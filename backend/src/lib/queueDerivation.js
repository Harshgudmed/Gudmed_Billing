// Derives the two fields a new queue entry needs but that staff should never
// have to pick by hand on every check-in: which physical room the doctor sits
// in for THIS appointment, and whether this is a new or follow-up visit.
//
// Room: the shift in the doctor's own weekly timetable that covers the
// appointment's day and time. The timetable is the single source of truth for
// "who sits where, when" — it is what the display board resolves the active
// doctor from (lib/activeDoctor.js), so deriving the room any other way lets
// the two disagree, and a queue entry the board cannot show is invisible.
//
// This used to read DoctorRoomAssignment.findFirst({ orderBy: createdAt asc }):
// the doctor's OLDEST room link. That table is only a derived cache of the rooms
// a timetable mentions (doctorAccountabilityController.js rewrites it on every
// save) and it carries no times, so picking a row out of it throws away the very
// thing that decides the room. Any doctor working more than one room got every
// patient filed into whichever room they happened to be linked to first: a
// doctor whose Friday shift is room 101, but whose oldest link is room 100, had
// his patients parked in room 100 — where nobody was sitting — while the board
// showed room 101 (where he actually was) with an empty list. Patients were in
// the database, waiting, and on no screen anywhere.
//
// Visit type: 'follow_up' if this patient has any prior Consultation with this
// same doctor, 'new' otherwise.
import { db } from '../config/db.js'
import { DAY_NAMES, parseTimetable, shiftsOnDay, toMinutes } from './doctorTimetable.js'
import { nowInZone, ymdInZone } from './dates.js'
import { isOnLeave } from './activeDoctor.js'

/**
 * The room this doctor's timetable puts them in at `appointmentDate`+
 * `appointmentTime`, or null if the timetable can't answer (no timetable, day
 * switched off, on leave, no shift carries a room, or an unparseable time).
 * Null means "fall back", never "no room" — see resolveRoom.
 *
 * Pure: takes an already-parsed timetable so it unit-tests against fixed input.
 */
export function roomFromTimetable(timetable, appointmentDate, appointmentTime) {
  if (!timetable) return null

  // The appointment's weekday and calendar date as the HOSPITAL reads them, not
  // the server — the same rule the rest of the queue uses (see lib/dates.js).
  const when = new Date(appointmentDate)
  if (Number.isNaN(when.getTime())) return null
  if (isOnLeave(timetable, ymdInZone(when))) return null

  const shifts = shiftsOnDay(timetable, DAY_NAMES[nowInZone(when).dayOfWeek]).filter((s) => s?.roomId)
  if (shifts.length === 0) return null

  const at = toMinutes(appointmentTime)
  if (!Number.isFinite(at)) return null

  const covering = shifts.find((s) => {
    const start = toMinutes(s.start)
    const end = toMinutes(s.end)
    return Number.isFinite(start) && Number.isFinite(end) && at >= start && at < end
  })
  if (covering) return covering.roomId

  // Booked outside the doctor's hours for that day (staff can book any time —
  // nothing forces a slot to sit inside a shift). They still sit in exactly one
  // room that day, so use the shift nearest the booked time rather than giving
  // up and falling back to a room they aren't in at all.
  const nearest = shifts
    .map((s) => ({ roomId: s.roomId, distance: Math.abs(toMinutes(s.start) - at) }))
    .filter((s) => Number.isFinite(s.distance))
    .sort((a, b) => a.distance - b.distance)[0]
  return nearest?.roomId ?? null
}

/**
 * Timetable first; the doctor's oldest room link only as a fallback.
 *
 * The fallback still matters: a doctor with no timetable yet, or one whose
 * shifts carry no roomId, would otherwise land in no room at all — worse than
 * the imprecise-but-usually-right link, and a regression for every
 * single-room doctor, for whom the link is the right answer anyway.
 */
export function resolveRoom(timetable, fallbackRoomId, appointmentDate, appointmentTime) {
  return roomFromTimetable(timetable, appointmentDate, appointmentTime) ?? fallbackRoomId ?? null
}

/** 'follow_up' if this patient has seen this doctor before, else 'new'. */
export async function deriveVisitType(doctorId, patientId) {
  if (!doctorId || !patientId) return 'new'
  const priorVisit = await db.consultation.findFirst({ where: { doctorId, patientId }, select: { id: true } })
  return priorVisit ? 'follow_up' : 'new'
}

export async function deriveRoomAndVisitType({ doctorId, patientId, appointmentDate, appointmentTime }) {
  if (!doctorId) return { roomId: null, visitType: 'new' }

  const [doctor, link, visitType] = await Promise.all([
    db.user.findUnique({ where: { id: doctorId }, select: { preferences: true } }),
    db.doctorRoomAssignment.findFirst({
      where: { doctorId },
      orderBy: { createdAt: 'asc' },
      select: { roomId: true },
    }),
    deriveVisitType(doctorId, patientId),
  ])

  return {
    roomId: resolveRoom(parseTimetable(doctor?.preferences), link?.roomId ?? null, appointmentDate, appointmentTime),
    visitType,
  }
}
