// How the display board decides WHICH DOCTOR each waiting patient is listed
// under. Pure — no DB, no clock — so the rules below are unit-testable against
// fixed inputs instead of the wall clock. See __tests__/queueGrouping.test.js.

/**
 * Who is this patient actually here to see?
 *   followUpDoctorId — an explicit "I'm coming back to Dr X".
 *   assignedToId     — the doctor their APPOINTMENT is with. The common case,
 *                      and NOT only about follow-ups: a brand-new patient
 *                      booked with Dr X is still here for Dr X.
 * A true walk-in (neither set) takes whoever is active right now.
 */
export function bookedDoctorId(entry) {
  return entry.followUpDoctorId || entry.assignedToId || null
}

/**
 * Group today's waiting entries by the doctor each patient is really waiting for.
 *
 * A patient stays in their own doctor's group only if that doctor is actually in
 * THIS room today (active now, or another shift today — the "booked with the 2pm
 * doctor, arrived at 9am" case). If their doctor isn't here today at all they'll
 * be seen by whoever is, so they fold into the active group — rather than the
 * board inventing a group labelled with that doctor's shift on another weekday.
 *
 * @param waitingEntries [{ followUpDoctorId, assignedToId, ... }]
 * @param opts.activeDoctorId  doctor resolved as active right now (may be null)
 * @param opts.hasShiftToday   (doctorId) => boolean — is this doctor in this room today?
 * @returns Map<doctorId|'unassigned', entry[]> — the active doctor's group always
 *          present (possibly empty) so an idle room renders "no one waiting"
 *          instead of a blank list.
 */
export function groupWaitingByDoctor(waitingEntries, { activeDoctorId = null, hasShiftToday = () => false } = {}) {
  const byDoctor = new Map()
  if (activeDoctorId) byDoctor.set(activeDoctorId, [])

  for (const e of waitingEntries) {
    const bookedWith = bookedDoctorId(e)
    const hereToday = bookedWith && (bookedWith === activeDoctorId || hasShiftToday(bookedWith))
    const targetId = hereToday ? bookedWith : (activeDoctorId || 'unassigned')
    if (!byDoctor.has(targetId)) byDoctor.set(targetId, [])
    byDoctor.get(targetId).push(e)
  }
  return byDoctor
}
