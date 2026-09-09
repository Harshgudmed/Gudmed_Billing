// Operation Theatre — the four case documents, tested over HTTP.
//
// Same harness as otHttp.test.js: the real Express app on a spare port, driven
// with fetch(), so authenticate, the route guard and the JSON parser are all in
// the path a tester would actually take.
//
// Run:  node --test --test-force-exit src/lib/__tests__/otClinical.test.js
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
let ourPatient, theirPatient, ourDoctor, theirDoctor
let theatre, theirTheatre, admission
let tokens = {}

// ── Harness ─────────────────────────────────────────────────────────────────

const tokenFor = (user, organizationId) => jwt.sign(
  { userId: user.id, id: user.id, organizationId, role: user.role, fullName: user.fullName, email: user.email },
  JWT_SECRET,
  { expiresIn: '1h' },
)

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
  const t = await res.text()
  let json = null
  try { json = JSON.parse(t) } catch { /* non-JSON body kept as text */ }
  return { status: res.status, body: json, text: t }
}

const read = (params, opts) =>
  api('GET', `/api/ot-clinical?${new URLSearchParams(params)}`, opts)
const save = (body, opts) => api('PATCH', '/api/ot-clinical', { body, ...opts })

// A fresh booking per test, so one test's document can never be another's.
// IN_THEATRE by default, because that is the state a case is in while it is
// being documented — and the operative note may only be written once the case is
// actually under way. Tests about the days BEFORE surgery pass 'SCHEDULED'
// explicitly, which is where the pre-op assessment lives.
async function freshBooking(status = 'IN_THEATRE', extra = {}) {
  return db.otBooking.create({
    data: {
      organizationId: ourOrg.id,
      patientId: ourPatient.id,
      theatreId: theatre.id,
      caseNumber: `OT-CLIN-${Math.random().toString(36).slice(2, 10)}`,
      procedureName: 'Clinical Test Procedure',
      scheduledStart: new Date('2032-01-10T09:00:00'),
      scheduledEnd: new Date('2032-01-10T10:00:00'),
      primarySurgeonId: ourDoctor.id,
      status,
      ...extra,
    },
  })
}

