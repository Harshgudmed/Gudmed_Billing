import { useState, useEffect, useMemo, useRef } from "react";
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
import { APPOINTMENTS_LIST_PER_PAGE } from "./appointmentConstants";
import { useAppointments } from "./useAppointments";
import { parseDate, getPatientFullName, byTime } from "./appointmentHelpers";
import CancelAppointmentDialog from "./CancelAppointmentDialog";
import RescheduleAppointmentDialog from "./RescheduleAppointmentDialog";
import EditAppointmentDialog from "./EditAppointmentDialog";
import NewAppointmentDialog from "./NewAppointmentDialog";
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
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [currentWeek, setCurrentWeek] = useState(
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selectedDoctor, setSelectedDoctor] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all"); // department NAME or 'all'
  // Only one dialog is ever open — a single value prevents invalid states.
  const [activeDialog, setActiveDialog] = useState(null); // 'new' | 'cancel' | 'reschedule' | 'edit' | null
  const [selectedAppointment, setSelectedAppointment] = useState(null);

  // Dashboard "Book Appointment" deep-links here with ?action=new → auto-open the dialog.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setActiveDialog("new");
      searchParams.delete("action"); // clean URL so back/refresh doesn't re-open
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState(null);
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingAppointment, setEditingAppointment] = useState(null);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const isEditSubmittingRef = useRef(false);

  const [selectedAppointmentIds, setSelectedAppointmentIds] = useState(new Set());
  const [appointmentsListPage, setAppointmentsListPage] = useState(1);
  const [selectedDayPage, setSelectedDayPage] = useState(1);
  const [selectedDayRows, setSelectedDayRows] = useState([]);
  const [selectedDayTotal, setSelectedDayTotal] = useState(0);
  const [selectedDayLoading, setSelectedDayLoading] = useState(false);
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
    setAppointmentsListPage(1);
  }, [selectedDate, statusFilter, doctorFilter, departmentFilter, searchQuery]);
  useEffect(() => {
    setSelectedDayPage(1);
  }, [selectedDate]);

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
  const [feeCalculationLoading, setFeeCalculationLoading] = useState(false);

  useEffect(() => {
    if (!watchDoctorId || !watchPatientId || !watchDate) {
      setFeeCalculation(null);
      setFeeCalculationLoading(false);
      return;
    }

    const controller = new AbortController();

    const calculateFee = async () => {
      setFeeCalculationLoading(true);

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
          setFeeCalculationLoading(false);
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
          startOfMonth(currentMonth).toISOString(),
          endOfMonth(currentMonth).toISOString(),
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
  }, [activeTab, currentMonth, fetchCalendarCounts, mutationCount, refreshCount]);

  useEffect(() => {
    if (activeTab !== "calendar") return;
    let cancelled = false;
    setSelectedDayLoading(true);
    fetchAppointmentsPage({
      page: selectedDayPage,
      pageSize: APPOINTMENTS_LIST_PER_PAGE,
      date: format(selectedDate, "yyyy-MM-dd"),
    })
      .then(({ rows, total }) => {
        if (!cancelled) {
          setSelectedDayRows(rows);
          setSelectedDayTotal(total);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedDayRows([]);
          setSelectedDayTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setSelectedDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    selectedDate,
    selectedDayPage,
    fetchAppointmentsPage,
    mutationCount,
    refreshCount,
  ]);

  // Load just the date window the weekly/today/doctor-slot tabs need (the List
  // tab fetches its own paginated data separately).
  useEffect(() => {
    let from, to;
    if (activeTab === "weekly" || activeTab === "doctor-slots") {
      from = currentWeek;
      to = addDays(currentWeek, 6);
    } else if (activeTab === "today") {
      from = new Date();
      to = new Date();
    } else {
      return;
    }
    loadAppointmentsRange(from.toISOString(), to.toISOString()).catch(() => {});
  }, [activeTab, currentWeek, loadAppointmentsRange, mutationCount, refreshCount]);

  // Today's appointments split by lifecycle stage and sorted by time. Computed
  // once here so the "Today" tab's empty-check and its list render share one
  // source instead of filtering + sorting the same data twice.
  const todaysUpcomingAppointments = useMemo(
    () =>
      appointments
        .filter(
          (appointment) =>
            isSameDay(parseDate(appointment.appointmentDate), new Date()) &&
            ["scheduled", "confirmed", "checked_in", "in_progress"].includes(
              appointment.status,
            ),
        )
        .sort(byTime),
    [appointments],
  );
  const todaysCompletedAppointments = useMemo(
    () =>
      appointments
        .filter(
          (appointment) =>
            isSameDay(parseDate(appointment.appointmentDate), new Date()) &&
            ["completed", "cancelled", "no_show", "rescheduled"].includes(
              appointment.status,
            ),
        )
        .sort(byTime),
    [appointments],
  );

  // List view data — fetched from the server (paginated + filtered) instead of
  // filtering the whole table in the browser. Debounced so typing in the search
  // box doesn't fire a request per keystroke.
  const [listRows, setListRows] = useState([]);
  const [listTotal, setListTotal] = useState(0);
  useEffect(() => {
    if (activeTab !== "list") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchAppointmentsPage({
        page: appointmentsListPage,
        pageSize: APPOINTMENTS_LIST_PER_PAGE,
        date: format(selectedDate, "yyyy-MM-dd"),
        search: searchQuery,
        status: statusFilter,
        doctorId: doctorFilter,
        department: departmentFilter,
      })
        .then(({ rows, total }) => {
          if (!cancelled) {
            setListRows(rows);
            setListTotal(total);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setListRows([]);
            setListTotal(0);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeTab,
    appointmentsListPage,
    selectedDate,
    searchQuery,
    statusFilter,
    doctorFilter,
    departmentFilter,
    mutationCount,
    refreshCount,
    fetchAppointmentsPage,
  ]);

  const calendarCountsByDay = useMemo(
    () => new Map(calendarCounts.map((summary) => [summary.date, summary])),
    [calendarCounts],
  );

  const monthDays = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  // ── Action handlers ──

  // One status-change path for all the simple lifecycle actions, instead of
  // five near-identical handlers.
  const changeStatus = async (appointment, status, successMessage) => {
    try {
      await updateAppointment(appointment.id, { status });
      toast.success(successMessage);
    } catch {
      toast.error("Failed to update appointment");
    }
  };

  const handleCheckIn = (appointment) => changeStatus(appointment, "checked_in", "Patient checked in successfully");
  const handleStartConsultation = (appointment) => changeStatus(appointment, "in_progress", "Consultation started");
  const handleComplete = (appointment) => changeStatus(appointment, "completed", "Appointment completed");
  const handleConfirm = (appointment) => changeStatus(appointment, "confirmed", "Appointment confirmed");
  const handleNoShow = (appointment) => changeStatus(appointment, "no_show", "Marked as no-show");

  const handleCancel = async () => {
    if (!selectedAppointment || !cancellationReason.trim()) {
      toast.error("Please provide a cancellation reason");
      return;
    }
    try {
      setIsSubmitting(true);
      await updateAppointment(selectedAppointment.id, {
        status: "cancelled",
        cancellationReason,
      });
      setActiveDialog(null);
      setSelectedAppointment(null);
      setCancellationReason("");
      toast.success("Appointment cancelled");
    } catch {
      toast.error("Failed to cancel appointment");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReschedule = async () => {
    if (!selectedAppointment || !rescheduleDate || !rescheduleTime) {
      toast.error("Please select date and time");
      return;
    }
    try {
      setIsSubmitting(true);
      // Single atomic backend call — creates the new appointment and marks the
      // old one rescheduled together (no orphan-row risk if one half fails).
      await rescheduleAppointment(selectedAppointment.id, {
        appointmentDate: rescheduleDate.toISOString(),
        appointmentTime: rescheduleTime,
      });
      setActiveDialog(null);
      setSelectedAppointment(null);
      setRescheduleDate(null);
      setRescheduleTime("");
      toast.success("Appointment rescheduled");
    } catch {
      toast.error("Failed to reschedule appointment");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = (appointment) => {
    setEditingAppointment(appointment);
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
    setActiveDialog("edit");
  };

  const handleEditSubmit = async (data) => {
    if (!editingAppointment || isEditSubmittingRef.current) return;
    isEditSubmittingRef.current = true;
    setIsEditSubmitting(true);
    try {
      await updateAppointment(editingAppointment.id, {
        doctorId: data.doctorId,
        appointmentDate: data.appointmentDate.toISOString(),
        appointmentTime: data.appointmentTime,
        appointmentType: data.appointmentType,
        chiefComplaint: data.chiefComplaint,
        notes: data.notes,
        status: data.status,
      });
      setActiveDialog(null);
      setEditingAppointment(null);
      toast.success("Appointment updated successfully");
    } catch {
      toast.error("Failed to update appointment");
    } finally {
      setIsEditSubmitting(false);
      isEditSubmittingRef.current = false;
    }
  };

  const toggleAppointmentSelection = (id) => {
    setSelectedAppointmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllAppointments = () => {
    if (selectedAppointmentIds.size === listRows.length)
      setSelectedAppointmentIds(new Set());
    else setSelectedAppointmentIds(new Set(listRows.map((appointment) => appointment.id)));
  };

  const handleBulkStatusUpdate = async (status) => {
    const count = selectedAppointmentIds.size;
    if (count === 0) return;
    try {
      // One request for all selected (was one PATCH per appointment).
      await bulkUpdateStatus([...selectedAppointmentIds], status);
      setSelectedAppointmentIds(new Set());
      toast.success(
        `${count} appointment${count > 1 ? "s" : ""} marked as ${status.replace("_", " ")}`,
      );
    } catch {
      toast.error("Failed to update some appointments");
    }
  };

  const handleSendReminder = async (appointment) => {
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
  };

  const handlePrintAppointmentCard = (appointment) =>
    printAppointmentCard(appointment, orgInfo);

  const handleRefresh = () => {
    fetchData();
    setRefreshCount((count) => count + 1);
  };

  const onSubmit = async (data) => {
    try {
      setIsSubmitting(true);
      const patient = selectedPatient; // already chosen in the form
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
      setActiveDialog(null);
      setSelectedPatient(null);
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
      setIsSubmitting(false);
    }
  };

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
      {/* Header */}
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
         
          <NewAppointmentDialog
            open={activeDialog === "new"}
            onOpenChange={(open) => {
              setActiveDialog(open ? "new" : null);
              if (!open) {
                setSelectedPatient(null);
                form.reset();
              }
            }}
            form={form}
            onSubmit={onSubmit}
            selectedPatient={selectedPatient}
            setSelectedPatient={setSelectedPatient}
            setPatients={setPatients}
            uniqueDepartments={departments}
            availableDoctors={availableDoctors}
            doctors={doctors}
            feeCalculation={feeCalculation}
            feeCalculationLoading={feeCalculationLoading}
            isSubmitting={isSubmitting}
            onCancel={() => setActiveDialog(null)}
          />
        </div>
      </div>

      {/* Statistics Cards */}
      <StatisticsCards stats={stats} />

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5 max-w-3xl">
           <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="calendar">Monthly</TabsTrigger>
     
          <TabsTrigger value="list">List View</TabsTrigger>
         
          <TabsTrigger value="doctor-slots">Doctor Slots</TabsTrigger>
        </TabsList>

        {/* ── Monthly Calendar ── */}
        <TabsContent value="calendar" className="space-y-4">
          <MonthlyView
            currentMonth={currentMonth}
            setCurrentMonth={setCurrentMonth}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            monthDays={monthDays}
            calendarCountsByDay={calendarCountsByDay}
            selectedDayAppointments={selectedDayRows}
            selectedDayTotal={selectedDayTotal}
            selectedDayLoading={selectedDayLoading}
            selectedDayPage={selectedDayPage}
            setSelectedDayPage={setSelectedDayPage}
            getPatient={getPatient}
            onScheduleNew={() => setActiveDialog("new")}
          />
        </TabsContent>

        {/* ── Weekly View ── */}
        <TabsContent value="weekly" className="space-y-4">
          <WeeklyView
            currentWeek={currentWeek}
            setCurrentWeek={setCurrentWeek}
            appointments={appointments}
            getPatient={getPatient}
          />
        </TabsContent>

        {/* ── List View ── */}
        <TabsContent value="list" className="space-y-4">
          <AppointmentsListView
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            departmentFilter={departmentFilter}
            setDepartmentFilter={setDepartmentFilter}
            doctorFilter={doctorFilter}
            setDoctorFilter={setDoctorFilter}
            uniqueDepartments={departments}
            filterDoctors={doctors}
            filteredAppointments={listRows}
            total={listTotal}
            getPatient={getPatient}
            selectedAppointmentIds={selectedAppointmentIds}
            toggleAppointmentSelection={toggleAppointmentSelection}
            toggleAllAppointments={toggleAllAppointments}
            clearSelection={() => setSelectedAppointmentIds(new Set())}
            onBulkStatusUpdate={handleBulkStatusUpdate}
            appointmentsListPage={appointmentsListPage}
            setAppointmentsListPage={setAppointmentsListPage}
            onScheduleNew={() => setActiveDialog("new")}
            onEdit={openEditDialog}
            onConfirm={handleConfirm}
            onCheckIn={handleCheckIn}
            onStartConsultation={handleStartConsultation}
            onComplete={handleComplete}
            onNoShow={handleNoShow}
            onSendReminder={handleSendReminder}
            onReschedule={(appointment) => {
              setSelectedAppointment(appointment);
              setActiveDialog("reschedule");
            }}
            onCancelAppointment={(appointment) => {
              setSelectedAppointment(appointment);
              setActiveDialog("cancel");
            }}
            onPrint={handlePrintAppointmentCard}
          />
        </TabsContent>

        {/* ── Today's Schedule ── */}
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

        {/* ── Doctor Slots ── */}
        <TabsContent value="doctor-slots" className="space-y-4">
          <DoctorSlotsView
            selectedDoctor={selectedDoctor}
            setSelectedDoctor={setSelectedDoctor}
            doctors={doctors}
            currentWeek={currentWeek}
            setCurrentWeek={setCurrentWeek}
            appointments={appointments}
            getPatient={getPatient}
          />
        </TabsContent>
      </Tabs>

      <EditAppointmentDialog
        open={activeDialog === "edit"}
        onOpenChange={(open) => {
          setActiveDialog(open ? "edit" : null);
          if (!open) setEditingAppointment(null);
        }}
        form={editForm}
        onSubmit={handleEditSubmit}
        editingAppointment={editingAppointment}
        getPatient={getPatient}
        doctors={doctors}
        isSubmitting={isEditSubmitting}
        onCancel={() => setActiveDialog(null)}
      />

      <CancelAppointmentDialog
        open={activeDialog === "cancel"}
        onOpenChange={(open) => setActiveDialog(open ? "cancel" : null)}
        appointment={selectedAppointment}
        getPatient={getPatient}
        reason={cancellationReason}
        onReasonChange={setCancellationReason}
        onKeep={() => {
          setActiveDialog(null);
          setSelectedAppointment(null);
          setCancellationReason("");
        }}
        onConfirm={handleCancel}
        isSubmitting={isSubmitting}
      />

      <RescheduleAppointmentDialog
        open={activeDialog === "reschedule"}
        onOpenChange={(open) => setActiveDialog(open ? "reschedule" : null)}
        appointment={selectedAppointment}
        getPatient={getPatient}
        date={rescheduleDate}
        onDateChange={setRescheduleDate}
        time={rescheduleTime}
        onTimeChange={setRescheduleTime}
        onCancel={() => {
          setActiveDialog(null);
          setSelectedAppointment(null);
          setRescheduleDate(null);
          setRescheduleTime("");
        }}
        onConfirm={handleReschedule}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
