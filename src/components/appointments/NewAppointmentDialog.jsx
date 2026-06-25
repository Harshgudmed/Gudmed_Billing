import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { format } from "date-fns";
import { Plus, Loader2 } from "lucide-react";
import PatientLookup from "@/components/common/PatientLookup";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TIME_SLOTS } from "./appointmentConstants";

export default function NewAppointmentDialog({
  open,
  onOpenChange,
  form,
  onSubmit,
  selectedPatient,
  setSelectedPatient,
  setPatients,
  uniqueDepartments,
  availableDoctors,
  doctors,
  feeCalculation,
  feeCalculationLoading,
  isSubmitting,
  onCancel,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Appointment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Appointment</DialogTitle>
          <DialogDescription>
            Schedule a new appointment for a patient
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Patient Selection — search database by UHID / name */}
            <FormField
              control={form.control}
              name="patientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Patient *</FormLabel>
                  <PatientLookup
                    selectedPatient={selectedPatient}
                    onSelect={(patient) => {
                      setSelectedPatient(patient);
                      field.onChange(patient.id);
                      setPatients((prev) => {
                        if (prev.some((existingPatient) => existingPatient.id === patient.id))
                          return prev;
                        return [patient, ...prev];
                      });
                    }}
                    onClear={() => {
                      setSelectedPatient(null);
                      field.onChange("");
                    }}
                    placeholder="Search by UHID, name, or phone..."
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Department & Doctor — pick a department to narrow the doctor list */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Department</FormLabel>
                    <SearchableSelect
                      className="w-full"
                      options={uniqueDepartments.map((department) => ({
                        value: department.id,
                        label: department.name,
                      }))}
                      value={field.value}
                      onChange={(value) => {
                        field.onChange(value);
                        // Reset doctor + fee since the doctor list just changed
                        form.setValue("doctorId", "");
                        form.setValue("consultationFee", "");
                      }}
                      placeholder="All departments"
                      searchPlaceholder="Search departments..."
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="doctorId"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Doctor *</FormLabel>
                    <SearchableSelect
                      className="w-full"
                      options={availableDoctors.map((doctor) => ({
                        value: doctor.id,
                        label: `${doctor.fullName}${doctor.consultationFee != null ? ` (₹${doctor.consultationFee})` : ""}`,
                        sublabel: doctor.specialization || undefined,
                      }))}
                      value={field.value}
                      onChange={(value) => {
                        field.onChange(value);
                        // Prefill fee from the doctor's configured consultation fee
                        const doctor = doctors.find((candidate) => candidate.id === value);
                        form.setValue(
                          "consultationFee",
                          doctor?.consultationFee != null
                            ? String(doctor.consultationFee)
                            : "",
                        );
                      }}
                      placeholder={
                        availableDoctors.length === 0
                          ? "No doctors in department"
                          : "Select doctor"
                      }
                      searchPlaceholder="Search doctors..."
                      emptyText="No doctors found"
                      disabled={availableDoctors.length === 0}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Charge Amount — decided by the doctor's fee slabs on the backend (read-only) */}
            <FormField
              control={form.control}
              name="consultationFee"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Charge Amount (₹)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      readOnly
                      tabIndex={-1}
                      placeholder="Select a doctor"
                      className="bg-gray-100 cursor-not-allowed text-gray-700"
                      {...field}
                    />
                  </FormControl>
                  {feeCalculationLoading ? (
                    <p className="text-xs text-gray-400 mt-1">Calculating fee…</p>
                  ) : feeCalculation ? (
                    feeCalculation.isNewPatient ? (
                      <p className="text-xs text-blue-600 font-medium mt-1">
                        🆕 New Patient — base consultation fee
                        {feeCalculation.daysSinceLastVisit != null
                          ? ` (last visit ${feeCalculation.daysSinceLastVisit} days ago, beyond 30-day window)`
                          : ""}
                        .
                      </p>
                    ) : feeCalculation.fee === 0 ? (
                      <p className="text-xs text-green-600 font-medium mt-1">
                        ✓ Free follow-up — {feeCalculation.daysSinceLastVisit} day(s)
                        since last visit. No charge.
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600 font-medium mt-1">
                        ↩ Follow-up — {feeCalculation.daysSinceLastVisit} day(s) since
                        last visit
                        {feeCalculation.appliedSlab?.fromDays != null
                          ? `, slab ${feeCalculation.appliedSlab.fromDays}–${feeCalculation.appliedSlab.toDays} days`
                          : ""}
                        .
                      </p>
                    )
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">
                      Set automatically from the doctor's fee structure.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="appointmentDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date *</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value ? format(field.value, "yyyy-MM-dd") : ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value ? new Date(e.target.value) : null,
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="appointmentTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select time" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TIME_SLOTS.map((time) => (
                          <SelectItem key={time} value={time}>
                            {time}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Type & Priority */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="appointmentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Appointment Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="new_patient">New Patient</SelectItem>
                        <SelectItem value="follow_up">Follow-up</SelectItem>
                        <SelectItem value="emergency">Emergency</SelectItem>
                      </SelectContent>
                    </Select>
                    {feeCalculation && (
                      <p className="text-xs text-gray-400 mt-1">
                        Auto-detected from patient history — change if needed.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Additional Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Any additional notes or instructions..."
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Appointment
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
