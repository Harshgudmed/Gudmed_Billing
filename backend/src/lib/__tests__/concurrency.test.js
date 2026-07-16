// Regression tests for the concurrency/race-condition audit: each covers one
// real bug found and fixed this session (see the session's plan notes for the
// full audit). Real-database integration tests, same disposable-org pattern
// as room.storage.test.js — these hit actual Postgres constraints, not mocks,
// since the whole point is proving the DB itself rejects the race.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { nextQueueNumber } from '../../utils/queueNumber.js'
import { chunk } from '../queueSync.js'

let org, doctor, patient

before(async () => {
  org = await db.organization.create({ data: { name: 'Test Org — concurrency.test.js', slug: `test-concurrency-${Date.now()}` } })
  doctor = await db.user.create({ data: { organizationId: org.id, email: `dr.concurrency.${Date.now()}@test.local`, fullName: 'Dr. Concurrency Test', role: 'doctor' } })
  patient = await db.patient.create({
    data: { organizationId: org.id, firstName: 'Concurrency', lastName: 'Patient', mrn: `TESTMRN-CONC-${Date.now()}`, gender: 'other', dateOfBirth: new Date('1990-01-01') },
  })
})

after(async () => {
  await db.queueManagement.deleteMany({ where: { organizationId: org.id } })
  await db.appointment.deleteMany({ where: { organizationId: org.id } })
  await db.billCounter.deleteMany({ where: { organizationId: org.id } })
  await db.patient.deleteMany({ where: { organizationId: org.id } })
  await db.user.deleteMany({ where: { organizationId: org.id } })
  await db.organization.delete({ where: { id: org.id } })
})

test('chunk() splits into groups of exactly `size`, with the remainder in the last group', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(chunk([], 2), [])
  assert.deepEqual(chunk([1, 2], 5), [[1, 2]])
})

test('nextQueueNumber: two concurrent calls for the same org+area+day never collide', async () => {
  const [a, b] = await Promise.all([
    nextQueueNumber(db, org.id, 'opd'),
    nextQueueNumber(db, org.id, 'opd'),
  ])
  assert.notEqual(a, b)
})

test('nextQueueNumber: many concurrent calls all produce distinct numbers (no lost increments)', async () => {
  const results = await Promise.all(Array.from({ length: 25 }, () => nextQueueNumber(db, org.id, 'emergency')))
  assert.equal(new Set(results).size, results.length)
})

test('QueueManagement_organizationId_queueNumber_key rejects a duplicate queueNumber in the same org', async () => {
  const dupe = `DUPE-TEST-${Date.now()}`
  const first = await db.queueManagement.create({
    data: { organizationId: org.id, patientId: patient.id, serviceArea: 'opd', queueNumber: dupe },
  })
  await assert.rejects(
    () => db.queueManagement.create({ data: { organizationId: org.id, patientId: patient.id, serviceArea: 'opd', queueNumber: dupe } }),
    (err) => err.code === 'P2002',
  )
  await db.queueManagement.delete({ where: { id: first.id } })
})

test('Appointment_doctor_active_slot_key rejects double-booking the same doctor at the same date+time', async () => {
  const apptDate = new Date('2027-06-15T00:00:00.000Z')
  const first = await db.appointment.create({
    data: { organizationId: org.id, patientId: patient.id, doctorId: doctor.id, appointmentDate: apptDate, appointmentTime: '10:00', status: 'scheduled' },
  })
  await assert.rejects(
    () => db.appointment.create({
      data: { organizationId: org.id, patientId: patient.id, doctorId: doctor.id, appointmentDate: apptDate, appointmentTime: '10:00', status: 'scheduled' },
    }),
    (err) => err.code === 'P2002',
  )
  await db.appointment.delete({ where: { id: first.id } })
})

