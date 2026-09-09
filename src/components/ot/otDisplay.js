// How OT reads on screen — colours, labels and the one slot format.
//
// The values themselves (SCHEDULED, SCRUB_NURSE …) belong to the backend and
// live in api/otApi.js. This file is only about how they LOOK, so a colour or a
// wording change is made once here and every OT screen follows. Without it each
// tab grows its own copy and the same case reads amber on one screen and orange
// on the next.
//
// Palette is the one already used by DayCare and Queue (bg-*-100 / text-*-700),
// so an OT screen sits beside them without looking like a different product.
import { formatDateTime } from '@/lib/format'

// Feed these to the shared <StatusBadge status={...} map={...} />, which turns
// the underscores into spaces on its own — so no label map is needed here.
export const OT_STATUS_COLORS = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-indigo-100 text-indigo-700',
  CHECKED_IN: 'bg-purple-100 text-purple-700',
  IN_THEATRE: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-gray-200 text-gray-600',
  POSTPONED: 'bg-orange-100 text-orange-700',
}

export const THEATRE_STATUS_COLORS = {
  AVAILABLE: 'bg-green-100 text-green-700',
  OCCUPIED: 'bg-amber-100 text-amber-700',
  CLEANING: 'bg-blue-100 text-blue-700',
  MAINTENANCE: 'bg-gray-200 text-gray-600',
}

// Red for EMERGENCY on purpose: it is the one value a nurse must not miss while
// scanning the day's list.
export const OT_PRIORITY_COLORS = {
  ELECTIVE: 'bg-gray-100 text-gray-700',
  URGENT: 'bg-orange-100 text-orange-700',
  EMERGENCY: 'bg-red-100 text-red-700',
}

export const OT_ROLE_LABEL = {
  PRIMARY_SURGEON: 'Primary Surgeon',
  ASSISTANT_SURGEON: 'Assistant Surgeon',
  ANAESTHETIST: 'Anaesthetist',
  SCRUB_NURSE: 'Scrub Nurse',
  CIRCULATING_NURSE: 'Circulating Nurse',
  OT_TECHNICIAN: 'OT Technician',
  PERFUSIONIST: 'Perfusionist',
  OBSERVER: 'Observer',
}

export const OT_LATERALITY_LABEL = {
  NA: 'Not applicable',
  LEFT: 'Left',
  RIGHT: 'Right',
  BILATERAL: 'Both sides',
}

// Which buttons a case may show, keyed by the status it is in now.
//
// These mirror the backend's own rules, and keeping them in ONE map is what
// stops a screen offering "Start surgery" on a cancelled case — the user would
// press it and get a 409 they can do nothing about. A status missing from this
// map is a finished case: it offers nothing, which is correct for COMPLETED and
// CANCELLED.
//
// `needsReason` marks the moves the backend refuses without one, so a screen
// cannot forget to ask.
//
// `schedule: true` marks an action that is NOT a plain status change — it opens
// the schedule-change dialog instead. Postpone and Re-book are the same question
// asked from two sides ("this case is not happening when planned"), so they open
// the same dialog and run the same code. Re-book was a status flip on its own
// before this, which sent a case back to SCHEDULED still pointing at the slot it
// was postponed out of — a time that had usually passed or been given away, with
// no clash check anywhere on that path.
export const OT_NEXT_ACTIONS = {
  SCHEDULED: [
    { status: 'CONFIRMED', label: 'Confirm' },
    { status: 'CANCELLED', label: 'Cancel', needsReason: true, destructive: true },
    { label: 'Reschedule', schedule: true },
  ],
  CONFIRMED: [
    { status: 'CHECKED_IN', label: 'Check in' },
    { status: 'CANCELLED', label: 'Cancel', needsReason: true, destructive: true },
    { label: 'Reschedule', schedule: true },
  ],
  CHECKED_IN: [
    { status: 'IN_THEATRE', label: 'Start surgery' },
    { status: 'CANCELLED', label: 'Cancel', needsReason: true, destructive: true },
  ],
  IN_THEATRE: [
    { status: 'COMPLETED', label: 'Complete' },
  ],
  POSTPONED: [
    // Same dialog, same code. A postponed case being re-booked is a case being
    // given a new time, which is what the dialog does.
    { label: 'Re-book', schedule: true },
    { status: 'CANCELLED', label: 'Cancel', needsReason: true, destructive: true },
  ],
}

// Why a case is moving off its slot.
//
// A list rather than a free-text box, because "surgeon unavailable" typed six
// different ways cannot be counted. Which cases slip, and why, is the single
// most useful number an OT committee looks at — and it is only answerable if
// this is the same list every time. OTHER keeps the escape hatch.
export const OT_CHANGE_REASONS = [
  'Patient not ready',
  'Investigations pending',
  'Consent or fitness pending',
  'Surgeon unavailable',
  'Anaesthetist unavailable',
  'Emergency case took the theatre',
  'Equipment not available',
  'Previous case overran',
  'Patient unwell on the day',
  'Patient request',
]
export const OT_REASON_OTHER = 'Other'

// What the dialog can do once a reason is given. Postponing keeps the case and
// drops the slot; moving it does the whole thing in one go.
export const OT_SCHEDULE_ACTIONS = {
  MOVE: 'move',
  POSTPONE: 'postpone',
}

// An operative note describes an operation: what was found, what was done, how
// much blood was lost. A case that has not started has none of those facts, and
// one written against a POSTPONED case records a surgery that never happened —
// the wrong kind of wrong, because it reads as evidence.
//
// Mirrors `onlyAfter` on the opnote entry in otClinicalController.js, which is
// the authority; this only decides whether the tab is offered, so a user is not
// handed a form the server will refuse.
export const canWriteOpNote = (status) => status === 'IN_THEATRE' || status === 'COMPLETED'

// A case is over — nothing about it may be edited any more.
export const isCaseClosed = (status) => status === 'COMPLETED' || status === 'CANCELLED'

// The time half of formatDateTime, for the two ends of a slot.
//
// Deliberately the SAME options as lib/format.js#formatDateTime, so "10:30 AM"
// here and "20 Jul 2026, 10:30 AM" there never disagree. If a second module ever
// needs a time-only value, promote this to lib/format.js rather than copying it.
const timeOfDay = (value) => {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
}

// One slot, written the same way on every OT screen.
//   formatSlot(start, end)                  -> "20 Jul 2026, 10:30 AM – 12:00 PM"
//   formatSlot(start, end, { dateOnly:false }) -> "10:30 AM – 12:00 PM"
//
// The list already groups by day, so it passes withDate:false and does not
// repeat the date on every row.
export function formatSlot(start, end, { withDate = true } = {}) {
  const from = timeOfDay(start)
  const to = timeOfDay(end)
  if (!from) return ''
  const range = to ? `${from} – ${to}` : from
  return withDate ? `${formatDateTime(start, { withTime: false })}, ${range}` : range
}

// How long the case is booked for, as a person would say it.
//   formatDuration(90) -> "1h 30m"      formatDuration(45) -> "45m"
export function formatDuration(minutes) {
  const total = Number(minutes)
  if (!Number.isFinite(total) || total <= 0) return ''
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
