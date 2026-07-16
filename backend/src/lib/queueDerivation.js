// Derives the two fields a new queue entry needs but that staff should never
// have to pick by hand on every check-in: which physical room the doctor
// sits in, and whether this is a new or follow-up visit.
//
// Room: the doctor's own DoctorRoomAssignment (Settings → Rooms) — NOT asked
// at check-in time, because the doctor is already known from the appointment.
// Visit type: 'follow_up' if this patient has any prior Consultation with
// this same doctor, 'new' otherwise. A real receptionist-facing override can
// be added later if this heuristic proves wrong for a real workflow; until
// then this keeps check-in a single click, matching how it works today.
import { db } from '../config/db.js'

export async function deriveRoomAndVisitType({ doctorId, patientId }) {
  if (!doctorId) return { roomId: null, visitType: 'new' }

  const [link, priorVisit] = await Promise.all([
    db.doctorRoomAssignment.findFirst({
      where: { doctorId },
      orderBy: { createdAt: 'asc' },
      select: { roomId: true },
    }),
    patientId
      ? db.consultation.findFirst({ where: { doctorId, patientId }, select: { id: true } })
      : null,
  ])

  return {
    roomId: link?.roomId || null,
    visitType: priorVisit ? 'follow_up' : 'new',
  }
}
