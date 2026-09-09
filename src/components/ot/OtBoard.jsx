import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { getFullName } from '@/lib/patient'
import { Clock, Stethoscope, Plus, Activity } from 'lucide-react'
import { OT_STATUS_COLORS, THEATRE_STATUS_COLORS, formatSlot, formatDuration } from './otDisplay'

// The day's list, laid out the way a theatre list is actually read: one column
// per operating theatre, cases down it in time order.
//
// A flat table cannot answer the two questions anyone standing in the corridor
// is asking — "is OT-2 free?" and "what is after this case?" — because rows for
// four theatres are interleaved. Columns answer both at a glance.
//
// Presentational only: it renders what it is given and reports clicks upward.
// Loading, filtering and refetching stay in OtModule, so this file has one job.
//
// Every visual here is the house kit — <Card>, <Badge>, bg-*-100/text-*-700,
// shadow-sm + hover:shadow-md, border-l-4 accents. Nothing bespoke, so the board
// reads as the same product as Day Care and Ambulance.

const PENDING_STATUSES = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_THEATRE']

// The left edge of a case card, in the same border-l-4 language the stat cards
// across the app use. Priority wins over status, because an emergency must be
// findable before anything else about the case is read.
const PRIORITY_EDGE = {
  EMERGENCY: 'border-l-4 border-l-red-500',
  URGENT: 'border-l-4 border-l-orange-500',
}
const STATUS_EDGE = {
  SCHEDULED: 'border-l-4 border-l-blue-500',
  CONFIRMED: 'border-l-4 border-l-indigo-500',
  CHECKED_IN: 'border-l-4 border-l-purple-500',
  IN_THEATRE: 'border-l-4 border-l-amber-500',
  COMPLETED: 'border-l-4 border-l-green-500',
  CANCELLED: 'border-l-4 border-l-gray-300',
  POSTPONED: 'border-l-4 border-l-orange-400',
}

// showDate — the filter can span more than one day (This Week, Custom Range), and
// then every slot has to say which date, or a week of cases all read "9:00 am".
export default function OtBoard({ theatres, bookings, showDate = false, onSelectCase, onAddCase }) {
  // Group once, not once per column: a filter inside the map would walk the whole
  // booking list for every theatre on screen.
  const casesByTheatre = useMemo(() => {
    const grouped = new Map(theatres.map((theatre) => [theatre.id, []]))
    for (const booking of bookings) {
      grouped.get(booking.theatreId)?.push(booking)
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))
    }
    return grouped
  }, [theatres, bookings])

  if (theatres.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-500">
          No operating theatres yet — add one before booking a case.
        </CardContent>
      </Card>
    )
  }

  return (
    // A grid, not a sideways-scrolling strip: theatres wrap onto the next row so
    // every column stays on screen. Sideways scrolling hides the very theatre
    // someone is looking for, and on a trackpad it is easy to miss that there is
    // anything to the right at all.
    //
    // auto-fill/minmax rather than fixed breakpoints: with four theatres and a
    // hard-coded 3-per-row, the fourth dropped onto a line of its own beside a
    // screen-width gap. This fits as many 260px columns as the window actually
    // has room for, so the row fills before it wraps — and it keeps working when
    // a hospital adds its sixth theatre.
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))] items-start">
      {theatres.map((theatre) => (
        <TheatreColumn
          key={theatre.id}
          theatre={theatre}
          cases={casesByTheatre.get(theatre.id) ?? []}
          showDate={showDate}
          onSelectCase={onSelectCase}
          onAddCase={onAddCase}
        />
      ))}
    </div>
  )
}

