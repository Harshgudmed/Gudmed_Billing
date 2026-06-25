import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CalendarDays, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { format, addMonths, subMonths, isSameDay, isToday } from "date-fns";
import { getPatientFullName } from "./appointmentHelpers";
import { STATUS_CONFIG, APPOINTMENT_TYPE_CONFIG } from "./appointmentConstants";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthlyView({
  currentMonth,
  setCurrentMonth,
  selectedDate,
  setSelectedDate,
  monthDays,
  getAppointmentsForDate,
  getPatient,
  onScheduleNew,
}) {
  const selectedDayAppointments = getAppointmentsForDate(selectedDate);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader>
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
        <CardContent>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="text-center text-sm font-medium text-gray-500 py-2"
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
              const dayAppointments = getAppointmentsForDate(day);
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
                  {dayAppointments.length > 0 && (
                    <div className="absolute bottom-1 flex gap-0.5">
                      {dayAppointments.slice(0, 3).map((appointment) => (
                        <div
                          key={appointment.id}
                          className={`h-1.5 w-1.5 rounded-full ${appointment.status === "completed" ? "bg-gray-400" : appointment.status === "cancelled" ? "bg-red-400" : appointment.status === "in_progress" ? "bg-orange-400" : "bg-blue-400"}`}
                        />
                      ))}
                      {dayAppointments.length > 3 && (
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

      {/* Selected day details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            {isToday(selectedDate) ? "Today" : format(selectedDate, "EEEE, MMM d")}
          </CardTitle>
          <CardDescription>
            {selectedDayAppointments.length} appointments
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-300px)] min-h-[400px] pr-4">
            {selectedDayAppointments.length === 0 ? (
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
                {[...selectedDayAppointments]
                  .sort((a, b) =>
                    a.appointmentTime.localeCompare(b.appointmentTime),
                  )
                  .map((appointment) => {
                    const patient = appointment.patient || getPatient(appointment.patientId);
                    const doctor = appointment.doctor;
                    const statusInfo = STATUS_CONFIG[appointment.status];
                    const StatusIcon = statusInfo?.icon || CalendarDays;
                    return (
                      <div
                        key={appointment.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md ${statusInfo?.bgColor || "bg-white"}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium">
                              {appointment.appointmentTime}
                            </span>
                          </div>
                          <Badge
                            className={`${statusInfo?.bgColor} ${statusInfo?.color} border-0`}
                          >
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {statusInfo?.label}
                          </Badge>
                        </div>
                        <div className="mt-2 font-medium">
                          {getPatientFullName(patient || null)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {patient?.mrn} • {doctor?.fullName}
                        </div>
                        <div className="mt-2 text-sm text-gray-600">
                          {appointment.chiefComplaint}
                        </div>
                        <Badge
                          variant="outline"
                          className={`mt-2 ${APPOINTMENT_TYPE_CONFIG[appointment.appointmentType || "new_patient"]?.color}`}
                        >
                          {
                            APPOINTMENT_TYPE_CONFIG[
                              appointment.appointmentType || "new_patient"
                            ]?.label
                          }
                        </Badge>
                      </div>
                    );
                  })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
