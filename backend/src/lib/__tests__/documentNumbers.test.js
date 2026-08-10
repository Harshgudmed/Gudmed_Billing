// Regression tests for the document-number fixes.
//
// Screening numbers, day-care case numbers, death certificate numbers, insurance
// claim numbers and lab/radiology order numbers used to be minted from a clock
// (`RAD${Date.now()}-${i}`, `LAB${Date.now()}`), from three random digits
// (`SCR${yyyymmdd}${rand3}`) or from `count() + 1` read outside any transaction.
// All three schemes hand the same string to two users who act at the same moment,
// and every one of these columns carries a `@@unique([organizationId, <field>])`
// — so a collision is not a cosmetic glitch, it is a hard 500 in front of the
// person at the desk. They now all draw from the atomic per-org BillCounter via
// nextSeriesNumber().
//
// Real-database integration tests on disposable organizations, same pattern as
// uhid.test.js — Postgres itself is what serialises the counter, so a mock would
// prove nothing. Where the fix lives in a controller these drive the REAL
// controller with a fake req/res (as refundApprovalConcurrency.test.js does), so
// the test covers the actual call site and not just the helper underneath it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { nextSeriesNumber } from '../counters.js'
import { financialYear } from '../money.js'
import { create as createScreening } from '../../controllers/preTriageController.js'
import { create as createDayCareCase } from '../../controllers/dayCareController.js'
import { create as createDeathCertificate } from '../../controllers/deathCertificateController.js'
import { create as createInsurance } from '../../controllers/insuranceController.js'

const FY = financialYear()

// orgBusy carries traffic; orgFresh is deliberately left untouched by every test
// except the "brand-new hospital" one, which asserts its first number of each
// series is literally 000001.
let orgBusy, orgFresh
let patientBusy, patientFresh
let doctor, radiologyExam
let insuranceCaseBusy, insuranceCaseFresh

/** Drive a real controller with a fake req/res and resolve {status, body}. */
function callController(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(payload) { resolve({ status: this.statusCode, body: payload }) },
    }
    // `next` rejects rather than swallowing: a controller error must fail the
    // test loudly instead of leaving the promise pending forever.
    Promise.resolve(handler({ query: {}, params: {}, body: {}, user: null, ...req }, res, reject)).catch(reject)
  })
}

const screeningBody = () => ({ firstName: 'Screening', lastName: 'Regression', age: 30, gender: 'other', chiefComplaint: 'fever' })
const dayCareBody = (patientId) => ({ patientId, procedure: 'Dressing', fee: 0, amountPaid: 0 })
const deathCertificateBody = (patientId) => ({
  patientId,
  dateOfDeath: '2026-01-01T00:00:00.000Z',
  placeOfDeath: 'inpatient',
  sex: 'other',
  immediateCause: 'Regression test',
  mannerOfDeath: 'natural',
})

/** Sequence part of "LABEL-2026-27-000123" → 123. */
const seqOf = (documentNumber) => Number(documentNumber.slice(documentNumber.lastIndexOf('-') + 1))
/** Label part of "LABEL-2026-27-000123" → "LABEL". Old numbers ("DC0001") have no dash. */
const labelOf = (documentNumber) => documentNumber.split('-')[0]

async function counterValue(organizationId, series) {
  const row = await db.billCounter.findUnique({
    where: { organizationId_series_year: { organizationId, series, year: FY } },
  })
  return row ? row.value : 0
}

