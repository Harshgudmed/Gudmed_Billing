// OT scheduling rules — the one place that decides whether a case may occupy a
// slot. Every create/reschedule path calls assertNoConflict() so a clash can
// never be introduced from one entry point and missed by another.
//
// Three separate clashes are checked, because they are three different real
// problems and each needs its own message:
//   • the theatre is already occupied
//   • the surgeon is already operating elsewhere
//   • the patient is already scheduled elsewhere
//
// The theatre window is widened by `cleaningMinutes` so a case can never be
// booked into the turnaround gap of the one before it — a clash the staff would
// otherwise only discover on the day.
import { db } from '../config/db.js'
import { bad, conflict, notFound } from '../lib/reqContext.js'

// Only these statuses still hold a slot. A cancelled case frees its theatre.
const OCCUPYING = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_THEATRE']

// Two time ranges overlap when each one starts before the other ends.
const overlapWhere = (start, end) => ({
  scheduledStart: { lt: end },
  scheduledEnd: { gt: start },
})

const hhmm = (d) =>
  new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

// Checks whether this slot is free. Says nothing if it is, throws if it is not.
//
// excludeBookingId — the booking being rescheduled, so it does not clash with itself.
// tx              — pass the transaction so the check and the write commit together.
export async function assertNoConflict(
  { organizationId, theatreId, primarySurgeonId, patientId, scheduledStart, scheduledEnd, excludeBookingId = null },
  tx = db,
) {
  const start = new Date(scheduledStart)
  const end = new Date(scheduledEnd)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw bad('Invalid start or end time')
  if (end <= start) throw bad('Surgery end time must be after the start time')

  const theatre = await tx.operatingTheatre.findFirst({
    where: { id: theatreId, organizationId },
    select: { id: true, name: true, isActive: true, cleaningMinutes: true },
  })
  if (!theatre) throw notFound('Operating theatre not found')
  if (!theatre.isActive) throw bad(`${theatre.name} is not in service`)

  // Widen only the THEATRE window by the turnaround. The surgeon and the patient
  // are free the moment the case ends; the room is not.
  const cleanMs = (theatre.cleaningMinutes || 0) * 60_000
  const roomStart = new Date(start.getTime() - cleanMs)
  const roomEnd = new Date(end.getTime() + cleanMs)

  const notSelf = excludeBookingId ? { id: { not: excludeBookingId } } : {}
  const base = { organizationId, status: { in: OCCUPYING }, ...notSelf }

  const [theatreClash, surgeonClash, patientClash] = await Promise.all([
    tx.otBooking.findFirst({
      where: { ...base, theatreId, ...overlapWhere(roomStart, roomEnd) },
      select: { scheduledEnd: true, procedureName: true },
      orderBy: { scheduledStart: 'asc' },
    }),
    tx.otBooking.findFirst({
      where: { ...base, primarySurgeonId, ...overlapWhere(start, end) },
      select: { scheduledStart: true },
      orderBy: { scheduledStart: 'asc' },
    }),
    tx.otBooking.findFirst({
      where: { ...base, patientId, ...overlapWhere(start, end) },
      select: { scheduledStart: true },
      orderBy: { scheduledStart: 'asc' },
    }),
  ])

  if (theatreClash) {
    const free = new Date(new Date(theatreClash.scheduledEnd).getTime() + cleanMs)
    throw conflict(
      `${theatre.name} is busy with ${theatreClash.procedureName} and is free from ${hhmm(free)} (includes ${theatre.cleaningMinutes} min cleaning)`,
      'OT_THEATRE_BUSY',
    )
  }
  if (surgeonClash) {
    throw conflict(`This surgeon already has a case at ${hhmm(surgeonClash.scheduledStart)}`, 'OT_SURGEON_BUSY')
  }
  if (patientClash) {
    throw conflict(`This patient already has a surgery booked at ${hhmm(patientClash.scheduledStart)}`, 'OT_PATIENT_BUSY')
  }
}

