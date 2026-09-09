// The appointment feed the doctor portal's backend reads.
//
// Drives the real Express app over HTTP, the same harness otHttp.test.js uses,
// because the things most likely to be wrong live in that layer: the route sits
// ABOVE `authenticate`, so a mistake there exposes patient names to anyone who
// finds the URL.
//
// The response shape is asserted field by field against what the portal's own
// calendar parses — verified against apitest.gudmed.in on 9 Sept 2026. Its
// components split scheduleDate on '-', scheduleTime on ' ' then ':', and test
// the modifier against 'PM'. Getting a format wrong here does not degrade the
// portal, it takes the page down.
//
// Run: node --test --test-force-exit src/lib/__tests__/partnerApi.test.js
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import cookieParser from 'cookie-parser'
import { db } from '../../config/db.js'
import { router as apiRouter } from '../../routes/index.js'
import { errorHandler } from '../../middleware/errorHandler.js'

const stamp = `PARTNER-${Date.now()}`
const SECRET = `test-secret-${stamp}`

let server, baseUrl
let ourOrg, otherOrg, ourDoctor, theirDoctor, ourPatient, theirPatient

async function get(path, { key = SECRET } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: key === null ? {} : { 'x-partner-key': key },
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: res.status, body: json, text }
}

const feed = (params, opts) =>
  get(`/api/partner/appointments?${new URLSearchParams(params)}`, opts)

// A booking on a given day. `time` is the HMS's own 24-hour string.
async function appointment({ org = ourOrg, doctor = ourDoctor, patient = ourPatient,
  date, time = '10:00', status = 'scheduled' } = {}) {
  return db.appointment.create({
    data: {
      organizationId: org.id,
      patientId: patient.id,
      doctorId: doctor.id,
      appointmentDate: new Date(`${date}T00:00:00`),
      appointmentTime: time,
      status,
    },
  })
}

before(async () => {
  process.env.DOCTOR_PORTAL_PARTNER_SECRET = SECRET

  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/api', apiRouter)
  app.use(errorHandler)
  await new Promise((resolve) => { server = app.listen(0, resolve) })
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const org = (tag) => db.organization.create({
    data: { name: `${stamp} ${tag}`, slug: `${stamp}-${tag}`.toLowerCase() },
  })
  ourOrg = await org('A')
  otherOrg = await org('B')

  const doctor = (organizationId, tag) => db.user.create({
    data: {
      organizationId, email: `${stamp}.${tag}@partner.local`.toLowerCase(),
      fullName: `Dr ${tag}`, role: 'doctor',
    },
  })
  ourDoctor = await doctor(ourOrg.id, 'ours')
  theirDoctor = await doctor(otherOrg.id, 'theirs')

  const patient = (organizationId, tag) => db.patient.create({
    data: {
      organizationId, mrn: `${stamp}-${tag}`,
      firstName: 'Rohit', middleName: 'Kumar', lastName: 'Sharma',
      gender: 'male', dateOfBirth: new Date('1990-01-01'),
      phonePrimary: '9876543210',
    },
  })
  ourPatient = await patient(ourOrg.id, 'OURS')
  theirPatient = await patient(otherOrg.id, 'THEIRS')
})

after(async () => {
  const orgs = { in: [ourOrg.id, otherOrg.id] }
  await db.appointment.deleteMany({ where: { organizationId: orgs } }).catch(() => {})
  await db.patient.deleteMany({ where: { organizationId: orgs } }).catch(() => {})
  await db.user.deleteMany({ where: { organizationId: orgs } }).catch(() => {})
  await db.organization.deleteMany({ where: { id: orgs } }).catch(() => {})
  await new Promise((r) => server.close(r))
  await db.$disconnect()
})

// ── The key ─────────────────────────────────────────────────────────────────

describe('the partner key', () => {
  test('no key is refused', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-01-01', to: '2031-01-07' }, { key: null })
    assert.equal(res.status, 401)
    assert.deepEqual(res.body.body, {}, 'a refusal carries no data')
  })

  test('a wrong key is refused', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-01-01', to: '2031-01-07' }, { key: 'wrong' })
    assert.equal(res.status, 401)
  })

  // A key of the right length but wrong content takes the same path as one of
  // the wrong length — the comparison must not stop at the first bad byte.
  test('a key of the same length but different content is refused', async () => {
    const same = 'x'.repeat(SECRET.length)
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-01-01', to: '2031-01-07' }, { key: same })
    assert.equal(res.status, 401)
  })

  test('with no secret configured, everything is refused', async () => {
    const saved = process.env.DOCTOR_PORTAL_PARTNER_SECRET
    delete process.env.DOCTOR_PORTAL_PARTNER_SECRET
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-01-01', to: '2031-01-07' })
    process.env.DOCTOR_PORTAL_PARTNER_SECRET = saved
    assert.equal(res.status, 401, 'fails closed — an unset secret must not open the door')
  })
})