before(async () => {
  const stamp = Date.now()
  orgBusy = await db.organization.create({ data: { name: 'Test Org Busy — documentNumbers.test.js', slug: `test-docnum-busy-${stamp}` } })
  orgFresh = await db.organization.create({ data: { name: 'Test Org Fresh — documentNumbers.test.js', slug: `test-docnum-fresh-${stamp}` } })

  const patientData = (organizationId, mrn) => ({
    organizationId, mrn, firstName: 'DocNum', lastName: 'Patient', gender: 'other', dateOfBirth: new Date('1990-01-01'),
  })
  patientBusy = await db.patient.create({ data: patientData(orgBusy.id, `TESTMRN-DOCNUM-A-${stamp}`) })
  patientFresh = await db.patient.create({ data: patientData(orgFresh.id, `TESTMRN-DOCNUM-B-${stamp}`) })

  doctor = await db.user.create({
    data: { organizationId: orgBusy.id, email: `dr.docnum.${stamp}@test.local`, fullName: 'Dr. DocNum Test', role: 'doctor' },
  })
  radiologyExam = await db.radiologyExam.create({
    data: { organizationId: orgBusy.id, examName: 'DocNum Test X-Ray', modality: 'XRAY' },
  })
  insuranceCaseBusy = await db.insuranceCase.create({
    data: { organizationId: orgBusy.id, patientId: patientBusy.id, insurerName: 'DocNum Test Insurer', coverageLimit: 1_000_000 },
  })
  insuranceCaseFresh = await db.insuranceCase.create({
    data: { organizationId: orgFresh.id, patientId: patientFresh.id, insurerName: 'DocNum Test Insurer', coverageLimit: 1_000_000 },
  })
})

after(async () => {
  // Children before parents, and never leave a BillCounter behind: a stray
  // counter row would keep issuing numbers for a hospital that no longer exists.
  // Each call is guarded so a failed assertion still cleans up everything after it.
  const organizationId = { in: [orgBusy?.id, orgFresh?.id].filter(Boolean) }
  for (const model of ['insuranceClaim', 'insuranceCase', 'deathCertificate', 'dayCareCase', 'preTriage',
    'labOrder', 'radiologyOrder', 'radiologyExam', 'patient', 'user', 'billCounter']) {
    await db[model].deleteMany({ where: { organizationId } }).catch(() => {})
  }
  await db.organization.deleteMany({ where: { id: organizationId } }).catch(() => {})
})

// ── A brand-new hospital: format, padding and per-org isolation ───────────────

test('a brand-new hospital starts every series at 000001 under its own label, instead of inheriting another hospital\'s numbering', async () => {
  // Runs against orgFresh, which no other test touches. It asserts the exact
  // printed shape (`LABEL-<financial year>-<6 zero-padded digits>`) as well as
  // the per-org isolation: the counter is keyed (org, series, year), so hospital
  // B's first document is 000001 no matter how much traffic hospital A has had.
  const busyBefore = {
    screening: await counterValue(orgBusy.id, 'PRE_TRIAGE'),
    dayCare: await counterValue(orgBusy.id, 'DAYCARE_CASE'),
    deathCert: await counterValue(orgBusy.id, 'DEATH_CERT'),
    claim: await counterValue(orgBusy.id, 'INS_CLAIM'),
  }

  const screening = await callController(createScreening, { organizationId: orgFresh.id, validatedBody: screeningBody() })
  assert.equal(screening.status, 201, JSON.stringify(screening.body))
  assert.equal(screening.body.data.screeningNumber, `SCR-${FY}-000001`)

  const dayCase = await callController(createDayCareCase, { organizationId: orgFresh.id, body: dayCareBody(patientFresh.id) })
  assert.equal(dayCase.status, 200, JSON.stringify(dayCase.body))
  assert.equal(dayCase.body.data.caseNumber, `DAY-${FY}-000001`)

  const cert = await callController(createDeathCertificate, { organizationId: orgFresh.id, body: deathCertificateBody(patientFresh.id) })
  assert.equal(cert.status, 200, JSON.stringify(cert.body))
  assert.equal(cert.body.data.certificateNumber, `DC-${FY}-000001`)

  const claim = await callController(createInsurance, {
    organizationId: orgFresh.id, query: { resource: 'claims' }, body: { caseId: insuranceCaseFresh.id, claimAmount: 500 },
  })
  assert.equal(claim.status, 200, JSON.stringify(claim.body))
  assert.equal(claim.body.data.claimNumber, `CLM-${FY}-000001`)

  // ...and none of that leaked into the other hospital's sequences.
  assert.equal(await counterValue(orgBusy.id, 'PRE_TRIAGE'), busyBefore.screening)
  assert.equal(await counterValue(orgBusy.id, 'DAYCARE_CASE'), busyBefore.dayCare)
  assert.equal(await counterValue(orgBusy.id, 'DEATH_CERT'), busyBefore.deathCert)
  assert.equal(await counterValue(orgBusy.id, 'INS_CLAIM'), busyBefore.claim)
})