// What is free for a slot: the theatres, the surgeon, and the patient.
//
// The booking form and the reschedule form both ask this while the user is still
// choosing, so a clash appears beside the field that causes it instead of after
// they press Save. Nothing here decides anything — assertNoConflict above is
// still the only gate. This asks the same three questions early, and reuses the
// same OCCUPYING list and overlapWhere, so the preview and the gate cannot drift
// apart and start disagreeing.
//
// ALL THREE, not just the room. The gate refuses on any one of them, so a
// preview that checked only the theatre would show a free room, let the user
// pick it, and then be refused for a surgeon already operating down the
// corridor — the exact failed save this exists to prevent.
//
// `status` rides along untouched. A theatre under maintenance is reported busy
// only when a case actually clashes, because that is what the booking check
// does; a preview that refused more than the gate would be a preview that lies.
export async function slotAvailability(
  {
    organizationId,
    scheduledStart,
    scheduledEnd,
    primarySurgeonId = null,
    patientId = null,
    excludeBookingId = null,
  },
  tx = db,
) {
  const start = new Date(scheduledStart)
  const end = new Date(scheduledEnd)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw bad('Invalid start or end time')
  if (end <= start) throw bad('Surgery end time must be after the start time')

  const theatres = await tx.operatingTheatre.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true, theatreType: true, status: true, cleaningMinutes: true },
    orderBy: { name: 'asc' },
  })

  // Rescheduling: the case being moved must not be reported as clashing with
  // where it currently sits.
  const notSelf = excludeBookingId ? { id: { not: excludeBookingId } } : {}
  const base = { organizationId, status: { in: OCCUPYING }, ...notSelf }

  const clashSelect = {
    caseNumber: true, procedureName: true,
    scheduledStart: true, scheduledEnd: true,
    theatre: { select: { name: true } },
  }

  // One query for every theatre, widened by the LONGEST turnaround any of them
  // has; each is then matched against its own window below. Asking per theatre
  // would be one round trip per room on every keystroke.
  const maxCleanMs = theatres.reduce((most, t) => Math.max(most, t.cleaningMinutes || 0), 0) * 60_000

  const [busy, surgeonClash, patientClash] = await Promise.all([
    theatres.length === 0 ? [] : tx.otBooking.findMany({
      where: {
        ...base,
        theatreId: { in: theatres.map((t) => t.id) },
        ...overlapWhere(new Date(start.getTime() - maxCleanMs), new Date(end.getTime() + maxCleanMs)),
      },
      select: { ...clashSelect, theatreId: true },
      orderBy: { scheduledStart: 'asc' },
    }),

    // No turnaround on these two. The room needs cleaning between cases; the
    // surgeon and the patient are free the moment the case ends. Same asymmetry
    // as assertNoConflict.
    primarySurgeonId
      ? tx.otBooking.findFirst({
        where: { ...base, primarySurgeonId, ...overlapWhere(start, end) },
        select: clashSelect,
        orderBy: { scheduledStart: 'asc' },
      })
      : null,

    patientId
      ? tx.otBooking.findFirst({
        where: { ...base, patientId, ...overlapWhere(start, end) },
        select: clashSelect,
        orderBy: { scheduledStart: 'asc' },
      })
      : null,
  ])

  // A person is either free or busy with one named case. Not asked for at all
  // (no id given) is a third answer, and null says so rather than pretending to
  // a clean bill of health nobody checked for.
  const person = (id, clash) => {
    if (!id) return null
    if (!clash) return { free: true }
    return {
      free: false,
      busyWith: clash.caseNumber,
      busyProcedure: clash.procedureName,
      busyFrom: clash.scheduledStart,
      busyUntil: clash.scheduledEnd,
      reason: `Already in ${clash.theatre?.name ?? 'another theatre'} for ${clash.procedureName} until ${hhmm(clash.scheduledEnd)}`,
    }
  }

  return {
    theatres: theatres.map((theatre) => {
      const cleanMs = (theatre.cleaningMinutes || 0) * 60_000
      const roomStart = new Date(start.getTime() - cleanMs)
      const roomEnd = new Date(end.getTime() + cleanMs)

      // This theatre's own window, so a room with no turnaround is not reported
      // busy on the strength of a longer one somewhere else.
      const clash = busy.find(
        (b) =>
          b.theatreId === theatre.id &&
          new Date(b.scheduledStart) < roomEnd &&
          new Date(b.scheduledEnd) > roomStart,
      )

      const row = {
        id: theatre.id,
        name: theatre.name,
        theatreType: theatre.theatreType,
        status: theatre.status,
        cleaningMinutes: theatre.cleaningMinutes,
      }
      if (clash === undefined) return { ...row, free: true }

      // When it frees up, turnaround included — the next question after "is it
      // busy" is always "then when".
      const freeFrom = new Date(new Date(clash.scheduledEnd).getTime() + cleanMs)
      return {
        ...row,
        free: false,
        busyWith: clash.caseNumber,
        busyProcedure: clash.procedureName,
        busyFrom: clash.scheduledStart,
        busyUntil: clash.scheduledEnd,
        freeFrom,
        reason: `Busy with ${clash.procedureName} — free from ${hhmm(freeFrom)}`,
      }
    }),
    surgeon: person(primarySurgeonId, surgeonClash),
    patient: person(patientId, patientClash),
  }
}

