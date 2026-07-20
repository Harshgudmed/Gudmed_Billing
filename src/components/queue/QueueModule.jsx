import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Users, Clock, CheckCircle, Search, MonitorPlay, DoorOpen, Bell } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Pagination } from '@/components/common/Pagination'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useDateFilter } from '@/components/common/DateFilter'
import { useDebounce } from '@/lib/useDebounce'
import { useServerPagination } from '@/lib/useServerPagination'
import client from '@/api/client'
import AppointmentsModule from '@/components/appointments/AppointmentsModule'
import BillingModule from '@/components/billing/BillingModule'
import { getFullName } from "@/lib/patient";

const PRIORITY_COLORS = {
  urgent: 'bg-red-500 text-white',
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  normal: 'bg-blue-100 text-blue-800',
  low: 'bg-green-100 text-green-800',
}

// Ordered most-urgent first — mirrors the backend rank in lib/queuePriority.js.
const PRIORITY_LEVELS = ['urgent', 'high', 'medium', 'normal', 'low']



const QUEUE_STATUS_COLORS = {
  waiting: 'bg-yellow-100 text-yellow-800',
  called: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  no_show: 'bg-gray-100 text-gray-800',
}

// Tiles double as status filters — clicking "Waiting: 5" lists those 5 patients.
const STAT_TILES = [
  { status: 'waiting', label: 'Waiting', color: 'text-yellow-600' },
  { status: 'called', label: 'Called', color: 'text-blue-600' },
  { status: 'in_progress', label: 'In Progress', color: 'text-orange-600' },
  { status: 'completed', label: 'Completed', color: 'text-green-600' },
]

const QUEUE_PER_PAGE = 10

