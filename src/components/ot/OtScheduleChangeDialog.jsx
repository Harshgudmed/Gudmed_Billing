import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusBadge } from '@/components/common/StatusBadge'
import { getFullName } from '@/lib/patient'
import { drName } from '@/lib/utils'
import {
  Loader2, AlertCircle, AlertTriangle, ArrowRight, ArrowDown, Calendar, CalendarClock,
  Check, CheckCircle2, ChevronLeft, ChevronRight, PauseCircle, RefreshCw, Stethoscope,
  User, Users,
} from 'lucide-react'
import { otApi } from '@/api/otApi'
import {
  OT_CHANGE_REASONS, OT_REASON_OTHER, OT_SCHEDULE_ACTIONS,
  OT_STATUS_COLORS, OT_PRIORITY_COLORS, formatSlot, formatDuration,
} from './otDisplay'

// Moving a case off its slot, start to finish.
//
// Postpone, Reschedule and Re-book were three buttons doing three different
// things: Postpone asked for a reason and kept the old time, Re-book flipped the
// status back to SCHEDULED still pointing at the slot the case was postponed out
// of — no reason, no new time, no clash check on that path at all — and
// Reschedule, the one endpoint that locks the theatre and re-runs the conflict
// check, was reachable from nowhere in the app.
//
// They are one question — "this case is not happening when it was planned, why,
// and what now?" — so they are one flow. Only the last answer differs.
//
// Stepped rather than one long form because each step's answer decides what the
// next one can even show: the reason is recorded before a slot is offered, and
// the slots depend on how long the case runs and who is operating.

const STEPS = [
  { n: 1, title: 'Enter Reason' },
  { n: 2, title: 'Select New Date & Time' },
  { n: 3, title: 'Verify Availability' },
  { n: 4, title: 'Review & Confirm' },
]

