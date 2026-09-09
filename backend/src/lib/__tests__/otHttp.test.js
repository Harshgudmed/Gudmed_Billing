// Operation Theatre — HTTP-level tests.
//
// otBooking.test.js calls the controller functions directly, which proves the
// business rules but skips everything a real request passes through first: CORS,
// helmet, the JSON body parser, `authenticate`, and the route's `authorize`.
// A tester hits the API over HTTP, so the gaps live in that layer — a route that
// forgets a guard, a token from another hospital, a body that is not JSON.
//
// This file starts the real Express app on a spare port and drives it with
// fetch(), exactly as a tester (or Postman) would. Tokens are minted with the
// server's own JWT_SECRET rather than by logging in, so the suite needs no
// seeded password and still produces sessions the server treats as genuine.
//
// Run:  node --test --test-force-exit src/lib/__tests__/otHttp.test.js
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import express from 'express'
import cookieParser from 'cookie-parser'
import { db } from '../../config/db.js'
import { router as apiRouter } from '../../routes/index.js'
import { errorHandler } from '../../middleware/errorHandler.js'
import { JWT_SECRET } from '../../config/security.js'

const stamp = Date.now()
const AUTH_ENFORCED = process.env.AUTH_ENFORCED === 'true'

let server, baseUrl
let ourOrg, otherOrg
let ourPatient, theirPatient, ourSurgeon, theirSurgeon
let theatreA, theatreB, theirTheatre, surgery, admission
let tokens = {}

// ── Harness ─────────────────────────────────────────────────────────────────

const tokenFor = (user, organizationId) => jwt.sign(
  {
    userId: user.id, id: user.id, organizationId,
    role: user.role, fullName: user.fullName, email: user.email,
  },
  JWT_SECRET,
  { expiresIn: '1h' },
)

