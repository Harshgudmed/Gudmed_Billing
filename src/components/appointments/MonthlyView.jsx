import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { drName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { format, addMonths, subMonths, isSameDay, isToday } from "date-fns";
import { getPatientFullName } from "./appointmentHelpers";
import {
  STATUS_CONFIG,
  APPOINTMENTS_LIST_PER_PAGE,
} from "./appointmentConstants";
import { StatusBadge, TypeBadge } from "./AppointmentBadges";
import { formatTime12h } from "@/lib/format";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS_DOT_CLASS = {
  scheduled: "bg-blue-400",
  confirmed: "bg-indigo-400",
  checked_in: "bg-green-400",
  in_progress: "bg-orange-400",
  completed: "bg-gray-400",
  cancelled: "bg-red-400",
  no_show: "bg-amber-400",
  rescheduled: "bg-purple-400",
};

export default function MonthlyView({
  currentMonth,
  setCurrentMonth,
  selectedDate,
  setSelectedDate,
  monthDays,
  calendarCountsByDay,
  selectedDayAppointments,
  selectedDayTotal,
  selectedDayLoading,
  selectedDayPage,
  setSelectedDayPage,
  getPatient,
  onScheduleNew,
  onViewPatient,
}) {
  const totalPages = Math.ceil(selectedDayTotal / APPOINTMENTS_LIST_PER_PAGE);

  return (
    // Both cards share ONE bounded height so they align top-to-bottom, and that
    // height is capped to what's actually left below the fixed header/stats/tabs
    // — otherwise the taller "Today" panel pushed total page height past the
    // viewport, adding a whole-PAGE scrollbar that fought with the panel's own
    // Previous/Next pagination for "how do I see more" (two answers, one screen).
    // `lg:grid-rows-[minmax(0,1fr)]` matters as much as the height: a plain grid
    // row defaults to 'auto' sizing, which grows to fit content and IGNORES the
    // container's explicit height — so the fixed height above alone still let
    // the calendar's content push both boxes past it. minmax(0, 1fr) lets the
    // row actually shrink to the assigned height, so overflow inside each Card
    // scrolls (invisibly) instead of the whole page growing taller.
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:h-[calc(100vh-266px)] lg:grid-rows-[minmax(0,1fr)]">
      <Card className="lg:col-span-2 flex flex-col min-h-0">
        <CardHeader className="py-4">
          <div className="flex items-center justify-between">
            <CardTitle>{format(currentMonth, "MMMM yyyy")}</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={() => setCurrentMonth(new Date())}>
                Today
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="text-center text-sm font-medium text-gray-500 py-1"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: monthDays[0].getDay() }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}
            {monthDays.map((day) => {
              const daySummary =
                calendarCountsByDay.get(format(day, "yyyy-MM-dd")) || null;
              const dayTotal = daySummary?.total || 0;
              const visibleStatuses = Object.entries(daySummary?.byStatus || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);
              const isSelected = isSameDay(day, selectedDate);
              const isTodayDate = isToday(day);
              return (
                <Button
                  key={day.toISOString()}
                  variant={isSelected ? "default" : "ghost"}
                  className={`h-auto aspect-square flex flex-col items-center p-1 relative ${isTodayDate && !isSelected ? "ring-2 ring-blue-400" : ""}`}
                  onClick={() => setSelectedDate(day)}
                >
                  <span className="text-sm">{format(day, "d")}</span>
                  {dayTotal > 0 && (
                    <span
                      className={`mt-1 rounded px-1.5 text-[10px] font-medium leading-4 ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {dayTotal}
                    </span>
                  )}
                  {dayTotal > 0 && (
                    <div className="absolute bottom-1 flex gap-0.5">
                      {visibleStatuses.map(([status]) => (
                        <div
                          key={status}
                          className={`h-1.5 w-1.5 rounded-full ${
                            STATUS_DOT_CLASS[status] || "bg-gray-300"
                          }`}
                        />
                      ))}
                      {visibleStatuses.length < Object.keys(daySummary?.byStatus || {}).length && (
                        <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                      )}
                    </div>
                  )}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Same shared grid height as the calendar (set on the parent grid) — this
          card no longer sets its own max-height, so the two columns' bottoms
          line up instead of the panel running on past the calendar. */}
      <Card className="flex flex-col min-h-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            {isToday(selectedDate) ? "Today" : format(selectedDate, "EEEE, MMM d")}
          </CardTitle>
          <CardDescription>
            {selectedDayLoading ? "Loading appointments..." : `${selectedDayTotal} appointments`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col min-h-0">
          {/* Plain scrollable div, not the Radix ScrollArea used elsewhere — hidden
              scrollbar (no-scrollbar): Previous/Next below is the one visible way
              to see more, so a visible scroll affordance here would be a second,
              confusing answer to "how do I see the rest". Content still scrolls
              via wheel/touch if a page's 15 cards don't quite fit the box. */}
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pr-4">
            {selectedDayLoading ? (
              <div className="flex min-h-[240px] items-center justify-center text-gray-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading appointments...
              </div>
            ) : selectedDayAppointments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <CalendarDays className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No appointments scheduled</p>
                <Button variant="outline" className="mt-4" onClick={onScheduleNew}>
                  <Plus className="h-4 w-4 mr-2" />
                  Schedule Appointment
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Already sorted by appointmentTime on the server */}
                {selectedDayAppointments.map((appointment) => {
                    const patient = appointment.patient || getPatient(appointment.patientId);
                    const doctor = appointment.doctor;
                    const statusInfo = STATUS_CONFIG[appointment.status];
                    return (
                      <div
                        key={appointment.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md ${statusInfo?.bgColor || "bg-white"}`}
                        onClick={() => onViewPatient?.(appointment.patientId)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">
                              {formatTime12h(appointment.appointmentTime)}
                            </span>
                          </div>
                          <StatusBadge status={appointment.status} />
                        </div>
                        <div className="mt-2 font-medium">
                          {getPatientFullName(patient || null)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {patient?.mrn} • {doctor?.fullName ? drName(doctor.fullName) : "—"}
                        </div>
                        <div className="mt-2 text-sm text-gray-600">
                          {appointment.chiefComplaint}
                        </div>
                        <TypeBadge type={appointment.appointmentType} className="mt-2" />
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedDayPage((prev) => Math.max(1, prev - 1))}
                disabled={selectedDayPage === 1 || selectedDayLoading}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-gray-600">
                Page {selectedDayPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelectedDayPage((prev) => Math.min(totalPages, prev + 1))
                }
                disabled={selectedDayPage === totalPages || selectedDayLoading}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