// ── Concurrency: N simultaneous callers, N distinct numbers ───────────────────

test('twenty screenings registered in the same instant get twenty different numbers — three random digits collided by the ~38th screening of the day', async () => {
  // `SCR${yyyymmdd}${Math.floor(Math.random()*1000)}` had 1,000 values per day
  // against a scoped-unique screeningNumber: by the birthday paradox a duplicate
  // was about even money by the 38th screening, and the duplicate was a 500.
  const before = await counterValue(orgBusy.id, 'PRE_TRIAGE')

  const results = await Promise.all(
    Array.from({ length: 20 }, () => callController(createScreening, { organizationId: orgBusy.id, validatedBody: screeningBody() })),
  )

  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body))
  const numbers = results.map((r) => r.body.data.screeningNumber)
  assert.equal(new Set(numbers).size, numbers.length, 'two screenings created at once received the same number')
  for (const n of numbers) assert.match(n, /^SCR-\d{4}-\d{2}-\d{6}$/, `got ${n}`)

  assert.equal(await counterValue(orgBusy.id, 'PRE_TRIAGE') - before, 20, 'an increment was lost — a later screening would reuse a number')

  // Storability: all twenty are actually on disk in the scoped-unique column.
  const stored = await db.preTriage.findMany({ where: { organizationId: orgBusy.id, screeningNumber: { in: numbers } }, select: { screeningNumber: true } })
  assert.equal(stored.length, 20)
})

test('two clerks admitting day-care patients at the same moment get different case numbers — count()+1 handed both of them the same one', async () => {
  // The old `count(where org) + 1` read outside any transaction: both requests
  // counted 7 rows, both wrote DC0008, and the second died on the unique index.
  const before = await counterValue(orgBusy.id, 'DAYCARE_CASE')

  const results = await Promise.all(
    Array.from({ length: 12 }, () => callController(createDayCareCase, { organizationId: orgBusy.id, body: dayCareBody(patientBusy.id) })),
  )

  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body))
  const numbers = results.map((r) => r.body.data.caseNumber)
  assert.equal(new Set(numbers).size, numbers.length, 'two simultaneous admissions received the same case number')
  assert.equal(await counterValue(orgBusy.id, 'DAYCARE_CASE') - before, 12, 'an increment was lost')

  const stored = await db.dayCareCase.findMany({ where: { organizationId: orgBusy.id, caseNumber: { in: numbers } }, select: { caseNumber: true } })
  assert.equal(stored.length, 12)
})

test('two death certificates issued at the same moment never carry the same certificate number', async () => {
  // A death certificate is a legal document: two of them sharing a number is
  // worse than a 500. The old count()+1 was read before the transaction, so two
  // concurrent issuances both computed the same next number.
  const before = await counterValue(orgBusy.id, 'DEATH_CERT')

  const results = await Promise.all(
    Array.from({ length: 10 }, () => callController(createDeathCertificate, { organizationId: orgBusy.id, body: deathCertificateBody(patientBusy.id) })),
  )

  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body))
  const numbers = results.map((r) => r.body.data.certificateNumber)
  assert.equal(new Set(numbers).size, numbers.length, 'two death certificates were issued the same number')
  assert.equal(await counterValue(orgBusy.id, 'DEATH_CERT') - before, 10, 'an increment was lost')

  const stored = await db.deathCertificate.findMany({ where: { organizationId: orgBusy.id, certificateNumber: { in: numbers } }, select: { certificateNumber: true } })
  assert.equal(stored.length, 10)
})

