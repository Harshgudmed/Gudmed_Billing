import { LogOut, Eye } from 'lucide-react'
import { differenceInDays } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getWardName, emptyDischarge } from '@/lib/inpatientHelpers'
import { getFullName } from "@/lib/patient";

// Discharge tab — cards for every currently-admitted patient. The actual discharge /
// transfer happen in the shared dialogs owned by InpatientModule (opened via setters).
export default function DischargeTab({
  currentAdmitted, wards, openViewAdmission,
  setSelectedAdmission, setDischargeForm, setShowDischargeDialog,
  setShowTransferDialog, setTransferForm,
}) {
  return (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2"><LogOut className="h-4 w-4" />Discharge Patients</h2>
                <p className="text-xs text-gray-500">
                  {currentAdmitted.length} patient(s) currently admitted and pending discharge
                </p>
              </div>
              <Badge className="bg-green-100 text-green-800">{currentAdmitted.length} Admitted</Badge>
            </div>
            {currentAdmitted.length === 0 ? (
              <Card>
                <CardContent className="py-14 text-center">
                  <LogOut className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-gray-400 font-medium">No patients currently admitted</p>
                  <p className="text-xs text-gray-400 mt-1">All patients have been discharged or no admissions exist.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {currentAdmitted.map(a => {
                  // Double-guard: skip any record that isn't truly 'admitted'
                  if ((a.status || '').toLowerCase() !== 'admitted') return null
                  const days = a.admissionDate ? differenceInDays(new Date(), new Date(a.admissionDate)) : 0
                  const initials = (a.patient?.firstName?.[0] || '') + (a.patient?.lastName?.[0] || '')
                  return (
                    <Card key={a.id} className={a.isCritical ? (a.criticalLevel === 'blue' ? 'border-blue-300' : 'border-yellow-400') : ''}>
                      <CardContent className="pt-4 pb-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">{initials}</div>
                          <div>
                            <div className="font-semibold text-sm">{getFullName(a.patient)}</div>
                            <div className="text-xs text-gray-500">{a.patient?.mrn}</div>
                          </div>
                          {a.isCritical && <Badge className={`ml-auto text-xs ${a.criticalLevel === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-800'}`}>Critical ({a.criticalLevel === 'blue' ? 'Blue' : 'Yellow'})</Badge>}
                        </div>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between"><span className="text-gray-500">Ward:</span><span>{a.bed?.ward?.name || getWardName(wards, a)}</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Bed:</span><span>{a.bed?.bedNumber || '—'}</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Days admitted:</span><span className={days > 7 ? 'text-orange-600 font-medium' : ''}>{days}</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Diagnosis:</span><span className="truncate max-w-[120px] text-xs text-right">{a.admissionDiagnosis || '—'}</span></div>
                        </div>
                        <Badge className="w-full justify-center bg-green-100 text-green-800 text-xs">Admitted</Badge>
                        <Button className="w-full bg-gray-900 hover:bg-gray-800 text-sm gap-1.5" size="sm"
                          onClick={() => { setSelectedAdmission(a); setDischargeForm(emptyDischarge); setShowDischargeDialog(true) }}>
                          <LogOut className="h-3.5 w-3.5" />Discharge Patient
                        </Button>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => openViewAdmission(a)}>
                            <Eye className="h-3.5 w-3.5 mr-1" />View
                          </Button>
                          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => { setSelectedAdmission(a); setShowTransferDialog(true); setTransferForm({ toWardId: '', toBedId: '', transferReason: '' }) }}>Transfer</Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
  )
}
