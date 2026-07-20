import { BedDouble, Activity, Building2, BarChart2, Plus } from 'lucide-react'
import { differenceInDays } from 'date-fns'
import { drName } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getWardName, emptyWard } from '@/lib/inpatientHelpers'
import { getFullName } from "@/lib/patient";

// Dashboard tab — stat cards, ward overview, current inpatients table.
// "Add Ward" opens the shared ward dialog owned by InpatientModule.
export default function DashboardTab({
  stats, occupancyPct, currentAdmitted, wards,
  setEditingWardId, setWardForm, setShowWardDialog,
}) {
  return (
          <div className="space-y-6">
            {/* Top stat cards */}
            <div className="grid grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-3xl font-bold text-blue-600">{stats.totalBeds}</p>
                      <p className="text-sm text-gray-500 mt-1">Total Beds</p>
                    </div>
                    <BedDouble className="h-8 w-8 text-blue-200" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-3xl font-bold text-red-500">{stats.occupiedBeds}</p>
                      <p className="text-sm text-gray-500 mt-1">Occupied</p>
                    </div>
                    <Activity className="h-8 w-8 text-red-200" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-3xl font-bold text-green-600">{stats.totalBeds - stats.occupiedBeds}</p>
                      <p className="text-sm text-gray-500 mt-1">Available</p>
                    </div>
                    <Building2 className="h-8 w-8 text-green-200" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-3xl font-bold text-purple-600">{occupancyPct}%</p>
                      <p className="text-sm text-gray-500 mt-1">Occupancy Rate</p>
                    </div>
                    <BarChart2 className="h-8 w-8 text-purple-200" />
                  </div>
                  <Progress value={occupancyPct} className="mt-2 h-1" />
                </CardContent>
              </Card>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
              <Card className="border-l-4 border-l-orange-400">
                <CardContent className="pt-4">
                  <p className="text-sm font-medium text-gray-600 mb-2">Today's Admissions</p>
                  <p className="text-3xl font-bold text-orange-500">{currentAdmitted.length}</p>
                  {currentAdmitted.slice(0, 2).map(a => (
                    <p key={a.id} className="text-xs text-orange-600 mt-1">{getFullName(a.patient)} · {a.bed?.ward?.name || '—'}{a.attendingDoctorName ? ` · ${drName(a.attendingDoctorName)}` : ''}</p>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-blue-400">
                <CardContent className="pt-4">
                  <p className="text-sm font-medium text-gray-600 mb-2">Pending Discharges</p>
                  <p className="text-3xl font-bold text-blue-500">{currentAdmitted.length}</p>
                  {currentAdmitted.slice(0, 1).map(a => (
                    <p key={a.id} className="text-xs text-blue-600 mt-1">{getFullName(a.patient)} · TBD</p>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-red-400">
                <CardContent className="pt-4">
                  <p className="text-sm font-medium text-gray-600 mb-2">Critical Patients</p>
                  <p className="text-3xl font-bold text-red-500">{stats.criticalPatients}</p>
                </CardContent>
              </Card>
            </div>

            {/* Ward Overview */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" />Ward Overview</h2>
                  <p className="text-xs text-gray-500">Current status of all wards</p>
                </div>
                  <Button size="sm" onClick={() => { setEditingWardId(null); setWardForm(emptyWard); setShowWardDialog(true) }}>
            <Plus className="h-4 w-4 mr-1" />Add Ward
          </Button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {wards.map(w => {
                  const beds = w.beds || []
                  const occ = beds.filter(b => b.status === 'occupied').length
                  const total = beds.length || w.capacity || 0
                  const pct = total > 0 ? Math.round((occ / total) * 100) : 0
                  return (
                    <Card key={w.id}>
                      <CardContent className="pt-3 pb-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-sm">{w.name}</span>
                          <Badge variant="outline" className="text-xs">{w.type}</Badge>
                        </div>
                        {(w.building || w.floor) && <p className="text-[11px] text-gray-400 mb-1.5 -mt-1">{[w.building, w.floor].filter(Boolean).join(' · ')}</p>}
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between"><span className="text-gray-500">Capacity:</span><span className="font-medium">{total}</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Occupied:</span><span className="font-medium text-red-500">{occ}</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Available:</span><span className="font-medium text-green-600">{total - occ}</span></div>
                        </div>
                        <Progress value={pct} className="mt-2 h-1" />
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>

            {/* Current Inpatients */}
            <div>
              <h2 className="text-base font-semibold mb-1">Current Inpatients</h2>
              <p className="text-xs text-gray-500 mb-3">{currentAdmitted.length} patient{currentAdmitted.length !== 1 ? 's' : ''} currently admitted</p>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Patient</TableHead>
                        <TableHead>Ward/Bed</TableHead>
                        <TableHead>Doctor</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Diagnosis</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentAdmitted.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">No current admissions</TableCell></TableRow>
                      ) : currentAdmitted.map(a => (
                        <TableRow key={a.id} className={a.isCritical ? (a.criticalLevel === 'blue' ? 'bg-blue-50' : 'bg-yellow-50') : ''}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                                {(a.patient?.firstName?.[0] || '') + (a.patient?.lastName?.[0] || '')}
                              </div>
                              <div>
                                <div className="font-medium text-sm">{getFullName(a.patient)}</div>
                                <div className="text-xs text-gray-500">{a.patient?.mrn}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{a.bed?.ward?.name || getWardName(wards, a)}</div>
                            <div className="text-xs text-gray-500">{a.bed?.bedNumber || '—'}</div>
                          </TableCell>
                          <TableCell className="text-sm">{drName(a.attendingDoctorName) || '—'}</TableCell>
                          <TableCell className="text-sm">{a.bed?.ward?.department?.name || '—'}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">{a.admissionDiagnosis}</TableCell>
                          <TableCell className="text-sm">{a.admissionDate ? differenceInDays(new Date(), new Date(a.admissionDate)) : 0}</TableCell>
                          <TableCell><Badge className="bg-green-100 text-green-800 text-xs">admitted</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </div>
  )
}
