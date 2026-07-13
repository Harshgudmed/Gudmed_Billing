import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { parseDate, getPatientFullName } from "./appointmentHelpers";
import { useDoctorTimetable } from "@/components/common/hooks/useDoctorTimetable";

export default function RescheduleAppointmentDialog({
  open,
  onOpenChange,
  appointment,
  getPatient,
  date,
  onDateChange,
  time,
  onTimeChange,
  onCancel,
  onConfirm,
  isSubmitting,
}) {
  // Offer the times this doctor actually sits (Doctor Accountability timetable),
  // not a fixed list — rescheduling must respect the same availability that
  // booking does.
  const { availableTimeSlots, timetableLoading } = useDoctorTimetable(
    appointment?.doctorId,
    date ? format(date, "yyyy-MM-dd") : "",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule Appointment</DialogTitle>
          <DialogDescription>
            Select a new date and time for this appointment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {appointment && (
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="font-medium">
                {getPatientFullName(appointment.patient || getPatient(appointment.patientId) || null)}
              </div>
              <div className="text-sm text-gray-500">
                Current: {format(parseDate(appointment.appointmentDate), "PPP")} at{" "}
                {appointment.appointmentTime}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>New Date</Label>
              <Input
                type="date"
                value={date ? format(date, "yyyy-MM-dd") : ""}
                onChange={(e) =>
                  onDateChange(e.target.value ? new Date(e.target.value) : null)
                }
              />
            </div>
            <div>
              <Label>New Time</Label>
              <Select
                value={time}
                onValueChange={onTimeChange}
                disabled={!date || timetableLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={
                    !date ? "Pick a date first"
                      : timetableLoading ? "Loading slots…"
                      : availableTimeSlots.length === 0 ? "Doctor not available this day"
                      : "Select time"
                  } />
                </SelectTrigger>
                <SelectContent>
                  {availableTimeSlots.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                      {slot}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isSubmitting || !date || !time}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
