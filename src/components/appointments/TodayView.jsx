import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { drName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, CheckCircle, Bell, BellOff } from "lucide-react";
import { getPatientFullName } from "./appointmentHelpers";
import { StatusBadge, TypeBadge } from "./AppointmentBadges";

export default function TodayView({
  upcomingAppointments,
  completedAppointments,
  getPatient,
  onConfirm,
  onCheckIn,
  onStartConsultation,
  onComplete,
  onSendReminder,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Current & Upcoming */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-600" />
            Current & Upcoming
          </CardTitle>
          <CardDescription>
            Active and pending appointments for today
          </CardDescription>
        </CardHeader>
        <CardContent>
        <ScrollArea className="h-[calc(100vh-320px)] pr-4">
            {upcomingAppointments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No upcoming appointments today</p>
              </div>
            ) : (
              upcomingAppointments.map((appointment) => {
                const patient = appointment.patient || getPatient(appointment.patientId);
                const doctor = appointment.doctor;
                return (
                  <div
                    key={appointment.id}
                    className={`p-4 rounded-lg border mb-3 transition-all ${appointment.status === "in_progress" ? "bg-orange-50 border-orange-300" : appointment.status === "checked_in" ? "bg-green-50 border-green-300" : "bg-white hover:shadow-md"}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-center">
                          <div className="font-mono text-lg font-bold">
                            {appointment.appointmentTime}
                          </div>
                        </div>
                        <Avatar className="h-10 w-10">
                          <AvatarFallback
                            className={`${appointment.status === "in_progress" ? "bg-orange-200 text-orange-700" : appointment.status === "checked_in" ? "bg-green-200 text-green-700" : "bg-blue-100 text-blue-700"}`}
                          >
                            {patient?.firstName?.[0]}
                            {patient?.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">
                            {getPatientFullName(patient || null)}
                          </div>
                          <div className="text-sm text-gray-500">
                            {doctor?.fullName ? drName(doctor.fullName) : "—"} • {patient?.mrn}
                          </div>
                          <div className="text-sm mt-1">
                            {appointment.chiefComplaint}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={appointment.status} />
                        <div className="mt-2 flex flex-col gap-1">
                          {appointment.status === "scheduled" && (
                            <>
                              <Button size="sm" onClick={() => onConfirm(appointment)}>
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onCheckIn(appointment)}
                              >
                                Check In
                              </Button>
                            </>
                          )}
                          {appointment.status === "confirmed" && (
                            <Button size="sm" onClick={() => onCheckIn(appointment)}>
                              Check In
                            </Button>
                          )}
                          {appointment.status === "checked_in" && (
                            <Button
                              size="sm"
                              onClick={() => onStartConsultation(appointment)}
                            >
                              Start
                            </Button>
                          )}
                          {appointment.status === "in_progress" && (
                            <Button size="sm" onClick={() => onComplete(appointment)}>
                              Complete
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2 flex-wrap">
                      <TypeBadge type={appointment.appointmentType} />
                      {appointment.reminderSent ? (
                        <Badge
                          variant="outline"
                          className="bg-green-100 text-green-700"
                        >
                          <Bell className="h-3 w-3 mr-1" />
                          Reminder Sent
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-6"
                          onClick={() => onSendReminder(appointment)}
                        >
                          <BellOff className="h-3 w-3 mr-1" />
                          Send Reminder
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Completed & Others */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Completed & Others
          </CardTitle>
          <CardDescription>
            Finished, cancelled, or no-show appointments
          </CardDescription>
        </CardHeader>
        <CardContent>
         <ScrollArea className="h-[calc(100vh-220px)] pr-4">
            {completedAppointments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <CheckCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No completed appointments today</p>
              </div>
            ) : (
              completedAppointments.map((appointment) => {
                const patient = appointment.patient || getPatient(appointment.patientId);
                const doctor = appointment.doctor;
                return (
                  <div
                    key={appointment.id}
                    className="p-4 rounded-lg border mb-3 bg-gray-50 border-gray-200"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-center">
                          <div className="font-mono text-lg font-bold text-gray-400">
                            {appointment.appointmentTime}
                          </div>
                          <div className="text-xs text-gray-400">
                            {appointment.durationMinutes} min
                          </div>
                        </div>
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="bg-gray-200 text-gray-500">
                            {patient?.firstName?.[0]}
                            {patient?.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium text-gray-600">
                            {getPatientFullName(patient || null)}
                          </div>
                          <div className="text-sm text-gray-400">
                            {doctor?.fullName ? drName(doctor.fullName) : "—"} • {patient?.mrn}
                          </div>
                          <div className="text-sm mt-1 text-gray-500">
                            {appointment.chiefComplaint}
                          </div>
                        </div>
                      </div>
                      <StatusBadge status={appointment.status} />
                    </div>
                    {appointment.cancellationReason && (
                      <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                        Reason: {appointment.cancellationReason}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