function fmtWait(minutes) {
  if (minutes == null) return '—'
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const TODAY_LABEL = new Date().toLocaleDateString('en-IN', {
  weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
})

export default function QueueModule() {
  const [activeTab, setActiveTab] = useState('queue')
  const [updatingId, setUpdatingId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const debouncedSearch = useDebounce(search, 300)
  const dateFilter = useDateFilter('today')

  const queuePage = useServerPagination('/queue', {
    perPage: QUEUE_PER_PAGE,
    // The queue is a live screen: reception books a patient and must see them
    // appear without pressing Refresh. The appointment now writes its queue row
    // in the same transaction as the booking, so a poll this soon after already
    // finds the patient there. 5s matches how often a busy front desk changes
    // something, while staying far cheaper than the board's 3s wall-display poll.
    pollMs: 5000,
    params: {
      search: debouncedSearch,
      status: statusFilter,
      startDate: dateFilter.range.startDate,
      endDate: dateFilter.range.endDate,
    },
  })
  const { rows: queue, loading, summary, refresh } = queuePage

  const setStatus = async (entry, status, successMessage) => {
    setUpdatingId(`${entry.id}_${status}`)
    try {
      const res = await client.patch(`/queue/${entry.id}`, { status })
      if (res.success) {
        toast.success(successMessage)
        refresh()
      } else {
        toast.error(res.error || 'Failed to update patient')
      }
    } catch (err) {
      toast.error(err.message || 'Failed to update patient')
    } finally {
      setUpdatingId(null)
    }
  }

  // The doctor's one button: finish whoever is in the room and wave the next
  // person in, as a single server-side transaction (POST /queue/call-next).
  //
  // Doing this as two row actions — mark completed, then mark called — is not
  // something a doctor can do from their desk mid-clinic, so in practice nobody
  // did: `in_progress` stayed empty and the board could never say who was next.
  // One press now also produces the "you are next" warning for the person
  // behind, because that is derived from the queue moving.
  const [callingNext, setCallingNext] = useState(false)
  const callNext = async (entry) => {
    setCallingNext(true)
    try {
      const res = await client.post('/queue/call-next', { queueEntryId: entry.id })
      if (res.success) {
        toast.success(res.message || 'Next patient called')
        refresh()
      } else {
        toast.error(res.error || 'Could not call the next patient')
      }
    } catch (err) {
      toast.error(err.message || 'Could not call the next patient')
    } finally {
      setCallingNext(false)
    }
  }

  // Changing priority re-ranks the row on the server (priority -> priorityRank),
  // so the queue must be re-read: the whole point is that the patient MOVES.
  // Mutating `entry.priority` in place did nothing — it is not React state, so
  // React never re-rendered and the row appeared stuck where it was.
  const changePriority = async (entry, priority) => {
    if (priority === entry.priority) return
    setUpdatingId(`${entry.id}_priority`)
    try {
      const res = await client.patch(`/queue/${entry.id}`, { priority })
      if (res.success) {
        toast.success(`Priority set to ${priority}`)
        await refresh()
      } else {
        toast.error(res.error || 'Failed to change priority')
      }
    } catch (err) {
      toast.error(err.message || 'Failed to change priority')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-7 w-7 text-blue-600" />
           Smart Queue Management
          </h1>
          <p className="text-gray-500">{TODAY_LABEL}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Opens in a new tab/window, not a Tabs entry — /display is a
              full-screen route with no sidebar, meant to be dragged onto a
              second monitor, not to replace this staff view in place. */}
          <Button variant="outline" onClick={() => window.open('/display', '_blank', 'noopener')}>
            <MonitorPlay className="h-4 w-4 mr-1" />
            Open Display Board
          </Button>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        {/* ── Queue Tab ── */}
        <TabsContent value="queue" className="space-y-4">
          {/* Stats row — each tile filters the table below */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {STAT_TILES.map(tile => {
              const selected = statusFilter === tile.status
              return (
                // A real <button>, not a focusable div: a div with tabIndex draws a
                // text caret when focused, which made the tile look editable.
                <button
                  key={tile.status}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setStatusFilter(selected ? 'all' : tile.status)}
                  className="text-left rounded-lg"
                >
                  <Card className={`transition-shadow hover:shadow-md ${selected ? 'ring-2 ring-blue-500' : ''}`}>
                    <CardContent className="pt-4">
                      <p className="text-xs text-gray-500">{tile.label}</p>
                      <p className={`text-2xl font-bold ${tile.color}`}>{summary?.[tile.status] ?? 0}</p>
                    </CardContent>
                  </Card>
                </button>
              )
            })}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-56">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                className="pl-8"
                placeholder="Search by patient name, UHID or queue number…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {dateFilter.control}
            {statusFilter !== 'all' && (
              <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => setStatusFilter('all')}>
                Clear status
              </Button>
            )}
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>UHID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Wait Time</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Only blank the table for the FIRST load (no data yet). On a
                      refetch after a priority/status change the rows already
                      exist, so keep showing them instead of wiping the whole list
                      to a spinner — the change re-ranks one row, not the page. */}
                  {loading && queue.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-gray-400">
                        <RefreshCw className="h-5 w-5 animate-spin inline mr-2" />Loading queue...
                      </TableCell>
                    </TableRow>
                  ) : queue.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-gray-400">
                        <Clock className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                        {/* The queue defaults to TODAY. An empty screen with no
                            explanation reads as "the queue is broken" when in fact
                            the filters simply exclude everything — say so, and give
                            a one-click way out. */}
                        {dateFilter.active || statusFilter !== 'all' || debouncedSearch ? (
                          <>
                            <p className="text-gray-600">No patients match the current filters</p>
                            <p className="text-xs mt-1">
                              Showing {dateFilter.active ? <b>{dateFilter.mode === 'today' ? "today" : "the selected dates"}</b> : 'all dates'}
                              {statusFilter !== 'all' && <> · status <b>{statusFilter}</b></>}
                              {debouncedSearch && <> · search <b>“{debouncedSearch}”</b></>}
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={() => {
                                dateFilter.reset()
                                setStatusFilter('all')
                                setSearch('')
                              }}
                            >
                              Clear filters &amp; show all
                            </Button>
                          </>
                        ) : (
                          <>
                            <p>No patients in queue</p>
                            <p className="text-xs mt-1">Queue entries from triage and appointment check-ins appear here</p>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : queue.map((entry, idx) => {
                    const patientName = entry.patient
                      ? getFullName(entry.patient) || '—'
                      : '—'
                    const status = entry.status || 'waiting'
                    const priority = entry.priority || 'normal'
                    const isCompleted = ['completed', 'cancelled'].includes(status)
                    const rowNumber = (queuePage.page - 1) * QUEUE_PER_PAGE + idx + 1

                    return (
                      <TableRow key={entry.id} className={isCompleted ? 'opacity-50' : ''}>
                        <TableCell className="font-bold text-gray-500">{rowNumber}</TableCell>
                        <TableCell>
                          <div className="font-medium">{patientName}</div>
                          {entry.patient?.phonePrimary && (
                            <div className="text-xs text-gray-400">{entry.patient.phonePrimary}</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{entry.patient?.mrn || '—'}</TableCell>
                        <TableCell><StatusBadge status={status} map={QUEUE_STATUS_COLORS} /></TableCell>
                        <TableCell className="text-sm text-gray-600">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-gray-400" />
                            {fmtWait(entry.waitTime)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {isCompleted ? (
                            <StatusBadge status={priority} map={PRIORITY_COLORS} />
                          ) : (
                            <Select 
                              value={priority} 
                              onValueChange={(value) => changePriority(entry, value)}
                              disabled={updatingId === `${entry.id}_priority`}
                            >
                              <SelectTrigger className={`h-7 w-[110px] px-2 py-1 border-none focus:ring-0 capitalize font-semibold text-xs ${PRIORITY_COLORS[priority] || 'bg-gray-100 text-gray-800'}`}>
                                <SelectValue placeholder="Priority" />
                              </SelectTrigger>
                              <SelectContent>
                                {PRIORITY_LEVELS.map(level => (
                                  <SelectItem key={level} value={level} className="capitalize text-xs font-medium">
                                    {level}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {/* The main action: this patient walks in, the one
                                before them is finished, and the person behind
                                them starts reading "You are next" on the wall
                                board — one press, one server transaction. */}
                            {!isCompleted && status !== 'in_progress' && (
                              <Button
                                size="sm"
                                className="bg-[#2E4168] text-white hover:bg-[#253453]"
                                disabled={callingNext}
                                onClick={() => callNext(entry)}
                              >
                                <DoorOpen className="h-3.5 w-3.5 mr-1" />
                                Call in
                              </Button>
                            )}
                            {/* Puts "YOU ARE NEXT — PLEASE BE READY" against
                                this patient on the wall board. Nothing appears
                                there unless this is pressed — the board never
                                decides on its own that someone should stand up. */}
                            {!isCompleted && status !== 'called' && status !== 'in_progress' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-amber-300 text-amber-700 hover:bg-amber-50"
                                disabled={updatingId === `${entry.id}_called`}
                                onClick={() => setStatus(entry, 'called', `${patientName} alerted — "You are next" is now on the display board`)}
                              >
                                <Bell className="h-3.5 w-3.5 mr-1" />
                                Alert next
                              </Button>
                            )}
                            {status === 'called' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-gray-500"
                                disabled={updatingId === `${entry.id}_waiting`}
                                onClick={() => setStatus(entry, 'waiting', 'Alert removed from the display board')}
                              >
                                Undo alert
                              </Button>
                            )}
                            {!isCompleted && (
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white"
                                disabled={updatingId === `${entry.id}_completed`}
                                onClick={() => setStatus(entry, 'completed', 'Marked as completed')}
                              >
                                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                Complete
                              </Button>
                            )}
                            {isCompleted && <span className="text-xs text-gray-400 italic">Done</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <Pagination
                page={queuePage.page}
                totalPages={queuePage.totalPages}
                onPageChange={queuePage.setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Appointments Tab ── */}
        <TabsContent value="appointments">
          <AppointmentsModule />
        </TabsContent>

        {/* ── Billing Tab ── */}
        <TabsContent value="billing">
          <BillingModule />
        </TabsContent>
      </Tabs>
    </div>
  )
}