before(async () => {
  const app = express()
  app.use(cookieParser())
  app.use(express.json({ limit: '50mb' }))
  app.use('/api', apiRouter)
  app.use(errorHandler)
  await new Promise((r) => { server = app.listen(0, r) })
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const org = (name, slug) => db.organization.create({ data: { name, slug } })
  ourOrg = await org('Test Org — otClinical (ours)', `test-otclin-ours-${stamp}`)
  otherOrg = await org('Test Org — otClinical (theirs)', `test-otclin-theirs-${stamp}`)

  const patient = (organizationId, tag) => db.patient.create({
    data: {
      organizationId, mrn: `TESTMRN-CLIN-${tag}-${stamp}`,
      firstName: 'Clinical', lastName: `Patient ${tag}`,
      gender: 'other', dateOfBirth: new Date('1990-01-01'),
    },
  })
  ourPatient = await patient(ourOrg.id, 'OURS')
  theirPatient = await patient(otherOrg.id, 'THEIRS')

  const user = (organizationId, tag, role) => db.user.create({
    data: { organizationId, email: `otclin.${tag}.${stamp}@test.local`, fullName: `Clin ${tag}`, role },
  })
  ourDoctor = await user(ourOrg.id, 'doctor', 'doctor')
  theirDoctor = await user(otherOrg.id, 'theirdoctor', 'doctor')

  for (const role of ['doctor', 'nurse', 'receptionist', 'billing', 'pharmacist', 'lab_tech', 'admin']) {
    const u = role === 'doctor' ? ourDoctor : await user(ourOrg.id, role, role)
    tokens[role] = tokenFor(u, ourOrg.id)
  }
  tokens.otherOrg = tokenFor(theirDoctor, otherOrg.id)
  tokens.wrongSecret = jwt.sign({ userId: ourDoctor.id, organizationId: ourOrg.id, role: 'doctor' }, 'nope', { expiresIn: '1h' })
  tokens.expired = jwt.sign({ userId: ourDoctor.id, organizationId: ourOrg.id, role: 'doctor' }, JWT_SECRET, { expiresIn: -10 })
  tokens.patient = jwt.sign({ patientId: ourPatient.id, organizationId: ourOrg.id, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' })

  theatre = await db.operatingTheatre.create({
    data: { organizationId: ourOrg.id, name: `CLIN-OT-${stamp}`, cleaningMinutes: 30 },
  })
  theirTheatre = await db.operatingTheatre.create({
    data: { organizationId: otherOrg.id, name: `CLIN-OT-THEIRS-${stamp}` },
  })
  admission = await db.admission.create({
    data: { organizationId: ourOrg.id, patientId: ourPatient.id },
  })
})

after(async () => {
  await new Promise((r) => server?.close(r))
  const orgIds = [ourOrg?.id, otherOrg?.id].filter(Boolean)
  const where = { organizationId: { in: orgIds } }
  for (const model of [
    'otPreOpAssessment', 'otSafetyChecklist', 'otAnaesthesiaRecord', 'otOperativeNote',
    'otTeamMember', 'otBooking', 'operatingTheatre', 'surgeryCatalog',
    'admission', 'patient', 'user', 'billCounter',
  ]) {
    await db[model].deleteMany({ where }).catch(() => {})
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {})
})

// ── 1. Authentication ───────────────────────────────────────────────────────

describe('authentication', () => {
  test('no token is refused', { skip: !AUTH_ENFORCED }, async () => {
    const b = await freshBooking()
    assert.equal((await read({ resource: 'preop', bookingId: b.id }, { token: null })).status, 401)
    assert.equal((await save({ resource: 'preop', bookingId: b.id, diagnosis: 'x' }, { token: null })).status, 401)
  })

  test('a forged or expired token is refused', { skip: !AUTH_ENFORCED }, async () => {
    const b = await freshBooking()
    for (const token of [tokens.wrongSecret, tokens.expired]) {
      assert.equal((await read({ resource: 'preop', bookingId: b.id }, { token })).status, 401)
    }
  })

  test('a patient session cannot reach the case record', { skip: !AUTH_ENFORCED }, async () => {
    const b = await freshBooking()
    assert.equal((await read({ resource: 'preop', bookingId: b.id }, { token: tokens.patient })).status, 403)
  })
})

// ── 2. Who may write which document ─────────────────────────────────────────

describe('per-document permission', () => {
  test('lab and pharmacy are refused at the door', { skip: !AUTH_ENFORCED }, async () => {
    const b = await freshBooking()
    for (const role of ['pharmacist', 'lab_tech']) {
      assert.equal((await read({ resource: 'all', bookingId: b.id }, { token: tokens[role] })).status, 403, role)
    }
  })

  test('a nurse may run the checklist but not write clinical documents', { skip: !AUTH_ENFORCED }, async () => {
    const b = await freshBooking()
    assert.equal((await save({ resource: 'checklist', bookingId: b.id, identityConfirmed: true }, { token: tokens.nurse })).status, 200)

    for (const resource of ['preop', 'anaesthesia', 'opnote']) {
      const res = await save({ resource, bookingId: b.id, diagnosis: 'x', findings: 'x', asaGrade: 'II' }, { token: tokens.nurse })
      assert.equal(res.status, 403, `nurse should not write ${resource}`)
    }
  })

  test('a receptionist may read but writes nothing', { skip: !AUTH_ENFORCED }, async () => {
    const b = await freshBooking()
    assert.equal((await read({ resource: 'all', bookingId: b.id }, { token: tokens.receptionist })).status, 200)
    for (const resource of ['preop', 'checklist', 'anaesthesia', 'opnote']) {
      const res = await save({ resource, bookingId: b.id, diagnosis: 'x', identityConfirmed: true }, { token: tokens.receptionist })
      assert.equal(res.status, 403, `receptionist should not write ${resource}`)
    }
  })

  test('a doctor may write all four', { skip: !AUTH_ENFORCED }, async () => {
    const b = await freshBooking()
    assert.equal((await save({ resource: 'preop', bookingId: b.id, diagnosis: 'D' })).status, 200)
    assert.equal((await save({ resource: 'checklist', bookingId: b.id, siteMarked: true })).status, 200)
    assert.equal((await save({ resource: 'anaesthesia', bookingId: b.id, anaesthesiaType: 'GENERAL' })).status, 200)
    assert.equal((await save({ resource: 'opnote', bookingId: b.id, findings: 'F' })).status, 200)
  })
})

// ── 3. Cross-tenant ─────────────────────────────────────────────────────────

describe('cross-tenant isolation', () => {
  test("another hospital's case cannot be read or written", async () => {
    const theirBooking = await db.otBooking.create({
      data: {
        organizationId: otherOrg.id, patientId: theirPatient.id, theatreId: theirTheatre.id,
        caseNumber: `OT-THEIRS-CLIN-${stamp}`, procedureName: 'Theirs',
        scheduledStart: new Date('2032-02-01T09:00:00'), scheduledEnd: new Date('2032-02-01T10:00:00'),
        primarySurgeonId: theirDoctor.id, status: 'SCHEDULED',
      },
    })

    assert.equal((await read({ resource: 'all', bookingId: theirBooking.id })).status, 404)
    assert.equal((await save({ resource: 'preop', bookingId: theirBooking.id, diagnosis: 'leak' })).status, 404)

    const leaked = await db.otPreOpAssessment.findUnique({ where: { bookingId: theirBooking.id } })
    assert.equal(leaked, null, 'nothing may be written against another hospital')
    await db.otBooking.delete({ where: { id: theirBooking.id } })
  })

  test('an organizationId in the body is ignored — the token decides', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, diagnosis: 'D', organizationId: otherOrg.id })
    const row = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.organizationId, ourOrg.id)
  })
})

// ── 4. Addressing ───────────────────────────────────────────────────────────

describe('bookingId and resource', () => {
  test('a missing bookingId is refused', async () => {
    assert.equal((await read({ resource: 'all' })).status, 400)
    assert.equal((await save({ resource: 'preop', diagnosis: 'x' })).status, 400)
  })

  test('a bookingId that matches nothing is 404, not 500', async () => {
    const ghost = 'clzzzzzzzzzzzzzzzzzzzzzzz'
    assert.equal((await read({ resource: 'all', bookingId: ghost })).status, 404)
    assert.equal((await save({ resource: 'preop', bookingId: ghost, diagnosis: 'x' })).status, 404)
  })

  test('junk bookingIds are refused, never crashed on', async () => {
    for (const id of ['../../etc/passwd', "' OR 1=1 --", '<script>alert(1)</script>', 'a'.repeat(400)]) {
      const res = await read({ resource: 'all', bookingId: id })
      assert.ok(res.status === 404 || res.status === 400, `id gave ${res.status}`)
    }
  })

  test('an unknown resource is refused', async () => {
    const b = await freshBooking()
    for (const resource of ['nonsense', '', 'PREOP', 'pre-op']) {
      assert.equal((await read({ resource, bookingId: b.id })).status, 400, `read ${resource}`)
      assert.equal((await save({ resource, bookingId: b.id, diagnosis: 'x' })).status, 400, `save ${resource}`)
    }
  })

  test('an empty save is refused rather than writing a blank document', async () => {
    const b = await freshBooking()
    const res = await save({ resource: 'preop', bookingId: b.id })
    assert.equal(res.status, 400)
    assert.equal(await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } }), null)
  })

  test('a body that is not JSON returns 400, not 500', async () => {
    const res = await api('PATCH', '/api/ot-clinical', { raw: 'not json', headers: { 'Content-Type': 'application/json' } })
    assert.equal(res.status, 400)
  })
})