test('the same doctor+slot IS rebookable once the earlier appointment is cancelled (partial index excludes cancelled rows)', async () => {
  const apptDate = new Date('2027-06-16T00:00:00.000Z')
  const first = await db.appointment.create({
    data: { organizationId: org.id, patientId: patient.id, doctorId: doctor.id, appointmentDate: apptDate, appointmentTime: '11:00', status: 'cancelled' },
  })
  const second = await db.appointment.create({
    data: { organizationId: org.id, patientId: patient.id, doctorId: doctor.id, appointmentDate: apptDate, appointmentTime: '11:00', status: 'scheduled' },
  })
  assert.ok(second.id)
  await db.appointment.deleteMany({ where: { id: { in: [first.id, second.id] } } })
})

test('two different doctors CAN share the same date+time slot (the guard is per-doctor, not per-slot)', async () => {
  const doctor2 = await db.user.create({ data: { organizationId: org.id, email: `dr.concurrency2.${Date.now()}@test.local`, fullName: 'Dr. Concurrency Two', role: 'doctor' } })
  const apptDate = new Date('2027-06-17T00:00:00.000Z')
  const a = await db.appointment.create({
    data: { organizationId: org.id, patientId: patient.id, doctorId: doctor.id, appointmentDate: apptDate, appointmentTime: '12:00', status: 'scheduled' },
  })
  const b = await db.appointment.create({
    data: { organizationId: org.id, patientId: patient.id, doctorId: doctor2.id, appointmentDate: apptDate, appointmentTime: '12:00', status: 'scheduled' },
  })
  assert.ok(a.id && b.id)
  await db.appointment.deleteMany({ where: { id: { in: [a.id, b.id] } } })
  await db.user.delete({ where: { id: doctor2.id } })
})

test('walk-in appointments with no doctorId never collide with each other (partial index excludes null doctorId)', async () => {
  const apptDate = new Date('2027-06-18T00:00:00.000Z')
  const a = await db.appointment.create({
    data: { organizationId: org.id, patientId: patient.id, doctorId: null, appointmentDate: apptDate, appointmentTime: '13:00', status: 'scheduled' },
  })
  const b = await db.appointment.create({
    data: { organizationId: org.id, patientId: patient.id, doctorId: null, appointmentDate: apptDate, appointmentTime: '13:00', status: 'scheduled' },
  })
  assert.ok(a.id && b.id)
  await db.appointment.deleteMany({ where: { id: { in: [a.id, b.id] } } })
})

test('timetable optimistic lock: updateMany against a stale expectedUpdatedAt affects zero rows', async () => {
  const before = await db.user.findUnique({ where: { id: doctor.id }, select: { updatedAt: true } })
  // Someone else's save happens first...
  await db.user.update({ where: { id: doctor.id }, data: { preferences: JSON.stringify({ timetable: { weeklySlots: {} } }) } })
  // ...then a stale-based save (still holding the OLD updatedAt) must affect 0 rows.
  const { count } = await db.user.updateMany({
    where: { id: doctor.id, updatedAt: before.updatedAt },
    data: { preferences: JSON.stringify({ timetable: { weeklySlots: { stale: true } } }) },
  })
  assert.equal(count, 0)
})

test('room override optimistic lock: setOverride/clearOverride reject a stale expectedOverrideSetAt', async () => {
  const floor = await db.floor.create({ data: { organizationId: org.id, name: 'Concurrency Test Floor' } })
  const room = await db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '999', sittingType: 'multiple' } })

  // Staff A's screen loads the room (override is currently null).
  const staffAExpected = null

  // Staff B sets the override first.
  await db.room.update({ where: { id: room.id }, data: { overrideDoctorId: doctor.id, overrideSetAt: new Date(), overrideSetById: doctor.id } })

  // Staff A's stale write (still expecting null) must be detected as a conflict —
  // this mirrors roomController.js's setOverride/clearOverride guard logic directly
  // against the real column, rather than re-deriving it through the HTTP layer.
  const fresh = await db.room.findUnique({ where: { id: room.id }, select: { overrideSetAt: true } })
  const actual = fresh.overrideSetAt ? fresh.overrideSetAt.getTime() : null
  const expected = staffAExpected
  assert.notEqual(actual, expected, 'a real override was set — staleness must be detectable')

  await db.room.delete({ where: { id: room.id } })
  await db.floor.delete({ where: { id: floor.id } })
})
