// Regression tests for the Operation Theatre module — otController.js and
// ot/schedulingService.js.
//
// Every rule below was broken at some point while this module was written, and
// four of them were only found by running the code rather than reading it:
//   • a stored cleaningMinutes of -20 SHRANK the theatre's busy window, so a
//     case booked at 10:50 was accepted against one already running 10:00–11:00
//   • SCHEDULED jumped straight to COMPLETED, and COMPLETED went back to
//     CANCELLED — a surgery that happened, recorded as cancelled
//   • a theatre with a case still IN_THEATRE could be marked AVAILABLE by hand,
//     so the board said free while the room was not
//   • a booking accepted another hospital's patientId
//
// Real-database integration test, same disposable-org pattern as tenant.test.js.
// These are database rules; only a real database proves them.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import * as ot from '../../controllers/otController.js'

let ourOrg, otherOrg
let ourPatient, theirPatient, ourSurgeon, theirSurgeon, ourNurse
let theatreA, theatreB, retiredTheatre, surgery, admission

const stamp = Date.now()

// The controller talks to Express, so the tests hand it the two objects it uses
// and read the status + body back off the fake response.
function call(handler, { body = {}, query = {}, role = 'doctor', org } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(payload) { resolve({ code: this.statusCode, body: payload }) },
    }
    const req = {
      body,
      query,
      organizationId: org ?? ourOrg.id,
      user: { id: ourSurgeon?.id, fullName: ourSurgeon?.fullName, role },
      headers: {},
    }
    // `next` is the unhandled-error path; surface it rather than hanging.
    handler(req, res, (err) => resolve({ code: 'UNHANDLED', body: { error: err.message } }))
  })
}

const at = (isoLocal) => isoLocal // the controller parses local wall-clock strings

// A booking that should succeed, with only the given fields overridden.
const bookingBody = (extra = {}) => ({
  resource: 'booking',
  patientId: ourPatient.id,
  theatreId: theatreA.id,
  procedureName: 'Test Procedure',
  scheduledStart: at('2030-01-15T09:00'),
  estimatedMinutes: 60,
  primarySurgeonId: ourSurgeon.id,
  ...extra,
})

before(async () => {
  const org = (name, slug) => db.organization.create({ data: { name, slug } })
  ourOrg = await org('Test Org — otBooking (ours)', `test-ot-ours-${stamp}`)
  otherOrg = await org('Test Org — otBooking (theirs)', `test-ot-theirs-${stamp}`)

  const patient = (organizationId, tag) => db.patient.create({
    data: {
      organizationId,
      mrn: `TESTMRN-OT-${tag}-${stamp}`,
      firstName: 'OT',
      lastName: `Patient ${tag}`,
      gender: 'other',
      dateOfBirth: new Date('1990-01-01'),
    },
  })
  ourPatient = await patient(ourOrg.id, 'OURS')
  theirPatient = await patient(otherOrg.id, 'THEIRS')

  const user = (organizationId, tag, role) => db.user.create({
    data: { organizationId, email: `ot.${tag}.${stamp}@test.local`, fullName: `OT ${tag}`, role },
  })
  ourSurgeon = await user(ourOrg.id, 'surgeon', 'doctor')
  theirSurgeon = await user(otherOrg.id, 'theirsurgeon', 'doctor')
  ourNurse = await user(ourOrg.id, 'nurse', 'nurse')

  const theatre = (name, extra = {}) => db.operatingTheatre.create({
    data: { organizationId: ourOrg.id, name, cleaningMinutes: 30, ...extra },
  })
  theatreA = await theatre(`OT-A-${stamp}`)
  theatreB = await theatre(`OT-B-${stamp}`)
  retiredTheatre = await theatre(`OT-RETIRED-${stamp}`, { isActive: false })

  surgery = await db.surgeryCatalog.create({
    data: { organizationId: ourOrg.id, name: `Test Surgery ${stamp}`, defaultMinutes: 45 },
  })

  admission = await db.admission.create({
    data: { organizationId: ourOrg.id, patientId: ourPatient.id },
  })
})

