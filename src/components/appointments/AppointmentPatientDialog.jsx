import { format } from "date-fns";
import { drName } from "@/lib/utils";
import { formatMoney as fmtMoney } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, CalendarDays, Clock, XCircle, IndianRupee } from "lucide-react";
import { getFullName, calcAge as calculateAge, initials } from "@/lib/patient";

// Trimmed copy of patients/components/PatientProfile.jsx's view dialog — same
// tab mechanism and same look, but only the two tabs relevant when a card is
// opened from the appointments Monthly view: Patient Details + Appointments.
// (Lab/Radiology/IPD/Documents live in the Patients module, not here.)
export default function AppointmentPatientDialog({
  open,
  onOpenChange,
  patient,
  patientLoading,
  records,
  recordsLoading,
  viewTab,
  setViewTab,
  cancelAppointment,
  cancellingId,
}) {
  const now = new Date();
  const isUpcoming = (a) =>
    new Date(a.appointmentDate) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) &&
    !["cancelled", "completed", "no_show"].includes(a.status);
  const upcoming = records.appointments.filter(isUpcoming);
  const history = records.appointments.filter((a) => !isUpcoming(a));
  const b = records.billing || { totalBilled: 0, totalPaid: 0, balanceDue: 0 };
  const statusColor = {
    scheduled: "bg-blue-100 text-blue-700", confirmed: "bg-indigo-100 text-indigo-700",
    checked_in: "bg-cyan-100 text-cyan-700", in_progress: "bg-amber-100 text-amber-700",
    completed: "bg-green-100 text-green-700", cancelled: "bg-red-100 text-red-700",
    no_show: "bg-gray-200 text-gray-600", rescheduled: "bg-purple-100 text-purple-700",
  };

  const ApptRow = ({ a, cancellable }) => (
    <div key={a.id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">
            {format(new Date(a.appointmentDate), "dd MMM yyyy")}{a.appointmentTime ? `, ${a.appointmentTime}` : ""}
          </span>
          <Badge className={`border-0 capitalize ${statusColor[a.status] || "bg-gray-100 text-gray-700"}`}>
            {a.status?.replace(/_/g, " ")}
          </Badge>
          <Badge className="bg-gray-100 text-gray-600 border-0 capitalize">
            {a.appointmentType?.replace(/_/g, " ")}
          </Badge>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {a.doctor?.fullName ? drName(a.doctor.fullName) : "Doctor —"}
          {a.department?.name ? ` · ${a.department.name}` : ""}
          {a.consultationFee != null ? ` · Fee ${fmtMoney(a.consultationFee)}` : ""}
        </p>
      </div>
      {cancellable && (
        <Button
          size="sm"
          variant="outline"
          className="text-red-600 hover:text-red-700 shrink-0"
          onClick={() => cancelAppointment(a)}
          disabled={cancellingId === a.id}
        >
          {cancellingId === a.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <><XCircle className="h-3.5 w-3.5 mr-1" />Cancel</>
          )}
        </Button>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Patient Details</DialogTitle>
        </DialogHeader>
        {patientLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" />
          </div>
        ) : patient && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xl font-bold">
                {initials(getFullName(patient))}
              </div>
              <div className="flex-1">
                <p className="text-lg font-bold">{getFullName(patient)}</p>
                <p className="text-sm text-gray-500">UHID: {patient.mrn}</p>
              </div>
            </div>

            <Tabs value={viewTab} onValueChange={setViewTab}>
              <TabsList className="grid w-full grid-cols-2 h-auto gap-1 p-1 bg-gray-100">
                <TabsTrigger value="overview" className="flex items-center justify-center gap-1.5 py-2 data-[state=active]:shadow-sm data-[state=active]:text-blue-700">
                  <Users className="h-4 w-4" />
                  <span>Patient Details</span>
                </TabsTrigger>
                <TabsTrigger value="appointments" className="flex items-center justify-center gap-1.5 py-2 data-[state=active]:shadow-sm data-[state=active]:text-green-700">
                  <CalendarDays className="h-4 w-4" />
                  <span>Appointments</span>
                  {records.appointments.length > 0 && (
                    <Badge className="ml-0.5 bg-green-100 text-green-700 border-0 px-1.5 py-0 text-[10px]">
                      {records.appointments.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Patient Details */}
              <TabsContent value="overview" className="mt-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "Date of Birth", val: patient.dateOfBirth ? format(new Date(patient.dateOfBirth), "dd MMM yyyy") : "—" },
                    { label: "Age", val: patient.dateOfBirth ? `${calculateAge(patient.dateOfBirth)} years` : "—" },
                    { label: "Gender", val: patient.gender },
                    { label: "Blood Group", val: patient.bloodGroup || "—" },
                    { label: "Phone", val: patient.phonePrimary || "—" },
                    { label: "Email", val: patient.email || "—" },
                    { label: "Address", val: [
                        patient.houseNumber, patient.street, patient.locality,
                        patient.city, patient.district, patient.state,
                      ].filter(Boolean).join(", ")
                        + (patient.pincode ? ` - ${patient.pincode}` : "")
                      || patient.addressDescription || "—" },
                    { label: "Insurance", val: patient.hasInsurance ? (patient.insuranceProvider || "Yes") : "No" },
                    { label: "Emergency Contact", val: patient.emergencyContactName || "—" },
                    { label: "Contact Phone", val: patient.emergencyContactPhone || "—" },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <p className="text-gray-500 text-xs font-medium uppercase">{label}</p>
                      <p className="font-medium capitalize">{val}</p>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Appointments & Billing */}
              <TabsContent value="appointments" className="mt-4">
                {recordsLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" /></div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border p-3 bg-gray-50">
                        <p className="text-xs text-gray-500 font-medium uppercase flex items-center gap-1"><IndianRupee className="h-3 w-3" />Total Billed</p>
                        <p className="text-lg font-bold text-gray-800">{fmtMoney(b.totalBilled)}</p>
                      </div>
                      <div className="rounded-lg border p-3 bg-green-50">
                        <p className="text-xs text-green-600 font-medium uppercase">Total Paid</p>
                        <p className="text-lg font-bold text-green-700">{fmtMoney(b.totalPaid)}</p>
                      </div>
                      <div className="rounded-lg border p-3 bg-amber-50">
                        <p className="text-xs text-amber-600 font-medium uppercase">Balance Due</p>
                        <p className="text-lg font-bold text-amber-700">{fmtMoney(b.balanceDue)}</p>
                      </div>
                    </div>

                    <ScrollArea className="h-[300px] pr-3">
                      {records.appointments.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                          <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-40" />
                          <p>No appointments yet</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Clock className="h-4 w-4 text-green-600" />Upcoming ({upcoming.length})</h4>
                            {upcoming.length === 0 ? (
                              <p className="text-sm text-gray-400 italic px-1">No upcoming appointments</p>
                            ) : (
                              <div className="space-y-2">{upcoming.map((a) => <ApptRow key={a.id} a={a} cancellable />)}</div>
                            )}
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">History ({history.length})</h4>
                            {history.length === 0 ? (
                              <p className="text-sm text-gray-400 italic px-1">No past appointments</p>
                            ) : (
                              <div className="space-y-2">{history.map((a) => <ApptRow key={a.id} a={a} cancellable={false} />)}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