function TheatreColumn({ theatre, cases, showDate, onSelectCase, onAddCase }) {
  const pending = cases.filter((c) => PENDING_STATUSES.includes(c.status)).length

  // Total booked minutes, so a list that is already nine hours long says so
  // before anyone adds a tenth case to it.
  const bookedMinutes = cases
    .filter((c) => PENDING_STATUSES.includes(c.status) || c.status === 'COMPLETED')
    .reduce((sum, c) => sum + (c.estimatedMinutes || 0), 0)

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader className="py-4 border-b">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="truncate text-base">{theatre.name}</CardTitle>
          <Badge className={THEATRE_STATUS_COLORS[theatre.status] || 'bg-gray-100 text-gray-700'}>
            {(theatre.status || '').replace(/_/g, ' ')}
          </Badge>
        </div>
        <p className="text-sm text-gray-500">
          {cases.length === 0
            ? 'Nothing booked'
            : `${cases.length} case${cases.length > 1 ? 's' : ''} · ${pending} to go${bookedMinutes ? ` · ${formatDuration(bookedMinutes)}` : ''}`}
        </p>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 pt-4">
        {cases.map((booking) => (
          <CaseCard key={booking.id} booking={booking} showDate={showDate} onSelect={onSelectCase} />
        ))}

        <button
          type="button"
          onClick={() => onAddCase?.(theatre)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed
                     border-gray-300 py-2.5 text-sm font-medium text-gray-500 transition-colors
                     hover:border-blue-500 hover:text-blue-600"
        >
          <Plus className="h-4 w-4" /> Add case
        </button>
      </CardContent>
    </Card>
  )
}

// How far a running case has got, 0–100. Shown only while IN_THEATRE, where the
// question being asked is "how much longer?" — everywhere else it is noise.
function elapsedPercent(booking) {
  const start = new Date(booking.actualStart || booking.scheduledStart).getTime()
  const end = new Date(booking.scheduledEnd).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  const done = ((Date.now() - start) / (end - start)) * 100
  return Math.min(100, Math.max(0, Math.round(done)))
}

function CaseCard({ booking, showDate, onSelect }) {
  const isRunning = booking.status === 'IN_THEATRE'
  const isClosed = booking.status === 'CANCELLED' || booking.status === 'COMPLETED'
  const edge = PRIORITY_EDGE[booking.priority] || STATUS_EDGE[booking.status] || 'border-l-4 border-l-gray-300'

  return (
    <button
      type="button"
      onClick={() => onSelect?.(booking)}
      className={`w-full rounded-lg border bg-white p-3 text-left shadow-sm transition-shadow
                  hover:shadow-md ${edge} ${isClosed ? 'opacity-75' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Clock className="h-4 w-4 text-gray-400" />
          {formatSlot(booking.scheduledStart, booking.scheduledEnd, { withDate: showDate })}
        </span>
        <StatusBadge status={booking.status} map={OT_STATUS_COLORS} />
      </div>

      <p className="mt-2 font-medium leading-snug">
        {booking.procedureName}
        {booking.laterality && booking.laterality !== 'NA' && (
          <span className="ml-1.5 text-xs font-normal text-gray-500">
            · {booking.laterality.toLowerCase()}
          </span>
        )}
      </p>

      <p className="mt-1 truncate text-sm text-gray-700">
        {getFullName(booking.patient)}
        <span className="ml-1 text-xs text-gray-400">{booking.patient?.mrn}</span>
      </p>

      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-xs text-gray-500">
        <span className="flex min-w-0 items-center gap-1">
          <Stethoscope className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="truncate">{booking.surgeon?.fullName}</span>
        </span>
        {booking.estimatedMinutes > 0 && (
          <span className="shrink-0">{formatDuration(booking.estimatedMinutes)}</span>
        )}
      </div>

      {isRunning && <RunningProgress percent={elapsedPercent(booking)} />}
    </button>
  )
}

// Turns amber into red once the case is past its booked end, because the list
// behind it is what slips — and that is the moment the co-ordinator needs to see.
function RunningProgress({ percent }) {
  const overrun = percent >= 100
  const tone = overrun ? 'text-red-600' : 'text-amber-700'

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-xs font-medium">
        <span className={`flex items-center gap-1 ${tone}`}>
          <Activity className="h-3.5 w-3.5" /> {overrun ? 'Running over' : 'In progress'}
        </span>
        <span className={tone}>{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-100">
        <div
          className={`h-full rounded-full ${overrun ? 'bg-red-500' : 'bg-amber-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
