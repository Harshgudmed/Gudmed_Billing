import { useMemo } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, ChevronLeft, ChevronRight } from "lucide-react";
import { format, addDays, addWeeks, subWeeks, isToday, endOfDay } from "date-fns";
import { drName } from "@/lib/utils";
import { parseDate } from "./appointmentHelpers";
import { useDoctorTimetable, slotsForDate } from "@/components/common/hooks/useDoctorTimetable";
import { getFullName } from "@/lib/patient";
import { formatTime12h } from "@/lib/format";

// Most doctor cards to render in the "this week" summary (there are 1000+ doctors).
const SUMMARY_CAP = 24;

export default function DoctorSlotsView({
  selectedDoctor,
  setSelectedDoctor,
  doctors,
  currentWeek,
  setCurrentWeek,
  appointments,
  getPatient,
}) {
  // Build a "yyyy-MM-dd|HH:mm" → appointments[] lookup ONCE per render (filtered
  // by the selected doctor), instead of re-scanning the whole list in every one
  // of the 28×7 grid cells.
  const slotMap = useMemo(() => {
    const map = new Map();
    for (const appointment of appointments) {
      if (selectedDoctor !== "all" && appointment.doctorId !== selectedDoctor)
        continue;
      const key = `${format(parseDate(appointment.appointmentDate), "yyyy-MM-dd")}|${appointment.appointmentTime}`;
      const list = map.get(key);
      if (list) list.push(appointment);
      else map.set(key, [appointment]);
    }
    return map;
  }, [appointments, selectedDoctor]);

  // The doctor's OWN timetable drives this grid — a fixed slot list both invented
  // hours a doctor never sits and, worse, had no row for 12:00/13:00/17:00, so real
  // bookings at those times were simply absent from the grid.
  const { doctorTimetable } = useDoctorTimetable(
    selectedDoctor !== "all" ? selectedDoctor : null,
    null,
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i)),
    [currentWeek],
  );

  // Which slots this doctor sits, per day of the shown week.
  const sittingByDay = useMemo(() => {
    const map = new Map();
    for (const day of days) {
      const ymd = format(day, "yyyy-MM-dd");
      map.set(ymd, new Set(slotsForDate(doctorTimetable, ymd)));
    }
    return map;
  }, [doctorTimetable, days]);

  // Rows = every hour the doctor sits this week, PLUS every hour that actually has
  // a booking (so an appointment outside the timetable is still visible, never lost).
  const timeRows = useMemo(() => {
    const rows = new Set();
    for (const slots of sittingByDay.values()) for (const s of slots) rows.add(s);
    for (const key of slotMap.keys()) rows.add(key.split("|")[1]);
    return [...rows].sort();
  }, [sittingByDay, slotMap]);

  // Per-doctor week counts in a SINGLE pass over the appointments — the old code
  // ran appointments.filter() once per doctor (1000+ doctors × the whole list).
  // Only doctors with at least one booking this week are kept, busiest first.
  const summaryDoctors = useMemo(() => {
    const weekStart = currentWeek;
    const weekEnd = endOfDay(addDays(currentWeek, 6));
    const counts = new Map();
    for (const a of appointments) {
      if (selectedDoctor !== "all" && a.doctorId !== selectedDoctor) continue;
      const d = parseDate(a.appointmentDate);
      if (d < weekStart || d > weekEnd) continue;
      counts.set(a.doctorId, (counts.get(a.doctorId) || 0) + 1);
    }
    return doctors
      .map((doctor) => ({ doctor, count: counts.get(doctor.id) || 0 }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [appointments, doctors, selectedDoctor, currentWeek]);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5 text-blue-600" />
              Doctor Slot Availability
            </CardTitle>
            <div className="flex items-center gap-3">
              <Select value={selectedDoctor} onValueChange={setSelectedDoctor}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select Doctor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Doctors</SelectItem>
                  {doctors.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {drName(doctor.fullName)}
                      {doctor.specialization ? ` — ${doctor.specialization}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium px-2">
                  {format(currentWeek, "dd MMM")} –{" "}
                  {format(addDays(currentWeek, 6), "dd MMM")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* One bounded, scrollable frame — the grid scrolls inside this, the page
          doesn't grow to the height of the busiest day. Sticky header + time
          column keep context while scrolling. */}
      <div className="overflow-auto thin-scroll max-h-[70vh] rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="border bg-gray-50 px-3 py-2 text-left w-20 font-semibold text-gray-600 sticky left-0 z-20">
                Time
              </th>
              {Array.from({ length: 7 }).map((_, i) => {
                const day = addDays(currentWeek, i);
                return (
                  <th
                    key={i}
                    className={`border px-2 py-2 text-center font-semibold ${isToday(day) ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600"}`}
                  >
                    <div>{format(day, "EEE")}</div>
                    <div className="text-base font-bold">{format(day, "d")}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {timeRows.length === 0 && (
              <tr>
                <td colSpan={8} className="border px-3 py-8 text-center text-gray-400">
                  {selectedDoctor === "all"
                    ? "No appointments booked this week."
                    : "This doctor has no consultation hours set. Add them under Doctor Accountability → Timing."}
                </td>
              </tr>
            )}
            {timeRows.map((slot) => (
              <tr key={slot} className="hover:bg-gray-50">
                <td className="border px-3 py-1.5 font-medium text-gray-500 bg-gray-50 sticky left-0 z-[5]">
                  {formatTime12h(slot)}
                </td>
                {days.map((day, i) => {
                  const ymd = format(day, "yyyy-MM-dd");
                  const slotAppointments = slotMap.get(`${ymd}|${slot}`) || [];
                  const isBooked = slotAppointments.length > 0;
                  // With "All Doctors" there is no single timetable to check against,
                  // so an empty cell just reads as free.
                  const isSitting =
                    selectedDoctor === "all" || sittingByDay.get(ymd)?.has(slot);
                  return (
                    <td
                      key={i}
                      className={`border p-1 align-top ${
                        isBooked ? "bg-red-50" : isSitting ? "bg-green-50" : "bg-gray-100"
                      }`}
                    >
                      {isBooked ? (
                        // A slot can hold hundreds of bookings (a demo day puts
                        // thousands at one time). Render a FIXED-HEIGHT, internally
                        // scrollable list — like a feed — so one busy cell can't
                        // stretch the row to thousands of px, and cap the DOM at
                        // MAX_CARDS so the browser never mounts 10k nodes per cell.
                        <div className="max-h-32 overflow-y-auto thin-scroll space-y-0.5 pr-0.5">
                          <div className="sticky top-0 bg-red-50/95 text-[10px] font-semibold text-red-700 pb-0.5">
                            {slotAppointments.length} booked
                          </div>
                          {/* Every loaded booking is rendered — the cell scrolls, so
                              even a busy slot stays compact. The set is already
                              bounded by the page's capped fetch, so the DOM stays
                              light without a per-cell cap. */}
                          {slotAppointments.map((appointment) => {
                            const patient =
                              appointment.patient || getPatient(appointment.patientId);
                            const name = patient
                              ? getFullName(patient)
                              : "Booked";
                            return (
                              <div
                                key={appointment.id}
                                className="rounded bg-red-100 border border-red-200 px-1 py-0.5 text-[10px] text-red-700 truncate text-left"
                                title={name}
                              >
                                {name}
                              </div>
                            );
                          })}
                        </div>
                      ) : isSitting ? (
                        <span className="text-green-400 text-[10px]">Free</span>
                      ) : (
                        <span className="text-gray-300 text-[10px]">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-100 border border-green-200" />
          <span className="text-gray-600">Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-100 border border-red-200" />
          <span className="text-gray-600">Booked</span>
        </div>
        {selectedDoctor !== "all" && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-gray-100 border border-gray-200" />
            <span className="text-gray-600">Not sitting</span>
          </div>
        )}
      </div>

      {summaryDoctors.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-gray-600 mb-2">
            Doctors with appointments this week
            {summaryDoctors.length > SUMMARY_CAP && (
              <span className="font-normal text-gray-400"> — showing top {SUMMARY_CAP} of {summaryDoctors.length}</span>
            )}
          </div>
          {/* Bounded + scrollable: with 1000+ doctors a plain grid grew the page to
              tens of thousands of px. Only doctors who actually have bookings this
              week are shown, busiest first. */}
          <div className="max-h-72 overflow-y-auto thin-scroll grid grid-cols-2 lg:grid-cols-4 gap-4 pr-1">
            {summaryDoctors.slice(0, SUMMARY_CAP).map(({ doctor, count }) => (
              <Card key={doctor.id} className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                    {doctor.fullName.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{drName(doctor.fullName)}</div>
                    <div className="text-xs text-gray-500">{doctor.specialization || "General"}</div>
                    <div className="text-blue-600 font-bold">{count} this week</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
