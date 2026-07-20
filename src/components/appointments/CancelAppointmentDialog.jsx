import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { parseDate, getPatientFullName } from "./appointmentHelpers";
import { formatTime12h } from "@/lib/format";

export default function CancelAppointmentDialog({
  open,
  onOpenChange,
  appointment,
  getPatient,
  reason,
  onReasonChange,
  onKeep,
  onConfirm,
  isSubmitting,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Appointment</DialogTitle>
          <DialogDescription>
            Please provide a reason for cancelling this appointment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {appointment && (
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="font-medium">
                {getPatientFullName(appointment.patient || getPatient(appointment.patientId) || null)}
              </div>
              <div className="text-sm text-gray-500">
                {format(parseDate(appointment.appointmentDate), "PPP")} at{" "}
                {formatTime12h(appointment.appointmentTime)}
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="reason">Cancellation Reason *</Label>
            <Textarea
              id="reason"
              placeholder="Enter reason for cancellation..."
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onKeep}>
            Keep Appointment
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Cancel Appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