// When this hospital's theatres run. Read from the organisation's own settings
// blob, which already carries { workingHours: { start, end } } — one hard-coded
// pair of times here would be the same day for every hospital on the system.
//
// Emergency cases fall outside these hours by design: this only bounds the slots
// the form SUGGESTS. Anything can still be booked directly, and the gate does
// not consult working hours at all.
const HOURS_DEFAULT = { start: '08:00', end: '17:00' }
const isHHMM = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '')

export function workingHours(organization) {
  let stored = {}
  try {
    stored = typeof organization?.settings === 'string'
      ? JSON.parse(organization.settings)
      : (organization?.settings || {})
  } catch { stored = {} }

  const hours = stored.workingHours || {}
  // A malformed or missing time falls back rather than producing an Invalid Date
  // that would silently return no slots at all.
  const start = isHHMM(hours.start) ? hours.start : HOURS_DEFAULT.start
  const end = isHHMM(hours.end) ? hours.end : HOURS_DEFAULT.end
  return end > start ? { start, end } : HOURS_DEFAULT
}

// Where a case of this length could go on a given day.
//
// This is the question a coordinator actually has — "when is there room for a
// 90 minute case on Tuesday" — and the one they currently answer by typing times
// into the form until one is accepted. Rescheduling asks it constantly.
//
// Built on the same OCCUPYING list and overlap rule as the gate, so a slot
// offered here is a slot the server will take. One query for the day's cases,
// then the arithmetic in memory: asking per candidate time would be forty round
// trips to fill one dropdown.
//
// Consecutive free times are collapsed into runs and only the earliest of each
// is returned. A free morning is one suggestion of "08:00, and the room is yours
// until 12:00" — not sixteen suggestions fifteen minutes apart.
export async function freeSlots(
  {
    organizationId,
    date,
    minutes,
    primarySurgeonId = null,
    patientId = null,
    theatreId = null,
    excludeBookingId = null,
    from = null,
    to = null,
    stepMinutes = 15,
    limit = 10,
  },
  tx = db,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw bad('date must be YYYY-MM-DD')
  if (Number.isInteger(minutes) === false || minutes < 1) throw bad('minutes must be a whole number above 0')

  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  })
  const hours = workingHours(org)
  const openAt = isHHMM(from) ? from : hours.start
  const closeAt = isHHMM(to) ? to : hours.end

  // Local wall-clock, never toISOString(): a theatre list is written in the time
  // the hospital keeps, not UTC.
  const dayOpen = new Date(`${date}T${openAt}`)
  const dayClose = new Date(`${date}T${closeAt}`)
  if (Number.isNaN(dayOpen.getTime()) || Number.isNaN(dayClose.getTime())) throw bad('Invalid date')
  // Refused, not answered with an empty list. "No slots" is a real answer that
  // means the day is full; returning it for a window that runs backwards would
  // hide the mistake behind a plausible-looking result. A list that crosses
  // midnight is not supported — say so rather than silently finding nothing.
  if (dayClose <= dayOpen) throw bad(`The end of the list (${closeAt}) must be after the start (${openAt})`)

  const theatres = await tx.operatingTheatre.findMany({
    where: { organizationId, isActive: true, ...(theatreId ? { id: theatreId } : {}) },
    select: { id: true, name: true, theatreType: true, cleaningMinutes: true },
    orderBy: { name: 'asc' },
  })
  if (theatres.length === 0) return { hours: { start: openAt, end: closeAt }, slots: [] }

  const notSelf = excludeBookingId ? { id: { not: excludeBookingId } } : {}
  const maxCleanMs = theatres.reduce((most, t) => Math.max(most, t.cleaningMinutes || 0), 0) * 60_000

  // Everything that could touch the day, widened by the longest turnaround at
  // both ends so a case running in from yesterday evening is still seen.
  const dayCases = await tx.otBooking.findMany({
    where: {
      organizationId,
      status: { in: OCCUPYING },
      ...notSelf,
      ...overlapWhere(
        new Date(dayOpen.getTime() - maxCleanMs),
        new Date(dayClose.getTime() + maxCleanMs),
      ),
    },
    select: {
      theatreId: true, primarySurgeonId: true, patientId: true,
      scheduledStart: true, scheduledEnd: true,
    },
  })

  // Parsed once. Doing it inside the candidate loop turns a few dozen Date
  // constructions into a few thousand.
  const cases = dayCases.map((c) => ({
    theatreId: c.theatreId,
    primarySurgeonId: c.primarySurgeonId,
    patientId: c.patientId,
    start: new Date(c.scheduledStart).getTime(),
    end: new Date(c.scheduledEnd).getTime(),
  }))

  const stepMs = Math.max(5, stepMinutes) * 60_000
  const lengthMs = minutes * 60_000
  const runs = []

  for (let t = dayOpen.getTime(); t + lengthMs <= dayClose.getTime(); t += stepMs) {
    const start = t
    const end = t + lengthMs

    // The surgeon and the patient carry no turnaround — they are free the moment
    // a case ends. Only the room needs cleaning. Same asymmetry as the gate.
    const surgeonFree = primarySurgeonId
      ? cases.some((c) => c.primarySurgeonId === primarySurgeonId && c.start < end && c.end > start) === false
      : true
    const patientFree = patientId
      ? cases.some((c) => c.patientId === patientId && c.start < end && c.end > start) === false
      : true
    if (surgeonFree === false || patientFree === false) { runs.push(null); continue }

    const openRooms = theatres.filter((room) => {
      const cleanMs = (room.cleaningMinutes || 0) * 60_000
      return cases.some(
        (c) => c.theatreId === room.id && c.start < end + cleanMs && c.end > start - cleanMs,
      ) === false
    })
    if (openRooms.length === 0) { runs.push(null); continue }

    runs.push({ start, end, roomIds: openRooms.map((r) => r.id).join(','), rooms: openRooms })
  }

  // Collapse. A new suggestion starts when the slot stops being bookable, or
  // when a DIFFERENT set of rooms becomes the answer — losing that would hide a
  // theatre that only opens up later in the same gap.
  const slots = []
  let current = null
  for (const candidate of runs) {
    if (candidate === null) { current = null; continue }
    if (current && current.roomIds === candidate.roomIds) {
      current.freeUntil = candidate.end
      continue
    }
    current = {
      start: new Date(candidate.start),
      end: new Date(candidate.end),
      freeUntil: candidate.end,
      theatres: candidate.rooms.map((r) => ({ id: r.id, name: r.name, theatreType: r.theatreType })),
      roomIds: candidate.roomIds,
    }
    slots.push(current)
  }

  return {
    hours: { start: openAt, end: closeAt },
    // roomIds was only ever the grouping key — it is not part of the answer.
    slots: slots.slice(0, limit).map(({ roomIds, freeUntil, ...slot }) => ({
      ...slot,
      freeUntil: new Date(freeUntil),
    })),
  }
}

// Lets only one person take a slot in a theatre at a time.
//
// Without this, two users looking at the same empty slot in the same second both
// pass the check above and both save — the check was right and it is still a
// double booking. This lock makes the second one wait, and by the time it runs
// it can see the first booking.
//
// Must be called inside db.$transaction, before assertNoConflict().
export async function lockTheatre(tx, theatreId) {
  // Fold the cuid into the 64-bit key the lock takes. Collisions between two
  // different theatres are harmless — the worst case is one waiting on the other.
  let h = 0n
  for (const ch of String(theatreId)) h = (h * 31n + BigInt(ch.charCodeAt(0))) % 9223372036854775783n
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1)', h)
}