// One call. `token: null` sends no Authorization header at all — the anonymous
// case a tester tries first.
async function api(method, path, { token = tokens.doctor, body, raw, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(raw === undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON body — kept as text */ }
  return { status: res.status, body: json, text }
}

const get = (path, opts) => api('GET', path, opts)
const post = (body, opts) => api('POST', '/api/ot', { body, ...opts })
const patch = (body, opts) => api('PATCH', '/api/ot', { body, ...opts })
const del = (path, opts) => api('DELETE', path, opts)

const bookingBody = (extra = {}) => ({
  resource: 'booking',
  patientId: ourPatient.id,
  theatreId: theatreA.id,
  procedureName: 'HTTP Test Procedure',
  scheduledStart: '2031-01-15T09:00',
  estimatedMinutes: 60,
  primarySurgeonId: ourSurgeon.id,
  ...extra,
})

async function clearBookings() {
  await db.otTeamMember.deleteMany({ where: { organizationId: ourOrg.id } })
  await db.otBooking.deleteMany({ where: { organizationId: ourOrg.id } })
}

// ── Fixtures ────────────────────────────────────────────────────────────────

before(async () => {
  // The same middleware order as server.js, minus the pieces that need a socket
  // (websockets) or the network (CORS origin checks are exercised by the browser,
  // not by a same-process fetch).
  const app = express()
  app.use(cookieParser())
  app.use(express.json({ limit: '50mb' }))
  app.use('/api', apiRouter)
  app.use(errorHandler)

  await new Promise((resolve) => { server = app.listen(0, resolve) })
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const org = (name, slug) => db.organization.create({ data: { name, slug } })
  ourOrg = await org('Test Org — otHttp (ours)', `test-othttp-ours-${stamp}`)
  otherOrg = await org('Test Org — otHttp (theirs)', `test-othttp-theirs-${stamp}`)

  const patient = (organizationId, tag) => db.patient.create({
    data: {
      organizationId, mrn: `TESTMRN-OTHTTP-${tag}-${stamp}`,
      firstName: 'HTTP', lastName: `Patient ${tag}`,
      gender: 'other', dateOfBirth: new Date('1990-01-01'),
    },
  })
  ourPatient = await patient(ourOrg.id, 'OURS')
  theirPatient = await patient(otherOrg.id, 'THEIRS')

  const user = (organizationId, tag, role) => db.user.create({
    data: { organizationId, email: `othttp.${tag}.${stamp}@test.local`, fullName: `HTTP ${tag}`, role },
  })
  ourSurgeon = await user(ourOrg.id, 'surgeon', 'doctor')
  theirSurgeon = await user(otherOrg.id, 'theirsurgeon', 'doctor')

  const roles = ['doctor', 'nurse', 'receptionist', 'billing', 'pharmacist', 'lab_tech', 'radiologist', 'admin']
  for (const role of roles) {
    const u = role === 'doctor' ? ourSurgeon : await user(ourOrg.id, role, role)
    tokens[role] = tokenFor(u, ourOrg.id)
  }
  // A genuine, correctly signed session belonging to the OTHER hospital.
  tokens.otherOrg = tokenFor(theirSurgeon, otherOrg.id)
  // A session whose token says nothing about a hospital.
  tokens.noOrg = jwt.sign({ userId: ourSurgeon.id, id: ourSurgeon.id, role: 'doctor' }, JWT_SECRET, { expiresIn: '1h' })
  tokens.expired = jwt.sign({ userId: ourSurgeon.id, organizationId: ourOrg.id, role: 'doctor' }, JWT_SECRET, { expiresIn: -10 })
  tokens.wrongSecret = jwt.sign({ userId: ourSurgeon.id, organizationId: ourOrg.id, role: 'doctor' }, 'not-the-real-secret', { expiresIn: '1h' })
  tokens.patient = jwt.sign({ patientId: ourPatient.id, organizationId: ourOrg.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' })

  const theatre = (organizationId, name, extra = {}) => db.operatingTheatre.create({
    data: { organizationId, name, cleaningMinutes: 30, ...extra },
  })
  theatreA = await theatre(ourOrg.id, `HTTP-OT-A-${stamp}`)
  theatreB = await theatre(ourOrg.id, `HTTP-OT-B-${stamp}`)
  theirTheatre = await theatre(otherOrg.id, `HTTP-OT-THEIRS-${stamp}`)

  surgery = await db.surgeryCatalog.create({
    data: { organizationId: ourOrg.id, name: `HTTP Surgery ${stamp}`, defaultMinutes: 45 },
  })
  admission = await db.admission.create({
    data: { organizationId: ourOrg.id, patientId: ourPatient.id },
  })
})

after(async () => {
  await new Promise((resolve) => server?.close(resolve))
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

// ── 1. Authentication ───────────────────────────────────────────────────────
// Every one of these is the first thing a tester tries.

describe('authentication', () => {
  test('no token is refused', { skip: !AUTH_ENFORCED }, async () => {
    const res = await get('/api/ot?resource=theatres', { token: null })
    assert.equal(res.status, 401)
    assert.equal(res.body.code, 'NO_TOKEN')
  })

  test('a token signed with the wrong secret is refused', { skip: !AUTH_ENFORCED }, async () => {
    const res = await get('/api/ot?resource=theatres', { token: tokens.wrongSecret })
    assert.equal(res.status, 401)
    assert.equal(res.body.code, 'BAD_TOKEN')
  })

  test('an expired token is refused', { skip: !AUTH_ENFORCED }, async () => {
    const res = await get('/api/ot?resource=theatres', { token: tokens.expired })
    assert.equal(res.status, 401)
  })

  test('a token carrying no hospital is refused', { skip: !AUTH_ENFORCED }, async () => {
    const res = await get('/api/ot?resource=theatres', { token: tokens.noOrg })
    assert.equal(res.status, 401)
    assert.equal(res.body.code, 'NO_ORG')
  })

  test('a mangled Authorization header is refused, not crashed on', { skip: !AUTH_ENFORCED }, async () => {
    for (const header of ['Bearer', 'Bearer ', 'Basic abc', 'Bearer a.b.c', 'Bearer null']) {
      const res = await get('/api/ot?resource=theatres', { token: null, headers: { Authorization: header } })
      assert.equal(res.status, 401, `header "${header}" should be 401`)
    }
  })

  test('a patient portal session cannot reach the staff API', { skip: !AUTH_ENFORCED }, async () => {
    const res = await get('/api/ot?resource=theatres', { token: tokens.patient })
    assert.equal(res.status, 403)
  })
})

// ── 2. Who may reach OT at all ──────────────────────────────────────────────

describe('route-level roles', () => {
  test('clinical and desk roles may read the theatre list', { skip: !AUTH_ENFORCED }, async () => {
    for (const role of ['doctor', 'nurse', 'receptionist', 'billing', 'admin']) {
      const res = await get('/api/ot?resource=theatres', { token: tokens[role] })
      assert.equal(res.status, 200, `${role} should be allowed in`)
    }
  })

  test('lab, pharmacy and radiology are refused at the door', { skip: !AUTH_ENFORCED }, async () => {
    for (const role of ['pharmacist', 'lab_tech', 'radiologist']) {
      const res = await get('/api/ot?resource=theatres', { token: tokens[role] })
      assert.equal(res.status, 403, `${role} should not reach OT`)
    }
  })
})

// ── 3. Per-action permission ────────────────────────────────────────────────

describe('per-action permission', () => {
  test('a nurse may not create a booking', { skip: !AUTH_ENFORCED }, async () => {
    await clearBookings()
    const res = await post(bookingBody(), { token: tokens.nurse })
    assert.equal(res.status, 403)
  })

  test('a receptionist may create a booking', { skip: !AUTH_ENFORCED }, async () => {
    await clearBookings()
    const res = await post(bookingBody({ scheduledStart: '2031-01-16T09:00' }), { token: tokens.receptionist })
    assert.equal(res.status, 201)
  })

  test('a receptionist may not cancel a case', { skip: !AUTH_ENFORCED }, async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2031-01-17T09:00' }))
    const res = await patch(
      { resource: 'status', id: created.body.data.id, status: 'CANCELLED', reason: 'not needed' },
      { token: tokens.receptionist },
    )
    assert.equal(res.status, 403)
  })

  test('a doctor may not edit the theatre master', { skip: !AUTH_ENFORCED }, async () => {
    const res = await patch({ resource: 'theatre', id: theatreB.id, code: 'X' }, { token: tokens.doctor })
    assert.equal(res.status, 403)
  })

  test('a billing user may not edit the team', { skip: !AUTH_ENFORCED }, async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2031-01-18T09:00' }))
    const res = await patch(
      { resource: 'team', id: created.body.data.id, team: [] },
      { token: tokens.billing },
    )
    assert.equal(res.status, 403)
  })
})

// ── 4. Cross-tenant ─────────────────────────────────────────────────────────
// The hospital comes from the TOKEN. A body that claims a different one, or an
// id belonging to another hospital, must change nothing.

describe('cross-tenant isolation', () => {
  test('a hospital sees only its own theatres', async () => {
    const ours = await get('/api/ot?resource=theatres', { token: tokens.doctor })
    const ids = ours.body.data.map((t) => t.id)
    assert.ok(ids.includes(theatreA.id))
    assert.equal(ids.includes(theirTheatre.id), false)
  })

  test("another hospital's booking cannot be read by id", async () => {
    await clearBookings()
    const theirBooking = await db.otBooking.create({
      data: {
        organizationId: otherOrg.id, patientId: theirPatient.id, theatreId: theirTheatre.id,
        caseNumber: `OT-THEIRS-${stamp}`, procedureName: 'Theirs',
        scheduledStart: new Date('2031-02-01T09:00:00'), scheduledEnd: new Date('2031-02-01T10:00:00'),
        primarySurgeonId: theirSurgeon.id, status: 'SCHEDULED',
      },
    })
    const res = await get(`/api/ot?resource=booking&id=${theirBooking.id}`, { token: tokens.doctor })
    assert.equal(res.status, 404)
    await db.otBooking.delete({ where: { id: theirBooking.id } })
  })

  test("another hospital's theatre cannot be retired", async () => {
    const res = await del(`/api/ot?resource=theatre&id=${theirTheatre.id}`, { token: tokens.receptionist })
    assert.equal(res.status, AUTH_ENFORCED ? 404 : 404)
    const still = await db.operatingTheatre.findUnique({ where: { id: theirTheatre.id } })
    assert.equal(still.isActive, true, "the other hospital's theatre must be untouched")
  })

  // Reschedule takes a theatreId straight from the body. assertNoConflict is
  // what refuses one that belongs elsewhere, does not exist, or is retired —
  // these three prove it, because the controller alone does not say so.
  test('a case cannot be rescheduled into another hospital, a ghost, or a retired theatre', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2031-02-10T09:00' }))
    const id = created.body.data.id

    const retired = await db.operatingTheatre.create({
      data: { organizationId: ourOrg.id, name: `HTTP-OT-RETIRED-${stamp}`, isActive: false },
    })

    const attempts = [
      ['another hospital', theirTheatre.id, 404],
      ['a theatre that does not exist', 'clzzzzzzzzzzzzzzzzzzzzzzz', 404],
      ['a retired theatre', retired.id, 400],
    ]
    for (const [label, theatreId, expected] of attempts) {
      const res = await patch({ resource: 'reschedule', id, theatreId, scheduledStart: '2031-02-11T09:00' })
      assert.equal(res.status, expected, `${label} gave ${res.status}`)
    }

    const after = await db.otBooking.findUnique({ where: { id } })
    assert.equal(after.theatreId, theatreA.id, 'the booking must not have moved')
  })

  test('an organizationId in the body is ignored — the token decides', async () => {
    await clearBookings()
    const res = await post(bookingBody({ organizationId: otherOrg.id, scheduledStart: '2031-02-02T09:00' }))
    assert.equal(res.status, 201)
    assert.equal(res.body.data.organizationId, ourOrg.id)
  })
})

// ── 5. Malformed requests ───────────────────────────────────────────────────
// A tester's favourite: none of these may return 500.

describe('malformed input', () => {
  test('a body that is not JSON returns 400, not 500', async () => {
    const res = await api('POST', '/api/ot', { raw: 'this is not json', headers: { 'Content-Type': 'application/json' } })
    assert.ok(res.status === 400, `expected 400, got ${res.status}`)
  })

  test('an empty body returns 400', async () => {
    const res = await post({})
    assert.equal(res.status, 400)
  })

  test('an unknown resource returns 400', async () => {
    for (const resource of ['nonsense', '', null, 123, ['bookings']]) {
      const res = await post({ resource })
      assert.equal(res.status, 400, `resource ${JSON.stringify(resource)} should be 400`)
    }
  })

  test('wrong types where a string is expected do not crash', async () => {
    await clearBookings()
    for (const value of [123, true, [], {}, null]) {
      const res = await post(bookingBody({ patientId: value }))
      assert.ok(res.status === 400 || res.status === 404, `patientId ${JSON.stringify(value)} gave ${res.status}`)
    }
  })

  test('a very long string is refused or stored, never a 500', async () => {
    await clearBookings()
    const res = await post(bookingBody({ procedureName: 'A'.repeat(10_000), scheduledStart: '2031-02-03T09:00' }))
    assert.ok(res.status < 500, `got ${res.status}`)
  })

  test('SQL-injection strings are treated as text', async () => {
    for (const evil of ["'; DROP TABLE \"OtBooking\"; --", "1' OR '1'='1", '${jndi:ldap://x}']) {
      const res = await get(`/api/ot?resource=bookings&search=${encodeURIComponent(evil)}`)
      assert.equal(res.status, 200, `search "${evil}" should be handled`)
    }
    // The table is still there.
    const count = await db.otBooking.count({ where: { organizationId: ourOrg.id } })
    assert.equal(typeof count, 'number')
  })

  test('unicode and emoji survive a round trip', async () => {
    await clearBookings()
    const name = 'शल्यक्रिया 🔪 Tonsillectomy'
    const created = await post(bookingBody({ procedureName: name, scheduledStart: '2031-02-04T09:00' }))
    assert.equal(created.status, 201)
    assert.equal(created.body.data.procedureName, name)
  })

  test('an unknown HTTP verb on /api/ot is not silently accepted', async () => {
    const res = await api('PUT', '/api/ot', { body: bookingBody() })
    assert.ok(res.status === 404 || res.status === 405, `PUT gave ${res.status}`)
  })
})

// ── 6. Numeric edges ────────────────────────────────────────────────────────

describe('numeric edges', () => {
  test('minutes must be a whole number in range', async () => {
    await clearBookings()
    // '' is absent, not bad — a cleared form field falls back to the default.
    // NaN and Infinity are not in the list because JSON.stringify turns both into
    // null, so the server never sees them; null is 'absent' and takes the default.
    const bad = ['abc', -1, 0, 45.5, 1441, 99999, Number.MAX_SAFE_INTEGER, '1e999']
    for (const value of bad) {
      const res = await post(bookingBody({ estimatedMinutes: value }))
      assert.equal(res.status, 400, `estimatedMinutes ${String(value)} gave ${res.status}`)
    }
  })

  test('a negative cleaning time is refused — it would shrink the busy window', async () => {
    const res = await patch({ resource: 'theatre', id: theatreB.id, cleaningMinutes: -20 }, { token: tokens.receptionist })
    assert.equal(res.status, 400)
    const after = await db.operatingTheatre.findUnique({ where: { id: theatreB.id } })
    assert.equal(after.cleaningMinutes, 30)
  })

  test('the list limit is capped rather than trusted', async () => {
    for (const limit of [1000, 99999, -5, 'abc']) {
      const res = await get(`/api/ot?resource=bookings&limit=${limit}`)
      assert.equal(res.status, 200)
      assert.ok(res.body.data.length <= 500)
    }
  })
})

// ── 7. Date edges ───────────────────────────────────────────────────────────

describe('date edges', () => {
  test('unparseable dates are refused and name the field', async () => {
    await clearBookings()
    for (const value of ['hello', '2031-13-45', '2031-02-30T09:00', '', null, 0, {}, '99999-01-01']) {
      const res = await post(bookingBody({ scheduledStart: value }))
      assert.equal(res.status, 400, `scheduledStart ${JSON.stringify(value)} gave ${res.status}`)
    }
  })

  test('an end at or before the start is refused', async () => {
    await clearBookings()
    for (const [start, end] of [
      ['2031-03-01T09:00', '2031-03-01T09:00'],
      ['2031-03-01T09:00', '2031-03-01T08:00'],
      ['2031-03-01T09:00', '2030-01-01T09:00'],
    ]) {
      const res = await post(bookingBody({ scheduledStart: start, scheduledEnd: end }))
      assert.equal(res.status, 400)
    }
  })

  test('a booking in the past is accepted — theatre lists are written up after the fact', async () => {
    await clearBookings()
    const res = await post(bookingBody({ scheduledStart: '2020-01-01T09:00' }))
    assert.equal(res.status, 201)
  })
})

// ── 8. Clash detection, every boundary ──────────────────────────────────────
// A 09:00–10:00 case in a theatre with a 30-minute turnaround occupies the room
// from 08:30 to 10:30. Each row below sits exactly on one edge of that.

describe('clash boundaries', () => {
  const cases = [
    ['ends exactly when the busy window starts', '2031-04-01T07:30', 60, 201],
    ['ends one minute into the window', '2031-04-01T07:31', 60, 409],
    ['starts one minute before the window ends', '2031-04-01T10:29', 60, 409],
    ['starts exactly when the window ends', '2031-04-01T10:30', 60, 201],
    ['sits entirely inside the case', '2031-04-01T09:15', 15, 409],
    ['swallows the case whole', '2031-04-01T08:00', 180, 409],
    ['starts exactly when the case starts', '2031-04-01T09:00', 60, 409],
  ]

  for (const [label, start, minutes, expected] of cases) {
    test(`a case that ${label} → ${expected}`, async () => {
      await clearBookings()
      const first = await post(bookingBody({ scheduledStart: '2031-04-01T09:00', estimatedMinutes: 60 }))
      assert.equal(first.status, 201)

      // A different patient and surgeon, so only the THEATRE can clash.
      const otherPatient = await db.patient.create({
        data: {
          organizationId: ourOrg.id, mrn: `TESTMRN-EDGE-${Math.random().toString(36).slice(2, 8)}`,
          firstName: 'Edge', lastName: 'Case', gender: 'other', dateOfBirth: new Date('1990-01-01'),
        },
      })
      const otherSurgeon = await db.user.create({
        data: {
          organizationId: ourOrg.id, email: `edge.${Math.random().toString(36).slice(2, 8)}@test.local`,
          fullName: 'Edge Surgeon', role: 'doctor',
        },
      })

      const res = await post(bookingBody({
        patientId: otherPatient.id,
        primarySurgeonId: otherSurgeon.id,
        scheduledStart: start,
        estimatedMinutes: minutes,
      }))
      assert.equal(res.status, expected, `${label}: ${res.body?.error ?? ''}`)
    })
  }

  test('a cancelled case releases its slot', async () => {
    await clearBookings()
    const first = await post(bookingBody({ scheduledStart: '2031-04-02T09:00' }))
    await patch({ resource: 'status', id: first.body.data.id, status: 'CANCELLED', reason: 'freed' })

    const second = await post(bookingBody({ scheduledStart: '2031-04-02T09:00' }))
    assert.equal(second.status, 201)
  })
})

// ── 9. Concurrency ──────────────────────────────────────────────────────────

describe('concurrency', () => {
  test('two users racing for the same empty slot — exactly one wins', async () => {
    await clearBookings()
    const body = bookingBody({ scheduledStart: '2031-05-01T09:00' })
    const results = await Promise.all([post(body), post(body), post(body), post(body), post(body)])

    const created = results.filter((r) => r.status === 201)
    const refused = results.filter((r) => r.status === 409)
    assert.equal(created.length, 1, `expected 1 booking, got ${created.length}`)
    assert.equal(refused.length, 4)

    const inDb = await db.otBooking.count({
      where: { organizationId: ourOrg.id, scheduledStart: new Date('2031-05-01T09:00:00') },
    })
    assert.equal(inDb, 1)
  })

  // Two people looking at the same CONFIRMED case: one presses Check in, the
  // other Cancel. Both pass the transition check, because both read the same
  // status. Without a compare-and-swap on that status, both writes land and the
  // second silently overwrites the first.
  test('two people moving the same case at once — exactly one wins', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2031-05-10T09:00', admissionId: admission.id }))
    const id = created.body.data.id
    await patch({ resource: 'status', id, status: 'CONFIRMED' })

    const [checkIn, cancel] = await Promise.all([
      patch({ resource: 'status', id, status: 'CHECKED_IN' }),
      patch({ resource: 'status', id, status: 'CANCELLED', reason: 'racing' }),
    ])

    const winners = [checkIn, cancel].filter((r) => r.status === 200)
    assert.equal(winners.length, 1, `expected exactly one winner, got ${winners.length}`)

    const after = await db.otBooking.findUnique({ where: { id } })
    assert.ok(['CHECKED_IN', 'CANCELLED'].includes(after.status))
    // The loser must not have written its half either.
    if (after.status === 'CHECKED_IN') assert.equal(after.cancelReason, null)
  })

  // A theatre being retired while a case starts in it. The check and the write
  // share the scheduler's theatre lock, so one of the two must lose.
  test('retiring a theatre while a case starts in it cannot leave both done', async () => {
    await clearBookings()
    const created = await post(bookingBody({
      theatreId: theatreB.id, scheduledStart: '2031-05-11T09:00', admissionId: admission.id,
    }))
    const id = created.body.data.id
    await patch({ resource: 'status', id, status: 'CONFIRMED' })
    await patch({ resource: 'status', id, status: 'CHECKED_IN' })

    const [start, retire] = await Promise.all([
      patch({ resource: 'status', id, status: 'IN_THEATRE' }),
      del(`/api/ot?resource=theatre&id=${theatreB.id}`, { token: tokens.receptionist }),
    ])

    const booking = await db.otBooking.findUnique({ where: { id } })
    const theatre = await db.operatingTheatre.findUnique({ where: { id: theatreB.id } })

    const bothWon = booking.status === 'IN_THEATRE' && theatre.isActive === false
    assert.equal(bothWon, false, 'a retired theatre must not have a case running in it')
    assert.ok(start.status === 200 || retire.status === 200, 'one of the two should have succeeded')

    await db.operatingTheatre.update({ where: { id: theatreB.id }, data: { isActive: true, status: 'AVAILABLE' } })
  })

  test('case numbers stay unique under parallel creation', async () => {
    await clearBookings()
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => post(bookingBody({
        theatreId: i % 2 === 0 ? theatreA.id : theatreB.id,
        scheduledStart: `2031-05-0${i + 2}T09:00`,
      }))),
    )
    const numbers = results.filter((r) => r.status === 201).map((r) => r.body.data.caseNumber)
    assert.equal(new Set(numbers).size, numbers.length, 'case numbers must not repeat')
  })
})

