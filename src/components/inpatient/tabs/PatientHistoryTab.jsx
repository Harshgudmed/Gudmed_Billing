import { Eye, Printer, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, differenceInDays } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { admissionLabel, getWardName } from '@/lib/inpatientHelpers'
import { getFullName } from "@/lib/patient";

// Patient Discharge History tab — paginated cards of past (discharged) admissions.
export default function PatientHistoryTab({
  dischargedList, wards, patientHistoryPage, setPatientHistoryPage,
  openViewAdmission, handlePrintDischargeSummary,
}) {
  return (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold">Patient Discharge History</h2>
                <p className="text-xs text-blue-600">All past admissions, discharge summaries, and records</p>
              </div>
              <span className="text-xs text-gray-500">{dischargedList.length} discharge records</span>
            </div>
            {dischargedList.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-gray-400">No discharge records yet</CardContent></Card>
            ) : (
              <div>
                <div className="space-y-3">
                  {(() => {
                    const ITEMS_PER_PAGE = 10
                    const startIdx = (patientHistoryPage - 1) * ITEMS_PER_PAGE
                    const endIdx = startIdx + ITEMS_PER_PAGE
                    const paginatedData = dischargedList.slice(startIdx, endIdx)
                    return paginatedData.map(a => {
                      const days = (a.admissionDate && a.dischargeDate) ? differenceInDays(new Date(a.dischargeDate), new Date(a.admissionDate)) : 0
                      const initials = (a.patient?.firstName?.[0] || '') + (a.patient?.lastName?.[0] || '')
                      return (
                        <Card key={a.id}>
                          <CardContent className="pt-4 pb-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-700">{initials}</div>
                                <div>
                                  <div className="font-semibold text-sm">{getFullName(a.patient)}</div>
                                  <div className="text-xs text-gray-500">{a.patient?.mrn} · {a.patient?.dateOfBirth ? Math.floor(differenceInDays(new Date(), new Date(a.patient.dateOfBirth)) / 365) + 'y' : ''}, {a.patient?.gender}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400">ADMISSION #</span>
                                <span className="text-xs font-mono font-medium">{admissionLabel(a)}</span>
                                <Badge className="bg-green-100 text-green-800 text-xs">Discharged</Badge>
                                <Button size="sm" variant="ghost" onClick={() => openViewAdmission(a)}><Eye className="h-4 w-4" /><span className="ml-1 text-xs">View</span></Button>
                              </div>
                            </div>
                            <div className="grid grid-cols-4 gap-4 text-xs mb-2">
                              <div>
                                <div className="text-gray-400 uppercase font-semibold mb-1">Admitted</div>
                                <div className="font-medium">{a.admissionDate ? format(new Date(a.admissionDate), 'dd MMM yyyy') : '—'}</div>
                                <div className="text-gray-500">{a.admissionDate ? format(new Date(a.admissionDate), 'HH:mm') : ''}</div>
                              </div>
                              <div>
                                <div className="text-gray-400 uppercase font-semibold mb-1">Duration</div>
                                <div className="font-medium">{days} days</div>
                                <div className="text-gray-500">{getWardName(wards, a)}/{a.bed?.bedNumber || '—'}</div>
                              </div>
                              <div>
                                <div className="text-gray-400 uppercase font-semibold mb-1">Admission Type</div>
                                <Badge className={`text-xs ${a.admissionType === 'Emergency' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{a.admissionType}</Badge>
                              </div>
                              <div>
                                <div className="text-gray-400 uppercase font-semibold mb-1">Bill</div>
                                {a.billSummary ? (
                                  <>
                                    <div className="font-medium">₹{(a.billSummary.payableTotal || 0).toLocaleString()}</div>
                                    <div className="text-gray-500 text-[11px]">{a.billSummary.billNumber || a.billSummary.status}</div>
                                  </>
                                ) : <div className="text-gray-400">Not billed</div>}
                              </div>
                            </div>
                            {a.admissionDiagnosis && (
                              <div>
                                <div className="text-xs text-gray-400 uppercase font-semibold mb-1">Admission Diagnosis</div>
                                <div className="text-sm">{a.admissionDiagnosis}</div>
                              </div>
                            )}
                            <div className="flex justify-end mt-2">
                              <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => handlePrintDischargeSummary(a)}>
                                <Printer className="h-3.5 w-3.5" />Print Summary
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })
                  })()}
                </div>
                {(() => {
                  const ITEMS_PER_PAGE = 10
                  const totalPages = Math.ceil(dischargedList.length / ITEMS_PER_PAGE)
                  return totalPages > 1 ? (
                    <div className="flex items-center justify-end gap-2 p-4 border-t mt-4">
                      <Button variant="outline" size="sm" onClick={() => setPatientHistoryPage(p => Math.max(1, p - 1))} disabled={patientHistoryPage === 1}>
                        <ChevronLeft className="h-4 w-4 mr-1" />Previous
                      </Button>
                      <span className="text-sm text-gray-600">Page {patientHistoryPage} of {totalPages}</span>
                      <Button variant="outline" size="sm" onClick={() => setPatientHistoryPage(p => Math.min(totalPages, p + 1))} disabled={patientHistoryPage === totalPages}>
                        Next<ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  ) : null
                })()}
              </div>
            )}
          </div>
  )
}
