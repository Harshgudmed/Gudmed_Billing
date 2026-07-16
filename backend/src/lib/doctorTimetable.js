// Shared helpers for the doctor timetable JSON stored on User.preferences
// (see doctorAccountabilityController.js). A doctor's presence in a room is
// no longer a separate "link" a staff member sets up — it falls out of
// which room each of their weekly shifts points at. One place to manage
// both room and timing, per the client's explicit ask.
//
// Shape: { weeklySlots: { Monday: { active, shifts: [{start,end,roomId}] }, ... },
//          exceptions: [{date, reason}], slotDuration, maxPatientsPerDay }

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function parseTimetable(preferencesJson) {
  if (!preferencesJson) return null
  try {
    const prefs = JSON.parse(preferencesJson)
    return prefs.timetable || null
  } catch {
    return null
  }
}

/** Every distinct roomId referenced by any shift in this timetable. */
export function roomIdsInTimetable(timetable) {
  if (!timetable?.weeklySlots) return []
  const ids = new Set()
  for (const day of Object.values(timetable.weeklySlots)) {
    for (const shift of day?.shifts || []) {
      if (shift.roomId) ids.add(shift.roomId)
    }
  }
  return [...ids]
}

/** This timetable's shifts that point at `roomId`, tagged with their day name. */
export function shiftsForRoom(timetable, roomId) {
  if (!timetable?.weeklySlots || !roomId) return []
  const out = []
  for (const [dayName, day] of Object.entries(timetable.weeklySlots)) {
    for (const shift of day?.shifts || []) {
      if (shift.roomId === roomId) out.push({ dayName, start: shift.start, end: shift.end })
    }
  }
  return out
}