after(async () => {
  const orgIds = [ourOrg?.id, otherOrg?.id].filter(Boolean)
  const where = { organizationId: { in: orgIds } }
  await db.otTeamMember.deleteMany({ where }).catch(() => {})
  await db.otBooking.deleteMany({ where }).catch(() => {})
  await db.operatingTheatre.deleteMany({ where }).catch(() => {})
  await db.surgeryCatalog.deleteMany({ where }).catch(() => {})
  await db.admission.deleteMany({ where }).catch(() => {})
  await db.patient.deleteMany({ where }).catch(() => {})
  await db.user.deleteMany({ where }).catch(() => {})
  await db.billCounter.deleteMany({ where }).catch(() => {})
  await db.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {})
})

// Removes everything booked by the tests so far, so each test starts on an
// empty theatre list and cannot be broken by the order they run in.
async function clearBookings() {
  await db.otTeamMember.deleteMany({ where: { organizationId: ourOrg.id } })
  await db.otBooking.deleteMany({ where: { organizationId: ourOrg.id } })
}

// ── Creating a booking ───────────────────────────────────────────────────────

test('a booking is created, numbered and defaulted', async () => {
  await clearBookings()
  const { code, body } = await call(ot.create, { body: bookingBody() })

  assert.equal(code, 201)
  assert.match(body.data.caseNumber, /^OT-\d{4}-\d{2}-\d{6}$/)
  assert.equal(body.data.status, 'SCHEDULED')
  assert.equal(body.data.priority, 'ELECTIVE')
  assert.equal(body.data.organizationId, ourOrg.id)
})

test('the catalogue supplies the procedure name and duration when none is sent', async () => {
  await clearBookings()
  const { code, body } = await call(ot.create, {
    body: bookingBody({ surgeryId: surgery.id, procedureName: undefined, estimatedMinutes: undefined }),
  })

  assert.equal(code, 201)
  assert.equal(body.data.procedureName, surgery.name)
  assert.equal(body.data.estimatedMinutes, 45)
})

test('a booking cannot be created without a procedure to call it', async () => {
  await clearBookings()
  const { code } = await call(ot.create, { body: bookingBody({ procedureName: '  ' }) })
  assert.equal(code, 400)
})

// ── Values that must not reach the database ──────────────────────────────────

test('an unknown priority is refused', async () => {
  await clearBookings()
  const { code, body } = await call(ot.create, { body: bookingBody({ priority: 'HACKED' }) })
  assert.equal(code, 400)
  assert.match(body.error, /priority must be one of/)
})

// Which knee, which eye, which kidney. A typo here is wrong-side surgery, and
// the column is a plain String — this check is the only thing standing in front
// of it.
test('an unknown laterality is refused', async () => {
  await clearBookings()
  const { code, body } = await call(ot.create, { body: bookingBody({ laterality: 'Lft' }) })
  assert.equal(code, 400)
  assert.match(body.error, /laterality must be one of/)
})

test('an unparseable date is refused, and says which field', async () => {
  await clearBookings()
  const { code, body } = await call(ot.create, { body: bookingBody({ scheduledStart: 'hello' }) })
  assert.equal(code, 400)
  assert.match(body.error, /scheduledStart/)
})

test('an end before the start is refused', async () => {
  await clearBookings()
  const { code } = await call(ot.create, {
    body: bookingBody({ scheduledStart: at('2030-01-15T10:00'), scheduledEnd: at('2030-01-15T09:00') }),
  })
  assert.equal(code, 400)
})

test('minutes must be a whole positive number', async () => {
  await clearBookings()
  for (const bad of ['abc', -30, 0, 45.7]) {
    const { code } = await call(ot.create, { body: bookingBody({ estimatedMinutes: bad }) })
    assert.equal(code, 400, `estimatedMinutes ${bad} should have been refused`)
  }
})