// ── 10. Status machine, every pair ──────────────────────────────────────────

describe('status transitions — the full matrix', () => {
  const ALL = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_THEATRE', 'COMPLETED', 'CANCELLED', 'POSTPONED']
  const ALLOWED = {
    SCHEDULED: ['CONFIRMED', 'CANCELLED', 'POSTPONED'],
    CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'POSTPONED'],
    CHECKED_IN: ['IN_THEATRE', 'CANCELLED'],
    IN_THEATRE: ['COMPLETED'],
    COMPLETED: [],
    CANCELLED: [],
    POSTPONED: ['SCHEDULED', 'CANCELLED'],
  }

  test('every one of the 42 from→to pairs behaves as the rules say', async () => {
    const failures = []

    for (const from of ALL) {
      for (const to of ALL) {
        if (from === to) continue
        await clearBookings()
        // An admission is attached so the CHECKED_IN/IN_THEATRE rule does not
        // mask what the transition rule would have done.
        const booking = await db.otBooking.create({
          data: {
            organizationId: ourOrg.id, patientId: ourPatient.id, theatreId: theatreA.id,
            admissionId: admission.id,
            caseNumber: `OT-MATRIX-${Math.random().toString(36).slice(2, 10)}`,
            procedureName: 'Matrix', scheduledStart: new Date('2031-06-01T09:00:00'),
            scheduledEnd: new Date('2031-06-01T10:00:00'),
            primarySurgeonId: ourSurgeon.id, status: from,
          },
        })

        const res = await patch({ resource: 'status', id: booking.id, status: to, reason: 'matrix test' })
        const shouldPass = ALLOWED[from].includes(to)
        const didPass = res.status === 200

        if (didPass !== shouldPass) {
          failures.push(`${from} → ${to}: expected ${shouldPass ? 'allowed' : 'refused'}, got ${res.status} ${res.body?.code ?? ''}`)
        }
      }
    }

    assert.deepEqual(failures, [], `\n${failures.join('\n')}`)
  })

  test('an unknown status value is refused', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2031-06-02T09:00' }))
    for (const status of ['DONE', 'completed', 'HACKED', '', null, 123]) {
      const res = await patch({ resource: 'status', id: created.body.data.id, status, reason: 'x' })
      assert.equal(res.status, 400, `status ${JSON.stringify(status)} gave ${res.status}`)
    }
  })

  test('a reason of only whitespace does not count as a reason', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2031-06-03T09:00' }))
    const res = await patch({ resource: 'status', id: created.body.data.id, status: 'CANCELLED', reason: '   ' })
    assert.equal(res.status, 400)
  })
})