// ── 5. Allowed values ───────────────────────────────────────────────────────

describe('coded values', () => {
  test('an unknown ASA grade is refused, on both documents that carry it', async () => {
    const b = await freshBooking()
    for (const resource of ['preop', 'anaesthesia']) {
      const res = await save({ resource, bookingId: b.id, asaGrade: 'VII' })
      assert.equal(res.status, 400, resource)
      assert.match(res.body.error, /asaGrade/)
    }
  })

  test('every real ASA grade is accepted, including the emergency suffix', async () => {
    const b = await freshBooking()
    for (const grade of ['I', 'II', 'III', 'IV', 'V', 'VI', 'IE', 'IVE']) {
      assert.equal((await save({ resource: 'preop', bookingId: b.id, asaGrade: grade })).status, 200, grade)
    }
  })

  test('an unknown fitness is refused, on both the assessment and the re-assessment', async () => {
    const b = await freshBooking()
    assert.equal((await save({ resource: 'preop', bookingId: b.id, fitness: 'MAYBE' })).status, 400)
    assert.equal((await save({ resource: 'preop', bookingId: b.id, reassessFitness: 'PROBABLY' })).status, 400)
  })

  test('unknown anaesthesia codes are refused', async () => {
    const b = await freshBooking()
    const cases = [
      ['anaesthesiaType', 'HYPNOSIS'],
      ['airwayDevice', 'STRAW'],
      ['ventilationMode', 'MANUAL'],
    ]
    for (const [field, value] of cases) {
      const res = await save({ resource: 'anaesthesia', bookingId: b.id, [field]: value })
      assert.equal(res.status, 400, field)
      assert.match(res.body.error, new RegExp(field))
    }
  })

  test('lower case is not silently accepted — the stored value must be the code', async () => {
    const b = await freshBooking()
    assert.equal((await save({ resource: 'anaesthesia', bookingId: b.id, anaesthesiaType: 'general' })).status, 400)
  })
})

// ── 6. Numbers ──────────────────────────────────────────────────────────────

