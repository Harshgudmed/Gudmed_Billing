import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useDateFilter } from '@/components/common/DateFilter'
import { useDebounce } from '@/lib/useDebounce'
import { getFullName } from '@/lib/patient'
import { formatDateTime } from '@/lib/format'
import {
  Stethoscope, Plus, Search, Loader2, AlertCircle, RefreshCw, LayoutGrid, List,
} from 'lucide-react'
import { toast } from 'sonner'
import { otApi, OT_STATUSES } from '@/api/otApi'
import OtBoard from './OtBoard'
import BookingFormDialog from './BookingFormDialog'
import CaseDetailDialog from './CaseDetailDialog'
import { OT_STATUS_COLORS, OT_PRIORITY_COLORS, formatSlot, formatDuration } from './otDisplay'

// Operation Theatre — one day at a time.
//
// The day is the unit a theatre list is planned and run in, so the date sits at
// the top and everything below answers "what is happening on this date". Two
// views over the SAME data: the board (a column per theatre, how the corridor
// reads it) and the list (searchable, how the office reads it).
//
// Booking and status moves live in their own dialogs; this file owns the day,
// the filters and the data both views read.

const labelize = (value) => (value || '').replace(/_/g, ' ')

export default function OtModule() {
  const [bookings, setBookings] = useState([])
  const [theatres, setTheatres] = useState([])
  const [surgeries, setSurgeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // The booking dialog. `bookingFor` carries the theatre a "+ Add case" came
  // from, so the form opens with that column already chosen.
  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingFor, setBookingFor] = useState(null)

  // The case whose detail is open. Held as the row itself, not just an id, so the
  // dialog renders instantly from data the list already has.
  const [selectedCase, setSelectedCase] = useState(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [theatreFilter, setTheatreFilter] = useState('all')

  // The shared date filter every other module uses. Starting on "today" because
  // a theatre board is read for the day it is; `showClear: false` because this
  // toolbar already has several filters and one Clear that did less than the
  // others would be worse than none.
  //
  // Its `range` is already { startDate, endDate } in the 'YYYY-MM-DD' shape the
  // backend's dayRange() expects, so nothing here formats a date by hand.
  const dateFilter = useDateFilter('today', { showClear: false })
  const { startDate, endDate } = dateFilter.range

  // Waits for a pause in typing rather than firing a request per keystroke.
  const debouncedSearch = useDebounce(search, 300)

  // The backend does every filter, including the date range, so the browser
  // never holds more of the schedule than is on screen.
  const loadBookings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await otApi.getBookings({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status: statusFilter,
        theatreId: theatreFilter === 'all' ? undefined : theatreFilter,
        search: debouncedSearch || undefined,
      })
      setBookings(res?.data ?? [])
    } catch (e) {
      // The backend's message names the rule that was broken; only fall back
      // when there is nothing to show.
      setError(e?.message || 'Could not load the theatre list')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, statusFilter, theatreFilter, debouncedSearch])

  // Theatres change rarely — loaded once, and they define the board's columns.
  const loadTheatres = useCallback(async () => {
    try {
      const res = await otApi.getTheatres()
      setTheatres(res?.data ?? [])
    } catch {
      toast.error('Could not load the operating theatres')
    }
  }, [])

  // The surgery catalogue, loaded once for the booking form. Departments and
  // doctors are NOT fetched here — the form uses the shared useBookingSource
  // hook, which caches departments across the session and asks for only the
  // chosen department's doctors.
  useEffect(() => {
    otApi.getSurgeries()
      .then((res) => setSurgeries(res?.data ?? []))
      .catch(() => toast.error('Could not load the surgery catalogue'))
  }, [])

  useEffect(() => { loadTheatres() }, [loadTheatres])
  useEffect(() => { loadBookings() }, [loadBookings])

  const refreshAll = () => { loadTheatres(); loadBookings() }

  const openBooking = (theatre) => {
    setBookingFor(theatre ?? null)
    setBookingOpen(true)
  }

  // The board shows only the columns the theatre filter allows, so choosing one
  // theatre narrows the board the same way it narrows the list.
  const visibleTheatres = useMemo(
    () => (theatreFilter === 'all' ? theatres : theatres.filter((t) => t.id === theatreFilter)),
    [theatres, theatreFilter],
  )

  const summary = useMemo(() => ({
    total: bookings.length,
    inTheatre: bookings.filter((b) => b.status === 'IN_THEATRE').length,
    completed: bookings.filter((b) => b.status === 'COMPLETED').length,
    emergency: bookings.filter((b) => b.priority === 'EMERGENCY').length,
  }), [bookings])

  // The shared filter offers ranges (This Week, This Month, Custom), not only a
  // single day. When the range covers more than one date, every slot has to say
  // WHICH date — otherwise a week's cases all read "9:00 am" and the column
  // becomes unreadable.
  const spansMultipleDays = startDate !== endDate

  const rangeLabel = !startDate
    ? 'All dates'
    : spansMultipleDays
      ? `${formatDateTime(startDate, { withTime: false })} – ${formatDateTime(endDate, { withTime: false })}`
      : formatDateTime(startDate, { withTime: false })


  return (
    <div className="space-y-6">
      {/* The same page header every other module uses — icon, title, subtitle,
          blue primary action. OT is not a special case and must not look like
          one; a screen that styles its own header reads as a bolted-on product. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold">Operation Theatre</h1>
            <p className="text-gray-500">Surgery scheduling &amp; theatre board</p>
          </div>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => openBooking(null)}>
          <Plus className="h-4 w-4 mr-2" /> New Booking
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {/* Names the dates on screen rather than saying "Today" — this filter can
            show any day, this week or a custom range. */}
        <SummaryCard title={`Cases · ${rangeLabel}`} value={summary.total} />
        <SummaryCard title="In Theatre" value={summary.inTheatre} accent="border-l-amber-500" />
        <SummaryCard title="Completed" value={summary.completed} accent="border-l-green-500" />
        <SummaryCard title="Emergency" value={summary.emergency} accent="border-l-red-500" />
      </div>

      <Tabs defaultValue="board">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="board" className="gap-2">
              <LayoutGrid className="h-4 w-4" /> Board
            </TabsTrigger>
            <TabsTrigger value="list" className="gap-2">
              <List className="h-4 w-4" /> List
            </TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full md:w-64">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search patient, procedure, case no..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {dateFilter.control}

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {OT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{labelize(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={theatreFilter} onValueChange={setTheatreFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Theatres</SelectItem>
                {theatres.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={refreshAll} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* One loading / error / empty treatment for both views, so they can
            never disagree about what an empty day looks like. */}
        <div className="mt-4">
          {loading ? (
            <PanelMessage icon={<Loader2 className="h-5 w-5 mr-2 animate-spin" />} text="Loading cases…" />
          ) : error ? (
            <PanelMessage icon={<AlertCircle className="h-5 w-5 mr-2" />} text={error} tone="text-red-600" />
          ) : (
            <>
              <TabsContent value="board" className="mt-0">
                <OtBoard
                  theatres={visibleTheatres}
                  bookings={bookings}
                  showDate={spansMultipleDays}
                  onSelectCase={setSelectedCase}
                  onAddCase={openBooking}
                />
              </TabsContent>

              <TabsContent value="list" className="mt-0">
                <CaseTable bookings={bookings} showDate={spansMultipleDays} onSelect={setSelectedCase} />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>

      {/* Booking a case can free or occupy a theatre, so both lists are reloaded
          rather than the new case being pushed into the one on screen. */}
      <BookingFormDialog
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        theatres={theatres}
        surgeries={surgeries}
        defaultTheatreId={bookingFor?.id ?? ''}
        defaultDate={startDate || undefined}
        onCreated={refreshAll}
      />

      {/* A status move can occupy or release a theatre, so both lists reload. */}
      <CaseDetailDialog
        open={!!selectedCase}
        onOpenChange={(isOpen) => { if (!isOpen) setSelectedCase(null) }}
        booking={selectedCase}
        onChanged={refreshAll}
      />
    </div>
  )
}

// ── Small pieces ────────────────────────────────────────────────────────────
// Each is used only here for now, and moves into its own file the moment a
// second screen needs it — not before.

// The stat card exactly as Ambulance, Day Care and Insurance render it —
// border-l-4 accent, gray label, 2xl bold figure. Same kit, same weight.
function SummaryCard({ title, value, accent = '' }) {
  return (
    <Card className={accent ? `border-l-4 ${accent}` : ''}>
      <CardHeader className="py-4">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  )
}

function PanelMessage({ icon, text, tone = 'text-gray-500' }) {
  return (
    <Card>
      <CardContent className={`flex items-center justify-center py-12 ${tone}`}>
        {icon}{text}
      </CardContent>
    </Card>
  )
}

function CaseTable({ bookings, showDate, onSelect }) {
  if (bookings.length === 0) {
    return <PanelMessage text="No cases match these filters." />
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case No.</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Procedure</TableHead>
              <TableHead>Theatre</TableHead>
              <TableHead>Slot</TableHead>
              <TableHead>Surgeon</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((booking) => (
              <TableRow
                key={booking.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => onSelect?.(booking)}
              >
                <TableCell className="font-medium">{booking.caseNumber}</TableCell>
                <TableCell>
                  <div>{getFullName(booking.patient)}</div>
                  <div className="text-xs text-gray-500">{booking.patient?.mrn}</div>
                </TableCell>
                <TableCell>
                  <div>{booking.procedureName}</div>
                  {booking.laterality && booking.laterality !== 'NA' && (
                    <div className="text-xs text-gray-500">{labelize(booking.laterality)}</div>
                  )}
                </TableCell>
                <TableCell>{booking.theatre?.name}</TableCell>
                <TableCell>
                  <div>{formatSlot(booking.scheduledStart, booking.scheduledEnd, { withDate: showDate })}</div>
                  {booking.estimatedMinutes && (
                    <div className="text-xs text-gray-500">{formatDuration(booking.estimatedMinutes)}</div>
                  )}
                </TableCell>
                <TableCell>{booking.surgeon?.fullName}</TableCell>
                <TableCell>
                  <Badge className={OT_PRIORITY_COLORS[booking.priority] || 'bg-gray-100 text-gray-700'}>
                    {labelize(booking.priority)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={booking.status} map={OT_STATUS_COLORS} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
