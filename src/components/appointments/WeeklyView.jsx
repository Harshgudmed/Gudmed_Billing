import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  addDays,
  addWeeks,
  subWeeks,
  startOfWeek,
  isSameDay,
  isToday,
} from "date-fns";
import { drName } from "@/lib/utils";
import { parseDate } from "./appointmentHelpers";
import { STATUS_CONFIG } from "./appointmentConstants";

export default function WeeklyView({
  currentWeek,
  setCurrentWeek,
  appointments,
  getPatient,
}) {
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              Weekly Calendar — {format(currentWeek, "dd MMM")} –{" "}
              {format(addDays(currentWeek, 6), "dd MMM yyyy")}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))
                }
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="grid grid-cols-7 border-b">
            {Array.from({ length: 7 }).map((_, i) => {
              const day = addDays(currentWeek, i);
              const isCurrentDay = isToday(day);
              return (
                <div
                  key={i}
                  className={`p-3 text-center border-r last:border-r-0 ${isCurrentDay ? "bg-blue-50" : ""}`}
                >
                  <div
                    className={`text-xs font-semibold uppercase ${isCurrentDay ? "text-blue-600" : "text-gray-500"}`}
                  >
                    {format(day, "EEE")}
                  </div>
                  <div
                    className={`text-2xl font-bold mt-1 ${isCurrentDay ? "text-blue-600" : "text-gray-800"}`}
                  >
                    {format(day, "d")}
                  </div>
                  <div className="text-xs text-gray-400">{format(day, "MMM")}</div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-7 min-h-[400px]">
            {Array.from({ length: 7 }).map((_, i) => {
              const day = addDays(currentWeek, i);
              const dayAppointments = appointments
                .filter((appointment) =>
                  isSameDay(parseDate(appointment.appointmentDate), day),
                )
                .sort((a, b) =>
                  a.appointmentTime.localeCompare(b.appointmentTime),
                );
              const isCurrentDay = isToday(day);
              return (
                <div
                  key={i}
                  className={`border-r last:border-r-0 p-2 space-y-1 ${isCurrentDay ? "bg-blue-50/30" : ""}`}
                >
                  {dayAppointments.length === 0 && (
                    <p className="text-xs text-gray-300 text-center mt-4">—</p>
                  )}
                  {dayAppointments.map((appointment) => {
                    const patient =
                      appointment.patient || getPatient(appointment.patientId);
                    const patientName = patient
                      ? `${patient.firstName} ${patient.lastName}`.trim()
                      : "Unknown";
                    const statusConfig =
                      STATUS_CONFIG[appointment.status] || STATUS_CONFIG.scheduled;
                    return (
                      <div
                        key={appointment.id}
                        className={`rounded p-1.5 text-xs cursor-pointer hover:opacity-80 ${statusConfig.bgColor}`}
                      >
                        <div className="font-semibold truncate">
                          {appointment.appointmentTime}
                        </div>
                        <div className="truncate">{patientName}</div>
                        {appointment.doctor && (
                          <div className="truncate text-gray-500">
                            {drName(appointment.doctor.fullName)}
                          </div>
                        )}
                        <Badge
                          className={`text-[9px] px-1 py-0 ${statusConfig.bgColor} ${statusConfig.color} border-0`}
                        >
                          {statusConfig.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-4">
        {Array.from({ length: 7 }).map((_, i) => {
          const day = addDays(currentWeek, i);
          const count = appointments.filter((appointment) =>
            isSameDay(parseDate(appointment.appointmentDate), day),
          ).length;
          return (
            <div
              key={i}
              className={`rounded-lg border p-3 text-center ${isToday(day) ? "border-blue-400 bg-blue-50" : "bg-white"}`}
            >
              <div className="text-sm font-medium text-gray-600">
                {format(day, "EEEE")}
              </div>
              <div className="text-2xl font-bold text-blue-600">{count}</div>
              <div className="text-xs text-gray-400">appointments</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