describe('numeric fields', () => {
  test('counts must be whole and non-negative', async () => {
    const b = await freshBooking()
    for (const field of ['swabInitial', 'swabFinal', 'instrumentFinal', 'needleInitial']) {
      for (const value of ['abc', -1, 4.5, 1000, '1e999']) {
        const res = await save({ resource: 'checklist', bookingId: b.id, [field]: value })
        assert.equal(res.status, 400, `${field}=${value} gave ${res.status}`)
      }
    }
  })

  test('a count of zero is valid — nothing was used', async () => {
    const b = await freshBooking()
    assert.equal((await save({ resource: 'checklist', bookingId: b.id, needleInitial: 0, needleFinal: 0 })).status, 200)
    const row = await db.otSafetyChecklist.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.needleInitial, 0)
  })

  test('vitals outside the physiological range are refused', async () => {
    const b = await freshBooking()
    const cases = [
      ['systolicBp', 500], ['systolicBp', 10],
      ['diastolicBp', 400], ['heartRate', 5], ['heartRate', 400],
      ['spo2', 200], ['spo2', 10],
      ['mallampati', 0], ['mallampati', 5],
      ['heightCm', 5], ['heightCm', 400],
      ['weightKg', 0], ['weightKg', 900],
      ['haemoglobin', 0.1], ['haemoglobin', 99],
    ]
    for (const [field, value] of cases) {
      const res = await save({ resource: 'preop', bookingId: b.id, [field]: value })
      assert.equal(res.status, 400, `${field}=${value} gave ${res.status}`)
    }
  })

  test('sensible vitals are accepted', async () => {
    const b = await freshBooking()
    const res = await save({
      resource: 'preop', bookingId: b.id,
      systolicBp: 124, diastolicBp: 78, heartRate: 72, spo2: 98,
      mallampati: 2, heightCm: 170, weightKg: 68, haemoglobin: 13.2,
    })
    assert.equal(res.status, 200)
  })

  test('blood loss and fluids are bounded', async () => {
    const b = await freshBooking()
    assert.equal((await save({ resource: 'opnote', bookingId: b.id, bloodLossMl: -50 })).status, 400)
    assert.equal((await save({ resource: 'opnote', bookingId: b.id, bloodLossMl: 99999 })).status, 400)
    assert.equal((await save({ resource: 'anaesthesia', bookingId: b.id, fluidsMl: -1 })).status, 400)
    assert.equal((await save({ resource: 'anaesthesia', bookingId: b.id, bloodUnits: 99 })).status, 400)
  })

  test('blank is "not sent", not zero', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, heartRate: 80 })
    await save({ resource: 'preop', bookingId: b.id, heartRate: '' })
    const row = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.heartRate, 80, 'a blank must not overwrite a real reading with 0')
  })

  // A surgery abandoned after induction and one that finished as planned used to
  // be the same record: same fields, same shape, nothing to tell them apart. The
  // bill differs, the audit counts them separately, and the abandoned one is the
  // case a coroner asks about.
  test('how the case ended is recorded, and only in the words the system knows', async () => {
    const b = await freshBooking()

    for (const status of ['COMPLETED', 'MODIFIED', 'ABANDONED']) {
      const res = await save({ resource: 'opnote', bookingId: b.id, procedureStatus: status })
      assert.equal(res.status, 200, `${status} should be accepted`)
    }

    const row = await db.otOperativeNote.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.procedureStatus, 'ABANDONED')
  })

  test('a made-up ending is refused', async () => {
    const b = await freshBooking()
    // "cancelled" is a booking status, not an ending — accepting it here would
    // put a word into a column that no report knows how to count.
    for (const bad of ['CANCELLED', 'completed', 'DONE', 'Abandoned']) {
      const res = await save({ resource: 'opnote', bookingId: b.id, procedureStatus: bad })
      assert.equal(res.status, 400, `${bad} should be refused`)
    }
  })

  test('where the patient was handed over is recorded', async () => {
    const b = await freshBooking()

    for (const where of ['RECOVERY', 'ICU', 'HDU', 'WARD', 'HOME']) {
      const res = await save({ resource: 'opnote', bookingId: b.id, patientDestination: where })
      assert.equal(res.status, 200, `${where} should be accepted`)
    }

    const row = await db.otOperativeNote.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.patientDestination, 'HOME')
  })

  test('a made-up destination is refused', async () => {
    const b = await freshBooking()
    for (const bad of ['PACU', 'Ward 3', 'icu', 'THEATRE']) {
      const res = await save({ resource: 'opnote', bookingId: b.id, patientDestination: bad })
      assert.equal(res.status, 400, `${bad} should be refused`)
    }
  })

  // Both are optional: an operative note written while the patient is still on
  // the table has neither answer yet, and demanding them would mean the findings
  // could not be written down until the case was over.
  test('both stay optional — the findings can be saved before either is known', async () => {
    const b = await freshBooking()
    const res = await save({ resource: 'opnote', bookingId: b.id, findings: 'Dense adhesions' })
    assert.equal(res.status, 200)

    const row = await db.otOperativeNote.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.procedureStatus, null)
    assert.equal(row.patientDestination, null)
  })

  // The contract every field in this file shares, checked on the two new ones:
  // a field that is NOT SENT is left alone, and an empty one is deliberately
  // cleared. The first half is what stops the surgeon's tab blanking what the
  // anaesthetist wrote; the second is how a wrong answer gets taken back.
  test('not sending a value leaves it alone; sending a blank clears it', async () => {
    const b = await freshBooking()
    await save({ resource: 'opnote', bookingId: b.id, procedureStatus: 'COMPLETED', patientDestination: 'ICU' })

    // Someone else saves a different part of the same note.
    await save({ resource: 'opnote', bookingId: b.id, findings: 'Written by someone else' })
    let row = await db.otOperativeNote.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.procedureStatus, 'COMPLETED', 'an untouched field must survive another edit')
    assert.equal(row.patientDestination, 'ICU')

    // Now cleared on purpose.
    await save({ resource: 'opnote', bookingId: b.id, procedureStatus: '', patientDestination: '' })
    row = await db.otOperativeNote.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.procedureStatus, null, 'clearing the box takes the answer back')
    assert.equal(row.patientDestination, null)
  })
})

// ── 7. Dates ────────────────────────────────────────────────────────────────

describe('dates', () => {
  test('unparseable dates are refused and name the field', async () => {
    const b = await freshBooking()
    for (const value of ['hello', '2032-13-01', '2032-02-30T09:00', '99999-01-01']) {
      const res = await save({ resource: 'opnote', bookingId: b.id, incisionAt: value })
      assert.equal(res.status, 400, `${value} gave ${res.status}`)
      assert.match(res.body.error, /incisionAt/)
    }
  })

  test('closure cannot be at or before incision', async () => {
    const b = await freshBooking()
    for (const [incisionAt, closureAt] of [
      ['2032-01-10T10:00', '2032-01-10T10:00'],
      ['2032-01-10T10:00', '2032-01-10T09:00'],
    ]) {
      const res = await save({ resource: 'opnote', bookingId: b.id, incisionAt, closureAt })
      assert.equal(res.status, 400)
      assert.match(res.body.error, /Closure/)
    }
  })

  test('reversal cannot be at or before induction', async () => {
    const b = await freshBooking()
    const res = await save({
      resource: 'anaesthesia', bookingId: b.id,
      inductionAt: '2032-01-10T10:00', reversalAt: '2032-01-10T09:30',
    })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /Reversal/)
  })

  test('a sensible operative window is accepted', async () => {
    const b = await freshBooking()
    const res = await save({
      resource: 'opnote', bookingId: b.id,
      incisionAt: '2032-01-10T09:10', closureAt: '2032-01-10T09:55',
    })
    assert.equal(res.status, 200)
  })
})

// ── 8. Save semantics ───────────────────────────────────────────────────────