// A negative turnaround does not merely store a silly number: schedulingService
// WIDENS the theatre's busy window by it, so a negative value shrinks the window
// and overlapping cases stop being detected.
test('a negative cleaning time cannot be stored on a theatre', async () => {
  const { code, body } = await call(ot.update, {
    body: { resource: 'theatre', id: theatreA.id, cleaningMinutes: -20 },
    role: 'receptionist',
  })
  assert.equal(code, 400)
  assert.match(body.error, /cleaningMinutes/)

  const after = await db.operatingTheatre.findUnique({ where: { id: theatreA.id } })
  assert.equal(after.cleaningMinutes, 30)
})

test('a client cannot set the fields the server owns', async () => {
  await clearBookings()
  const { code, body } = await call(ot.create, {
    body: bookingBody({
      organizationId: otherOrg.id,
      caseNumber: 'HACKED-001',
      status: 'COMPLETED',
      actualStart: at('2020-01-01T00:00'),
    }),
  })

  assert.equal(code, 201)
  assert.equal(body.data.organizationId, ourOrg.id)
  assert.notEqual(body.data.caseNumber, 'HACKED-001')
  assert.equal(body.data.status, 'SCHEDULED')
  assert.equal(body.data.actualStart, null)
})

// ── Cross-tenant ─────────────────────────────────────────────────────────────

test("another hospital's patient cannot be booked", async () => {
  await clearBookings()
  const { code } = await call(ot.create, { body: bookingBody({ patientId: theirPatient.id }) })
  assert.equal(code, 404)
})

test("another hospital's surgeon cannot be booked", async () => {
  await clearBookings()
  const { code } = await call(ot.create, { body: bookingBody({ primarySurgeonId: theirSurgeon.id }) })
  assert.equal(code, 404)
})

test("another hospital's theatre cannot be booked", async () => {
  await clearBookings()
  const theirTheatre = await db.operatingTheatre.create({
    data: { organizationId: otherOrg.id, name: `OT-THEIRS-${stamp}` },
  })
  const { code } = await call(ot.create, { body: bookingBody({ theatreId: theirTheatre.id }) })
  assert.equal(code, 404)
})

// ── The three clashes ────────────────────────────────────────────────────────

test('a theatre already busy at that time is refused, cleaning gap included', async () => {
  await clearBookings()
  await call(ot.create, { body: bookingBody({ scheduledStart: at('2030-02-01T09:00') }) })

  // 10:15 is after the 09:00–10:00 case but inside its 30-minute turnaround.
  const { code, body } = await call(ot.create, {
    body: bookingBody({ scheduledStart: at('2030-02-01T10:15') }),
  })
  assert.equal(code, 409)
  assert.equal(body.code, 'OT_THEATRE_BUSY')
})

test('the same theatre is free once the cleaning gap has passed', async () => {
  await clearBookings()
  await call(ot.create, { body: bookingBody({ scheduledStart: at('2030-02-02T09:00') }) })

  const { code } = await call(ot.create, {
    body: bookingBody({ scheduledStart: at('2030-02-02T10:31') }),
  })
  assert.equal(code, 201)
})

test('a surgeon cannot be in two theatres at once', async () => {
  await clearBookings()
  await call(ot.create, { body: bookingBody({ scheduledStart: at('2030-02-03T09:00') }) })

  const { code, body } = await call(ot.create, {
    body: bookingBody({ theatreId: theatreB.id, scheduledStart: at('2030-02-03T09:30') }),
  })
  assert.equal(code, 409)
  assert.equal(body.code, 'OT_SURGEON_BUSY')
})