// ── 11. Ids that do not exist ───────────────────────────────────────────────

describe('missing and malformed ids', () => {
  test('a well-formed id that matches nothing is 404, not 500', async () => {
    const ghost = 'clzzzzzzzzzzzzzzzzzzzzzzz'
    const reads = await get(`/api/ot?resource=booking&id=${ghost}`)
    assert.equal(reads.status, 404)

    const writes = await patch({ resource: 'status', id: ghost, status: 'CONFIRMED' })
    assert.equal(writes.status, 404)
  })

  test('a missing id is refused rather than acting on the first row', async () => {
    assert.equal((await get('/api/ot?resource=booking')).status, 400)
    assert.equal((await patch({ resource: 'status', status: 'CONFIRMED' })).status, 400)
    assert.equal((await del('/api/ot?resource=theatre')).status, 400)
  })

  test('junk ids are refused, not crashed on', async () => {
    for (const id of ['../../etc/passwd', '<script>alert(1)</script>', "' OR 1=1 --", 'a'.repeat(500)]) {
      const res = await get(`/api/ot?resource=booking&id=${encodeURIComponent(id)}`)
      assert.ok(res.status === 404 || res.status === 400, `id "${id.slice(0, 20)}" gave ${res.status}`)
    }
  })
})

// ── 12. What leaves the server ──────────────────────────────────────────────