// ── The shape the portal parses ─────────────────────────────────────────────

describe('the response shape', () => {
  test('a booking comes back in exactly the fields the portal reads', async () => {
    await appointment({ date: '2031-03-05', time: '10:15' })
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-03-01', to: '2031-03-31' })

    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body.body).sort(), ['completedData', 'upcomingData'])

    const row = res.body.body.upcomingData[0]
    assert.ok(row, 'the booking should be in upcomingData')
    assert.deepEqual(Object.keys(row).sort(), [
      'appointmentFlag', 'callbackNumber', 'city', 'endTime', 'hospitalName',
      'mobileNo', 'patname', 'pincode', 'scheduleDate', 'scheduleTime',
    ], 'no field beyond what the portal renders')
  })

  // The middle name is the one most often dropped, and the patient is named on
  // a doctor's screen — "Rohit Sharma" for a patient registered as
  // "Rohit Kumar Sharma" is the wrong person to the doctor reading it.
  test('the patient is named in full', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-03-01', to: '2031-03-31' })
    assert.equal(res.body.body.upcomingData[0].patname, 'Rohit Kumar Sharma')
  })

  test('the date is DD-MM-YYYY, which is how the calendar splits it', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-03-01', to: '2031-03-31' })
    const [d, m, y] = res.body.body.upcomingData[0].scheduleDate.split('-')
    assert.deepEqual([d, m, y], ['05', '03', '2031'])
  })

  // Upcoming.jsx: scheduleTime.split(' ') → [time, modifier], then
  // time.split(':') → [hours, minutes], then modifier === 'PM'.
  test('the time is hh:mm AM/PM, parsed the way the calendar parses it', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-03-01', to: '2031-03-31' })
    const [time, modifier] = res.body.body.upcomingData[0].scheduleTime.split(' ')
    const [hours, minutes] = time.split(':')
    assert.equal(modifier, 'AM')
    assert.equal(hours, '10')
    assert.equal(minutes, '15')
  })

  test('afternoon reads as PM, and noon and midnight do not read as zero', async () => {
    await appointment({ date: '2031-04-01', time: '13:30' })
    await appointment({ date: '2031-04-02', time: '12:00' })
    await appointment({ date: '2031-04-03', time: '00:30' })
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-04-01', to: '2031-04-30' })
    const times = res.body.body.upcomingData.map((r) => r.scheduleTime)
    assert.ok(times.includes('01:30 PM'), `13:30 → 01:30 PM, got ${times}`)
    assert.ok(times.includes('12:00 PM'), `12:00 → 12:00 PM, got ${times}`)
    assert.ok(times.includes('12:30 AM'), `00:30 → 12:30 AM, got ${times}`)
  })

  test('endTime is the start plus the hospital\'s own slot length', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-03-01', to: '2031-03-31' })
    // Default 30 minutes when the organisation has not set its own.
    assert.equal(res.body.body.upcomingData[0].endTime, '10:45 AM')
  })

  test('a booking with an unreadable time is dropped, not returned as null', async () => {
    await appointment({ date: '2031-05-10', time: '' })
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-05-01', to: '2031-05-31' })
    assert.equal(res.status, 200)
    for (const row of res.body.body.upcomingData) {
      assert.ok(row.scheduleTime, 'a null here takes the portal calendar down')
      assert.ok(row.endTime)
      assert.ok(row.scheduleDate)
    }
  })
})

// ── Which appointments appear ───────────────────────────────────────────────