describe('saving', () => {
  test('saving twice updates one document, never creates a second', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, diagnosis: 'First' })
    await save({ resource: 'preop', bookingId: b.id, diagnosis: 'Second' })

    const rows = await db.otPreOpAssessment.findMany({ where: { bookingId: b.id } })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].diagnosis, 'Second')
  })

  test('a partial save leaves the sections it did not touch alone', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, diagnosis: 'Cholelithiasis', allergies: 'Penicillin', asaGrade: 'II' })
    await save({ resource: 'preop', bookingId: b.id, fitness: 'FIT' })

    const row = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.diagnosis, 'Cholelithiasis', 'the anaesthetist must not blank the surgeon`s half')
    assert.equal(row.allergies, 'Penicillin')
    assert.equal(row.asaGrade, 'II')
    assert.equal(row.fitness, 'FIT')
  })

  test('the four documents are independent', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, diagnosis: 'D' })
    await save({ resource: 'opnote', bookingId: b.id, findings: 'F' })

    const record = (await read({ resource: 'all', bookingId: b.id })).body.data
    assert.equal(record.preop.diagnosis, 'D')
    assert.equal(record.opnote.findings, 'F')
    assert.equal(record.checklist, null)
    assert.equal(record.anaesthesia, null)
  })

  test('whitespace is trimmed, and a field cleared to blank becomes null', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, diagnosis: '   Appendicitis   ' })
    let row = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.diagnosis, 'Appendicitis')

    await save({ resource: 'preop', bookingId: b.id, diagnosis: '   ' })
    row = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.diagnosis, null)
  })

  test('unicode and very long text survive', async () => {
    const b = await freshBooking()
    const note = 'शल्यक्रिया 🔪 ' + 'A'.repeat(5000)
    const res = await save({ resource: 'opnote', bookingId: b.id, procedureNote: note })
    assert.equal(res.status, 200)
    const row = await db.otOperativeNote.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.procedureNote, note)
  })
})

// ── 9. Who signed it ────────────────────────────────────────────────────────
// A record that names a signer must mean it, so every name comes from the
// session and none from the body.

describe('signatures', () => {
  test('the assessor is taken from the session, not the body', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, fitness: 'FIT', assessedByName: 'Dr Fake', assessedById: 'forged' })

    const row = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.assessedByName, ourDoctor.fullName)
    assert.equal(row.assessedById, ourDoctor.id)
    assert.ok(row.assessedAt, 'the time of the decision must be stamped')
  })

  test('a re-assessment is stamped separately from the first assessment', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, fitness: 'FIT' })
    const first = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })

    await save({ resource: 'preop', bookingId: b.id, reassessFitness: 'FIT_WITH_CONDITIONS', reassessNote: 'BP high' })
    const after = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })

    assert.equal(after.fitness, 'FIT', 'the first decision must remain readable')
    assert.equal(after.reassessFitness, 'FIT_WITH_CONDITIONS')
    assert.equal(after.assessedAt.getTime(), first.assessedAt.getTime())
    assert.ok(after.reassessedAt)
  })

  test('editing a field that is not the decision does not re-stamp the signature', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, fitness: 'FIT' })
    const first = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })

    await new Promise((r) => setTimeout(r, 20))
    await save({ resource: 'preop', bookingId: b.id, allergies: 'Sulfa' })
    const after = await db.otPreOpAssessment.findUnique({ where: { bookingId: b.id } })

    assert.equal(after.assessedAt.getTime(), first.assessedAt.getTime(), 'a typo fix is not a new assessment')
  })

  test('each checklist phase stamps its own time and signer', async () => {
    const b = await freshBooking()

    await save({ resource: 'checklist', bookingId: b.id, phase: 'signIn', identityConfirmed: true }, { token: tokens.nurse })
    let row = await db.otSafetyChecklist.findUnique({ where: { bookingId: b.id } })
    assert.ok(row.signInAt)
    assert.equal(row.timeOutAt, null, 'signing in must not sign the Time Out')
    assert.equal(row.signOutAt, null)

    await save({ resource: 'checklist', bookingId: b.id, phase: 'timeOut', teamIntroduced: true }, { token: tokens.nurse })
    row = await db.otSafetyChecklist.findUnique({ where: { bookingId: b.id } })
    assert.ok(row.timeOutAt)
    assert.equal(row.signOutAt, null)

    await save({ resource: 'checklist', bookingId: b.id, phase: 'signOut', procedureRecorded: true }, { token: tokens.nurse })
    row = await db.otSafetyChecklist.findUnique({ where: { bookingId: b.id } })
    assert.ok(row.signOutAt)
    assert.ok(row.signInAt <= row.timeOutAt && row.timeOutAt <= row.signOutAt, 'the three moments must be in order')
  })

  test('ticking boxes without a phase records the ticks but signs nothing', async () => {
    const b = await freshBooking()
    await save({ resource: 'checklist', bookingId: b.id, identityConfirmed: true }, { token: tokens.nurse })
    const row = await db.otSafetyChecklist.findUnique({ where: { bookingId: b.id } })
    assert.equal(row.identityConfirmed, true)
    assert.equal(row.signInAt, null, 'a tick is not a signature')
  })

  test('the person who counted is recorded with the counts', async () => {
    const b = await freshBooking()
    await save({ resource: 'checklist', bookingId: b.id, swabInitial: 10, swabFinal: 10, countsCorrect: true }, { token: tokens.nurse })
    const row = await db.otSafetyChecklist.findUnique({ where: { bookingId: b.id } })
    assert.ok(row.countedByName, '"correct" with nobody attached is the failure this record exists to catch')
  })
})

// ── 10. A cancelled case ────────────────────────────────────────────────────