describe('response payload', () => {
  test('no password hash ever reaches the client', async () => {
    await clearBookings()
    const created = await post(bookingBody({
      scheduledStart: '2031-07-01T09:00',
      team: [{ role: 'PRIMARY_SURGEON', userId: ourSurgeon.id, memberName: ourSurgeon.fullName }],
    }))
    const detail = await get(`/api/ot?resource=booking&id=${created.body.data.id}`)
    const list = await get('/api/ot?resource=bookings')

    for (const payload of [created.text, detail.text, list.text]) {
      assert.equal(/passwordHash|password"/.test(payload), false, 'a password field escaped')
    }
  })

  test('the list stays lean and the detail stays complete', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2031-07-02T09:00', surgeryId: surgery.id }))

    const row = (await get('/api/ot?resource=bookings')).body.data[0]
    assert.equal(row.team, undefined)
    assert.equal(row.anaesthetist, undefined)

    const detail = (await get(`/api/ot?resource=booking&id=${created.body.data.id}`)).body.data
    assert.ok(Array.isArray(detail.team))
    assert.equal(detail.surgery.name, surgery.name)
  })

  test('every response carries the { success, data } shape', async () => {
    const res = await get('/api/ot?resource=theatres')
    assert.equal(res.body.success, true)
    assert.ok(Array.isArray(res.body.data))
  })

  test('an error response says what went wrong, without a stack trace', async () => {
    const res = await post({ resource: 'booking' })
    assert.equal(res.body.success, false)
    assert.equal(typeof res.body.error, 'string')
    assert.equal(/at .*\.js:\d+/.test(res.text), false, 'a stack trace leaked')
  })
})

// ── 13. The board must not lie ──────────────────────────────────────────────

describe('theatre board consistency', () => {
  test('the theatre follows the case, and cannot be overridden while a case is in it', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2031-08-01T09:00', admissionId: admission.id }))
    const id = created.body.data.id

    await patch({ resource: 'status', id, status: 'CONFIRMED' })
    await patch({ resource: 'status', id, status: 'CHECKED_IN' })
    await patch({ resource: 'status', id, status: 'IN_THEATRE' })

    let theatre = await db.operatingTheatre.findUnique({ where: { id: theatreA.id } })
    assert.equal(theatre.status, 'OCCUPIED')

    const override = await patch({ resource: 'theatre', id: theatreA.id, status: 'AVAILABLE' }, { token: tokens.receptionist })
    assert.equal(override.status, 409)

    const retire = await del(`/api/ot?resource=theatre&id=${theatreA.id}`, { token: tokens.receptionist })
    assert.equal(retire.status, 409)

    await patch({ resource: 'status', id, status: 'COMPLETED' })
    theatre = await db.operatingTheatre.findUnique({ where: { id: theatreA.id } })
    assert.equal(theatre.status, 'CLEANING')

    await db.operatingTheatre.update({ where: { id: theatreA.id }, data: { status: 'AVAILABLE', isActive: true } })
  })

  test('OCCUPIED and CLEANING cannot be set by hand', async () => {
    for (const status of ['OCCUPIED', 'CLEANING', 'HACKED']) {
      const res = await patch({ resource: 'theatre', id: theatreB.id, status }, { token: tokens.receptionist })
      assert.equal(res.status, 400, `${status} should be refused`)
    }

    // An empty string is treated as 'not sent', so nothing changes.
    const wasStatus = (await db.operatingTheatre.findUnique({ where: { id: theatreB.id } })).status
    const blank = await patch({ resource: 'theatre', id: theatreB.id, status: '' }, { token: tokens.receptionist })
    assert.equal(blank.status, 200)
    const nowStatus = (await db.operatingTheatre.findUnique({ where: { id: theatreB.id } })).status
    assert.equal(nowStatus, wasStatus, 'a blank status must not overwrite the real one')
  })
})

// ── 14. Idempotency and repeat ──────────────────────────────────────────────

describe('repeat requests', () => {
  test('the same status twice is refused the second time, not applied twice', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2031-09-01T09:00' }))
    const id = created.body.data.id

    assert.equal((await patch({ resource: 'status', id, status: 'CONFIRMED' })).status, 200)
    assert.equal((await patch({ resource: 'status', id, status: 'CONFIRMED' })).status, 409)
  })

  test('retiring an already-retired theatre is harmless', async () => {
    const doomed = await db.operatingTheatre.create({
      data: { organizationId: ourOrg.id, name: `HTTP-OT-DOOMED-${Math.random().toString(36).slice(2, 8)}` },
    })
    assert.equal((await del(`/api/ot?resource=theatre&id=${doomed.id}`, { token: tokens.receptionist })).status, 200)
    assert.equal((await del(`/api/ot?resource=theatre&id=${doomed.id}`, { token: tokens.receptionist })).status, 200)

    const still = await db.operatingTheatre.findUnique({ where: { id: doomed.id } })
    assert.equal(still.isActive, false)
  })
})

