import { UserPlus, User, BedDouble, Stethoscope, IndianRupee, Loader2 } from 'lucide-react'
import { drName } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import PatientLookup from '@/components/common/PatientLookup'
import { ADMISSION_TYPES, emptyAdmission } from '@/lib/inpatientHelpers'

// New Admission tab — inline form to admit an existing patient. Submits via the
// parent's handleAdmit; ward/bed dropdowns are driven by parent state + fetchBedsForWard.
export default function NewAdmissionTab({
  admitPatient, setAdmitPatient, admitForm, setAdmitForm,
  wards, availableBeds, setAvailableBeds, departments, doctors,
  fetchBedsForWard, handleAdmit, savingAdmission,
}) {
  return (
          <div className="w-full">
            <div className="mb-4">
              <h2 className="text-base font-semibold flex items-center gap-2"><UserPlus className="h-4 w-4" />New Patient Admission</h2>
              <p className="text-xs text-gray-500">Register a new inpatient admission</p>
            </div>

            <div className="space-y-4">
              {/* Patient Information */}
              <Card>
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2"><User className="h-4 w-4" />Patient Information</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Select Patient *</Label>
                      <PatientLookup className="mt-1" selectedPatient={admitPatient} showHint={false} placeholder="Search by name or UHID..."
                        onSelect={p => { setAdmitPatient(p); setAdmitForm(prev => ({ ...prev, patientId: p.id })) }}
                        onClear={() => { setAdmitPatient(null); setAdmitForm(prev => ({ ...prev, patientId: '' })) }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Admission Type *</Label>
                      <Select value={admitForm.admissionType} onValueChange={v => setAdmitForm(p => ({ ...p, admissionType: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>{ADMISSION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Ward & Bed Assignment */}
              <Card>
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2"><BedDouble className="h-4 w-4" />Ward &amp; Bed Assignment</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Select Ward *</Label>
                      <Select value={admitForm.wardId} onValueChange={v => { setAdmitForm(p => ({ ...p, wardId: v, bedId: '' })); fetchBedsForWard(v) }}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Select ward" /></SelectTrigger>
                        <SelectContent>{wards.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Select Bed *</Label>
                      <Select value={admitForm.bedId} onValueChange={v => setAdmitForm(p => ({ ...p, bedId: v }))} disabled={!admitForm.wardId}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Select bed" /></SelectTrigger>
                        <SelectContent>{availableBeds.map(b => <SelectItem key={b.id} value={b.id}>Bed {b.bedNumber} ({b.type || 'Standard'})</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Medical Information */}
              <Card>
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2"><Stethoscope className="h-4 w-4" />Medical Information</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Department *</Label>
                      <Select value={admitForm.departmentId || ''} onValueChange={v => setAdmitForm(p => ({ ...p, departmentId: v, doctorId: '' }))}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Select department" /></SelectTrigger>
                        <SelectContent>
                          {departments.filter(dep => doctors.some(d => d.departmentId === dep.id)).map(dep => <SelectItem key={dep.id} value={dep.id}>{dep.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Attending Physician *</Label>
                      <Select value={admitForm.doctorId || ''} onValueChange={v => setAdmitForm(p => ({ ...p, doctorId: v }))} disabled={!admitForm.departmentId}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder={admitForm.departmentId ? 'Select physician' : 'Select department first'} /></SelectTrigger>
                        <SelectContent>{doctors.filter(d => d.departmentId === admitForm.departmentId).map(d => <SelectItem key={d.id} value={d.id}>{drName(d.fullName)}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Expected Length of Stay (Days) *</Label>
                      <Input type="number" min={1} className="mt-1" value={admitForm.expectedLengthOfStay} onChange={e => setAdmitForm(p => ({ ...p, expectedLengthOfStay: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Admission Diagnosis *</Label>
                    <Input className="mt-1" placeholder="Primary diagnosis for admission" value={admitForm.admissionDiagnosis} onChange={e => setAdmitForm(p => ({ ...p, admissionDiagnosis: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Chief Complaint *</Label>
                    <Textarea className="mt-1" placeholder="Patient's main complaint or reason for admission" rows={2} value={admitForm.chiefComplaint} onChange={e => setAdmitForm(p => ({ ...p, chiefComplaint: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Admission Notes</Label>
                    <Textarea className="mt-1" placeholder="Additional notes about the admission" rows={2} value={admitForm.admissionNotes} onChange={e => setAdmitForm(p => ({ ...p, admissionNotes: e.target.value }))} />
                  </div>
                </CardContent>
              </Card>

              {/* Financial Information */}
              <Card>
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2"><IndianRupee className="h-4 w-4" />Financial Information</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs">Deposit Amount (₹)</Label>
                      <Input type="number" min={0} className="mt-1" value={admitForm.depositAmount} onChange={e => setAdmitForm(p => ({ ...p, depositAmount: e.target.value }))} />
                    </div>
                    <div className="border rounded-lg p-3">
                      <p className="text-sm font-medium text-orange-600 mb-1">Critical Patient</p>
                      <p className="text-xs text-gray-500 mb-2">Mark if patient requires critical care monitoring</p>
                      <div className="flex flex-row flex-wrap items-center gap-4 mt-2">
                        <label className="flex items-center gap-2 text-sm text-blue-700 font-medium cursor-pointer">
                          <input type="radio" name="critical" checked={admitForm.isCritical && admitForm.criticalLevel === 'blue'} onChange={() => setAdmitForm(p => ({ ...p, isCritical: true, criticalLevel: 'blue' }))} className="h-4 w-4" />
                          Code Blue (Higher Priority)
                        </label>
                        <label className="flex items-center gap-2 text-sm text-yellow-600 font-medium cursor-pointer">
                          <input type="radio" name="critical" checked={admitForm.isCritical && admitForm.criticalLevel === 'yellow'} onChange={() => setAdmitForm(p => ({ ...p, isCritical: true, criticalLevel: 'yellow' }))} className="h-4 w-4" />
                          Code Yellow (Lower Priority)
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                          <input type="radio" name="critical" checked={!admitForm.isCritical} onChange={() => setAdmitForm(p => ({ ...p, isCritical: false, criticalLevel: 'none' }))} className="h-4 w-4" />
                          Not Critical
                        </label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => { setAdmitForm(emptyAdmission); setAdmitPatient(null); setAvailableBeds([]) }}>Reset Form</Button>
                <Button className="bg-gray-900 hover:bg-gray-800" onClick={handleAdmit} disabled={savingAdmission}>
                  {savingAdmission ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Admitting...</> : 'Complete Admission'}
                </Button>
              </div>
            </div>
          </div>
  )
}
