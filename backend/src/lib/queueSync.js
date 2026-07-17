import { db } from '../config/db.js'
import { nextQueueNumber } from '../utils/queueNumber.js'
import { priorityRank } from './queuePriority.js'
import { dayRange, ymdInZone, zonedDateTimeToUtc } from './dates.js'
import { deriveVisitType, resolveRoom } from './queueDerivation.js'
import { parseTimetable } from './doctorTimetable.js'

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

// Postgres caps a single prepared statement at 32,767 bind variables, and
// every id in an `appointmentId: { in: [...] }` list is one bind variable.
// A sync spanning many months of appointments can carry tens of thousands of
// ids — comfortably over that limit in one query (this crashed in practice:
// "too many bind variables ... received 32768" when backfilling a ~13-month
// range). Chunking also caps the size of each write transaction, so a wide
// backfill is many small fast commits instead of one giant all-or-nothing one.
const BATCH_SIZE = 2000

// Exported for a direct unit test — the bind-variable crash is impractical
// to reproduce at full scale (tens of thousands of rows) in a fast test.
export function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Make the queue reflect every appointment in [startDate, endDate].
 * Idempotent: after the first pass a repeat call issues no writes.
 * Safe for a range of any size (internally batched) and safe to call
 * concurrently with itself (see syncBatch's upsert).
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

  let totalOps = 0
  for (const batch of chunk(appointments, BATCH_SIZE)) {
    totalOps += await syncBatch(organizationId, batch)
  }
  return totalOps
}

async function syncBatch(organizationId, appointments) {
  const existing = await db.queueManagement.findMany({
    where: { organizationId, appointmentId: { in: appointments.map((a) => a.id) } },
    select: { appointmentId: true, joinedQueueAt: true, roomId: true, status: true },
  })
  const byAppointment = new Map(existing.map((q) => [q.appointmentId, q]))

  // Every doctor in this batch, fetched ONCE. Resolving a room needs the
  // doctor's timetable, and a batch is thousands of appointments across a
  // handful of doctors — asking per appointment would be thousands of queries
  // per sync, on the same connection pool the display board polls against.
  const doctorIds = [...new Set(appointments.map((a) => a.doctorId).filter(Boolean))]
  const [doctors, links] = await Promise.all([
    db.user.findMany({ where: { id: { in: doctorIds } }, select: { id: true, preferences: true } }),
    db.doctorRoomAssignment.findMany({
      where: { doctorId: { in: doctorIds } },
      orderBy: { createdAt: 'asc' },
      select: { doctorId: true, roomId: true },
    }),
  ])
  const timetables = new Map(doctors.map((d) => [d.id, parseTimetable(d.preferences)]))
  const fallbackRooms = new Map() // oldest link per doctor — matches deriveRoomAndVisitType's fallback
  for (const l of links) if (!fallbackRooms.has(l.doctorId)) fallbackRooms.set(l.doctorId, l.roomId)
  const roomFor = (a) => resolveRoom(
    timetables.get(a.doctorId) ?? null,
    fallbackRooms.get(a.doctorId) ?? null,
    a.appointmentDate,
    a.appointmentTime,
  )

  const ops = []
  for (const a of appointments) {
    const slot = zonedDateTimeToUtc(ymdInZone(a.appointmentDate), a.appointmentTime)
    const current = byAppointment.get(a.id)

    if (!current) {
      // Room + new-vs-follow-up are derived from the doctor/patient, not
      // asked at check-in — see lib/queueDerivation.js.
      const roomId = roomFor(a)
      const visitType = await deriveVisitType(a.doctorId, a.patientId)
      ops.push(db.queueManagement.upsert({
        where: { appointmentId: a.id },
        create: {
          organizationId,
          patientId: a.patientId,
          appointmentId: a.id,
          assignedToId: a.doctorId,
          roomId,
          visitType,
          serviceArea: 'opd',
          queueNumber: await nextQueueNumber(db, organizationId, 'opd'),
          status: 'waiting',
          priority: a.priority || 'normal',
          priorityRank: priorityRank(a.priority || 'normal'),
          joinedQueueAt: slot,
        },
        // A concurrent sync run (two staff opening the Queue page for the
        // same date at once) can create this same row between our `findMany`
        // read above and this write. `create` alone would throw P2002 on
        // appointmentId's unique constraint and roll back this whole batch —
        // `upsert` degrades that race to a harmless no-op update instead.
        update: {},
      }))
      continue
    }

    const slotChanged = current.joinedQueueAt?.getTime() !== slot.getTime()
    // Self-healing: a row created before roomId derivation existed (or whose
    // doctor didn't have a room yet at the time) heals itself the next time
    // this sync runs, instead of staying stale forever — see the client demo
    // incident this was written for (2670 today-rows all had roomId null
    // because they predated that fix).
    //
    // A row in the WRONG room heals the same way, and for the same reason: it
    // is just as invisible as one with no room. Every row written while the
    // room came from the oldest DoctorRoomAssignment link is potentially in the
    // wrong room, and there are ~1M of them — they must not need a hand-run
    // script each time a doctor's timetable moves.
    //
    // But only while the patient is still WAITING: once staff have called them
    // or started the consultation, they are physically somewhere, and moving
    // their row would contradict the room they were actually called into.
    const derivedRoom = roomFor(a)
    const roomNeedsFix = derivedRoom != null
      && current.roomId !== derivedRoom
      && (current.roomId == null || current.status === 'waiting')

    if (slotChanged || roomNeedsFix) {
      const data = {}
      if (slotChanged) data.joinedQueueAt = slot
      if (roomNeedsFix) data.roomId = derivedRoom
      // Status and priority are deliberately left alone here — staff may
      // since have called the patient or bumped them up by hand.
      ops.push(db.queueManagement.update({ where: { appointmentId: a.id }, data }))
    }
  }

  if (ops.length > 0) await db.$transaction(ops)
  return ops.length
}
