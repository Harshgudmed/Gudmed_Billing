import { db } from '../config/db.js'
import { generateQueueNumber } from '../utils/queueNumber.js'
import { priorityRank } from './queuePriority.js'
import { dayRange, ymdInZone, zonedDateTimeToUtc } from './dates.js'

// Business rule from the client: there is NO check-in step. A patient who has an
// appointment today IS in the queue — ordered by their appointment time, with
// priority floating urgent cases to the top.
//
// So the queue is DERIVED from appointments rather than from a staff action. This
// makes sure every appointment in the requested window has a queue row, and stamps
// `joinedQueueAt` with the appointment's OWN time — which is what makes the queue's
// existing `[priorityRank desc, joinedQueueAt asc]` ordering read as
// "priority first, then appointment time".
//
// Without the re-stamp, `joinedQueueAt` held the moment the row happened to be
// created, so a 5pm patient could sit above a 9am one.

const NOT_QUEUEABLE = ['cancelled', 'no_show', 'rescheduled']

/**
 * Make the queue reflect every appointment in [startDate, endDate].
 * Idempotent: after the first pass a repeat call issues no writes.
 * @returns the number of rows created/re-stamped
 */
export async function syncAppointmentsToQueue(organizationId, startDate, endDate) {
  const appointments = await db.appointment.findMany({
    where: {
      organizationId,
      appointmentDate: dayRange(startDate, endDate),
      status: { notIn: NOT_QUEUEABLE },
    },
    select: {
      id: true, patientId: true, doctorId: true,
      appointmentDate: true, appointmentTime: true, priority: true,
    },
  })
  if (appointments.length === 0) return 0

  const existing = await db.queueManagement.findMany({
    where: { organizationId, appointmentId: { in: appointments.map((a) => a.id) } },
    select: { appointmentId: true, joinedQueueAt: true },
  })
  const byAppointment = new Map(existing.map((q) => [q.appointmentId, q]))

  const ops = []
  for (const a of appointments) {
    const slot = zonedDateTimeToUtc(ymdInZone(a.appointmentDate), a.appointmentTime)
    const current = byAppointment.get(a.id)

    if (!current) {
      ops.push(db.queueManagement.create({
        data: {
          organizationId,
          patientId: a.patientId,
          appointmentId: a.id,
          assignedToId: a.doctorId,
          serviceArea: 'opd',
          queueNumber: generateQueueNumber('opd'),
          status: 'waiting',
          priority: a.priority || 'normal',
          priorityRank: priorityRank(a.priority || 'normal'),
          joinedQueueAt: slot,
        },
      }))
    } else if (current.joinedQueueAt?.getTime() !== slot.getTime()) {
      // Row predates this rule, or the appointment was moved to a new time.
      // Only the slot is re-stamped: status and priority are left alone because
      // staff may since have called the patient or bumped them up by hand.
      ops.push(db.queueManagement.update({
        where: { appointmentId: a.id },
        data: { joinedQueueAt: slot },
      }))
    }
  }

  if (ops.length > 0) await db.$transaction(ops)
  return ops.length
}
