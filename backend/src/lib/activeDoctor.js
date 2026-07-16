// Doctor Sitting Type resolution — decides which doctor is "active" in a
// consulting room right now.
//
// There is no separate "link a doctor to this room" step and no manually
// chosen "single vs multiple" toggle: a doctor's presence in a room is
// whatever their own weekly timetable (Settings this lives in: Doctor
// Accountability → Timetable) says via each shift's roomId. A room that only
// ever has one doctor's shifts pointing at it behaves like a single-doctor
// room; a room several doctors' shifts point at (at different times)
// behaves like a shared room — same resolution logic either way.
//
// Pure functions only — no DB access here. Callers fetch each candidate
// doctor's timetable via Prisma/lib/doctorTimetable.js and pass it in; that
// keeps this module trivially unit-testable against a fixed clock instead
// of the real wall clock.

import { normalizeTimeHHMM, nowInZone } from './dates.js'
import { DAY_NAMES, shiftsForRoom } from './doctorTimetable.js'

function toMinutes(hhmm) {
  const [h, m] = normalizeTimeHHMM(hhmm).split(':').map(Number)
  return h * 60 + m
}

/**
 * @param roomId    the room being resolved
 * @param doctors   [{ doctorId, doctorName, timetable }] — every doctor who has EVER
 *                  had a shift point at this room (the caller fetches this small set
 *                  via the DoctorRoomAssignment index, not by scanning every doctor)
 * @param opts.override  { doctorId, doctorName } | null — staff-forced doctor
 *                  (absent-doctor case). Takes precedence over everything else, and
 *                  is NOT required to be one of `doctors` — a covering doctor from
 *                  elsewhere in the hospital is a valid override.
 * @param opts.now  { hhmm, dayOfWeek } — defaults to real now via dates.js#nowInZone;
 *                  pass a fixed value in tests instead of mocking the system clock.
 * @returns {{ doctorId, doctorName, manual, unassigned, onBreak }}
 */
export function resolveActiveDoctor(roomId, doctors, opts = {}) {
  const { override = null, now } = opts

  if (override) {
    return { doctorId: override.doctorId, doctorName: override.doctorName, manual: true, unassigned: false, onBreak: false }
  }

  if (!doctors || doctors.length === 0) {
    return { doctorId: null, doctorName: null, manual: false, unassigned: true, onBreak: false }
  }

  const clock = now || nowInZone()
  const dayName = DAY_NAMES[clock.dayOfWeek]
  const cur = toMinutes(clock.hhmm)

  const matches = []
  for (const d of doctors) {
    for (const shift of shiftsForRoom(d.timetable, roomId)) {
      if (shift.dayName !== dayName) continue
      const start = toMinutes(shift.start)
      const end = toMinutes(shift.end)
      if (cur >= start && cur < end) matches.push({ doctorId: d.doctorId, doctorName: d.doctorName, start: shift.start })
    }
  }

  if (matches.length === 0) {
    return { doctorId: null, doctorName: null, manual: false, unassigned: false, onBreak: true }
  }

  // Two shifts pointing at the same room at an overlapping time is a
  // data-entry mistake (two doctors' timetables independently claiming the
  // same room+slot — nothing prevents this at write time since each
  // doctor's shifts are edited independently). Resolve deterministically
  // rather than picking whichever happened to be fetched first: earliest
  // start wins, so behaviour is at least stable and reproducible.
  matches.sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  const active = matches[0]
  return { doctorId: active.doctorId, doctorName: active.doctorName, manual: false, unassigned: false, onBreak: false }
}

/**
 * Which OTHER doctors (besides the resolved active one) are genuinely
 * scheduled in this room at this exact moment — not "everyone who has ever
 * had a shift here." By design, shared-room shifts are non-overlapping
 * (see seed-full-timetables.js's SHIFT_SLOTS), so this is normally empty:
 * exactly one doctor is ever actually "sitting" in a room at a given moment.
 * A non-empty result means two doctors' independently-edited timetables
 * really do overlap in this room right now — a genuine data-entry conflict
 * worth surfacing, not routine multi-doctor sharing.
 *
 * @returns [{ doctorId, doctorName }] — empty for an override room (a
 *          manual override is a single covering doctor, not a shift overlap)
 *          or when nobody else's shift matches right now.
 */
export function otherConcurrentDoctors(roomId, doctors, opts = {}) {
  const { override = null, activeDoctorId = null, now } = opts
  if (override || !doctors || doctors.length === 0) return []

  const clock = now || nowInZone()
  const dayName = DAY_NAMES[clock.dayOfWeek]
  const cur = toMinutes(clock.hhmm)

  const result = []
  for (const d of doctors) {
    if (d.doctorId === activeDoctorId) continue
    for (const shift of shiftsForRoom(d.timetable, roomId)) {
      if (shift.dayName !== dayName) continue
      const start = toMinutes(shift.start)
      const end = toMinutes(shift.end)
      if (cur >= start && cur < end) {
        result.push({ doctorId: d.doctorId, doctorName: d.doctorName })
        break
      }
    }
  }
  return result
}

/** Throws if `shift`'s start/end aren't valid HH:mm times, or start isn't
 * strictly before end. Overnight (crosses-midnight) shifts are not supported
 * yet — reject them at write time instead of resolving them wrong (or
 * silently never matching) at read time.
 *
 * toMinutes() on a malformed/empty time string returns NaN, and EVERY
 * NaN comparison (>=, <, ==) evaluates to false — so a naive `start >= end`
 * check alone silently PASSES malformed input instead of rejecting it. This
 * must check finiteness explicitly first. */
export function assertValidShift(shift) {
  const start = toMinutes(shift.start)
  const end = toMinutes(shift.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`Invalid shift time (expected HH:mm): "${shift.start}"–"${shift.end}"`)
  }
  if (start >= end) {
    throw new Error('Shift start time must be before end time (overnight shifts are not supported yet)')
  }
}

/** Throws if any two shifts in `shifts` (all for the SAME doctor, SAME day,
 * regardless of which room each points at) overlap — a doctor cannot
 * physically be in two rooms at once. Each room resolves independently
 * (resolveActiveDoctor never looks at a doctor's OTHER rooms), so without
 * this check two overlapping shifts in different rooms would each
 * legitimately "win" their own room and the display board would show the
 * same doctor active in two places at the same time. */
export function assertNoSelfOverlap(shifts) {
  const withMinutes = shifts
    .map((s) => ({ start: toMinutes(s.start), end: toMinutes(s.end) }))
    .sort((a, b) => a.start - b.start)
  for (let i = 1; i < withMinutes.length; i++) {
    if (withMinutes[i].start < withMinutes[i - 1].end) {
      throw new Error('This doctor already has an overlapping shift on this day — they cannot be scheduled in two rooms at once')
    }
  }
}