describe('cancelled cases', () => {
  test('nothing can be recorded against a cancelled case', async () => {
    const b = await freshBooking('CANCELLED', { cancelReason: 'Patient unfit' })
    for (const resource of ['preop', 'checklist', 'anaesthesia', 'opnote']) {
      const res = await save({ resource, bookingId: b.id, diagnosis: 'x', findings: 'x', identityConfirmed: true })
      assert.equal(res.status, 409, resource)
      assert.equal(res.body.code, 'OT_CASE_CANCELLED')
    }
  })

  test('a cancelled case can still be READ — its record is why it was called off', async () => {
    const b = await freshBooking('SCHEDULED')
    await save({ resource: 'preop', bookingId: b.id, fitness: 'UNFIT', fitnessNote: 'Chest infection' })
    await db.otBooking.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelReason: 'Unfit' } })

    const res = await read({ resource: 'all', bookingId: b.id })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.preop.fitness, 'UNFIT')
  })

  test('a completed case can still be documented — the note is written afterwards', async () => {
    const b = await freshBooking('COMPLETED')
    const res = await save({ resource: 'opnote', bookingId: b.id, procedurePerformed: 'Appendicectomy', findings: 'Inflamed' })
    assert.equal(res.status, 200)
  })
})

// "minor bleeding controlled" is a fine sentence and a useless row: counting
// bleeding complications across a year meant searching text for words nobody
// agreed on. The kinds are now coded; the sentence is kept beside them.
describe('complications, as kinds and words', () => {
  const ALL = ['BLEEDING', 'INFECTION', 'ORGAN_INJURY', 'ANAESTHESIA',
    'CARDIOVASCULAR', 'RESPIRATORY', 'EQUIPMENT', 'OTHER']

  const stored = (id) => db.otOperativeNote.findUnique({ where: { bookingId: id } })

  test('every canonical code is accepted', async () => {
    const b = await freshBooking()
    for (const code of ALL) {
      const res = await save({
        resource: 'opnote', bookingId: b.id,
        complicationTypes: [code],
        // OTHER is the one that needs words; giving them for all keeps this test
        // about the codes.
        complication: 'Detail',
      })
      assert.equal(res.status, 200, code)
    }
  })

  test('a code that is not in the taxonomy is refused', async () => {
    const b = await freshBooking()
    // Case matters: "bleeding" and "BLEEDING" would count as two things in a
    // report, so only the canonical spelling is a code.
    for (const nonsense of ['bleeding', 'HAEMORRHAGE', 'Blood loss', 'SEPSIS', 'Bleeding']) {
      const res = await save({ resource: 'opnote', bookingId: b.id, complicationTypes: [nonsense] })
      assert.equal(res.status, 400, `${nonsense} should be refused`)
    }
  })

  // Stray whitespace is not a different complication. It is trimmed and stored
  // canonically rather than refused — a space picked up from a copy-paste should
  // not lose the surgeon their answer.
  test('surrounding whitespace is cleaned, not rejected', async () => {
    const b = await freshBooking()
    const res = await save({
      resource: 'opnote', bookingId: b.id, complicationTypes: ['  BLEEDING  ', 'INFECTION'],
    })
    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse((await stored(b.id)).complicationTypes), ['BLEEDING', 'INFECTION'])
  })

  test('something that is not a list at all is refused', async () => {
    const b = await freshBooking()
    for (const notAList of ['BLEEDING', '{"a":1}', 'not json', 42]) {
      const res = await save({ resource: 'opnote', bookingId: b.id, complicationTypes: notAList })
      assert.equal(res.status, 400, `${JSON.stringify(notAList)} should be refused`)
    }
  })

  // The three states this column has to keep apart. Reading "no complications"
  // off an unanswered field is how an audit comes to believe a hospital never
  // has any.
  test('not answered, answered none, and answered yes are three different things', async () => {
    const b = await freshBooking()

    await save({ resource: 'opnote', bookingId: b.id, findings: 'Nothing said about complications' })
    assert.equal((await stored(b.id)).complicationTypes, null, 'unanswered stays null')

    await save({ resource: 'opnote', bookingId: b.id, complicationTypes: [] })
    assert.equal((await stored(b.id)).complicationTypes, '[]', 'an explicit none is not null')

    await save({ resource: 'opnote', bookingId: b.id, complicationTypes: ['BLEEDING'] })
    assert.deepEqual(JSON.parse((await stored(b.id)).complicationTypes), ['BLEEDING'])
  })

  test('an answer can be taken back to unanswered', async () => {
    const b = await freshBooking()
    await save({ resource: 'opnote', bookingId: b.id, complicationTypes: ['INFECTION'] })
    await save({ resource: 'opnote', bookingId: b.id, complicationTypes: '' })
    assert.equal((await stored(b.id)).complicationTypes, null)
  })

  test('not sending it leaves the answer alone', async () => {
    const b = await freshBooking()
    await save({ resource: 'opnote', bookingId: b.id, complicationTypes: ['RESPIRATORY'] })
    await save({ resource: 'opnote', bookingId: b.id, findings: 'Someone else edits the findings' })
    assert.deepEqual(JSON.parse((await stored(b.id)).complicationTypes), ['RESPIRATORY'])
  })

  // "Other" says a kind occurred that the list cannot name. Without the words,
  // the record says something happened and refuses to say what — worse than no
  // answer, because it looks like one.
  test('Other needs words', async () => {
    const b = await freshBooking()
    assert.equal((await save({
      resource: 'opnote', bookingId: b.id, complicationTypes: ['OTHER'],
    })).status, 400)

    assert.equal((await save({
      resource: 'opnote', bookingId: b.id, complicationTypes: ['OTHER'], complication: '   ',
    })).status, 400)

    assert.equal((await save({
      resource: 'opnote', bookingId: b.id,
      complicationTypes: ['OTHER'], complication: 'Retained swab found on count',
    })).status, 200)
  })

  test('the other codes do not need words', async () => {
    const b = await freshBooking()
    const res = await save({ resource: 'opnote', bookingId: b.id, complicationTypes: ['BLEEDING'] })
    assert.equal(res.status, 200)
  })

  test('duplicates collapse rather than being stored twice', async () => {
    const b = await freshBooking()
    await save({
      resource: 'opnote', bookingId: b.id,
      complicationTypes: ['BLEEDING', 'BLEEDING', 'INFECTION'],
    })
    assert.deepEqual(JSON.parse((await stored(b.id)).complicationTypes), ['BLEEDING', 'INFECTION'])
  })

  // Rule 6 and 7 of the brief: nothing historical is touched.
  test('an older free-text complication survives untouched', async () => {
    const b = await freshBooking()
    // Written the way notes were written before the codes existed.
    await db.otOperativeNote.create({
      data: {
        organizationId: ourOrg.id, bookingId: b.id,
        complication: 'minor bleeding controlled with diathermy',
      },
    })

    const read1 = await read({ resource: 'all', bookingId: b.id })
    assert.equal(read1.body.data.opnote.complication, 'minor bleeding controlled with diathermy')
    assert.equal(read1.body.data.opnote.complicationTypes, null, 'an old note is unanswered, not "none"')

    // Coding it later must not eat the sentence.
    await save({ resource: 'opnote', bookingId: b.id, complicationTypes: ['BLEEDING'] })
    const row = await stored(b.id)
    assert.equal(row.complication, 'minor bleeding controlled with diathermy')
    assert.deepEqual(JSON.parse(row.complicationTypes), ['BLEEDING'])
  })

  test('one hospital cannot write complications onto another hospital\'s case', async () => {
    const b = await freshBooking()
    const res = await save(
      { resource: 'opnote', bookingId: b.id, complicationTypes: ['BLEEDING'] },
      { token: tokens.otherOrg },
    )
    assert.equal(res.status, 404, 'another hospital must not even find this case')
    assert.equal((await stored(b.id)) , null, 'and must not have created a row for it')
  })

  test('one hospital cannot read another hospital\'s complications', async () => {
    const b = await freshBooking()
    await save({ resource: 'opnote', bookingId: b.id, complicationTypes: ['CARDIOVASCULAR'] })

    const res = await read({ resource: 'all', bookingId: b.id }, { token: tokens.otherOrg })
    assert.equal(res.status, 404)
  })
})