// The booking form asks this while the user is still choosing a theatre, so its
// answer has to agree with the check that later blocks the booking. A preview
// that says free where the gate says busy is worse than no preview at all — the
// user picks the room it offered and is refused on submit.
//
// theatreA and theatreB both carry a 30 minute turnaround (see fixtures), so the
// boundary tests below are written against that number.
describe('theatre availability', () => {
  const availability = (params, opts) =>
    get(`/api/ot?resource=availability&${new URLSearchParams(params)}`, opts)

  // The answer is { theatres, surgeon, patient } — the gate refuses on any of the
  // three, so the preview reports all three.
  const named = (data, theatre) => (data.theatres || []).find((r) => r.id === theatre.id)

  test('an empty day reports every theatre in this hospital as free', async () => {
    await clearBookings()
    const res = await availability({ scheduledStart: '2032-03-01T09:00', estimatedMinutes: 60 })

    assert.equal(res.status, 200)
    assert.equal(named(res.body.data, theatreA).free, true)
    assert.equal(named(res.body.data, theatreB).free, true)
  })

  test('another hospital\'s theatres never appear', async () => {
    const res = await availability({ scheduledStart: '2032-03-01T09:00', estimatedMinutes: 60 })
    assert.equal(named(res.body.data, theirTheatre), undefined)
  })

  test('a booked theatre is reported busy, naming the case and when it frees up', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2032-03-02T09:00', estimatedMinutes: 60 }))
    assert.equal(created.status, 201)

    const res = await availability({ scheduledStart: '2032-03-02T09:00', estimatedMinutes: 60 })
    const busy = named(res.body.data, theatreA)

    assert.equal(busy.free, false)
    assert.equal(busy.busyWith, created.body.data.caseNumber)
    // Ends 10:00 plus the 30 minute turnaround.
    assert.equal(new Date(busy.freeFrom).getHours(), 10)
    assert.equal(new Date(busy.freeFrom).getMinutes(), 30)
  })

  test('a busy theatre does not make the others look busy', async () => {
    const res = await availability({ scheduledStart: '2032-03-02T09:00', estimatedMinutes: 60 })
    assert.equal(named(res.body.data, theatreA).free, false)
    assert.equal(named(res.body.data, theatreB).free, true)
  })

  // The turnaround is the whole reason this endpoint cannot just look for
  // overlapping bookings. These two tests sit one minute either side of it.
  test('one minute inside the cleaning gap is still busy', async () => {
    const res = await availability({ scheduledStart: '2032-03-02T10:29', estimatedMinutes: 30 })
    assert.equal(named(res.body.data, theatreA).free, false)
  })

  test('the moment the cleaning gap closes, the theatre is free', async () => {
    const res = await availability({ scheduledStart: '2032-03-02T10:30', estimatedMinutes: 30 })
    assert.equal(named(res.body.data, theatreA).free, true)
  })

  test('a case being rescheduled does not clash with itself', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2032-03-03T09:00', estimatedMinutes: 60 }))
    const id = created.body.data.id

    const without = await availability({ scheduledStart: '2032-03-03T09:00', estimatedMinutes: 60 })
    assert.equal(named(without.body.data, theatreA).free, false)

    const with_ = await availability({ scheduledStart: '2032-03-03T09:00', estimatedMinutes: 60, excludeBookingId: id })
    assert.equal(named(with_.body.data, theatreA).free, true)
  })

  test('the preview agrees with the booking it is previewing', async () => {
    await clearBookings()
    await post(bookingBody({ scheduledStart: '2032-03-04T09:00', estimatedMinutes: 60 }))

    // Inside the gap: the preview says busy, so the real booking must be refused.
    const preview = await availability({ scheduledStart: '2032-03-04T10:29', estimatedMinutes: 30 })
    assert.equal(named(preview.body.data, theatreA).free, false)

    const attempt = await post(bookingBody({ scheduledStart: '2032-03-04T10:29', estimatedMinutes: 30 }))
    assert.equal(attempt.status, 409, 'the gate must refuse what the preview called busy')

    // And just past it, both must agree the other way.
    const after = await availability({ scheduledStart: '2032-03-04T10:30', estimatedMinutes: 30 })
    assert.equal(named(after.body.data, theatreA).free, true)

    const allowed = await post(bookingBody({ scheduledStart: '2032-03-04T10:30', estimatedMinutes: 30 }))
    assert.equal(allowed.status, 201, 'the gate must allow what the preview called free')
  })

  // Dates arrive as text from a query string, so this is the layer that has to
  // refuse a day that does not exist. Left to new Date(), 30 February silently
  // becomes 2 March and the answer describes a different day than the one asked
  // about — the bug the OT case record already shipped with once.
  test('30 February is refused, not rolled over into March', async () => {
    const res = await availability({ scheduledStart: '2032-02-30T09:00', estimatedMinutes: 60 })
    assert.equal(res.status, 400)
  })

  test('an absurd year is refused rather than crashing the database', async () => {
    const res = await availability({ scheduledStart: '99999-01-01T09:00', estimatedMinutes: 60 })
    assert.equal(res.status, 400)
  })

  test('a missing start time is refused', async () => {
    const res = await availability({ estimatedMinutes: 60 })
    assert.equal(res.status, 400)
  })

  test('a negative duration is refused', async () => {
    const res = await availability({ scheduledStart: '2032-03-05T09:00', estimatedMinutes: -30 })
    assert.equal(res.status, 400)
  })

  test('a duration that is not a number is refused', async () => {
    const res = await availability({ scheduledStart: '2032-03-05T09:00', estimatedMinutes: 'sixty' })
    assert.equal(res.status, 400)
  })

  test('no duration falls back to an hour rather than failing', async () => {
    const res = await availability({ scheduledStart: '2032-03-06T09:00' })
    assert.equal(res.status, 200)
    assert.ok(res.body.data.theatres.length > 0)
  })

  // ── The surgeon and the patient ───────────────────────────────────────────
  //
  // A theatre-only preview was the bug this section exists for: it reported a
  // free room, the user picked it, and the save was refused for a surgeon
  // already operating somewhere else. Free rooms are not the same as a bookable
  // slot.

  test('nobody is reported on when nobody was asked about', async () => {
    await clearBookings()
    const res = await availability({ scheduledStart: '2032-04-01T09:00', estimatedMinutes: 60 })
    assert.equal(res.body.data.surgeon, null, 'no surgeon id means no verdict, not a clean one')
    assert.equal(res.body.data.patient, null)
  })

  test('a free surgeon and a free patient are reported free', async () => {
    await clearBookings()
    const res = await availability({
      scheduledStart: '2032-04-01T09:00', estimatedMinutes: 60,
      primarySurgeonId: ourSurgeon.id, patientId: ourPatient.id,
    })
    assert.equal(res.body.data.surgeon.free, true)
    assert.equal(res.body.data.patient.free, true)
  })

  test('a surgeon operating in ANOTHER theatre makes the slot unbookable', async () => {
    await clearBookings()
    const created = await post(bookingBody({
      theatreId: theatreA.id, scheduledStart: '2032-04-02T09:00', estimatedMinutes: 60,
    }))
    assert.equal(created.status, 201)

    const res = await availability({
      scheduledStart: '2032-04-02T09:30', estimatedMinutes: 30,
      primarySurgeonId: ourSurgeon.id,
    })

    // The other room is genuinely empty — and that is exactly why the room alone
    // is not the answer.
    assert.equal(named(res.body.data, theatreB).free, true)
    assert.equal(res.body.data.surgeon.free, false)
    assert.equal(res.body.data.surgeon.busyWith, created.body.data.caseNumber)
  })

  test('the preview agrees with the gate about a busy surgeon', async () => {
    // Same slot as above: theatreB reads free, so only the surgeon can refuse it.
    const attempt = await post(bookingBody({
      theatreId: theatreB.id, scheduledStart: '2032-04-02T09:30', estimatedMinutes: 30,
    }))
    assert.equal(attempt.status, 409)
    assert.equal(attempt.body.code, 'OT_SURGEON_BUSY')
  })

  test('a patient already booked elsewhere is reported busy', async () => {
    const res = await availability({
      scheduledStart: '2032-04-02T09:30', estimatedMinutes: 30,
      patientId: ourPatient.id,
    })
    assert.equal(res.body.data.patient.free, false)
  })

  // The room needs cleaning between cases; the surgeon walks straight to the
  // next one. One slot, two different answers — which is the whole reason the
  // turnaround is applied to the theatre only.
  test('the cleaning gap holds the theatre but not the surgeon', async () => {
    const res = await availability({
      scheduledStart: '2032-04-02T10:00', estimatedMinutes: 30,
      primarySurgeonId: ourSurgeon.id,
    })
    assert.equal(named(res.body.data, theatreA).free, false, 'theatre is still in turnaround')
    assert.equal(res.body.data.surgeon.free, true, 'the surgeon is free the moment the case ends')
  })

  test('rescheduling frees the surgeon from their own case', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2032-04-03T09:00', estimatedMinutes: 60 }))
    const id = created.body.data.id

    const without = await availability({
      scheduledStart: '2032-04-03T09:00', estimatedMinutes: 60, primarySurgeonId: ourSurgeon.id,
    })
    assert.equal(without.body.data.surgeon.free, false)

    const with_ = await availability({
      scheduledStart: '2032-04-03T09:00', estimatedMinutes: 60,
      primarySurgeonId: ourSurgeon.id, excludeBookingId: id,
    })
    assert.equal(with_.body.data.surgeon.free, true)
  })

  test('another hospital\'s surgeon is not a surgeon we will answer about', async () => {
    const res = await availability({
      scheduledStart: '2032-04-04T09:00', estimatedMinutes: 60, primarySurgeonId: theirSurgeon.id,
    })
    assert.equal(res.status, 404)
  })

  test('another hospital\'s patient is not a patient we will answer about', async () => {
    const res = await availability({
      scheduledStart: '2032-04-04T09:00', estimatedMinutes: 60, patientId: theirPatient.id,
    })
    assert.equal(res.status, 404)
  })

  test('no token is refused', { skip: !AUTH_ENFORCED }, async () => {
    const res = await availability({ scheduledStart: '2032-03-01T09:00' }, { token: null })
    assert.equal(res.status, 401)
  })

  test('a role that cannot book cannot see availability either', { skip: !AUTH_ENFORCED }, async () => {
    const res = await availability({ scheduledStart: '2032-03-01T09:00' }, { token: tokens.lab_tech })
    assert.equal(res.status, 403)
  })

  test('the other hospital sees its own theatres, never ours', async () => {
    const res = await availability({ scheduledStart: '2032-03-01T09:00' }, { token: tokens.otherOrg })
    assert.equal(res.status, 200)
    assert.equal(named(res.body.data, theatreA), undefined)
    assert.equal(named(res.body.data, theatreB), undefined)
  })
})

