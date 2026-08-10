import { useState, useCallback, lazy, Suspense } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Users, Search, MonitorPlay } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { useDateFilter } from '@/components/common/DateFilter'
import { useDebounce } from '@/lib/useDebounce'
import { useServerPagination } from '@/lib/useServerPagination'
import client from '@/api/client'
// Both are behind lazy() because they are whole modules living in this module's
// tabs, and a static import puts them in the Queue route's bundle whether or not
// anyone opens the tab. Measured on the Queue route: 833 KB of Billing and 690 KB
// of Appointments arrived for a receptionist who only watches the queue.
// Radix unmounts an inactive TabsContent, so neither ever mounted — the bytes were
// downloaded and parsed for nothing.
const AppointmentsModule = lazy(() => import('@/components/appointments/AppointmentsModule'))
const BillingModule = lazy(() => import('@/components/billing/BillingModule'))
import { QueueRow } from '@/components/queue/QueueRow'
import { QueueEmptyState } from '@/components/queue/QueueEmptyState'

// Named, not a bare spinner: the tab loads a whole module on a hospital's
// connection, and "Loading Billing…" tells the user the click registered.
function TabLoading({ name }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
      <RefreshCw className="h-4 w-4 animate-spin" />
      Loading {name}…
    </div>
  )
}

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

// The table's columns, declared once: PaginatedTable renders these as the header
// AND derives the loading/empty cell's colSpan from the count, so the two can no
// longer drift apart. Must stay in the same order as the cells in QueueRow.
const QUEUE_COLUMNS = [
  { header: '#', className: 'w-10' },
  { header: 'Patient Name' },
  { header: 'UHID' },
  { header: 'Status' },
  { header: 'Wait Time' },
  { header: 'Priority' },
  { header: 'Actions' },
]

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
  // `rows` isn't pulled out: PaginatedTable reads them off the pagination object
  // itself. `loading` drives the Refresh button, `summary` the stat tiles.
  const { loading, summary, refresh } = queuePage

  // One place for the loading/success/error/refresh cycle every queue action
  // shares. setStatus, callNext and changePriority used to each copy-paste this
  // same try/catch/finally shape — three identical copies in one file, the
  // textbook "Rule of Three" signal to extract it. Mirrors the same-shaped
  // `act()` helper in DisplayBoardPage.jsx, which solved this exact problem
  // for the doctor console first.
  //
  // `key` scopes the loading flag to ONE row+action (e.g. "id_called"), so
  // pressing one row's button never disables a different row's — callNext
  // previously used a single component-wide `callingNext` boolean instead,
  // which disabled every row's "Call in" button at once while any one call
  // was in flight.
  // The three row handlers below are useCallback'd, and this is why: QueueRow is
  // memo'd, and memo compares props by reference. A handler rebuilt on every render
  // makes every row re-render anyway, so the memo would cost a comparison and buy
  // nothing — which is the failure mode that looks like "we already memoised it".
  const act = useCallback(async (key, fn, successMessage, failureMessage) => {
    setUpdatingId(key)
    try {
      const res = await fn()
      if (res.success) {
        toast.success(typeof successMessage === 'function' ? successMessage(res) : successMessage)
        await refresh()
      } else {
        toast.error(res.error || failureMessage)
      }
    } catch (err) {
      toast.error(err.message || failureMessage)
    } finally {
      setUpdatingId(null)
    }
  }, [refresh])

  const setStatus = useCallback((entry, status, successMessage) =>
    act(`${entry.id}_${status}`, () => client.patch(`/queue/${entry.id}`, { status }), successMessage, 'Failed to update patient'),
  [act])

  // The doctor's one button: finish whoever is in the room and wave the next
  // person in, as a single server-side transaction (POST /queue/call-next).
  //
  // Doing this as two row actions — mark completed, then mark called — is not
  // something a doctor can do from their desk mid-clinic, so in practice nobody
  // did: `in_progress` stayed empty and the board could never say who was next.
  // One press now also produces the "you are next" warning for the person
  // behind, because that is derived from the queue moving.
  const callNext = useCallback((entry) =>
    act(`${entry.id}_call`, () => client.post('/queue/call-next', { queueEntryId: entry.id }), (res) => res.message || 'Next patient called', 'Could not call the next patient'),
  [act])

  // Changing priority re-ranks the row on the server (priority -> priorityRank),
  // so the queue must be re-read: the whole point is that the patient MOVES.
  // Mutating `entry.priority` in place did nothing — it is not React state, so
  // React never re-rendered and the row appeared stuck where it was.
  const changePriority = useCallback((entry, priority) => {
    if (priority === entry.priority) return
    return act(`${entry.id}_priority`, () => client.patch(`/queue/${entry.id}`, { priority }), `Priority set to ${priority}`, 'Failed to change priority')
  }, [act])

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

          {/* The table itself — header, first-load spinner, empty state, the page
              of rows and the pagination footer — is the shared PaginatedTable,
              so none of that boilerplate (or the colSpan that has to match the
              column count) lives here. QUEUE_COLUMNS is the single source of
              both the headers and that colSpan. */}
          <Card>
            <CardContent className="p-0">
              <PaginatedTable
                pagination={queuePage}
                columns={QUEUE_COLUMNS}
                loadingLabel="Loading queue..."
                empty={
                  <QueueEmptyState
                    dateFilter={dateFilter}
                    statusFilter={statusFilter}
                    search={debouncedSearch}
                    onClearFilters={() => { dateFilter.reset(); setStatusFilter('all'); setSearch('') }}
                  />
                }
                renderRow={(entry, idx) => (
                  <QueueRow
                    key={entry.id}
                    entry={entry}
                    rowNumber={(queuePage.page - 1) * QUEUE_PER_PAGE + idx + 1}
                    updatingId={updatingId}
                    statusColors={QUEUE_STATUS_COLORS}
                    priorityColors={PRIORITY_COLORS}
                    priorityLevels={PRIORITY_LEVELS}
                    onCallNext={callNext}
                    onSetStatus={setStatus}
                    onChangePriority={changePriority}
                  />
                )}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Appointments Tab ── */}
        <TabsContent value="appointments">
          <Suspense fallback={<TabLoading name="Appointments" />}>
            <AppointmentsModule />
          </Suspense>
        </TabsContent>

        {/* ── Billing Tab ── */}
        <TabsContent value="billing">
          <Suspense fallback={<TabLoading name="Billing" />}>
            <BillingModule />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}