describe('what the feed includes', () => {
  test('completed bookings go in completedData, not upcomingData', async () => {
    await appointment({ date: '2031-06-10', time: '09:00', status: 'completed' })
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-06-01', to: '2031-06-30' })
    assert.equal(res.body.body.completedData.length, 1)
    assert.equal(res.body.body.upcomingData.length, 0)
  })

  // The portal has no way to show "cancelled", so a cancelled case listed as
  // upcoming reads to the doctor as a live booking.
  test('cancelled and no-show bookings appear in neither list', async () => {
    await appointment({ date: '2031-07-10', time: '09:00', status: 'cancelled' })
    await appointment({ date: '2031-07-11', time: '09:00', status: 'no_show' })
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-07-01', to: '2031-07-31' })
    assert.equal(res.body.body.upcomingData.length, 0)
    assert.equal(res.body.body.completedData.length, 0)
  })

  test('a doctor with nothing booked gets empty lists, not a 404', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2035-01-01', to: '2035-01-31' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.body.upcomingData, [])
    assert.deepEqual(res.body.body.completedData, [])
  })

  test('only the named doctor\'s bookings come back', async () => {
    const other = await db.user.create({
      data: {
        organizationId: ourOrg.id, email: `${stamp}.second@partner.local`,
        fullName: 'Dr Second', role: 'doctor',
      },
    })
    await appointment({ date: '2031-08-05', time: '11:00', doctor: other })
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-08-01', to: '2031-08-31' })
    assert.equal(res.body.body.upcomingData.length, 0, 'another doctor\'s list must not leak into this one')
  })
})

// ── Tenant isolation ────────────────────────────────────────────────────────

describe('one hospital cannot read another', () => {
  test('a doctor from another hospital returns their own data, never ours', async () => {
    await appointment({ date: '2031-09-05', time: '10:00' })
    await appointment({ org: otherOrg, doctor: theirDoctor, patient: theirPatient, date: '2031-09-05', time: '14:00' })

    const res = await feed({ doctorEmail: theirDoctor.email, from: '2031-09-01', to: '2031-09-30' })
    assert.equal(res.status, 200)
    const times = res.body.body.upcomingData.map((r) => r.scheduleTime)
    assert.deepEqual(times, ['02:00 PM'], 'only the other hospital\'s own booking')
  })

  test('the hospital is never taken from the request', async () => {
    // organizationId is not a parameter this endpoint accepts; sending one must
    // change nothing.
    const res = await feed({
      doctorEmail: ourDoctor.email, from: '2031-09-01', to: '2031-09-30',
      organizationId: otherOrg.id,
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.body.upcomingData.length, 1, 'still only our own hospital\'s booking')
  })
})

// ── Input ───────────────────────────────────────────────────────────────────

describe('input', () => {
  test('an unknown email is a 404 that says nothing about the address', async () => {
    const res = await feed({ doctorEmail: 'nobody@nowhere.local', from: '2031-01-01', to: '2031-01-07' })
    assert.equal(res.status, 404)
    assert.doesNotMatch(res.body.message, /nobody@nowhere/, 'must not echo the address back')
  })

  test('a non-doctor account is not found either', async () => {
    const nurse = await db.user.create({
      data: {
        organizationId: ourOrg.id, email: `${stamp}.nurse@partner.local`,
        fullName: 'A Nurse', role: 'nurse',
      },
    })
    const res = await feed({ doctorEmail: nurse.email, from: '2031-01-01', to: '2031-01-07' })
    assert.equal(res.status, 404)
  })

  test('email matching ignores case and stray spaces', async () => {
    const res = await feed({
      doctorEmail: `  ${ourDoctor.email.toUpperCase()}  `,
      from: '2031-03-01', to: '2031-03-31',
    })
    assert.equal(res.status, 200)
    assert.ok(res.body.body.upcomingData.length > 0)
  })

  test('a missing email or missing dates are refused', async () => {
    assert.equal((await feed({ from: '2031-01-01', to: '2031-01-07' })).status, 400)
    assert.equal((await feed({ doctorEmail: ourDoctor.email })).status, 400)
    assert.equal((await feed({ doctorEmail: ourDoctor.email, from: '2031-01-01' })).status, 400)
  })

  test('30 February is refused rather than rolled into March', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-02-30', to: '2031-03-05' })
    assert.equal(res.status, 400)
  })

  test('a backwards range is refused', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-03-31', to: '2031-03-01' })
    assert.equal(res.status, 400)
  })

  // Without a cap, one key pulls a doctor's whole history in a single call.
  test('a range beyond 90 days is refused', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-01-01', to: '2031-12-31' })
    assert.equal(res.status, 400)
    assert.match(res.body.message, /90/)
  })

  test('exactly 90 days is allowed', async () => {
    const res = await feed({ doctorEmail: ourDoctor.email, from: '2031-01-01', to: '2031-03-31' })
    assert.equal(res.status, 200)
  })
})

// ── Read only ───────────────────────────────────────────────────────────────

describe('the feed cannot change anything', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    test(`${method} is not served`, async () => {
      const res = await fetch(`${baseUrl}/api/partner/appointments`, {
        method,
        headers: { 'x-partner-key': SECRET, 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : '{}',
      })
      assert.notEqual(res.status, 200, `${method} must not succeed`)
    })
  }
})