// "When is there room for a 90 minute case on Tuesday" — the question a
// coordinator answers today by typing times into the form until one is accepted,
// and the one rescheduling asks on every move.
describe('free slots for a day', () => {
  const slots = (params, opts) =>
    get(`/api/ot?resource=slots&${new URLSearchParams(params)}`, opts)

  const at = (d) => {
    const t = new Date(d)
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  }

  test('an empty day offers the start of the list', async () => {
    await clearBookings()
    const res = await slots({ date: '2033-05-02', estimatedMinutes: 60, from: '08:00', to: '17:00' })

    assert.equal(res.status, 200)
    assert.equal(res.body.data.hours.start, '08:00')
    assert.ok(res.body.data.slots.length > 0)
    assert.equal(at(res.body.data.slots[0].start), '08:00')
  })

  test('a free day is ONE suggestion, not thirty-six', async () => {
    const res = await slots({ date: '2033-05-02', estimatedMinutes: 60, from: '08:00', to: '17:00' })
    // Every theatre is free all day, so the answer never changes — offering the
    // same slot every 15 minutes would be noise, not help.
    assert.equal(res.body.data.slots.length, 1)
    assert.equal(at(res.body.data.slots[0].freeUntil), '17:00')
  })

  test('a booked morning pushes the first slot past the cleaning gap', async () => {
    await clearBookings()
    // 09:00-10:00 in theatreA, which keeps 30 minutes of turnaround.
    await post(bookingBody({ theatreId: theatreA.id, scheduledStart: '2033-05-03T09:00', estimatedMinutes: 60 }))

    const res = await slots({
      date: '2033-05-03', estimatedMinutes: 60, from: '09:00', to: '17:00', theatreId: theatreA.id,
    })
    assert.equal(at(res.body.data.slots[0].start), '10:30')
  })

  test('a longer case fits in fewer places', async () => {
    await clearBookings()
    // Two cases with a two-hour hole between them, in the only theatre asked about.
    await post(bookingBody({ theatreId: theatreA.id, scheduledStart: '2033-05-04T09:00', estimatedMinutes: 60 }))
    await post(bookingBody({ theatreId: theatreA.id, scheduledStart: '2033-05-04T13:00', estimatedMinutes: 60 }))

    const short = await slots({
      date: '2033-05-04', estimatedMinutes: 60, from: '08:00', to: '17:00', theatreId: theatreA.id,
    })
    const long = await slots({
      date: '2033-05-04', estimatedMinutes: 240, from: '08:00', to: '17:00', theatreId: theatreA.id,
    })
    assert.ok(short.body.data.slots.length > long.body.data.slots.length,
      'a four hour case cannot fit where a one hour case can')
  })

  test('a busy surgeon moves the suggestion, and moves it by less than a room would', async () => {
    await clearBookings()
    await post(bookingBody({ theatreId: theatreA.id, scheduledStart: '2033-05-05T09:00', estimatedMinutes: 60 }))

    // The room is held until 10:30 by its turnaround; the surgeon is free at
    // 10:00 sharp. Asking about the surgeon in theatreB shows the difference.
    const forSurgeon = await slots({
      date: '2033-05-05', estimatedMinutes: 60, from: '09:00', to: '17:00',
      theatreId: theatreB.id, primarySurgeonId: ourSurgeon.id,
    })
    assert.equal(at(forSurgeon.body.data.slots[0].start), '10:00')

    const forRoom = await slots({
      date: '2033-05-05', estimatedMinutes: 60, from: '09:00', to: '17:00', theatreId: theatreA.id,
    })
    assert.equal(at(forRoom.body.data.slots[0].start), '10:30')
  })

  test('rescheduling a case does not let it block its own move', async () => {
    await clearBookings()
    const created = await post(bookingBody({
      theatreId: theatreA.id, scheduledStart: '2033-05-06T09:00', estimatedMinutes: 60,
    }))

    const blocked = await slots({
      date: '2033-05-06', estimatedMinutes: 60, from: '09:00', to: '17:00', theatreId: theatreA.id,
    })
    const freed = await slots({
      date: '2033-05-06', estimatedMinutes: 60, from: '09:00', to: '17:00',
      theatreId: theatreA.id, excludeBookingId: created.body.data.id,
    })
    assert.equal(at(blocked.body.data.slots[0].start), '10:30')
    assert.equal(at(freed.body.data.slots[0].start), '09:00')
  })

  test('a full day answers honestly with nothing', async () => {
    await clearBookings()
    await post(bookingBody({ theatreId: theatreA.id, scheduledStart: '2033-05-07T09:00', estimatedMinutes: 120 }))

    const res = await slots({
      date: '2033-05-07', estimatedMinutes: 60, from: '09:00', to: '10:00', theatreId: theatreA.id,
    })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.data.slots, [])
  })

  test('working hours come from the hospital, and can be overridden per request', async () => {
    await clearBookings()
    const night = await slots({ date: '2033-05-08', estimatedMinutes: 60, from: '20:00', to: '23:00' })
    assert.equal(night.body.data.hours.start, '20:00')
    assert.equal(at(night.body.data.slots[0].start), '20:00')

    // No override: whatever this hospital has saved, not a number written here.
    const normal = await slots({ date: '2033-05-08', estimatedMinutes: 60 })
    assert.match(normal.body.data.hours.start, /^\d\d:\d\d$/)
  })

  test('another hospital\'s theatre cannot be asked about', async () => {
    const res = await slots({ date: '2033-05-09', estimatedMinutes: 60, theatreId: theirTheatre.id })
    assert.equal(res.status, 404)
  })

  test('a missing date is refused', async () => {
    assert.equal((await slots({ estimatedMinutes: 60 })).status, 400)
  })

  test('30 February is refused rather than answered for 2 March', async () => {
    assert.equal((await slots({ date: '2033-02-30', estimatedMinutes: 60 })).status, 400)
  })

  test('a zero or negative length is refused', async () => {
    assert.equal((await slots({ date: '2033-05-10', estimatedMinutes: 0 })).status, 400)
    assert.equal((await slots({ date: '2033-05-10', estimatedMinutes: -30 })).status, 400)
  })

  // Empty means "the day is full", which is a real answer. Returning it for a
  // window that runs backwards would hide the mistake behind a plausible result.
  test('a list that ends before it starts is refused, not answered as full', async () => {
    const res = await slots({ date: '2033-05-11', estimatedMinutes: 60, from: '17:00', to: '08:00' })
    assert.equal(res.status, 400)
  })

  test('no token is refused', { skip: !AUTH_ENFORCED }, async () => {
    assert.equal((await slots({ date: '2033-05-12', estimatedMinutes: 60 }, { token: null })).status, 401)
  })

  test('a role that cannot book cannot see slots either', { skip: !AUTH_ENFORCED }, async () => {
    const res = await slots({ date: '2033-05-12', estimatedMinutes: 60 }, { token: tokens.lab_tech })
    assert.equal(res.status, 403)
  })
})