// An operative note describes an operation. A case that has not started has none
// of the facts it asks for, and one written against a postponed case is a record
// of a surgery that never happened — which is the wrong kind of wrong, because
// it reads as evidence.
describe('an operative note needs a case that actually happened', () => {
  for (const status of ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'POSTPONED']) {
    test(`refused while the case is ${status}`, async () => {
      const b = await freshBooking(status)
      const res = await save({ resource: 'opnote', bookingId: b.id, findings: 'Nothing has happened yet' })
      assert.equal(res.status, 409)
      assert.equal(res.body.code, 'OT_CASE_NOT_STARTED')
      assert.match(res.body.error, /operative note/)
    })
  }

  for (const status of ['IN_THEATRE', 'COMPLETED']) {
    test(`allowed once the case is ${status}`, async () => {
      const b = await freshBooking(status)
      const res = await save({ resource: 'opnote', bookingId: b.id, findings: 'Dense adhesions' })
      assert.equal(res.status, 200)
    })
  }

  // The point of the pre-op assessment is that it happens BEFORE the day. It
  // must not be swept up by the same rule.
  test('the pre-op assessment is still written before the day', async () => {
    for (const status of ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN']) {
      const b = await freshBooking(status)
      const res = await save({ resource: 'preop', bookingId: b.id, fitness: 'FIT' })
      assert.equal(res.status, 200, `preop should be writable while ${status}`)
    }
  })

  // The assessment did happen, even though the surgery did not. Locking it after
  // a postponement would leave a wrong reading with no way to correct it.
  test('a postponed case can still have its pre-op assessment corrected', async () => {
    const b = await freshBooking('POSTPONED', { postponeReason: 'Patient not ready' })
    const res = await save({ resource: 'preop', bookingId: b.id, fitnessNote: 'Chest clear on review' })
    assert.equal(res.status, 200)
  })

  // Blocking the write must not hide what is already there: a case that ran and
  // was documented, then somehow moved, still has a note worth reading.
  test('an existing note stays readable whatever the case status becomes', async () => {
    const b = await freshBooking('IN_THEATRE')
    await save({ resource: 'opnote', bookingId: b.id, findings: 'Written while it was under way' })
    await db.otBooking.update({ where: { id: b.id }, data: { status: 'POSTPONED' } })

    const res = await read({ resource: 'all', bookingId: b.id })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.opnote.findings, 'Written while it was under way')
  })
})

// ── 11. Reads ───────────────────────────────────────────────────────────────

describe('reads', () => {
  test('an untouched case reads as four nulls, not an error', async () => {
    const b = await freshBooking()
    const res = await read({ resource: 'all', bookingId: b.id })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.data, { preop: null, checklist: null, anaesthesia: null, opnote: null })
  })

  test('a single document reads on its own', async () => {
    const b = await freshBooking()
    await save({ resource: 'anaesthesia', bookingId: b.id, anaesthesiaType: 'SPINAL' })
    const res = await read({ resource: 'anaesthesia', bookingId: b.id })
    assert.equal(res.body.data.anaesthesiaType, 'SPINAL')
  })

  test('no password or hash ever reaches the client', async () => {
    const b = await freshBooking()
    await save({ resource: 'preop', bookingId: b.id, fitness: 'FIT' })
    const res = await read({ resource: 'all', bookingId: b.id })
    assert.equal(/passwordHash|"password"/.test(res.text), false)
  })

  test('an error names the problem without a stack trace', async () => {
    const b = await freshBooking()
    const res = await save({ resource: 'preop', bookingId: b.id, asaGrade: 'ZZ' })
    assert.equal(res.body.success, false)
    assert.equal(typeof res.body.error, 'string')
    assert.equal(/at .*\.js:\d+/.test(res.text), false)
  })
})

