// Real-database integration test — not the pure-function unit tests in
// activeDoctor.test.js. This exercises actual Prisma writes/reads against
// the local dev Postgres to verify what actually gets stored (constraints,
// cascades, FK behaviour), the same way the app's own controllers would.
//
// Runs inside one disposable Organization created in `before` and torn down
// in `after`, in explicit dependency order — this must never touch real
// seeded data.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { resolveActiveDoctor } from '../activeDoctor.js'
import { deriveRoomAndVisitType } from '../queueDerivation.js'
import { parseTimetable } from '../doctorTimetable.js'

let org, docA, docB, floor

before(async () => {
  org = await db.organization.create({ data: { name: 'Test Org — room.storage.test.js', slug: `test-room-storage-${Date.now()}` } })
  docA = await db.user.create({ data: { organizationId: org.id, email: `dr.a.${Date.now()}@test.local`, fullName: 'Dr. Test Alpha', role: 'doctor' } })
  docB = await db.user.create({ data: { organizationId: org.id, email: `dr.b.${Date.now()}@test.local`, fullName: 'Dr. Test Beta', role: 'doctor' } })
  floor = await db.floor.create({ data: { organizationId: org.id, name: '1st Floor' } })
})

after(async () => {
  // Reverse dependency order — no reliance on cascade behaviour for cleanup,
  // so the test cleans up correctly even if a cascade rule ever changes.
  await db.doctorRoomAssignment.deleteMany({ where: { organizationId: org.id } })
  await db.room.deleteMany({ where: { organizationId: org.id } })
  await db.floor.deleteMany({ where: { organizationId: org.id } })
  await db.user.deleteMany({ where: { organizationId: org.id } })
  await db.organization.delete({ where: { id: org.id } })
})

test('Room round-trips sittingType, roomNumber, and floor/department scoping', async () => {
  const room = await db.room.create({
    data: { organizationId: org.id, floorId: floor.id, roomNumber: '204', sittingType: 'single' },
  })
  const fetched = await db.room.findUnique({ where: { id: room.id } })
  assert.equal(fetched.roomNumber, '204')
  assert.equal(fetched.sittingType, 'single')
  assert.equal(fetched.organizationId, org.id)
  await db.room.delete({ where: { id: room.id } })
})

test('Room_organizationId_floorId_roomNumber_key rejects a duplicate room number on the same floor', async () => {
  const r1 = await db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '205', sittingType: 'single' } })
  await assert.rejects(
    () => db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '205', sittingType: 'single' } }),
    (err) => err.code === 'P2002',
  )
  await db.room.delete({ where: { id: r1.id } })
})

test('DoctorRoomAssignment is unique per (doctor, room) — the same doctor cannot be linked twice', async () => {
  const room = await db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '206', sittingType: 'multiple' } })
  await db.doctorRoomAssignment.create({ data: { organizationId: org.id, roomId: room.id, doctorId: docA.id } })
  await assert.rejects(
    () => db.doctorRoomAssignment.create({ data: { organizationId: org.id, roomId: room.id, doctorId: docA.id } }),
    (err) => err.code === 'P2002',
  )
  await db.doctorRoomAssignment.deleteMany({ where: { roomId: room.id } })
  await db.room.delete({ where: { id: room.id } })
})

test('full round trip: shared room + two doctors\' OWN timetables resolves the right doctor from REAL stored data', async () => {
  const room = await db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '207', sittingType: 'multiple' } })
  const tt = (start, end) => JSON.stringify({ timetable: { weeklySlots: { Monday: { active: true, shifts: [{ start, end, roomId: room.id }] } } } })
  await db.user.update({ where: { id: docA.id }, data: { preferences: tt('09:00', '13:00') } })
  await db.user.update({ where: { id: docB.id }, data: { preferences: tt('14:00', '18:00') } })
  await db.doctorRoomAssignment.createMany({
    data: [
      { organizationId: org.id, roomId: room.id, doctorId: docA.id },
      { organizationId: org.id, roomId: room.id, doctorId: docB.id },
    ],
  })

  // Re-fetch from the DB exactly the way roomController.getRoom does — this
  // is the "does what's stored actually resolve correctly" check, not a
  // hand-built fixture like activeDoctor.test.js uses.
  const fetched = await db.room.findUnique({
    where: { id: room.id },
    include: { doctorLinks: { include: { doctor: { select: { id: true, fullName: true, preferences: true } } } } },
  })
  const candidates = fetched.doctorLinks.map((l) => ({
    doctorId: l.doctorId, doctorName: l.doctor.fullName, timetable: parseTimetable(l.doctor.preferences),
  }))

  const morning = resolveActiveDoctor(room.id, candidates, { now: { hhmm: '10:00', dayOfWeek: 1 } })
  assert.equal(morning.doctorId, docA.id)

  const evening = resolveActiveDoctor(room.id, candidates, { now: { hhmm: '15:00', dayOfWeek: 1 } })
  assert.equal(evening.doctorId, docB.id)

  await db.doctorRoomAssignment.deleteMany({ where: { roomId: room.id } })
  await db.room.delete({ where: { id: room.id } })
  await db.user.updateMany({ where: { id: { in: [docA.id, docB.id] } }, data: { preferences: null } })
})