test('a patient cannot be in two theatres at once', async () => {
  await clearBookings()
  const otherSurgeon = await db.user.create({
    data: { organizationId: ourOrg.id, email: `ot.surgeon2.${stamp}@test.local`, fullName: 'OT Surgeon 2', role: 'doctor' },
  })
  await call(ot.create, { body: bookingBody({ scheduledStart: at('2030-02-04T09:00') }) })

  const { code, body } = await call(ot.create, {
    body: bookingBody({
      theatreId: theatreB.id,
      primarySurgeonId: otherSurgeon.id,
      scheduledStart: at('2030-02-04T09:30'),
    }),
  })
  assert.equal(code, 409)
  assert.equal(body.code, 'OT_PATIENT_BUSY')
})

test('a retired theatre cannot be booked', async () => {
  await clearBookings()
  const { code, body } = await call(ot.create, { body: bookingBody({ theatreId: retiredTheatre.id }) })
  assert.equal(code, 400)
  assert.match(body.error, /not in service/)
})

// ── Moving a case along the day ──────────────────────────────────────────────

async function bookingAt(status, extra = {}) {
  await clearBookings()
  return db.otBooking.create({
    data: {
      organizationId: ourOrg.id,
      patientId: ourPatient.id,
      theatreId: theatreA.id,
      caseNumber: `OT-TEST-${Math.random().toString(36).slice(2, 10)}`,
      procedureName: 'Transition Test',
      scheduledStart: new Date('2030-03-01T09:00:00'),
      scheduledEnd: new Date('2030-03-01T10:00:00'),
      primarySurgeonId: ourSurgeon.id,
      status,
      ...extra,
    },
  })
}

test('cancelling without a reason is refused', async () => {
  const booking = await bookingAt('SCHEDULED')
  const { code, body } = await call(ot.update, {
    body: { resource: 'status', id: booking.id, status: 'CANCELLED' },
  })
  assert.equal(code, 400)
  assert.match(body.error, /reason is required to cancel/)
})

test('postponing without a reason is refused', async () => {
  const booking = await bookingAt('SCHEDULED')
  const { code, body } = await call(ot.update, {
    body: { resource: 'status', id: booking.id, status: 'POSTPONED' },
  })
  assert.equal(code, 400)
  assert.match(body.error, /reason is required to postpone/)
})

test('a reason is kept on the record', async () => {
  const booking = await bookingAt('SCHEDULED')
  await call(ot.update, {
    body: { resource: 'status', id: booking.id, status: 'POSTPONED', reason: 'List ran over' },
  })
  const after = await db.otBooking.findUnique({ where: { id: booking.id } })
  assert.equal(after.status, 'POSTPONED')
  assert.equal(after.postponeReason, 'List ran over')
})

// Vitals, nursing notes and OT charges all key on the admission, so a patient
// cannot enter the theatre without one.
test('a case cannot enter the theatre before the patient is admitted', async () => {
  const booking = await bookingAt('CHECKED_IN')
  const { code, body } = await call(ot.update, {
    body: { resource: 'status', id: booking.id, status: 'IN_THEATRE' },
  })
  assert.equal(code, 409)
  assert.equal(body.code, 'OT_NO_ADMISSION')
})

test('a scheduled case cannot jump straight to completed', async () => {
  const booking = await bookingAt('SCHEDULED')
  const { code, body } = await call(ot.update, {
    body: { resource: 'status', id: booking.id, status: 'COMPLETED' },
  })
  assert.equal(code, 409)
  assert.equal(body.code, 'OT_BAD_TRANSITION')
})

// A surgery that physically happened, recorded as cancelled, with the bill
// following the record.
test('a completed case cannot be cancelled or reopened', async () => {
  for (const target of ['CANCELLED', 'SCHEDULED']) {
    const booking = await bookingAt('COMPLETED')
    const { code, body } = await call(ot.update, {
      body: { resource: 'status', id: booking.id, status: target, reason: 'test' },
    })
    assert.equal(code, 409, `COMPLETED should not move to ${target}`)
    assert.equal(body.code, 'OT_BAD_TRANSITION')
  }
})