// ── 12. Concurrency ─────────────────────────────────────────────────────────

describe('concurrency', () => {
  test('two people saving different halves at once both land', async () => {
    const b = await freshBooking()
    await Promise.all([
      save({ resource: 'preop', bookingId: b.id, diagnosis: 'Cholelithiasis' }),
      save({ resource: 'anaesthesia', bookingId: b.id, anaesthesiaType: 'GENERAL' }),
    ])

    const record = (await read({ resource: 'all', bookingId: b.id })).body.data
    assert.equal(record.preop.diagnosis, 'Cholelithiasis')
    assert.equal(record.anaesthesia.anaesthesiaType, 'GENERAL')
  })

  test('parallel first-saves of the same document produce one row, not two', async () => {
    const b = await freshBooking()
    const results = await Promise.allSettled([
      save({ resource: 'opnote', bookingId: b.id, findings: 'A' }),
      save({ resource: 'opnote', bookingId: b.id, findings: 'B' }),
      save({ resource: 'opnote', bookingId: b.id, findings: 'C' }),
    ])

    const ok = results.filter((r) => r.value?.status === 200)
    assert.ok(ok.length >= 1, 'at least one save must succeed')

    const rows = await db.otOperativeNote.findMany({ where: { bookingId: b.id } })
    assert.equal(rows.length, 1, 'the one-per-case rule must hold under a race')
  })
})

// ── 13. The whole journey ───────────────────────────────────────────────────

describe('a complete case, end to end', () => {
  test('assess, sign in, time out, anaesthetise, operate, count, sign out', async () => {
    const b = await freshBooking('CONFIRMED', { admissionId: admission.id })

    assert.equal((await save({
      resource: 'preop', bookingId: b.id,
      diagnosis: 'Symptomatic cholelithiasis',
      indication: 'Recurrent biliary colic',
      asaGrade: 'II', mallampati: 2, allergies: 'None known',
      systolicBp: 126, diastolicBp: 80, heartRate: 76, spo2: 98,
      bloodGroup: 'B+', haemoglobin: 12.9,
      consentTaken: true, consentBy: 'Patient', fitness: 'FIT',
    })).status, 200)

    assert.equal((await save({
      resource: 'checklist', bookingId: b.id, phase: 'signIn',
      identityConfirmed: true, siteMarked: true, consentConfirmed: true,
      anaesthesiaCheck: true, pulseOximeterOn: true,
    }, { token: tokens.nurse })).status, 200)

    assert.equal((await save({
      resource: 'checklist', bookingId: b.id, phase: 'timeOut',
      teamIntroduced: true, patientSiteAgreed: true, antibioticGiven: true,
    }, { token: tokens.nurse })).status, 200)

    // The patient is wheeled in. Everything from here describes an operation
    // that is actually happening — which is exactly what the operative note is
    // now gated on.
    await db.otBooking.update({ where: { id: b.id }, data: { status: 'IN_THEATRE' } })

    assert.equal((await save({
      resource: 'anaesthesia', bookingId: b.id,
      anaesthesiaType: 'GENERAL', asaGrade: 'II', airwayDevice: 'ETT', tubeSize: '7.5',
      ventilationMode: 'CONTROLLED', drugsGiven: 'Propofol 120 mg',
      fluidsMl: 1000, inductionAt: '2032-01-10T09:05', reversalAt: '2032-01-10T09:55',
    })).status, 200)

    assert.equal((await save({
      resource: 'opnote', bookingId: b.id,
      incisionAt: '2032-01-10T09:10', closureAt: '2032-01-10T09:50',
      findings: 'Thick-walled gallbladder, multiple calculi',
      procedurePerformed: 'Laparoscopic cholecystectomy',
      procedureStatus: 'COMPLETED', patientDestination: 'RECOVERY',
      complication: 'Nil', specimenSent: true, specimenDetail: 'Gallbladder to histopathology',
      bloodLossMl: 50,
    })).status, 200)

    assert.equal((await save({
      resource: 'checklist', bookingId: b.id, phase: 'signOut',
      procedureRecorded: true, specimenLabelled: true,
      swabInitial: 12, swabFinal: 12,
      instrumentInitial: 45, instrumentFinal: 45,
      needleInitial: 6, needleFinal: 6, countsCorrect: true,
    }, { token: tokens.nurse })).status, 200)

    const r = (await read({ resource: 'all', bookingId: b.id })).body.data

    assert.equal(r.preop.fitness, 'FIT')
    assert.equal(r.preop.assessedByName, ourDoctor.fullName)
    assert.ok(r.checklist.signInAt && r.checklist.timeOutAt && r.checklist.signOutAt)
    assert.equal(r.checklist.countsCorrect, true)
    assert.equal(r.checklist.swabInitial, r.checklist.swabFinal)
    assert.equal(r.anaesthesia.anaesthesiaType, 'GENERAL')
    assert.ok(new Date(r.anaesthesia.reversalAt) > new Date(r.anaesthesia.inductionAt))
    assert.equal(r.opnote.procedurePerformed, 'Laparoscopic cholecystectomy')
    assert.ok(new Date(r.opnote.closureAt) > new Date(r.opnote.incisionAt))

    // The operative note is what the bill follows, so it must be able to differ
    // from the procedure the case was booked as.
    assert.notEqual(r.opnote.procedurePerformed, b.procedureName)
  })
})