// Postpone and re-book are one round trip: a case comes off its slot with a
// reason, and later goes back on with a new one. The board is read as the truth
// about what is happening today, so a case that has been given a new time must
// not still be sitting under "postponed".
describe('postpone and re-book', () => {
  test('a postponed case that is given a new time is scheduled again', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2034-01-10T09:00', estimatedMinutes: 60 }))
    const id = created.body.data.id

    const off = await patch({ resource: 'status', id, status: 'POSTPONED', reason: 'Patient not ready' })
    assert.equal(off.status, 200)
    assert.equal(off.body.data.status, 'POSTPONED')

    const moved = await patch({
      resource: 'reschedule', id,
      scheduledStart: '2034-01-11T09:00', estimatedMinutes: 60,
      reason: 'Patient not ready — investigations now done',
    })
    assert.equal(moved.status, 200)
    assert.equal(moved.body.data.status, 'SCHEDULED',
      'a case with a new time is not postponed any more')
    assert.equal(new Date(moved.body.data.scheduledStart).getDate(), 11)
  })

  test('rescheduling a live case does not change its status', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2034-01-12T09:00', estimatedMinutes: 60 }))
    const id = created.body.data.id
    await patch({ resource: 'status', id, status: 'CONFIRMED' })

    const moved = await patch({
      resource: 'reschedule', id, scheduledStart: '2034-01-12T14:00', estimatedMinutes: 60, reason: 'List overran',
    })
    assert.equal(moved.status, 200)
    assert.equal(moved.body.data.status, 'CONFIRMED', 'a confirmed case stays confirmed when it moves')
  })

  test('the reason is kept on both halves of the round trip', async () => {
    await clearBookings()
    const created = await post(bookingBody({ scheduledStart: '2034-01-13T09:00', estimatedMinutes: 60 }))
    const id = created.body.data.id

    await patch({ resource: 'status', id, status: 'POSTPONED', reason: 'Equipment not available' })
    const off = await get(`/api/ot?resource=booking&id=${id}`)
    assert.equal(off.body.data.postponeReason, 'Equipment not available')

    await patch({
      resource: 'reschedule', id, scheduledStart: '2034-01-14T09:00', estimatedMinutes: 60,
      reason: 'Equipment not available — C-arm back in service',
    })
    const on = await get(`/api/ot?resource=booking&id=${id}`)
    assert.match(on.body.data.statusChangeNote, /C-arm back in service/)
  })

  test('a postponed case cannot be moved onto a slot that is taken', async () => {
    await clearBookings()
    const a = await post(bookingBody({ scheduledStart: '2034-01-15T09:00', estimatedMinutes: 60 }))
    await patch({ resource: 'status', id: a.body.data.id, status: 'POSTPONED', reason: 'Patient not ready' })

    // Someone else takes the theatre in the meantime.
    await post(bookingBody({ scheduledStart: '2034-01-16T09:00', estimatedMinutes: 60 }))

    const clash = await patch({
      resource: 'reschedule', id: a.body.data.id,
      scheduledStart: '2034-01-16T09:00', estimatedMinutes: 60, reason: 'Patient ready now',
    })
    assert.equal(clash.status, 409, 'the clash check runs on the re-book path too')
  })
})