test('a postponed case can be re-booked', async () => {
  const booking = await bookingAt('POSTPONED')
  const { code } = await call(ot.update, {
    body: { resource: 'status', id: booking.id, status: 'SCHEDULED' },
  })
  assert.equal(code, 200)
})

test('a completed case cannot be rescheduled', async () => {
  const booking = await bookingAt('COMPLETED')
  const { code } = await call(ot.update, {
    body: { resource: 'reschedule', id: booking.id, scheduledStart: at('2030-03-02T09:00') },
  })
  assert.equal(code, 409)
})

// ── The theatre board must agree with the cases ──────────────────────────────

test('the theatre follows the case into and out of the room', async () => {
  const booking = await bookingAt('CHECKED_IN', { admissionId: admission.id })
  await db.operatingTheatre.update({ where: { id: theatreA.id }, data: { status: 'AVAILABLE' } })

  await call(ot.update, { body: { resource: 'status', id: booking.id, status: 'IN_THEATRE' } })
  let theatre = await db.operatingTheatre.findUnique({ where: { id: theatreA.id } })
  assert.equal(theatre.status, 'OCCUPIED')

  await call(ot.update, { body: { resource: 'status', id: booking.id, status: 'COMPLETED' } })
  theatre = await db.operatingTheatre.findUnique({ where: { id: theatreA.id } })
  assert.equal(theatre.status, 'CLEANING')
})

test('OCCUPIED and CLEANING cannot be set by hand — they follow the case', async () => {
  for (const status of ['OCCUPIED', 'CLEANING']) {
    const { code, body } = await call(ot.update, {
      body: { resource: 'theatre', id: theatreB.id, status },
      role: 'receptionist',
    })
    assert.equal(code, 400, `${status} should not be settable by hand`)
    assert.match(body.error, /AVAILABLE, MAINTENANCE/)
  }
})

test('a theatre with a case in it cannot be re-labelled or retired', async () => {
  const booking = await bookingAt('CHECKED_IN', { admissionId: admission.id })
  await call(ot.update, { body: { resource: 'status', id: booking.id, status: 'IN_THEATRE' } })

  const labelled = await call(ot.update, {
    body: { resource: 'theatre', id: theatreA.id, status: 'AVAILABLE' },
    role: 'receptionist',
  })
  assert.equal(labelled.code, 409)
  assert.equal(labelled.body.code, 'OT_THEATRE_IN_USE')

  const retired = await call(ot.remove, {
    query: { resource: 'theatre', id: theatreA.id },
    role: 'receptionist',
  })
  assert.equal(retired.code, 409)

  // Leave the theatre usable for whatever runs next.
  await call(ot.update, { body: { resource: 'status', id: booking.id, status: 'COMPLETED' } })
  await db.operatingTheatre.update({
    where: { id: theatreA.id },
    data: { status: 'AVAILABLE', isActive: true },
  })
})

// ── Who may do what ──────────────────────────────────────────────────────────
// Skipped unless AUTH_ENFORCED is on, because ipdAllowed() is deliberately a
// no-op without it and every assertion below would pass for the wrong reason.

const rbacOn = process.env.AUTH_ENFORCED === 'true'

test('a receptionist may book but may not cancel', { skip: !rbacOn }, async () => {
  const booking = await bookingAt('SCHEDULED')
  const { code, body } = await call(ot.update, {
    body: { resource: 'status', id: booking.id, status: 'CANCELLED', reason: 'no longer needed' },
    role: 'receptionist',
  })
  assert.equal(code, 403)
  assert.equal(body.code, 'FORBIDDEN')
})

test('a nurse may move a case along but may not book one', { skip: !rbacOn }, async () => {
  await clearBookings()
  const { code } = await call(ot.create, { body: bookingBody(), role: 'nurse' })
  assert.equal(code, 403)
})

// ── Reads ────────────────────────────────────────────────────────────────────

