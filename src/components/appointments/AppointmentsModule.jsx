import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useOrgSettings } from "@/lib/useOrgSettings";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  startOfWeek,
  addDays,
} from "date-fns";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import client from "@/api/client";
import { drName } from "@/lib/utils";
import { appointmentSchema, editAppointmentSchema } from "./appointmentSchema";
import { printAppointmentCard } from "./appointmentPrint";
import { APPOINTMENTS_LIST_PER_PAGE, APPOINTMENT_STATUSES, WEEKLY_DAY_PAGE_SIZE } from "./appointmentConstants";
import { useAppointments } from "./useAppointments";
import { parseDate, getPatientFullName, byTime } from "./appointmentHelpers";
import CancelAppointmentDialog from "./CancelAppointmentDialog";
import RescheduleAppointmentDialog from "./RescheduleAppointmentDialog";
import AppointmentFormDialog from "./AppointmentFormDialog";
import WeeklyView from "./WeeklyView";
import DoctorSlotsView from "./DoctorSlotsView";
import MonthlyView from "./MonthlyView";
import TodayView from "./TodayView";
import AppointmentsListView from "./AppointmentsListView";
import StatisticsCards from "./StatisticsCards";

export default function AppointmentsModule() {
  const [activeTab, setActiveTab] = useState("calendar");
  const [orgInfo, setOrgInfo] = useState({
    name: "Hospital",
    address: "",
    city: "",
    phone: "",
    email: "",
  });

  // Consolidated state objects to reduce useState calls
  const [dates, setDates] = useState({
    selected: new Date(),
    currentMonth: new Date(),
    currentWeek: startOfWeek(new Date(), { weekStartsOn: 1 }),
  });

  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    doctor: "all",
    department: "all",
  });

  // Standalone (not in `filters`): this is the Doctor-Slots view selector, a
  // different concern from the List view's `filters.doctor`. It also has a clean
  // direct setter, so grouping it would only add wrapper boilerplate.
  const [selectedDoctor, setSelectedDoctor] = useState("all");

  const [dialog, setDialog] = useState({
    active: null, // 'new' | 'cancel' | 'reschedule' | 'edit' | null
    appointment: null,
    patient: null,
    reason: "",
    rescheduleDate: null,
    rescheduleTime: "",
    editing: null,
  });

  // Dashboard "Book Appointment" deep-links here with ?action=new → auto-open the dialog.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setDialog((prev) => ({ ...prev, active: "new" }));
      searchParams.delete("action"); // clean URL so back/refresh doesn't re-open
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [loadingState, setLoadingState] = useState({
    submitting: false,
    editSubmitting: false,
    selectedDay: false,
    feeCalculation: false,
  });

  // Toggle one loading flag without losing the others. (Object state replaces,
  // it doesn't merge — so we spread `prev` here once, instead of at every call.)
  const setLoading = (key, value) =>
    setLoadingState((prev) => ({ ...prev, [key]: value }));

  const isEditSubmittingRef = useRef(false);

  const [selectedAppointmentIds, setSelectedAppointmentIds] = useState(new Set());

  const [pagination, setPagination] = useState({
    list: 1,
    selectedDay: 1,
  });

  const [selectedDayData, setSelectedDayData] = useState({
    rows: [],
    total: 0,
  });

  const [listData, setListData] = useState({
    rows: [],
    total: 0,
  });

  // Weekly view data, keyed by day ("yyyy-MM-dd") → { rows, total }. Each day is
  // fetched separately (bounded preview) because a single capped range fetch
  // only ever returns the earliest day when volume is high (~2500/day).
  const [weekData, setWeekData] = useState({});

  const [calendarCounts, setCalendarCounts] = useState([]);
  const [refreshCount, setRefreshCount] = useState(0);

  const {
    appointments,
    doctors,
    departments,
    loading,
    error,
    fetchData,
    getPatient,
    getDoctor,
    createAppointment,
    updateAppointment,
    rescheduleAppointment,
    bulkUpdateStatus,
    fetchAppointmentsPage,
    fetchCalendarCounts,
    loadAppointmentsRange,
    fetchStats,
    mutationCount,
    setPatients,
  } = useAppointments();

  const { orgInfo: hookOrgInfo } = useOrgSettings();
  useEffect(() => {
    setOrgInfo(hookOrgInfo);
  }, [hookOrgInfo]);
  useEffect(() => {
    setPaginationField("list", 1);
  }, [dates.selected, filters.status, filters.doctor, filters.department, filters.search]);

  const form = useForm({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      patientId: "",
      departmentId: "",
      doctorId: "",
      appointmentDate: new Date(),
      appointmentTime: "",
      appointmentType: "new_patient",
      priority: "normal",
      consultationFee: "",
      notes: "",
    },
  });

  const editForm = useForm({
    resolver: zodResolver(editAppointmentSchema),
    defaultValues: {
      doctorId: "",
      appointmentDate: new Date(),
      appointmentTime: "",
      appointmentType: "new_patient",
      priority: "normal",
      status: "scheduled",
      chiefComplaint: "",
      notes: "",
    },
  });

  // Ask the backend what this visit will cost: it detects New vs Follow-up from the
  // patient's history with this doctor, applies the doctor's day-based fee slabs, and
  // resets to "New Patient" after 30 days. This is the SAME logic the booking endpoint
  // uses, so the preview always matches the charge.
  const watchDoctorId = form.watch("doctorId");
  const watchPatientId = form.watch("patientId");
  const watchDate = form.watch("appointmentDate");
  const [feeCalculation, setFeeCalculation] = useState(null);

  useEffect(() => {
    if (!watchDoctorId || !watchPatientId || !watchDate) {
      setFeeCalculation(null);
      setLoading("feeCalculation", false);
      return;
    }

    const controller = new AbortController();

    const calculateFee = async () => {
      setLoading("feeCalculation", true);

      try {
        const response = await client.get("/fee-slabs/calculate", {
          params: {
            doctorId: watchDoctorId,
            patientId: watchPatientId,
            date: parseDate(watchDate).toISOString(),
          },
          signal: controller.signal,
        });

        if (!response?.success) return;

        const calculation = response.data;
        setFeeCalculation(calculation);

        // Auto-flag the visit type (don't override a manual "emergency" choice)
        const current = form.getValues("appointmentType");
        if (current !== "emergency") {
          form.setValue(
            "appointmentType",
            calculation.isNewPatient ? "new_patient" : "follow_up",
          );
        }

        // Reflect the fee that will actually be charged
        form.setValue("consultationFee", String(calculation.fee));
      } catch (error) {
        if (error?.name !== "CanceledError" && error?.code !== "ERR_CANCELED") {
          setFeeCalculation(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading("feeCalculation", false);
        }
      }
    };

    calculateFee();

    return () => controller.abort();
  }, [watchDoctorId, watchPatientId, watchDate, form]);

  // Show all doctors until a department is selected, then match by department ID.
  const selectedDepartmentId = form.watch("departmentId");
  const availableDoctors = useMemo(() => {
    if (!selectedDepartmentId) return doctors;

    return doctors.filter(
      (doctor) => doctor.departmentId === selectedDepartmentId,
    );
  }, [selectedDepartmentId, doctors]);

  // Today's status counts come from the server (DB groupBy), refreshed on mount
  // and after any change — no need to load every appointment just to count them.
  const [stats, setStats] = useState({
    total: 0, scheduled: 0, confirmed: 0, checkedIn: 0,
    inProgress: 0, completed: 0, cancelled: 0, noShows: 0,
  });
  useEffect(() => {
    const loadStats = async () => {
      try {
        const stats = await fetchStats()
        setStats(stats)
      } catch (err) {
        console.error('Failed to load appointment stats:', err)
      }
    }

    loadStats()
  }, [mutationCount, refreshCount, fetchStats]);

  // Monthly grid loads compact per-day counts; row data is lazy-loaded only for
  // the selected day below.
  useEffect(() => {
    if (activeTab !== "calendar") return;
    let cancelled = false;

    const loadCalendarCounts = async () => {
      try {
        const rows = await fetchCalendarCounts(
          startOfMonth(dates.currentMonth).toISOString(),
          endOfMonth(dates.currentMonth).toISOString(),
        )
        if (!cancelled) setCalendarCounts(rows)
      } catch (err) {
        console.error('Failed to load calendar counts:', err)
        if (!cancelled) setCalendarCounts([])
      }
    }

    loadCalendarCounts()
    return () => {
      cancelled = true
    }
  }, [activeTab, dates.currentMonth, fetchCalendarCounts, mutationCount, refreshCount]);

  useEffect(() => {
    if (activeTab !== "calendar") return;
    let cancelled = false;

    const loadSelectedDay = async () => {
      try {
        setLoading("selectedDay", true);
        const { rows, total } = await fetchAppointmentsPage({
          page: pagination.selectedDay,
          pageSize: APPOINTMENTS_LIST_PER_PAGE,
          date: format(dates.selected, "yyyy-MM-dd"),
        })
        if (!cancelled) {
          setSelectedDayData({ rows, total })
        }
      } catch (err) {
        console.error('Failed to load selected day appointments:', err)
        if (!cancelled) {
          setSelectedDayData({ rows: [], total: 0 })
        }
      } finally {
        if (!cancelled) setLoading("selectedDay", false)
      }
    }

    loadSelectedDay()
    return () => {
      cancelled = true
    }
  }, [
    activeTab,
    dates.selected,
    pagination.selectedDay,
    fetchAppointmentsPage,
    mutationCount,
    refreshCount,
  ]);

  // Load just the date window the today/doctor-slot tabs need (the List tab and
  // Weekly tab fetch their own paginated data separately).
  useEffect(() => {
    const loadRange = async () => {
      try {
        let from, to;
        if (activeTab === "doctor-slots") {
          from = dates.currentWeek;
          to = addDays(dates.currentWeek, 6);
        } else if (activeTab === "today") {
          from = new Date();
          to = new Date();
        } else {
          return;
        }
        // Send calendar-day strings (yyyy-MM-dd), NOT toISOString(): the latter
        // shifts to UTC and drops the last day of the week in +offset zones like
        // IST. Matches the single-day fetch the List/calendar views already use.
        await loadAppointmentsRange(
          format(from, "yyyy-MM-dd"),
          format(to, "yyyy-MM-dd"),
        )
      } catch (err) {
        console.error('Failed to load appointments range:', err)
      }
    }

    loadRange()
  }, [activeTab, dates.currentWeek, loadAppointmentsRange, mutationCount, refreshCount]);

  // Weekly view: fetch a BOUNDED preview per day (first N) plus each day's true
  // total. A single flat range fetch is capped (limit 1000) and ordered by date,
  // so at high volume it returns only the earliest day — leaving the rest blank.
  useEffect(() => {
    if (activeTab !== "weekly") return;
    let cancelled = false;

    const loadWeek = async () => {
      try {
        const days = Array.from({ length: 7 }, (_, i) =>
          format(addDays(dates.currentWeek, i), "yyyy-MM-dd"),
        );
        const results = await Promise.all(
          days.map((date) =>
            fetchAppointmentsPage({
              page: 1,
              pageSize: WEEKLY_DAY_PAGE_SIZE,
              date,
            }),
          ),
        );
        if (cancelled) return;
        const next = {};
        days.forEach((date, i) => {
          next[date] = { rows: results[i].rows, total: results[i].total };
        });
        setWeekData(next);
      } catch (err) {
        console.error("Failed to load weekly appointments:", err);
        if (!cancelled) setWeekData({});
      }
    };

    loadWeek();
    return () => {
      cancelled = true;
    };
  }, [activeTab, dates.currentWeek, fetchAppointmentsPage, mutationCount, refreshCount]);

  // "+N more" in the Weekly view fetches the NEXT chunk for that one day and
  // appends it — a real server round-trip (limit/offset), not a client-side
  // reveal. loadedCount is always a multiple of WEEKLY_DAY_PAGE_SIZE (every
  // chunk, initial or appended, uses the same size), so it maps to the next
  // page number exactly.
  const [loadingMoreDay, setLoadingMoreDay] = useState(null);
  const loadMoreWeekDay = useCallback(
    async (date) => {
      setLoadingMoreDay(date);
      try {
        const loadedCount = weekData[date]?.rows.length ?? 0;
        const nextPage = Math.floor(loadedCount / WEEKLY_DAY_PAGE_SIZE) + 1;
        const { rows, total } = await fetchAppointmentsPage({
          page: nextPage,
          pageSize: WEEKLY_DAY_PAGE_SIZE,
          date,
        });
        setWeekData((prev) => ({
          ...prev,
          [date]: { rows: [...(prev[date]?.rows ?? []), ...rows], total },
        }));
      } catch (err) {
        console.error("Failed to load more appointments for", date, err);
        toast.error("Failed to load more appointments");
      } finally {
        setLoadingMoreDay(null);
      }
    },
    [weekData, fetchAppointmentsPage],
  );

  // Today's appointments split by lifecycle stage and sorted by time. Computed
  // once here so the "Today" tab's empty-check and its list render share one
  // source instead of filtering + sorting the same data twice.
  const { todaysUpcomingAppointments, todaysCompletedAppointments } = useMemo(() => {
    const today = new Date();

    const upcoming = appointments
      .filter(
        (apt) =>
          isSameDay(parseDate(apt.appointmentDate), today) &&
          APPOINTMENT_STATUSES.upcoming.includes(apt.status),
      )
      .sort(byTime);

    const completed = appointments
      .filter(
        (apt) =>
          isSameDay(parseDate(apt.appointmentDate), today) &&
          APPOINTMENT_STATUSES.completed.includes(apt.status),
      )
      .sort(byTime);

    return { todaysUpcomingAppointments: upcoming, todaysCompletedAppointments: completed };
  }, [appointments]);

  // List view data — fetched from the server (paginated + filtered) instead of
  // filtering the whole table in the browser. Debounced so typing in the search
  // box doesn't fire a request per keystroke.
  useEffect(() => {
    if (activeTab !== "list") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { rows, total } = await fetchAppointmentsPage({
          page: pagination.list,
          pageSize: APPOINTMENTS_LIST_PER_PAGE,
          date: format(dates.selected, "yyyy-MM-dd"),
          search: filters.search,
          status: filters.status,
          doctorId: filters.doctor,
          department: filters.department,
        })
        if (!cancelled) {
          setListData({ rows, total })
        }
      } catch (err) {
        console.error('Failed to load appointments list:', err)
        if (!cancelled) {
          setListData({ rows: [], total: 0 })
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeTab,
    pagination.list,
    dates.selected,
    filters.search,
    filters.status,
    filters.doctor,
    filters.department,
    mutationCount,
    refreshCount,
    fetchAppointmentsPage,
  ]);

  const calendarCountsByDay = useMemo(
    () => new Map(calendarCounts.map((summary) => [summary.date, summary])),
    [calendarCounts],
  );

  const monthDays = useMemo(() => {
    const start = startOfMonth(dates.currentMonth);
    const end = endOfMonth(dates.currentMonth);
    return eachDayOfInterval({ start, end });
  }, [dates.currentMonth]);

  // Dialog helpers: openDialog sets which dialog is active plus any data it
  // needs (appointment / editing). closeDialog resets every transient field at
  // once, so each handler just calls closeDialog() instead of spelling out the
  // reset every time.
  const openDialog = (type, extra = {}) =>
    setDialog((prev) => ({ ...prev, active: type, ...extra }));

  const closeDialog = () =>
    setDialog((prev) => ({
      ...prev,
      active: null,
      appointment: null,
      patient: null,
      reason: "",
      rescheduleDate: null,
      rescheduleTime: "",
      editing: null,
    }));

  // Update one field on the dialog's transient data (reason, rescheduleDate,
  // etc.) without touching the rest — same pattern as setLoading above.
  const setDialogField = (key, value) =>
    setDialog((prev) => ({ ...prev, [key]: value }));

  // Shared onOpenChange for every Dialog below: closing it (via Esc, overlay
  // click, or the X button) should behave exactly like pressing Cancel.
  const handleDialogOpenChange = (open) => {
    if (!open) closeDialog();
  };

  // Same one-field-at-a-time pattern as setDialogField, for the other three
  // grouped state objects used by the views below.
  const setDatesField = (key, value) =>
    setDates((prev) => ({ ...prev, [key]: value }));

  const setFiltersField = (key, value) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // Pagination setters are also handed to child views as direct setters, and
  // some of those views call them with an updater function (prev => next)
  // instead of a plain value — so this one supports both, same as useState's
  // own setter would.
  const setPaginationField = (key, value) =>
    setPagination((prev) => ({
      ...prev,
      [key]: typeof value === "function" ? value(prev[key]) : value,
    }));

  // Changing the selected date must reset selectedDay's page in the SAME
  // update, not a separate effect — otherwise the Monthly view's undebounced
  // day-fetch fires once with the stale page, then again with the reset page
  // (a real double-request). Same "reset in the same update" fix already
  // applied to patient search in usePatients.js. Shared by both the Monthly
  // and List views since they read/write the same `dates.selected`.
  const handleSelectedDateChange = (date) => {
    setDatesField("selected", date);
    setPaginationField("selectedDay", 1);
  };

  const changeStatus = useCallback(
    async (appointment, status, successMessage) => {
      try {
        await updateAppointment(appointment.id, { status });
        toast.success(successMessage);
      } catch {
        toast.error("Failed to update appointment");
      }
    },
    [updateAppointment]
  );

  const handleCheckIn = useCallback(
    (appointment) => changeStatus(appointment, "checked_in", "Patient checked in successfully"),
    [changeStatus]
  );

  const handleStartConsultation = useCallback(
    (appointment) => changeStatus(appointment, "in_progress", "Consultation started"),
    [changeStatus]
  );

  const handleComplete = useCallback(
    (appointment) => changeStatus(appointment, "completed", "Appointment completed"),
    [changeStatus]
  );

  const handleConfirm = useCallback(
    (appointment) => changeStatus(appointment, "confirmed", "Appointment confirmed"),
    [changeStatus]
  );

  const handleNoShow = useCallback(
    (appointment) => changeStatus(appointment, "no_show", "Marked as no-show"),
    [changeStatus]
  );

  const handleCancel = useCallback(async () => {
    if (!dialog.appointment || !dialog.reason.trim()) {
      toast.error("Please provide a cancellation reason");
      return;
    }
    try {
      setLoading("submitting", true);
      await updateAppointment(dialog.appointment.id, {
        status: "cancelled",
        cancellationReason: dialog.reason,
      });
      closeDialog();
      toast.success("Appointment cancelled");
    } catch {
      toast.error("Failed to cancel appointment");
    } finally {
      setLoading("submitting", false);
    }
  }, [dialog.appointment, dialog.reason, updateAppointment, closeDialog, setLoading]);

  const handleReschedule = useCallback(async () => {
    if (!dialog.appointment || !dialog.rescheduleDate || !dialog.rescheduleTime) {
      toast.error("Please select date and time");
      return;
    }
    try {
      setLoading("submitting", true);
      await rescheduleAppointment(dialog.appointment.id, {
        appointmentDate: dialog.rescheduleDate.toISOString(),
        appointmentTime: dialog.rescheduleTime,
      });
      closeDialog();
      toast.success("Appointment rescheduled");
    } catch {
      toast.error("Failed to reschedule appointment");
    } finally {
      setLoading("submitting", false);
    }
  }, [
    dialog.appointment,
    dialog.rescheduleDate,
    dialog.rescheduleTime,
    rescheduleAppointment,
    closeDialog,
    setLoading,
  ]);

  const openEditDialog = (appointment) => {
    editForm.reset({
      doctorId: appointment.doctorId || "",
      appointmentDate: parseDate(appointment.appointmentDate),
      appointmentTime: appointment.appointmentTime,
      appointmentType: appointment.appointmentType || "new_patient",
      priority: "normal",
      status: appointment.status,
      chiefComplaint: appointment.chiefComplaint || "",
      notes: appointment.notes || "",
    });
    openDialog("edit", { editing: appointment });
  };

  const handleEditSubmit = useCallback(async (data) => {
    if (!dialog.editing || isEditSubmittingRef.current) return;
    isEditSubmittingRef.current = true;
    setLoading("editSubmitting", true);
    try {
      await updateAppointment(dialog.editing.id, {
        doctorId: data.doctorId,
        appointmentDate: data.appointmentDate.toISOString(),
        appointmentTime: data.appointmentTime,
        appointmentType: data.appointmentType,
        chiefComplaint: data.chiefComplaint,
        notes: data.notes,
        status: data.status,
      });
      closeDialog();
      toast.success("Appointment updated successfully");
    } catch {
      toast.error("Failed to update appointment");
    } finally {
      setLoading("editSubmitting", false);
      isEditSubmittingRef.current = false;
    }
  }, [dialog.editing, updateAppointment, closeDialog, setLoading]);

  const toggleAppointmentSelection = useCallback((id) => {
    setSelectedAppointmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllAppointments = useCallback(() => {
    setSelectedAppointmentIds((prev) => {
      if (prev.size === listData.rows.length) return new Set();
      return new Set(listData.rows.map((appointment) => appointment.id));
    });
  }, [listData.rows]);

  const handleBulkStatusUpdate = useCallback(async (status) => {
    const count = selectedAppointmentIds.size;
    if (count === 0) return;
    try {
      await bulkUpdateStatus([...selectedAppointmentIds], status);
      setSelectedAppointmentIds(new Set());
      toast.success(
        `${count} appointment${count > 1 ? "s" : ""} marked as ${status.replace("_", " ")}`,
      );
    } catch {
      toast.error("Failed to update some appointments");
    }
  }, [selectedAppointmentIds, bulkUpdateStatus]);

  const handleSendReminder = useCallback(async (appointment) => {
    try {
      const patient = appointment.patient || getPatient(appointment.patientId);
      const phone = patient?.phonePrimary?.replace(/[^0-9]/g, "") || "";
      const patientName = patient
        ? `${patient.firstName} ${patient.lastName}`.trim()
        : "Patient";
      const aptDate = appointment.appointmentDate
        ? format(new Date(appointment.appointmentDate), "dd MMM yyyy")
        : "";
      const doctorName =
        appointment.doctor?.fullName || getDoctor(appointment.doctorId)?.fullName || "Doctor";
      const message = `Dear ${patientName}, your appointment with ${drName(doctorName)} is confirmed on ${aptDate} at ${appointment.appointmentTime}. Please arrive 10 minutes early. ${orgInfo.name}.`;
      if (phone)
        window.open(
          `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`,
          "_blank",
        );
      await updateAppointment(appointment.id, { reminderSent: true });
      toast.success(`WhatsApp reminder opened for ${patientName}`);
    } catch {
      toast.error("Failed to send reminder");
    }
  }, [getPatient, getDoctor, orgInfo, updateAppointment]);

  const handlePrintAppointmentCard = (appointment) =>
    printAppointmentCard(appointment, orgInfo);

  const handleRefresh = () => {
    fetchData();
    setRefreshCount((count) => count + 1);
  };

  const onSubmit = useCallback(async (data) => {
    try {
      setLoading("submitting", true);
      const patient = dialog.patient; // already chosen in the form
      const result = await createAppointment({
        patientId: data.patientId,
        doctorId: data.doctorId,
        ...(data.departmentId ? { departmentId: data.departmentId } : {}),
        appointmentDate: data.appointmentDate.toISOString(),
        appointmentTime: data.appointmentTime,
        appointmentType: data.appointmentType,
        notes: data.notes,
        priority: data.priority,
        // Fee is decided by the doctor on the backend — not sent from the form
      });
      closeDialog();
      form.reset();
      const patientName = getPatientFullName(patient || null);
      if (result?.draftInvoiceNumber) {
        toast.success(`Appointment booked for ${patientName}`, {
          description: `Draft invoice ${result.draftInvoiceNumber} created — go to Billing to review`,
          duration: 6000,
        });
      } else {
        toast.success(`Appointment created for ${patientName}`);
      }
    } catch {
      toast.error("Failed to create appointment");
    } finally {
      setLoading("submitting", false);
    }
  }, [dialog.patient, createAppointment, closeDialog, form, getPatientFullName, setLoading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-500">Loading appointments...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600 mb-4">Failed to load appointments data</p>
          <Button onClick={fetchData} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <CalendarDays className="h-8 w-8 text-blue-600" />
            Appointments
          </h1>
          <p className="text-gray-500">
            Schedule and manage patient appointments
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
         
          <AppointmentFormDialog
            isEdit={false}
            open={dialog.active === "new"}
            onOpenChange={(open) => {
              if (open) {
                openDialog("new");
              } else {
                closeDialog();
                form.reset();
              }
            }}
            form={form}
            onSubmit={onSubmit}
            selectedPatient={dialog.patient}
            setSelectedPatient={(patient) => setDialogField("patient", patient)}
            setPatients={setPatients}
            uniqueDepartments={departments}
            availableDoctors={availableDoctors}
            doctors={doctors}
            feeCalculation={feeCalculation}
            feeCalculationLoading={loadingState.feeCalculation}
            isSubmitting={loadingState.submitting}
            onCancel={closeDialog}
          />
        </div>
      </div>

      <StatisticsCards stats={stats} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5 max-w-3xl">
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="calendar">Monthly</TabsTrigger>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="doctor-slots">Doctor Slots</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="space-y-4">
          <MonthlyView
            currentMonth={dates.currentMonth}
            setCurrentMonth={(month) => setDatesField("currentMonth", month)}
            selectedDate={dates.selected}
            setSelectedDate={handleSelectedDateChange}
            monthDays={monthDays}
            calendarCountsByDay={calendarCountsByDay}
            selectedDayAppointments={selectedDayData.rows}
            selectedDayTotal={selectedDayData.total}
            selectedDayLoading={loadingState.selectedDay}
            selectedDayPage={pagination.selectedDay}
            setSelectedDayPage={(value) => setPaginationField("selectedDay", value)}
            getPatient={getPatient}
            onScheduleNew={() => openDialog("new")}
          />
        </TabsContent>

        <TabsContent value="weekly" className="space-y-4">
          <WeeklyView
            currentWeek={dates.currentWeek}
            setCurrentWeek={(week) => setDatesField("currentWeek", week)}
            weekData={weekData}
            onLoadMoreDay={loadMoreWeekDay}
            loadingMoreDay={loadingMoreDay}
            getPatient={getPatient}
          />
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          <AppointmentsListView
            searchQuery={filters.search}
            setSearchQuery={(search) => setFiltersField("search", search)}
            selectedDate={dates.selected}
            setSelectedDate={handleSelectedDateChange}
            statusFilter={filters.status}
            setStatusFilter={(status) => setFiltersField("status", status)}
            departmentFilter={filters.department}
            setDepartmentFilter={(department) => setFiltersField("department", department)}
            doctorFilter={filters.doctor}
            setDoctorFilter={(doctor) => setFiltersField("doctor", doctor)}
            uniqueDepartments={departments}
            filterDoctors={doctors}
            filteredAppointments={listData.rows}
            total={listData.total}
            getPatient={getPatient}
            selectedAppointmentIds={selectedAppointmentIds}
            toggleAppointmentSelection={toggleAppointmentSelection}
            toggleAllAppointments={toggleAllAppointments}
            clearSelection={() => setSelectedAppointmentIds(new Set())}
            onBulkStatusUpdate={handleBulkStatusUpdate}
            appointmentsListPage={pagination.list}
            setAppointmentsListPage={(value) => setPaginationField("list", value)}
            onScheduleNew={() => openDialog("new")}
            onEdit={openEditDialog}
            onConfirm={handleConfirm}
            onCheckIn={handleCheckIn}
            onStartConsultation={handleStartConsultation}
            onComplete={handleComplete}
            onNoShow={handleNoShow}
            onSendReminder={handleSendReminder}
            onReschedule={(appointment) => openDialog("reschedule", { appointment })}
            onCancelAppointment={(appointment) => openDialog("cancel", { appointment })}
            onPrint={handlePrintAppointmentCard}
          />
        </TabsContent>

        <TabsContent value="today" className="space-y-4">
          <TodayView
            upcomingAppointments={todaysUpcomingAppointments}
            completedAppointments={todaysCompletedAppointments}
            getPatient={getPatient}
            onConfirm={handleConfirm}
            onCheckIn={handleCheckIn}
            onStartConsultation={handleStartConsultation}
            onComplete={handleComplete}
            onSendReminder={handleSendReminder}
          />
        </TabsContent>

        <TabsContent value="doctor-slots" className="space-y-4">
          <DoctorSlotsView
            selectedDoctor={selectedDoctor}
            setSelectedDoctor={setSelectedDoctor}
            doctors={doctors}
            currentWeek={dates.currentWeek}
            setCurrentWeek={(week) => setDatesField("currentWeek", week)}
            appointments={appointments}
            getPatient={getPatient}
          />
        </TabsContent>
      </Tabs>

      <AppointmentFormDialog
        isEdit={true}
        open={dialog.active === "edit"}
        onOpenChange={handleDialogOpenChange}
        form={editForm}
        onSubmit={handleEditSubmit}
        editingAppointment={dialog.editing}
        getPatient={getPatient}
        doctors={doctors}
        isSubmitting={loadingState.editSubmitting}
        onCancel={closeDialog}
      />

      <CancelAppointmentDialog
        open={dialog.active === "cancel"}
        onOpenChange={handleDialogOpenChange}
        appointment={dialog.appointment}
        getPatient={getPatient}
        reason={dialog.reason}
        onReasonChange={(reason) => setDialogField("reason", reason)}
        onKeep={closeDialog}
        onConfirm={handleCancel}
        isSubmitting={loadingState.submitting}
      />

      <RescheduleAppointmentDialog
        open={dialog.active === "reschedule"}
        onOpenChange={handleDialogOpenChange}
        appointment={dialog.appointment}
        getPatient={getPatient}
        date={dialog.rescheduleDate}
        onDateChange={(date) => setDialogField("rescheduleDate", date)}
        time={dialog.rescheduleTime}
        onTimeChange={(time) => setDialogField("rescheduleTime", time)}
        onCancel={closeDialog}
        onConfirm={handleReschedule}
        isSubmitting={loadingState.submitting}
      />
    </div>
  );
}
