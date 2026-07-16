import { Search, Loader2, Eye, LogOut, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, differenceInDays } from 'date-fns'
import { drName } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { admissionLabel, getWardName, emptyDischarge } from '@/lib/inpatientHelpers'

// Admissions tab — searchable/filterable table of admissions (paginated server-side).
// Discharge action opens the shared dialog owned by InpatientModule.
export default function AdmissionsTab({
  admissions, loading, wards,
  searchQuery, setSearchQuery, wardFilter, setWardFilter, statusFilter, setStatusFilter,
  admissionsMeta, patientHistoryPage, setPatientHistoryPage, ADMISSIONS_PER_PAGE,
  openViewAdmission, setSelectedAdmission, setDischargeForm, setShowDischargeDialog,
}) {
  return (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input className="pl-9" placeholder="Search by patient, UHID, admission #..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
              <Select value={wardFilter} onValueChange={setWardFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="All Wards" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Wards</SelectItem>
                  {wards.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36"><SelectValue placeholder="All Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="admitted">Admitted</SelectItem>
                  <SelectItem value="discharged">Discharged</SelectItem>
                  <SelectItem value="transferred">Transferred</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Admission #</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Admission Type</TableHead>
                      <TableHead>Ward/Bed</TableHead>
                      <TableHead>Doctor / Dept</TableHead>
                      <TableHead>Admitted On</TableHead>
                      <TableHead>Days</TableHead>
                      <TableHead>Diagnosis</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168] mx-auto" /></TableCell></TableRow>
                    ) : admissions.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-8 text-gray-400">No admissions found</TableCell></TableRow>
                    ) : admissions.map(a => {
                      const days = a.admissionDate ? differenceInDays(new Date(), new Date(a.admissionDate)) : 0
                      const typeColor = a.admissionType === 'Emergency' ? 'bg-red-100 text-red-700' : a.admissionType === 'Transfer' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                      const statusColor = a.status === 'admitted' ? 'bg-green-100 text-green-800' : a.status === 'transferred' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-xs font-medium">{admissionLabel(a)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
                                {(a.patient?.firstName?.[0] || '') + (a.patient?.lastName?.[0] || '')}
                              </div>
                              <div>
                                <div className="font-medium text-sm">{a.patient?.firstName} {a.patient?.lastName}</div>
                                <div className="text-xs text-gray-500">{a.patient?.mrn} · {a.patient?.dateOfBirth ? differenceInDays(new Date(), new Date(a.patient.dateOfBirth)) > 365 ? Math.floor(differenceInDays(new Date(), new Date(a.patient.dateOfBirth)) / 365) + 'y' : '' : ''} {a.patient?.gender}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><Badge className={`text-xs ${typeColor}`}>{a.admissionType}</Badge></TableCell>
                          <TableCell>
                            <div className="text-sm">{a.bed?.ward?.name || getWardName(wards, a)}</div>
                            <div className="text-xs text-gray-500">{a.bed?.bedNumber || '—'}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{drName(a.attendingDoctorName) || '—'}</div>
                            <div className="text-xs text-gray-500">{a.bed?.ward?.department?.name || '—'}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{a.admissionDate ? format(new Date(a.admissionDate), 'dd MMM yyyy') : '—'}</div>
                            <div className="text-xs text-gray-500">{a.admissionDate ? format(new Date(a.admissionDate), 'HH:mm') : ''}</div>
                          </TableCell>
                          <TableCell className="text-sm">{days}</TableCell>
                          <TableCell className="text-sm max-w-[160px]"><div className="truncate">{a.admissionDiagnosis}</div></TableCell>
                          <TableCell><Badge className={`text-xs ${statusColor}`}>{a.status}</Badge></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => openViewAdmission(a)}><Eye className="h-4 w-4" /></Button>
                              {a.status === 'admitted' && (
                                <Button size="sm" variant="ghost" onClick={() => { setSelectedAdmission(a); setDischargeForm(emptyDischarge); setShowDischargeDialog(true) }}>
                                  <LogOut className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                {admissionsMeta.total > ADMISSIONS_PER_PAGE && (
                  <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
                    <Button variant="outline" size="sm" onClick={() => setPatientHistoryPage(p => Math.max(1, p - 1))} disabled={patientHistoryPage === 1}>
                      <ChevronLeft className="h-4 w-4 mr-1" />Previous
                    </Button>
                    <span className="text-sm text-gray-600">Page {admissionsMeta.page} of {admissionsMeta.totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setPatientHistoryPage(p => Math.min(admissionsMeta.totalPages, p + 1))} disabled={!admissionsMeta.hasMore}>
                      Next<ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
  )
}