test('the list sends only what the board renders', async () => {
  await clearBookings()
  await call(ot.create, { body: bookingBody({ scheduledStart: at('2030-04-01T09:00') }) })

  const { body } = await call(ot.getAll, { query: { resource: 'bookings' } })
  const row = body.data[0]

  assert.ok(row.caseNumber && row.patient && row.surgeon)
  // These belong to the detail view; sending them on every row of a 200-case
  // day was measured at 368 KB against 107 KB without them.
  assert.equal(row.team, undefined)
  assert.equal(row.anaesthetist, undefined)
  assert.equal(row.notes, undefined)
})

test('the detail read returns the whole case', async () => {
  await clearBookings()
  const created = await call(ot.create, {
    body: bookingBody({ scheduledStart: at('2030-04-02T09:00'), surgeryId: surgery.id }),
  })

  const { body } = await call(ot.getAll, {
    query: { resource: 'booking', id: created.body.data.id },
  })
  assert.ok(Array.isArray(body.data.team))
  assert.equal(body.data.surgery.name, surgery.name)
})

test('a detail read without an id is refused rather than returning someone else', async () => {
  const { code } = await call(ot.getAll, { query: { resource: 'booking' } })
  assert.equal(code, 400)
})

test('a retired theatre is hidden from the list unless asked for', async () => {
  const hidden = await call(ot.getAll, { query: { resource: 'theatres' } })
  assert.equal(hidden.body.data.some((t) => t.id === retiredTheatre.id), false)

  const shown = await call(ot.getAll, { query: { resource: 'theatres', includeInactive: 'true' } })
  assert.equal(shown.body.data.some((t) => t.id === retiredTheatre.id), true)
})

// ── The team ─────────────────────────────────────────────────────────────────

test('an unknown team role is rejected, not silently dropped', async () => {
  await clearBookings()
  const { code, body } = await call(ot.create, {
    body: bookingBody({
      scheduledStart: at('2030-05-01T09:00'),
      team: [{ role: 'SCRUB NURSE', memberName: 'Sunita' }], // space, not underscore
    }),
  })
  assert.equal(code, 400)
  assert.match(body.error, /Team role must be one of/)
})

test('a team member with no login is recorded as external', async () => {
  await clearBookings()
  const created = await call(ot.create, {
    body: bookingBody({
      scheduledStart: at('2030-05-02T09:00'),
      team: [
        { role: 'PRIMARY_SURGEON', userId: ourSurgeon.id, memberName: ourSurgeon.fullName },
        { role: 'ANAESTHETIST', memberName: 'Dr. Visiting' },
      ],
    }),
  })
  assert.equal(created.code, 201)

  const team = await db.otTeamMember.findMany({ where: { bookingId: created.body.data.id } })
  assert.equal(team.length, 2)
  assert.equal(team.find((m) => m.role === 'ANAESTHETIST').isExternal, true)
  assert.equal(team.find((m) => m.role === 'PRIMARY_SURGEON').isExternal, false)
})

test("a team member from another hospital is refused", async () => {
  await clearBookings()
  const { code } = await call(ot.create, {
    body: bookingBody({
      scheduledStart: at('2030-05-03T09:00'),
      team: [{ role: 'SCRUB_NURSE', userId: theirSurgeon.id, memberName: 'Theirs' }],
    }),
  })
  assert.equal(code, 404)
})

// ── Retiring, not deleting ───────────────────────────────────────────────────

test('a theatre is retired, never deleted — a past case must still resolve it', async () => {
  const doomed = await db.operatingTheatre.create({
    data: { organizationId: ourOrg.id, name: `OT-DOOMED-${stamp}` },
  })
  const { code } = await call(ot.remove, {
    query: { resource: 'theatre', id: doomed.id },
    role: 'receptionist',
  })
  assert.equal(code, 200)

  const still = await db.operatingTheatre.findUnique({ where: { id: doomed.id } })
  assert.ok(still, 'the row must still exist')
  assert.equal(still.isActive, false)
})
