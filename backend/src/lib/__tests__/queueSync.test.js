// One visit, two records: the appointment and its queue row must move together.
// Real-database tests in a disposable organization (same pattern as
// room.storage.test.js), because what is being proven is which rows the
// updateMany calls actually touch — status guards and hospital scoping.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { keepVisitInStep, upsertQueueForAppointment, syncAppointmentsToQueue } from '../queueSync.js'
import { ymdInZone, zonedDateTimeToUtc } from '../dates.js'

const stamp = Date.now()
let org, otherOrg, docA, docB, roomA, roomB, patient
const day = new Date(`${ymdInZone()}T00:00:00+05:30`) // today, pinned to the hospital's midnight
let nextTime = 0
const freshTime = () => `0${Math.floor(nextTime / 4)}:${String((nextTime++ % 4) * 15).padStart(2, '0')}`.slice(-5)

async function visit({ organizationId = org.id, doctorId = docA.id, appointmentStatus = 'scheduled', queueStatus = 'waiting' } = {}) {
  const appointment = await db.appointment.create({
    data: { organizationId, patientId: patient.id, doctorId, appointmentDate: day, appointmentTime: freshTime(), status: appointmentStatus },
  })
  const row = await upsertQueueForAppointment(db, { organizationId, appointment })
  if (queueStatus !== 'waiting') await db.queueManagement.update({ where: { id: row.id }, data: { status: queueStatus } })
  return { appointment, queueId: row.id }
}
const statuses = async ({ appointment, queueId }) => {
  const [a, q] = await Promise.all([
    db.appointment.findUnique({ where: { id: appointment.id } }),
    db.queueManagement.findUnique({ where: { id: queueId } }),
  ])
  return { a: a.status, q: q.status, appointment: a, queue: q }
}

before(async () => {
  org = await db.organization.create({ data: { name: 'Test Org — queueSync.test.js', slug: `test-queue-sync-${stamp}` } })
  otherOrg = await db.organization.create({ data: { name: 'Other Org — queueSync.test.js', slug: `test-queue-sync-other-${stamp}` } })
  docA = await db.user.create({ data: { organizationId: org.id, email: `dr.a.qs.${stamp}@test.local`, fullName: 'Dr. Alpha', role: 'doctor' } })
  docB = await db.user.create({ data: { organizationId: org.id, email: `dr.b.qs.${stamp}@test.local`, fullName: 'Dr. Beta', role: 'doctor' } })
  const floor = await db.floor.create({ data: { organizationId: org.id, name: 'Ground' } })
  roomA = await db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '101' } })
  roomB = await db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '201' } })
  // No timetable: the room falls back to the doctor's room link, which is enough here.
  await db.doctorRoomAssignment.createMany({ data: [
    { organizationId: org.id, doctorId: docA.id, roomId: roomA.id },
    { organizationId: org.id, doctorId: docB.id, roomId: roomB.id },
  ] })
  patient = await db.patient.create({ data: { organizationId: org.id, firstName: 'Queue', lastName: 'Sync', mrn: `TQS-${stamp}`, gender: 'other', dateOfBirth: new Date('1990-01-01') } })
})

after(async () => {
  // Cascades from Organization remove rooms, links, appointments, queue rows, counters.
  await db.queueManagement.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } })
  await db.appointment.deleteMany({ where: { organizationId: { in: [org.id, otherOrg.id] } } })
  await db.organization.delete({ where: { id: org.id } })
  await db.organization.delete({ where: { id: otherOrg.id } })
})

test('appointment → queue: started, completed, cancelled, no-show and rescheduled move the queue row the same way', async () => {
  for (const status of ['in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled']) {
    const v = await visit()
    const moved = await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [v.appointment.id], changed: 'appointment', status })
    const s = await statuses(v)
    assert.equal(moved, 1, status)
    assert.equal(s.q, status)
  }
})

test('appointment → queue: completing stamps serviceCompletedAt; starting stamps serviceStartedAt', async () => {
  const v = await visit()
  await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [v.appointment.id], changed: 'appointment', status: 'in_progress' })
  assert.ok((await statuses(v)).queue.serviceStartedAt)
  await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [v.appointment.id], changed: 'appointment', status: 'completed' })
  assert.ok((await statuses(v)).queue.serviceCompletedAt)
})

test('appointment → queue: confirmed / checked_in do not move the row (being booked is being in the queue)', async () => {
  const v = await visit()
  for (const status of ['confirmed', 'checked_in', 'scheduled']) {
    assert.equal(await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [v.appointment.id], changed: 'appointment', status }), 0)
  }
  assert.equal((await statuses(v)).q, 'waiting')
})