test('deleting a Room cascades its OWN doctorLinks index, but leaves the doctor User and sibling rooms untouched', async () => {
  const roomToDelete = await db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '208', sittingType: 'multiple' } })
  const siblingRoom = await db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '209', sittingType: 'single' } })
  await db.doctorRoomAssignment.create({ data: { organizationId: org.id, roomId: roomToDelete.id, doctorId: docA.id } })
  await db.doctorRoomAssignment.create({ data: { organizationId: org.id, roomId: siblingRoom.id, doctorId: docA.id } })

  await db.room.delete({ where: { id: roomToDelete.id } })

  const remainingLinks = await db.doctorRoomAssignment.findMany({ where: { roomId: roomToDelete.id } })
  assert.equal(remainingLinks.length, 0)

  const doctorStillExists = await db.user.findUnique({ where: { id: docA.id } })
  assert.ok(doctorStillExists, 'doctor User row must survive a room delete')

  const siblingStillLinked = await db.doctorRoomAssignment.findFirst({ where: { roomId: siblingRoom.id, doctorId: docA.id } })
  assert.ok(siblingStillLinked, 'the sibling room\'s own link must be untouched by an unrelated room delete')

  await db.doctorRoomAssignment.deleteMany({ where: { roomId: siblingRoom.id } })
  await db.room.delete({ where: { id: siblingRoom.id } })
})

test('Room.overrideDoctorId is SET NULL (not blocked, not left dangling) when the override doctor is deleted', async () => {
  const tempDoctor = await db.user.create({ data: { organizationId: org.id, email: `dr.temp.${Date.now()}@test.local`, fullName: 'Dr. Temp Cover', role: 'doctor' } })
  const room = await db.room.create({
    data: { organizationId: org.id, floorId: floor.id, roomNumber: '210', sittingType: 'multiple', overrideDoctorId: tempDoctor.id, overrideSetAt: new Date() },
  })

  await db.user.delete({ where: { id: tempDoctor.id } })

  const fetched = await db.room.findUnique({ where: { id: room.id } })
  assert.equal(fetched.overrideDoctorId, null)

  await db.room.delete({ where: { id: room.id } })
})

test('QueueManagement.visitType defaults to "new" and prescriptionUploadedAt/followUpDoctorId round-trip correctly', async () => {
  const patient = await db.patient.create({
    data: { organizationId: org.id, firstName: 'Test', lastName: 'Patient', mrn: `TESTMRN-${Date.now()}`, gender: 'other', dateOfBirth: new Date('1990-01-01') },
  })

  const walkIn = await db.queueManagement.create({
    data: { organizationId: org.id, patientId: patient.id, serviceArea: 'opd', queueNumber: `TEST-${Date.now()}` },
  })
  assert.equal(walkIn.visitType, 'new')
  assert.equal(walkIn.prescriptionUploadedAt, null)
  assert.equal(walkIn.followUpDoctorId, null)

  const followUp = await db.queueManagement.create({
    data: {
      organizationId: org.id, patientId: patient.id, serviceArea: 'opd', queueNumber: `TEST-${Date.now()}-2`,
      visitType: 'follow_up', followUpDoctorId: docA.id, prescriptionUploadedAt: new Date(),
    },
  })
  const fetched = await db.queueManagement.findUnique({ where: { id: followUp.id }, include: { followUpDoctor: { select: { fullName: true } } } })
  assert.equal(fetched.visitType, 'follow_up')
  assert.equal(fetched.followUpDoctor.fullName, 'Dr. Test Alpha')
  assert.ok(fetched.prescriptionUploadedAt instanceof Date)

  await db.queueManagement.deleteMany({ where: { patientId: patient.id } })
  await db.patient.delete({ where: { id: patient.id } })
})

// ---------- deriveRoomAndVisitType (check-in auto-fill, no staff picker) ----------

test('deriveRoomAndVisitType: no doctorId → new visit, no room, no DB queries needed', async () => {
  const r = await deriveRoomAndVisitType({ doctorId: null, patientId: 'irrelevant' })
  assert.deepEqual(r, { roomId: null, visitType: 'new' })
})

test('deriveRoomAndVisitType: doctor linked to a room, patient never seen them before → new + that room', async () => {
  const room = await db.room.create({ data: { organizationId: org.id, floorId: floor.id, roomNumber: '401', sittingType: 'single' } })
  await db.doctorRoomAssignment.create({ data: { organizationId: org.id, roomId: room.id, doctorId: docA.id } })
  const patient = await db.patient.create({
    data: { organizationId: org.id, firstName: 'Fresh', lastName: 'Patient', mrn: `TESTMRN-${Date.now()}`, gender: 'other', dateOfBirth: new Date('1990-01-01') },
  })

  const r = await deriveRoomAndVisitType({ doctorId: docA.id, patientId: patient.id })
  assert.equal(r.roomId, room.id)
  assert.equal(r.visitType, 'new')

  await db.patient.delete({ where: { id: patient.id } })
  await db.doctorRoomAssignment.deleteMany({ where: { roomId: room.id } })
  await db.room.delete({ where: { id: room.id } })
})

test('deriveRoomAndVisitType: patient has a prior Consultation with this doctor → follow_up', async () => {
  const patient = await db.patient.create({
    data: { organizationId: org.id, firstName: 'Returning', lastName: 'Patient', mrn: `TESTMRN-${Date.now()}`, gender: 'other', dateOfBirth: new Date('1990-01-01') },
  })
  await db.consultation.create({
    data: { organizationId: org.id, patientId: patient.id, doctorId: docA.id, visitDate: new Date(), visitType: 'outpatient' },
  })

  const r = await deriveRoomAndVisitType({ doctorId: docA.id, patientId: patient.id })
  assert.equal(r.visitType, 'follow_up')

  await db.consultation.deleteMany({ where: { patientId: patient.id } })
  await db.patient.delete({ where: { id: patient.id } })
})

test('deriveRoomAndVisitType: doctor has NO room link → roomId null, visitType still derived correctly', async () => {
  const r = await deriveRoomAndVisitType({ doctorId: docB.id, patientId: null })
  assert.equal(r.roomId, null)
  assert.equal(r.visitType, 'new')
})