// 'YYYY-MM-DD' from local parts. Never toISOString(), which converts to UTC and
// hands back the previous day for anyone east of Greenwich.
const toDateInput = (date) => {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const hhmm = (v) => new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
const longDate = (v) =>
  new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export default function OtScheduleChangeDialog({
  open,
  onOpenChange,
  booking,
  onConfirm,
  isSubmitting = false,
  error = null,
  done = null,
  onViewCase,
}) {
  const [step, setStep] = useState(1)
  const [reason, setReason] = useState('')
  const [otherReason, setOtherReason] = useState('')
  const [notes, setNotes] = useState('')

  const [date, setDate] = useState('')
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsFailed, setSlotsFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [chosenSlot, setChosenSlot] = useState(null)
  const [theatreId, setTheatreId] = useState('')

  const minutes = booking?.estimatedMinutes || 60

  // Everything typed is cleared on open. Without this the next case inherits the
  // previous one's reason — and that reason is written onto the record, so it
  // would be attributed to the wrong patient.
  useEffect(() => {
    if (!open) return
    setStep(1)
    setReason('')
    setOtherReason('')
    setNotes('')
    setChosenSlot(null)
    setTheatreId('')
    setSlots([])
    setSlotsFailed(false)
    // Start from the day the case is on now — where someone re-booking a
    // postponed case is most likely looking.
    setDate(toDateInput(booking?.scheduledStart || new Date()))
  }, [open, booking?.scheduledStart])

  // Where a case this long could go on the chosen day. `excludeBookingId` keeps
  // the case from clashing with the slot it is leaving.
  useEffect(() => {
    if (!open || step !== 2 || !date || !booking?.id) return
    let live = true
    setSlotsLoading(true)
    setSlotsFailed(false)
    otApi.getSlots({
      date,
      estimatedMinutes: minutes,
      excludeBookingId: booking.id,
      ...(booking.primarySurgeonId ? { primarySurgeonId: booking.primarySurgeonId } : {}),
      ...(booking.patientId ? { patientId: booking.patientId } : {}),
    })
      .then((res) => { if (live) setSlots(res?.data?.slots ?? []) })
      .catch(() => { if (live) { setSlots([]); setSlotsFailed(true) } })
      .finally(() => { if (live) setSlotsLoading(false) })
    return () => { live = false }
  }, [open, step, date, reloadKey, booking?.id, booking?.primarySurgeonId, booking?.patientId, minutes])

  const chosenReason = reason === OT_REASON_OTHER ? otherReason.trim() : reason
  // One column holds this, so the category leads and the detail follows. Keeping
  // the category as a known phrase is what makes "how many cases slipped for
  // want of a surgeon" answerable later.
  const fullReason = notes.trim() ? `${chosenReason} — ${notes.trim()}` : chosenReason

  const chosenTheatre = chosenSlot?.theatres.find((t) => t.id === theatreId) || null

  const pickSlot = (slot) => {
    setChosenSlot(slot)
    setTheatreId(slot.theatres[0]?.id || '')
    setStep(3)
  }

  const confirmMove = () => onConfirm({
    action: OT_SCHEDULE_ACTIONS.MOVE,
    reason: fullReason,
    scheduledStart: chosenSlot.start,
    estimatedMinutes: minutes,
    theatreId,
    // The name travels with the id: only this screen holds the slot's theatre
    // list, and the confirmation panel needs a name rather than a cuid.
    theatreName: chosenTheatre?.name,
  })

  const confirmPostpone = () => onConfirm({
    action: OT_SCHEDULE_ACTIONS.POSTPONE,
    reason: fullReason,
  })

  if (!booking) return null

  // The success panel replaces the wizard once the parent reports the change
  // landed, rather than closing on the user — a coordinator writes the new time
  // on a whiteboard from this screen.
  const finished = done !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reschedule / Postpone Surgery</DialogTitle>
        </DialogHeader>

        {finished ? (
          <SuccessPanel
            done={done}
            booking={booking}
            onViewCase={onViewCase}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <>
            <StepBar current={step} />

            {step === 1 && (
              <ReasonStep
                booking={booking}
                reason={reason} setReason={setReason}
                otherReason={otherReason} setOtherReason={setOtherReason}
                notes={notes} setNotes={setNotes}
              />
            )}

            {step === 2 && (
              <SlotStep
                date={date}
                onDate={(d) => { setDate(d); setChosenSlot(null) }}
                slots={slots}
                loading={slotsLoading}
                failed={slotsFailed}
                onRefresh={() => setReloadKey((k) => k + 1)}
                onPick={pickSlot}
                minutes={minutes}
                booking={booking}
              />
            )}

            {step === 3 && chosenSlot && (
              <VerifyStep
                booking={booking}
                slot={chosenSlot}
                theatreId={theatreId}
                onTheatre={setTheatreId}
                minutes={minutes}
              />
            )}

            {step === 4 && (
              <ReviewStep
                booking={booking}
                slot={chosenSlot}
                theatre={chosenTheatre}
                minutes={minutes}
                reason={fullReason}
              />
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Footer
              step={step}
              setStep={setStep}
              onOpenChange={onOpenChange}
              canLeaveReason={chosenReason.length > 0}
              canConfirm={chosenSlot !== null && theatreId !== ''}
              isSubmitting={isSubmitting}
              onPostpone={confirmPostpone}
              onConfirmMove={confirmMove}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Step bar ────────────────────────────────────────────────────────────────

function StepBar({ current }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-lg border bg-gray-50 p-2">
      {STEPS.map((s, i) => {
        const state = s.n < current ? 'done' : s.n === current ? 'now' : 'todo'
        return (
          <li key={s.n} className="flex items-center gap-1">
            <span className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${
              state === 'now' ? 'bg-blue-600 text-white'
                : state === 'done' ? 'bg-blue-100 text-blue-800'
                : 'text-gray-400'
            }`}>
              <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                state === 'now' ? 'bg-white text-blue-700'
                  : state === 'done' ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}>
                {state === 'done' ? <Check className="h-2.5 w-2.5" /> : s.n}
              </span>
              <span className="font-medium">{s.title}</span>
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" />}
          </li>
        )
      })}
    </ol>
  )
}

// ── 1 · Reason ──────────────────────────────────────────────────────────────

function ReasonStep({ booking, reason, setReason, otherReason, setOtherReason, notes, setNotes }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center gap-2 border-b bg-gray-50 px-3 py-2">
          <span className="font-semibold text-gray-900">{booking.caseNumber}</span>
          <StatusBadge status={booking.status} map={OT_STATUS_COLORS} />
          <Badge className={OT_PRIORITY_COLORS[booking.priority] || 'bg-gray-100 text-gray-700'}>
            {booking.priority}
          </Badge>
        </div>
        <div className="p-3">
          <p className="mb-3 font-medium text-gray-900">{booking.procedureName}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Fact Icon={User} label="Patient"
              value={getFullName(booking.patient)} sub={booking.patient?.mrn} />
            <Fact Icon={CalendarClock} label="Theatre"
              value={booking.theatre?.name} sub={booking.theatre?.theatreType} />
            <Fact Icon={Calendar} label="Scheduled date & time"
              value={formatSlot(booking.scheduledStart, booking.scheduledEnd)}
              sub={formatDuration(booking.estimatedMinutes || 60)} />
            <Fact Icon={Stethoscope} label="Primary surgeon"
              value={drName(booking.surgeon?.fullName) || '—'}
              sub={booking.anaesthetist ? `Anaesthetist: ${drName(booking.anaesthetist.fullName)}` : null} />
          </div>
        </div>
      </div>

      {/* Asked once, for both endings. The backend refuses a postpone without
          one, and a move without one leaves nothing to answer "why did this
          list slip" three months later. */}
      <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
        <div>
          <Label>Reason for change *</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Why is this case moving?" />
            </SelectTrigger>
            <SelectContent>
              {OT_CHANGE_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              <SelectItem value={OT_REASON_OTHER}>{OT_REASON_OTHER}…</SelectItem>
            </SelectContent>
          </Select>
          {reason === OT_REASON_OTHER && (
            <Input
              className="mt-2 bg-white"
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              placeholder="Say what happened"
              autoFocus
            />
          )}
        </div>
        <div>
          <Label>Additional notes (optional)</Label>
          <Textarea
            rows={2}
            className="bg-white"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the theatre team should know"
          />
        </div>
      </div>
    </div>
  )
}

// ── 2 · Date and slots ──────────────────────────────────────────────────────

function SlotStep({ date, onDate, slots, loading, failed, onRefresh, onPick, minutes, booking }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <Label className="text-xs uppercase tracking-wide text-gray-500">Select date</Label>
        <MonthGrid value={date} onChange={onDate} />
        <Input type="date" className="mt-2" value={date} onChange={(e) => onDate(e.target.value)} />
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Label className="text-xs uppercase tracking-wide text-gray-500">
            Free slots for {formatDuration(minutes)}{date ? ` — ${longDate(date)}` : ''}
          </Label>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {failed ? (
          <Empty>Could not look up free slots. Try Refresh, or pick another date.</Empty>
        ) : loading ? (
          <Empty><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Looking for free slots…</Empty>
        ) : slots.length === 0 ? (
          <Empty>Nothing free on this day for a case this long. Try another date.</Empty>
        ) : (
          <div className="space-y-2">
            {slots.map((slot) => (
              <SlotCard key={slot.start} slot={slot} minutes={minutes} booking={booking} onSelect={() => onPick(slot)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// One free slot, with what the server actually confirmed about it.
//
// Only the three things the booking check runs on are ticked here. The
// assistant, the anaesthetist and the nurses are not checked for clashes by any
// endpoint, so a green tick beside their names would be a claim nothing stands
// behind — and the person reading it would stop looking.
function SlotCard({ slot, minutes, booking, onSelect }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-green-200 bg-green-50/50 p-3">
      <div className="min-w-[130px]">
        <p className="font-semibold text-gray-900">{hhmm(slot.start)} – {hhmm(slot.end)}</p>
        <p className="text-xs text-gray-500">{formatDuration(minutes)}</p>
      </div>
      <ul className="min-w-0 flex-1 space-y-0.5 text-xs">
        <Tick>{slot.theatres.map((t) => t.name).join(', ')} available</Tick>
        {booking.surgeon && <Tick>{drName(booking.surgeon.fullName)} available</Tick>}
        <Tick>Patient free at this time</Tick>
        <li className="text-gray-400">Room free until {hhmm(slot.freeUntil)}</li>
      </ul>
      <Button size="sm" onClick={onSelect} className="bg-blue-600 hover:bg-blue-700">Select</Button>
    </div>
  )
}

// ── 3 · Verify ──────────────────────────────────────────────────────────────

function VerifyStep({ booking, slot, theatreId, onTheatre, minutes }) {
  const team = booking.team ?? []
  // Split by what the system actually verifies, because presenting the two the
  // same way is how a coordinator comes to trust a check that never ran.
  const checked = [
    { label: 'Operating theatre', who: slot.theatres.find((t) => t.id === theatreId)?.name },
    { label: 'Primary surgeon', who: drName(booking.surgeon?.fullName) },
    { label: 'Patient', who: getFullName(booking.patient) },
  ].filter((r) => r.who)

  const assigned = team.filter((m) => m.role !== 'PRIMARY_SURGEON')

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
        <span>The theatre, the surgeon and the patient are all free for this slot.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Selected slot">
          <p className="font-semibold text-gray-900">{longDate(slot.start)}</p>
          <p className="text-sm text-gray-700">{hhmm(slot.start)} – {hhmm(slot.end)}</p>
          <p className="text-xs text-gray-500">{formatDuration(minutes)}</p>
        </Panel>

        <Panel title="Operating theatre">
          {slot.theatres.length === 1 ? (
            <p className="font-semibold text-gray-900">{slot.theatres[0].name}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {slot.theatres.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onTheatre(t.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    theatreId === t.id
                      ? 'border-blue-500 bg-blue-100 font-medium text-blue-900'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-green-700">Free for this slot</p>
        </Panel>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide text-gray-500">Checked for clashes</Label>
        <ul className="mt-1 divide-y rounded-lg border">
          {checked.map((r) => (
            <li key={r.label} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="w-36 shrink-0 text-gray-500">{r.label}</span>
              <span className="min-w-0 flex-1 truncate text-gray-900">{r.who}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Free
              </span>
            </li>
          ))}
        </ul>
      </div>

      {assigned.length > 0 && (
        <div>
          <Label className="text-xs uppercase tracking-wide text-gray-500">
            Also assigned — not checked for clashes
          </Label>
          <ul className="mt-1 divide-y rounded-lg border border-dashed">
            {assigned.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-36 shrink-0 text-gray-500">
                  {m.role.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-900">{m.memberName}</span>
                <span className="shrink-0 text-xs text-gray-400">not checked</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-gray-500">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            Nobody checks these for a double booking yet — confirm with them before the day.
          </p>
        </div>
      )}
    </div>
  )
}

// ── 4 · Review ──────────────────────────────────────────────────────────────

function ReviewStep({ booking, slot, theatre, minutes, reason }) {
  const postponing = slot === null
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Previous schedule</p>
          <p className="mt-1 font-medium text-gray-900">
            {formatSlot(booking.scheduledStart, booking.scheduledEnd)}
          </p>
          <p className="text-xs text-gray-600">
            {[booking.theatre?.name, formatDuration(booking.estimatedMinutes || 60)].filter(Boolean).join(' · ')}
          </p>
        </div>

        <ArrowDown className="mx-auto h-5 w-5 text-gray-400 sm:hidden" />
        <ArrowRight className="mx-auto hidden h-5 w-5 text-gray-400 sm:block" />

        <div className={`rounded-lg border p-3 ${
          postponing ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'
        }`}>
          <p className={`text-xs font-semibold uppercase tracking-wide ${
            postponing ? 'text-amber-700' : 'text-green-700'
          }`}>
            New schedule
          </p>
          {postponing ? (
            <>
              <p className="mt-1 font-medium text-gray-900">Postponed</p>
              <p className="text-xs text-gray-600">No new time yet — re-book from the board</p>
            </>
          ) : (
            <>
              <p className="mt-1 font-medium text-gray-900">
                {longDate(slot.start)}, {hhmm(slot.start)} – {hhmm(slot.end)}
              </p>
              <p className="text-xs text-gray-600">
                {[theatre?.name, formatDuration(minutes)].filter(Boolean).join(' · ')}
              </p>
            </>
          )}
        </div>
      </div>

      <dl className="divide-y rounded-lg border text-sm">
        <ReviewRow label="Patient" value={getFullName(booking.patient)} sub={booking.patient?.mrn} />
        <ReviewRow label="Procedure" value={booking.procedureName} />
        <ReviewRow
          label="Surgical team"
          value={booking.team?.length
            ? booking.team.map((m) => `${m.memberName} (${m.role.replace(/_/g, ' ').toLowerCase()})`).join(', ')
            : drName(booking.surgeon?.fullName)}
        />
        <ReviewRow label="Reason" value={reason} />
      </dl>

      {postponing === false && (
        <p className="flex items-start gap-1.5 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The old slot is released the moment this is saved, and the clash check
          runs once more against the new one.
        </p>
      )}
    </div>
  )
}

// ── Success ─────────────────────────────────────────────────────────────────

function SuccessPanel({ done, booking, onViewCase, onClose }) {
  const postponed = done.action === OT_SCHEDULE_ACTIONS.POSTPONE
  return (
    <div className="space-y-4 py-4 text-center">
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
        postponed ? 'bg-amber-100' : 'bg-green-100'
      }`}>
        {postponed
          ? <PauseCircle className="h-9 w-9 text-amber-600" />
          : <Check className="h-9 w-9 text-green-600" />}
      </div>

      <div>
        <p className="text-lg font-semibold text-gray-900">
          {postponed ? 'Surgery postponed' : 'Surgery rescheduled'}
        </p>
        <p className="text-sm text-gray-600">
          {postponed
            ? 'The slot is free again. Re-book this case from the board when the date is known.'
            : 'The case now holds its new slot, and the old one is free again.'}
        </p>
      </div>

      <div className="mx-auto max-w-sm rounded-lg border bg-gray-50 p-3 text-left">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {postponed ? 'Case' : 'New schedule'}
        </p>
        {postponed === false && (
          <>
            <p className="mt-1 font-medium text-gray-900">
              {longDate(done.scheduledStart)}, {hhmm(done.scheduledStart)} – {hhmm(done.scheduledEnd)}
            </p>
            <p className="text-sm text-gray-700">{done.theatreName}</p>
          </>
        )}
        <p className="mt-1 text-xs text-gray-500">{booking.caseNumber} · {booking.procedureName}</p>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
        <Users className="h-3.5 w-3.5" />
        Nobody is notified automatically yet — tell the team.
      </p>

      <div className="flex flex-wrap justify-center gap-2 pt-1">
        {onViewCase && (
          <Button variant="outline" onClick={onViewCase}>View updated case</Button>
        )}
        <Button onClick={onClose} className="bg-blue-600 hover:bg-blue-700">Back to OT board</Button>
      </div>
    </div>
  )
}

// ── Footer ──────────────────────────────────────────────────────────────────

function Footer({
  step, setStep, onOpenChange, canLeaveReason, canConfirm,
  isSubmitting, onPostpone, onConfirmMove,
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
      {step === 1 ? (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          {/* Both endings leave from here, so the choice is made once the reason
              is known rather than before it. */}
          <Button
            variant="outline"
            onClick={onPostpone}
            disabled={canLeaveReason === false || isSubmitting}
            className="sm:mr-auto"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <PauseCircle className="mr-1.5 h-4 w-4" />
            Postpone, decide later
          </Button>
          <Button
            onClick={() => setStep(2)}
            disabled={canLeaveReason === false}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Find a new slot <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </>
      ) : (
        <>
          <Button variant="outline" onClick={() => setStep(step - 1)} disabled={isSubmitting}>
            Back
          </Button>
          {step === 3 && (
            <Button
              onClick={() => setStep(4)}
              disabled={canConfirm === false}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Review <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
          {step === 4 && (
            <Button
              onClick={onConfirmMove}
              disabled={canConfirm === false || isSubmitting}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm reschedule
            </Button>
          )}
        </>
      )}
    </div>
  )
}

// ── Small pieces ────────────────────────────────────────────────────────────

// A month at a glance. The coordinator is looking for a day, and which days sit
// next to a weekend is part of that — a bare date box cannot show it. The native
// input stays under it for typing a date straight in.
function MonthGrid({ value, onChange }) {
  const selected = value ? new Date(`${value}T00:00`) : null
  const [cursor, setCursor] = useState(() => {
    const base = selected && Number.isNaN(selected.getTime()) === false ? selected : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  useEffect(() => {
    if (!value) return
    const d = new Date(`${value}T00:00`)
    if (Number.isNaN(d.getTime())) return
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
  }, [value])

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const lead = first.getDay()
  const today = toDateInput(new Date())

  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)),
  ]

  const move = (by) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + by, 1))

  return (
    <div className="mt-1 rounded-lg border p-2">
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} className="rounded p-1 hover:bg-gray-100" aria-label="Previous month">
          <ChevronLeft className="h-4 w-4 text-gray-500" />
        </button>
        <span className="text-sm font-medium text-gray-900">
          {cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </span>
        <button type="button" onClick={() => move(1)} className="rounded p-1 hover:bg-gray-100" aria-label="Next month">
          <ChevronRight className="h-4 w-4 text-gray-500" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <span key={d} className="py-1 text-[10px] font-medium text-gray-400">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`pad-${i}`} />
          const iso = toDateInput(d)
          const on = iso === value
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onChange(iso)}
              className={`rounded py-1 text-xs transition-colors ${
                on ? 'bg-blue-600 font-semibold text-white'
                  : iso === today ? 'bg-blue-50 font-medium text-blue-700 hover:bg-blue-100'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Fact({ Icon, label, value, sub }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="truncate text-sm font-medium text-gray-900">{value || '—'}</p>
        {sub && <p className="truncate text-xs text-gray-500">{sub}</p>}
      </div>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      {children}
    </div>
  )
}

function ReviewRow({ label, value, sub }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 px-3 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-gray-900">
        {value || '—'}
        {sub && <span className="block text-xs text-gray-500">{sub}</span>}
      </dd>
    </div>
  )
}

function Tick({ children }) {
  return (
    <li className="flex items-start gap-1.5 text-green-800">
      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-green-600" />
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function Empty({ children }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">
      {children}
    </div>
  )
}
