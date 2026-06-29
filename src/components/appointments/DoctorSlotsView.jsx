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
import { format, addDays, addWeeks, subWeeks, isToday } from "date-fns";
import { drName } from "@/lib/utils";
import { parseDate } from "./appointmentHelpers";
import { TIME_SLOTS } from "./appointmentConstants";

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

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border bg-gray-50 px-3 py-2 text-left w-20 font-semibold text-gray-600">
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
            {TIME_SLOTS.map((slot) => (
              <tr key={slot} className="hover:bg-gray-50">
                <td className="border px-3 py-1.5 font-medium text-gray-500 bg-gray-50">
                  {slot}
                </td>
                {Array.from({ length: 7 }).map((_, i) => {
                  const day = addDays(currentWeek, i);
                  const slotAppointments =
                    slotMap.get(`${format(day, "yyyy-MM-dd")}|${slot}`) || [];
                  const isBooked = slotAppointments.length > 0;
                  return (
                    <td
                      key={i}
                      className={`border px-1 py-1 text-center ${isBooked ? "bg-red-50" : "bg-green-50"}`}
                    >
                      {isBooked ? (
                        slotAppointments.map((appointment) => {
                          const patient =
                            appointment.patient || getPatient(appointment.patientId);
                          return (
                            <div
                              key={appointment.id}
                              className="rounded bg-red-100 border border-red-200 px-1 py-0.5 text-[10px] text-red-700 truncate"
                              title={
                                patient
                                  ? `${patient.firstName} ${patient.lastName}`
                                  : "Booked"
                              }
                            >
                              {patient
                                ? `${patient.firstName} ${patient.lastName}`.substring(
                                    0,
                                    10,
                                  )
                                : "Booked"}
                            </div>
                          );
                        })
                      ) : (
                        <span className="text-green-400 text-[10px]">Free</span>
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
      </div>

      {doctors.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {doctors
            .filter(
              (doctor) => selectedDoctor === "all" || doctor.id === selectedDoctor,
            )
            .map((doctor) => {
              const weekStart = currentWeek;
              const weekEnd = addDays(currentWeek, 6);
              const count = appointments.filter((appointment) => {
                const appointmentDate = parseDate(appointment.appointmentDate);
                return (
                  appointment.doctorId === doctor.id &&
                  appointmentDate >= weekStart &&
                  appointmentDate <= weekEnd
                );
              }).length;
              return (
                <Card key={doctor.id} className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                      {doctor.fullName.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">
                        {drName(doctor.fullName)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {doctor.specialization || "General"}
                      </div>
                      <div className="text-blue-600 font-bold">
                        {count} this week
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
        </div>
      )}
    </>
  );
}