test('queue → appointment: Call in (in_progress) and Complete move the appointment, with its timestamps', async () => {
  const v = await visit({ appointmentStatus: 'checked_in' })
  await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [v.appointment.id], changed: 'queue', status: 'in_progress' })
  let s = await statuses(v)
  assert.equal(s.a, 'in_progress')
  assert.ok(s.appointment.startedAt)
  await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [v.appointment.id], changed: 'queue', status: 'completed' })
  s = await statuses(v)
  assert.equal(s.a, 'completed')
  assert.ok(s.appointment.completedAt)
})

test('queue → appointment: an alert (called), Undo alert (waiting), cancelled and no_show do not move the appointment', async () => {
  const v = await visit()
  for (const status of ['called', 'waiting', 'cancelled', 'no_show']) {
    assert.equal(await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [v.appointment.id], changed: 'queue', status }), 0, status)
  }
  assert.equal((await statuses(v)).a, 'scheduled')
})

test('a finished record is never moved out of its state, and never backwards', async () => {
  const over = await visit({ appointmentStatus: 'cancelled', queueStatus: 'cancelled' })
  assert.equal(await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [over.appointment.id], changed: 'queue', status: 'completed' }), 0)
  assert.equal(await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [over.appointment.id], changed: 'appointment', status: 'completed' }), 0)
  assert.deepEqual([(await statuses(over)).a, (await statuses(over)).q], ['cancelled', 'cancelled'])
  // in consultation → "start" again is not a second move; the row stays in_progress
  const busy = await visit({ appointmentStatus: 'in_progress', queueStatus: 'in_progress' })
  assert.equal(await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [busy.appointment.id], changed: 'queue', status: 'in_progress' }), 0)
})

test('hospital isolation: another hospital\'s id moves nothing, and the caller\'s hospital is the only one written', async () => {
  const v = await visit()
  // the right ids, the wrong hospital → nothing moves
  assert.equal(await keepVisitInStep(db, { organizationId: otherOrg.id, appointmentIds: [v.appointment.id], changed: 'appointment', status: 'completed' }), 0)
  assert.equal(await keepVisitInStep(db, { organizationId: otherOrg.id, appointmentIds: [v.appointment.id], changed: 'queue', status: 'completed' }), 0)
  const s = await statuses(v)
  assert.deepEqual([s.a, s.q], ['scheduled', 'waiting'])
})

test('no ids, a null id or an unmapped status is a harmless no-op', async () => {
  assert.equal(await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [], changed: 'appointment', status: 'completed' }), 0)
  assert.equal(await keepVisitInStep(db, { organizationId: org.id, appointmentIds: [null], changed: 'queue', status: 'completed' }), 0)
  assert.equal(await keepVisitInStep(db, { organizationId: org.id, appointmentIds: ['x'], changed: 'queue', status: 'bogus' }), 0)
})

test('followMove: a new doctor / time moves the queue row (doctor, room, slot), keeps the token, withdraws an alert', async () => {
  const v = await visit({ queueStatus: 'called' })
  const before = (await statuses(v)).queue
  const moved = await db.appointment.update({ where: { id: v.appointment.id }, data: { doctorId: docB.id, appointmentTime: '23:30' } })
  await upsertQueueForAppointment(db, { organizationId: org.id, appointment: moved, followMove: true })
  const after = (await statuses(v)).queue
  assert.equal(after.assignedToId, docB.id)
  assert.equal(after.roomId, roomB.id)
  assert.equal(after.joinedQueueAt.getTime(), zonedDateTimeToUtc(ymdInZone(day), '23:30').getTime())
  assert.equal(after.queueNumber, before.queueNumber)
  assert.equal(after.status, 'waiting') // "you are next" was promised in Dr Alpha's room
})

test('followMove off (booking, check-in): an existing row is left exactly as staff set it', async () => {
  const v = await visit({ queueStatus: 'called' })
  const moved = await db.appointment.update({ where: { id: v.appointment.id }, data: { doctorId: docB.id } })
  await upsertQueueForAppointment(db, { organizationId: org.id, appointment: moved })
  const row = (await statuses(v)).queue
  assert.equal(row.assignedToId, docA.id)
  assert.equal(row.status, 'called')
})

test('the queue sync heals a waiting row whose doctor no longer matches its appointment', async () => {
  const v = await visit()
  await db.queueManagement.update({ where: { id: v.queueId }, data: { assignedToId: docB.id, roomId: roomB.id } })
  await syncAppointmentsToQueue(org.id, ymdInZone(day), ymdInZone(day))
  const row = (await statuses(v)).queue
  assert.equal(row.assignedToId, docA.id)
  assert.equal(row.roomId, roomA.id)
})