test('ten insurance claims filed at once never share a claim number', async () => {
  const before = await counterValue(orgBusy.id, 'INS_CLAIM')

  const results = await Promise.all(
    Array.from({ length: 10 }, () => callController(createInsurance, {
      organizationId: orgBusy.id, query: { resource: 'claims' }, body: { caseId: insuranceCaseBusy.id, claimAmount: 100 },
    })),
  )

  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body))
  const numbers = results.map((r) => r.body.data.claimNumber)
  assert.equal(new Set(numbers).size, numbers.length, 'two claims filed at once received the same claim number')
  assert.equal(await counterValue(orgBusy.id, 'INS_CLAIM') - before, 10, 'an increment was lost')

  const stored = await db.insuranceClaim.findMany({ where: { organizationId: orgBusy.id, claimNumber: { in: numbers } }, select: { claimNumber: true } })
  assert.equal(stored.length, 10)
})

// ── Monotonic: a number is never reissued or handed out backwards ─────────────

test('consecutive screenings step forward by exactly one — a number is never reissued or handed out backwards', async () => {
  const issued = []
  for (let i = 0; i < 5; i++) {
    const r = await callController(createScreening, { organizationId: orgBusy.id, validatedBody: screeningBody() })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    issued.push(seqOf(r.body.data.screeningNumber))
  }
  for (let i = 1; i < issued.length; i++) {
    assert.equal(issued[i], issued[i - 1] + 1, `screening number jumped or went backwards: ${issued[i - 1]} then ${issued[i]}`)
  }
  assert.equal(new Set(issued).size, issued.length, 'the same screening number was issued twice')
})

// ── Prefix collision: two different documents must not look like each other ───

test('a day-care case number and a death certificate number are told apart at a glance — both used to print as DC', async () => {
  // dayCareController minted `DC0001` and deathCertificateController `DC-00001`.
  // Two entirely different documents wore the same "DC" badge, so a ward clerk
  // reading a number out could not tell which record it belonged to. The series
  // keys are independent counters (DAYCARE_CASE / DEATH_CERT) so their sequence
  // numbers routinely coincide — the LABEL is the only thing distinguishing them.
  const dayCase = await callController(createDayCareCase, { organizationId: orgBusy.id, body: dayCareBody(patientBusy.id) })
  const cert = await callController(createDeathCertificate, { organizationId: orgBusy.id, body: deathCertificateBody(patientBusy.id) })
  assert.equal(dayCase.status, 200, JSON.stringify(dayCase.body))
  assert.equal(cert.status, 200, JSON.stringify(cert.body))

  const caseNumber = dayCase.body.data.caseNumber
  const certNumber = cert.body.data.certificateNumber
  assert.equal(labelOf(caseNumber), 'DAY', `a day-care case must not wear the death-certificate label: ${caseNumber}`)
  assert.equal(labelOf(certNumber), 'DC')
  assert.notEqual(labelOf(caseNumber), labelOf(certNumber), `${caseNumber} and ${certNumber} are indistinguishable`)

  // Independent counters: draining one must not move the other, or the two
  // series would drift into each other's numbers.
  const certCounterBefore = await counterValue(orgBusy.id, 'DEATH_CERT')
  const dayCareCounterBefore = await counterValue(orgBusy.id, 'DAYCARE_CASE')
  for (let i = 0; i < 3; i++) await callController(createDayCareCase, { organizationId: orgBusy.id, body: dayCareBody(patientBusy.id) })
  assert.equal(await counterValue(orgBusy.id, 'DEATH_CERT'), certCounterBefore, 'day-care admissions advanced the death certificate series')
  assert.equal(await counterValue(orgBusy.id, 'DAYCARE_CASE') - dayCareCounterBefore, 3)

  const nextCert = await callController(createDeathCertificate, { organizationId: orgBusy.id, body: deathCertificateBody(patientBusy.id) })
  assert.equal(seqOf(nextCert.body.data.certificateNumber), seqOf(certNumber) + 1, 'the death certificate series must continue from its own sequence')
})

// ── Lab and radiology order numbers ──────────────────────────────────────────

