import { ArrowRight, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const TRANSFERS_PER_PAGE = 15

// Patient Movement History tab — ward transfers recorded during active admissions.
// Presentational: all data + page state come from InpatientModule via props.
export default function MovementTab({ transferEventList, admissions, transferHistoryPage, setTransferHistoryPage, fetchAll }) {
  return (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-blue-600" />
                  Patient Movement History
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Ward transfers recorded during active admissions
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge className="bg-blue-100 text-blue-800">
                  {transferEventList.length} transfer{transferEventList.length !== 1 ? 's' : ''}
                </Badge>
                <Button variant="outline" size="sm" onClick={fetchAll}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
                </Button>
              </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-4">
              <Card className="border-l-4 border-l-blue-400">
                <CardContent className="pt-4 pb-3">
                  <p className="text-2xl font-bold text-blue-600">{transferEventList.length}</p>
                  <p className="text-xs text-gray-500 mt-1">Total Transfers</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-green-400">
                <CardContent className="pt-4 pb-3">
                  <p className="text-2xl font-bold text-green-600">
                    {new Set(transferEventList.map(e => e.admissionId)).size}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Patients Moved</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-purple-400">
                <CardContent className="pt-4 pb-3">
                  <p className="text-2xl font-bold text-purple-600">
                    {admissions.filter(a => a.status === 'admitted').length}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Currently Admitted</p>
                </CardContent>
              </Card>
            </div>

            {/* Transfer event table */}
            {transferEventList.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <ArrowRight className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-gray-400 font-medium">No patient movements recorded</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Transfers are recorded when you use the Transfer button on an admission.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="font-semibold">Patient</TableHead>
                        <TableHead className="font-semibold">Current Ward / Bed</TableHead>
                        <TableHead className="font-semibold">Transfer Details</TableHead>
                        <TableHead className="font-semibold">Date &amp; Time</TableHead>
                        <TableHead className="font-semibold">Authorised By</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const sortedTransfers = transferEventList.sort((a, b) => new Date(b.date) - new Date(a.date))
                        const startIdx = (transferHistoryPage - 1) * TRANSFERS_PER_PAGE
                        const endIdx = startIdx + TRANSFERS_PER_PAGE
                        const paginatedTransfers = sortedTransfers.slice(startIdx, endIdx)
                        return paginatedTransfers.map((ev, idx) => {
                          // Parse ward names from note text
                          const fromMatch = ev.note.match(/from\s+([^(]+?)\s*\(/i)
                          const toMatch   = ev.note.match(/to\s+([^(]+?)\s*\(/i)
                          const fromWard  = fromMatch?.[1]?.trim() || '—'
                          const toWard    = toMatch?.[1]?.trim()   || ev.currentWard
                          const fromBedM  = ev.note.match(/Bed\s+(\S+)\)/i)
                          const toBedM    = ev.note.match(/to\s+[^(]+\(Bed\s+(\S+)\)/i)
                          const fromBed   = fromBedM?.[1] || '—'
                          const toBed     = toBedM?.[1]   || ev.currentBed
                          return (
                            <TableRow key={`${ev.admissionId}-${idx}`} className="hover:bg-blue-50/30">
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                                    {(ev.patient?.firstName?.[0] || '') + (ev.patient?.lastName?.[0] || '')}
                                  </div>
                                  <div>
                                    <div className="font-medium text-sm">{ev.patient?.firstName} {ev.patient?.lastName}</div>
                                    <div className="text-xs text-gray-400">{ev.patient?.mrn}</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm font-medium">{ev.currentWard}</div>
                                <div className="text-xs text-gray-400">Bed {ev.currentBed}</div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5 text-sm">
                                  <span className="bg-red-50 text-red-700 border border-red-200 rounded px-1.5 py-0.5 text-xs font-medium">
                                    {fromWard} / {fromBed}
                                  </span>
                                  <ArrowRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                  <span className="bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 text-xs font-medium">
                                    {toWard} / {toBed}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">{ev.date ? format(new Date(ev.date), 'dd MMM yyyy') : '—'}</div>
                                <div className="text-xs text-gray-400">{ev.date ? format(new Date(ev.date), 'HH:mm') : ''}</div>
                              </TableCell>
                              <TableCell className="text-sm text-gray-600">{ev.authorName}</TableCell>
                              <TableCell>
                                <Badge className={
                                  ev.status === 'admitted'
                                    ? 'bg-green-100 text-green-800 text-xs'
                                    : ev.status === 'discharged'
                                    ? 'bg-gray-100 text-gray-700 text-xs'
                                    : 'bg-blue-100 text-blue-800 text-xs'
                                }>
                                  {ev.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          )
                        })
                      })()}
                    </TableBody>
                  </Table>
                  {transferEventList.length > TRANSFERS_PER_PAGE && (
                    <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
                      <Button variant="outline" size="sm" onClick={() => setTransferHistoryPage(p => Math.max(1, p - 1))} disabled={transferHistoryPage === 1}>
                        <ChevronLeft className="h-4 w-4 mr-1" />Previous
                      </Button>
                      <span className="text-sm text-gray-600">Page {transferHistoryPage} of {Math.ceil(transferEventList.length / TRANSFERS_PER_PAGE)}</span>
                      <Button variant="outline" size="sm" onClick={() => setTransferHistoryPage(p => Math.min(Math.ceil(transferEventList.length / TRANSFERS_PER_PAGE), p + 1))} disabled={transferHistoryPage >= Math.ceil(transferEventList.length / TRANSFERS_PER_PAGE)}>
                        <>Next<ChevronRight className="h-4 w-4 ml-1" /></>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
  )
}
