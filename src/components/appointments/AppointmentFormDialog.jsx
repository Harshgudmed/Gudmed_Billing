import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { format } from "date-fns";
import { Plus, Loader2 } from "lucide-react";
import PatientLookup from "@/components/common/PatientLookup";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { STATUS_CONFIG } from "./appointmentConstants";
import { getPatientFullName } from "./appointmentHelpers";
import { useDoctorTimetable } from "@/components/common/hooks/useDoctorTimetable";

export default function AppointmentFormDialog({
  open,
  onOpenChange,
  form,
  onSubmit,
  isEdit = false,              
  editingAppointment = null,   
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
  getPatient,
}) {
  // Bookable times come from the DOCTOR'S timetable (Doctor Accountability), not a
  // fixed list — the same source RegisterPatientForm books against. The old static
  // TIME_SLOTS both offered hours a doctor may not sit, and omitted ones they do
  // (it skipped 12:00-13:45 and 17:00, so those existing appointments opened with
  // an empty Time field).
  const doctorId = form.watch("doctorId");
  const appointmentDate = form.watch("appointmentDate");
  const currentTime = form.watch("appointmentTime");
  const { availableTimeSlots, timetableLoading } = useDoctorTimetable(doctorId, appointmentDate);

  // Keep the appointment's own time selectable even when it falls outside the
  // doctor's current timetable, so editing an old appointment never blanks the field.
  const timeOptions = currentTime && !availableTimeSlots.includes(currentTime)
    ? [currentTime, ...availableTimeSlots]
    : availableTimeSlots;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!isEdit && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Appointment
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Appointment" : "Create New Appointment"}</DialogTitle>
          <DialogDescription>
            {isEdit 
              ? `Patient: ${getPatientFullName(editingAppointment?.patient || getPatient(editingAppointment?.patientId) || null)}`
              : "Schedule a new appointment for a patient"
            }
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            
            {/* PATIENT SELECTION (Only for New) */}
            {!isEdit && (
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
                        setPatients((prev) => prev.some(p => p.id === patient.id) ? prev : [patient, ...prev]);
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
            )}

            {/* DEPARTMENT & DOCTOR */}
            <div className={`grid gap-4 ${!isEdit ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {!isEdit && (
                <FormField
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Department</FormLabel>
                      <SearchableSelect
                        className="w-full"
                        options={(uniqueDepartments || []).map((d) => ({ value: d.id, label: d.name }))}
                        value={field.value}
                        onChange={(val) => {
                          field.onChange(val);
                          form.setValue("doctorId", "");
                          form.setValue("consultationFee", "");
                        }}
                        placeholder="All departments"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="doctorId"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Doctor *</FormLabel>
                    <SearchableSelect
                      className="w-full"
                      options={isEdit 
                        ? (doctors || []).map(d => ({ value: d.id, label: `${d.fullName} - ${d.specialization}` }))
                        : (availableDoctors || []).map(d => ({ value: d.id, label: `${d.fullName}${d.consultationFee != null ? ` (₹${d.consultationFee})` : ""}`, sublabel: d.specialization }))
                      }
                      value={field.value}
                      onChange={(val) => {
                        field.onChange(val);
                        if (!isEdit) {
                          const doc = (doctors || []).find(d => d.id === val);
                          form.setValue("consultationFee", doc?.consultationFee != null ? String(doc.consultationFee) : "");
                        }
                      }}
                      placeholder="Select doctor"
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* CHARGE AMOUNT (Only for New) */}
            {!isEdit && (
              <FormField
                control={form.control}
                name="consultationFee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Charge Amount (₹)</FormLabel>
                    <FormControl>
                      <Input type="number" readOnly tabIndex={-1} className="bg-gray-100 cursor-not-allowed" {...field} />
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
            )}

            {/* DATE & TIME (Shared) */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="appointmentDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date *</FormLabel>
                    <FormControl>
                      <Input type="date" value={field.value ? format(field.value, "yyyy-MM-dd") : ""} onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)} />
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
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!doctorId || !appointmentDate || timetableLoading}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={
                            !doctorId ? "Select a doctor first"
                              : !appointmentDate ? "Select a date first"
                              : timetableLoading ? "Loading slots…"
                              : timeOptions.length === 0 ? "Doctor not available this day"
                              : "Select time"
                          } />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {timeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* TYPE, STATUS & PRIORITY */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="appointmentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Appointment Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="new_patient">New Patient</SelectItem>
                        <SelectItem value="follow_up">Follow-up</SelectItem>
                        <SelectItem value="emergency">Emergency</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isEdit ? (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {Object.entries(STATUS_CONFIG).map(([key, val]) => <SelectItem key={key} value={key}>{val.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {/* EDIT ONLY: CHIEF COMPLAINT */}
            {isEdit && (
              <FormField
                control={form.control}
                name="chiefComplaint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chief Complaint</FormLabel>
                    <FormControl><Textarea placeholder="Patient's main complaint..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* SHARED: NOTES */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Notes</FormLabel>
                  <FormControl><Textarea placeholder="Any additional notes..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Save Changes" : "Create Appointment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