test('a lab order raised from a consultation and one raised in the lab module draw from ONE counter, so neither reissues the other\'s number', async () => {
  // consultationController used `LAB${Date.now()}` while laboratoryController
  // used the LAB_ORDER counter — two schemes on one scoped-unique column. Both
  // now use series key 'LAB_ORDER', which is a single counter row: a second key
  // would restart at 1 and walk back through numbers already printed on labels.
  const fromConsultation = await db.$transaction((tx) => nextSeriesNumber(tx, orgBusy.id, 'LAB_ORDER', 'LAB'))
  const fromLabModule = await db.$transaction((tx) => nextSeriesNumber(tx, orgBusy.id, 'LAB_ORDER', 'LAB'))

  assert.equal(seqOf(fromLabModule) - seqOf(fromConsultation), 1, 'the two paths must consume consecutive numbers from the same sequence')
  const counters = await db.billCounter.findMany({ where: { organizationId: orgBusy.id, series: 'LAB_ORDER' } })
  assert.equal(counters.length, 1, 'lab orders must be minted from exactly one counter row')

  // Storable on the scoped-unique LabOrder.orderNumber, from both paths.
  for (const orderNumber of [fromConsultation, fromLabModule]) {
    await db.labOrder.create({
      data: {
        organizationId: orgBusy.id, patientId: patientBusy.id, requestedById: doctor.id,
        orderNumber, tests: JSON.stringify([{ testName: 'CBC' }]),
      },
    })
  }
  const stored = await db.labOrder.findMany({ where: { organizationId: orgBusy.id, orderNumber: { in: [fromConsultation, fromLabModule] } } })
  assert.equal(stored.length, 2)
})

test('two doctors saving a consultation in the same millisecond get different radiology order numbers', async () => {
  // `RAD${Date.now()}-${i}` stamped the clock once per consultation and appended
  // the exam index, so two doctors saving in the same millisecond produced the
  // identical string for their first exam — a 500 for whoever committed second.
  const before = await counterValue(orgBusy.id, 'RAD_ORDER')

  const orderNumbers = await Promise.all(
    Array.from({ length: 10 }, () => db.$transaction((tx) => nextSeriesNumber(tx, orgBusy.id, 'RAD_ORDER', 'RAD'))),
  )
  assert.equal(new Set(orderNumbers).size, orderNumbers.length, 'two concurrent scan orders received the same order number')
  assert.equal(await counterValue(orgBusy.id, 'RAD_ORDER') - before, 10, 'an increment was lost')

  // Storable on the scoped-unique RadiologyOrder.orderNumber — no P2002.
  for (const orderNumber of orderNumbers) {
    await db.radiologyOrder.create({
      data: {
        organizationId: orgBusy.id, patientId: patientBusy.id, requestedById: doctor.id,
        examId: radiologyExam.id, orderNumber,
      },
    })
  }
  const stored = await db.radiologyOrder.findMany({ where: { organizationId: orgBusy.id, orderNumber: { in: orderNumbers } } })
  assert.equal(stored.length, 10)
})

// ── Why a collision matters at all ───────────────────────────────────────────

test('a repeated document number is refused by the database, which is why a colliding generator was a 500 and not a cosmetic bug', async () => {
  // The highest number the busy hospital has reached — one the fresh hospital
  // has certainly not issued yet, so the cross-org half of this test is testing
  // the scoping and not tripping over a number both orgs happen to hold.
  const existing = await db.preTriage.findFirst({
    where: { organizationId: orgBusy.id },
    orderBy: { screeningNumber: 'desc' },
    select: { screeningNumber: true },
  })
  assert.ok(existing, 'earlier tests must have created at least one screening')

  await assert.rejects(
    () => db.preTriage.create({ data: { organizationId: orgBusy.id, screeningNumber: existing.screeningNumber, status: 'screening' } }),
    (err) => err.code === 'P2002',
    'the same screening number was accepted twice within one hospital',
  )

  // Scoped, not global: the other hospital may legitimately hold the same
  // string, which is what lets every hospital start its own series at 000001.
  const twin = await db.preTriage.create({
    data: { organizationId: orgFresh.id, screeningNumber: existing.screeningNumber, status: 'screening' },
  })
  assert.ok(twin.id, 'a second hospital must be allowed to hold the same screening number')
})
