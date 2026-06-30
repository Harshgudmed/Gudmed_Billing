import { Plus, Edit, Building2, BedDouble } from 'lucide-react'
import { format } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { emptyWard, emptyAddBed, emptyAdmission } from '@/lib/inpatientHelpers'

// Wards & Beds tab — ward list table + visual bed map (building → floor → ward → beds).
// Clicking an available bed jumps to the New Admission tab with that bed pre-selected.
// Ward/Bed add+edit happen through the shared dialogs owned by InpatientModule.
export default function WardsBedsTab({
  wards, admissions, buildingFilter, setBuildingFilter, buildingOptions, bedMapGroups,
  setEditingWardId, setWardForm, setShowWardDialog, setAddBedForm, setShowAddBedDialog,
  setActiveTab, setAdmitPatient, setAdmitForm, fetchBedsForWard,
}) {
  return (
          <div className="space-y-6">
            {/* Ward list table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-semibold">Ward List</h2>
                  <p className="text-xs text-gray-500">Manage wards and view bed availability</p>
                </div>
                <Button size="sm" onClick={() => { setEditingWardId(null); setWardForm(emptyWard); setShowWardDialog(true) }}>
                  <Plus className="h-4 w-4 mr-1" />Add Ward
                </Button>
              </div>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ward Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Total Beds</TableHead>
                        <TableHead>Occupied</TableHead>
                        <TableHead>Available</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wards.length === 0 ? (
                        <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-400">No wards configured</TableCell></TableRow>
                      ) : wards.map(w => {
                        const beds = w.beds || []
                        const occ = beds.filter(b => b.status === 'occupied').length
                        const total = beds.length || w.capacity || 0
                        return (
                          <TableRow key={w.id}>
                            <TableCell>
                              <div className="font-medium">{w.name}</div>
                              <div className="text-xs text-gray-500">{w.code}</div>
                            </TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{w.type}</Badge></TableCell>
                            <TableCell>
                              <div className="text-sm">{w.building || '—'}</div>
                              <div className="text-xs text-gray-500">{w.floor || ''}</div>
                            </TableCell>
                            <TableCell className="text-sm">{w.department?.name || '—'}</TableCell>
                            <TableCell className="font-medium">{total}</TableCell>
                            <TableCell className="text-red-500 font-medium">{occ}</TableCell>
                            <TableCell className="text-green-600 font-medium">{total - occ}</TableCell>
                            <TableCell><Badge className="bg-green-100 text-green-800 text-xs">Active</Badge></TableCell>
                            <TableCell>
                              <Button size="sm" variant="ghost" onClick={() => { setWardForm({ name: w.name, code: w.code, type: w.type, capacity: w.capacity, building: w.building || '', floor: w.floor || '', departmentId: w.departmentId || '', chargeNurse: w.chargeNurse || '', phone: w.phone || '' }); setEditingWardId(w.id); setShowWardDialog(true) }}>
                                <Edit className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* Bed Map */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-semibold">Bed Map</h2>
                  <p className="text-xs text-gray-500">Visual overview of all beds</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <Select value={buildingFilter} onValueChange={setBuildingFilter}>
                    <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="All Buildings" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Buildings</SelectItem>
                      {buildingOptions.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-green-500 inline-block" />Available</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-red-500 inline-block" />Occupied</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-yellow-500 inline-block" />Maintenance</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-blue-500 inline-block" />Reserved</span>
                </div>
              </div>
              <div className="space-y-6">
                {bedMapGroups.map(([building, floors]) => (
                <div key={building} className="rounded-lg border bg-gray-50/40 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-4 w-4 text-blue-600" />
                    <span className="font-semibold text-sm">{building}</span>
                    <Badge variant="outline" className="text-xs">{Object.values(floors).flat().length} ward{Object.values(floors).flat().length !== 1 ? 's' : ''}</Badge>
                  </div>
                  {Object.entries(floors).map(([floor, floorWards]) => (
                  <div key={floor} className="mb-4 last:mb-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{floor}</div>
                    <div className="space-y-5">
                {floorWards.map(w => {
                  const beds = w.beds || []
                  return (
                    <div key={w.id}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{w.name}</span>
                          <Badge variant="outline" className="text-xs">{w.type}</Badge>
                          {w.department?.name && <Badge variant="outline" className="text-xs text-blue-600 border-blue-200">{w.department.name}</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{beds.filter(b => b.status === 'occupied').length}/{beds.length} occupied</span>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setAddBedForm({ ...emptyAddBed, wardId: w.id }); setShowAddBedDialog(true) }}>
                            <Plus className="h-3 w-3 mr-1" />Add Bed
                          </Button>
                        </div>
                      </div>
                      {beds.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">No beds configured for this ward</p>
                      ) : (
                        <div className="flex flex-wrap gap-3">
                          {beds.map(bed => {
                            const admission = admissions.find(a => a.bedId === bed.id && a.status === 'admitted')
                            const patientName = admission ? `${admission.patient?.firstName || ''} ${admission.patient?.lastName || ''}`.trim() : ''
                            const styles = {
                              occupied:    { bed: 'border-red-400 bg-red-50',    sheet: 'bg-red-500',    text: 'text-red-700' },
                              maintenance: { bed: 'border-yellow-400 bg-yellow-50', sheet: 'bg-yellow-500', text: 'text-yellow-700' },
                              reserved:    { bed: 'border-blue-400 bg-blue-50',  sheet: 'bg-blue-500',   text: 'text-blue-700' },
                              available:   { bed: 'border-green-400 bg-green-50', sheet: 'bg-green-500',  text: 'text-green-700' },
                            }[bed.status] || { bed: 'border-green-400 bg-green-50', sheet: 'bg-green-500', text: 'text-green-700' }
                            const isAvailable = bed.status === 'available'

                            return (
                              <div key={bed.id} className="relative group">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isAvailable) {
                                      // Open the in-module New Admission tab with this
                                      // ward + bed pre-selected (admit an existing patient),
                                      // instead of jumping to the Register-New-Patient page.
                                      setActiveTab('new-admission')
                                      setAdmitPatient(null)
                                      setAdmitForm({ ...emptyAdmission, wardId: w.id, bedId: bed.id })
                                      fetchBedsForWard(w.id)
                                    }
                                  }}
                                  className={`relative w-[68px] rounded-lg border-2 ${styles.bed} p-1.5 flex flex-col items-center transition-all ${isAvailable ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : 'cursor-default'}`}
                                >
                                  {/* pillow */}
                                  <div className={`h-1.5 w-7 rounded-full ${styles.sheet} mb-1`} />
                                  {/* bed icon */}
                                  <BedDouble className={`h-6 w-6 ${styles.text}`} />
                                  {/* bed number */}
                                  <span className={`mt-0.5 text-[11px] font-bold ${styles.text} leading-none text-center break-all`}>
                                    {bed.bedNumber}
                                  </span>
                                </button>

                                {/* Hover tooltip */}
                                <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden -translate-x-1/2 group-hover:block">
                                  <div className="whitespace-nowrap rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg">
                                    <div className="font-semibold">Bed {bed.bedNumber}</div>
                                    {bed.status === 'occupied' ? (
                                      <div className="mt-0.5 text-gray-200">
                                        👤 {patientName || 'Occupied'}
                                        {admission?.admissionDate && (
                                          <div className="text-gray-400">Since {format(new Date(admission.admissionDate), 'dd MMM')}</div>
                                        )}
                                      </div>
                                    ) : bed.status === 'available' ? (
                                      <div className="mt-0.5 text-green-300">Available · click to admit patient</div>
                                    ) : (
                                      <div className="mt-0.5 text-gray-300 capitalize">{bed.status}</div>
                                    )}
                                    <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 bg-gray-900" />
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
                    </div>
                  </div>
                  ))}
                </div>
                ))}
                {bedMapGroups.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No wards configured</p>}
              </div>
            </div>
          </div>
  )
}
