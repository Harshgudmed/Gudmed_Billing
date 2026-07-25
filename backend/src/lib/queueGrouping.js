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
 * Which group key an entry belongs to: the doctor it is booked with IF that
 * doctor is in this room today, otherwise the active doctor (or 'unassigned').
 * The single rule shared by every "group by doctor" caller — waiting and
 * in-progress alike — so the display board never sorts the two differently.
 */
export function doctorGroupKey(entry, activeDoctorId = null, hasShiftToday = () => false) {
  const bookedWith = bookedDoctorId(entry)
  const hereToday = bookedWith && (bookedWith === activeDoctorId || hasShiftToday(bookedWith))
  return hereToday ? bookedWith : (activeDoctorId || 'unassigned')
}

/**
 * The IN-PROGRESS entries grouped by doctor, the same way waiting ones are — so
 * each doctor's column/console shows the patient THAT doctor is seeing, not the
 * room's first. At most one consult per doctor (a doctor sees one patient at a
 * time), so a later entry for the same key simply replaces the earlier.
 */
export function groupInProgressByDoctor(inProgressEntries, { activeDoctorId = null, hasShiftToday = () => false } = {}) {
  const byDoctor = new Map()
  for (const e of inProgressEntries) {
    byDoctor.set(doctorGroupKey(e, activeDoctorId, hasShiftToday), e)
  }
  return byDoctor
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
    const targetId = doctorGroupKey(e, activeDoctorId, hasShiftToday)
    if (!byDoctor.has(targetId)) byDoctor.set(targetId, [])
    byDoctor.get(targetId).push(e)
  }
  return byDoctor
}
