// Regression tests for the cross-tenant PHI leaks found in the multi-tenant audit.
//
// Every case here is a route where one hospital could read or write another
// hospital's patient because an id arrived in the request body and was used
// without an organizationId beside it:
//   - getPatientSnapshot() looked a patient up with findUnique-by-id, so the
//     name, UHID/MRN, phone, email, age and full address of ANY tenant's patient
//     came back and were echoed onto the caller's receipt.
//   - lab / radiology / prescription create attached an order to whatever
//     patientId was posted and returned that patient's demographics with it.
//   - the lab dashboard's "critical results" tile counted EVERY hospital's
//     unverified criticals into one tenant's alarm number.
//
// Real-database integration tests. They need TWO disposable organizations —
// isolation cannot be proved with one tenant — and both are torn down in after(),
// including on failure. Same disposable-org pattern as concurrency.test.js;
// controllers are driven with a fake req/res as in refundApprovalConcurrency.test.js.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { getPatientSnapshot } from '../../utils/patientSnapshot.js'
import { getAll as labGetAll, create as labCreate } from '../../controllers/laboratoryController.js'
import { create as radiologyCreate } from '../../controllers/radiologyController.js'
import { create as prescriptionCreate } from '../../pharmacy/controllers/prescription.controller.js'

let ourOrg, theirOrg, ourDoctor, theirDoctor, ourPatient, theirPatient
let ourExam, theirExam, theirTest, theirOrder

/**
 * Drive a controller with a fake req/res and resolve {status, body}.
 * A controller that hands its error to next() resolves too, so a regression
 * surfaces as a failed assertion instead of an unhandled rejection.
 */
function callController(handler, { body = {}, query = {}, params = {}, organizationId, user = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = { body, query, params, organizationId, user }
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(payload) { resolve({ status: this.statusCode, body: payload }) },
    }
    const next = (err) => resolve({ status: err?.status ?? 500, body: { error: err?.message } })
    Promise.resolve(handler(req, res, next)).catch(reject)
  })
}

/** The lab dashboard's unverified-critical-results tile, for one tenant. */
async function criticalResultsTile(organizationId) {
  const stats = await callController(labGetAll, { query: { resource: 'stats' }, organizationId })
  assert.equal(stats.status, 200, JSON.stringify(stats.body))
  return stats.body.data.criticalResults
}

before(async () => {
  const stamp = Date.now()
  ourOrg = await db.organization.create({ data: { name: 'Test Org — crossTenantReads (ours)', slug: `test-xtenant-ours-${stamp}` } })
  theirOrg = await db.organization.create({ data: { name: 'Test Org — crossTenantReads (theirs)', slug: `test-xtenant-theirs-${stamp}` } })

  ourDoctor = await db.user.create({ data: { organizationId: ourOrg.id, email: `xtenant.ours.${stamp}@test.local`, fullName: 'Dr. Ours', role: 'doctor' } })
  theirDoctor = await db.user.create({ data: { organizationId: theirOrg.id, email: `xtenant.theirs.${stamp}@test.local`, fullName: 'Dr. Theirs', role: 'doctor' } })

  ourPatient = await db.patient.create({
    data: {
      organizationId: ourOrg.id, mrn: `TESTMRN-XT-OURS-${stamp}`,
      firstName: 'Ours', middleName: 'Own', lastName: 'Patient',
      gender: 'female', dateOfBirth: new Date('1990-01-01'),
      phonePrimary: '9000000001', email: 'ours@test.local', city: 'Pune', state: 'Maharashtra', pincode: '411001',
    },
  })
  // Deliberately identifiable PHI: if any of this reaches the other tenant the
  // assertions below name exactly which field crossed.
  theirPatient = await db.patient.create({
    data: {
      organizationId: theirOrg.id, mrn: `TESTMRN-XT-THEIRS-${stamp}`,
      firstName: 'Theirs', middleName: 'Secret', lastName: 'Patient',
      gender: 'male', dateOfBirth: new Date('1985-05-05'),
      phonePrimary: '9000000002', email: 'theirs@test.local', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001',
    },
  })

  ourExam = await db.radiologyExam.create({ data: { organizationId: ourOrg.id, examName: 'Chest X-Ray (ours)', examCategory: 'xray' } })
  theirExam = await db.radiologyExam.create({ data: { organizationId: theirOrg.id, examName: 'Chest X-Ray (theirs)', examCategory: 'xray' } })

  theirTest = await db.labTest.create({ data: { organizationId: theirOrg.id, testName: 'Serum Potassium (theirs)' } })
  theirOrder = await db.labOrder.create({
    data: {
      organizationId: theirOrg.id, patientId: theirPatient.id, requestedById: theirDoctor.id,
      orderNumber: `LAB-XT-THEIRS-${stamp}`, tests: JSON.stringify([{ testName: 'Serum Potassium' }]), status: 'in_progress',
    },
  })
})

after(async () => {
  const orgIds = [ourOrg?.id, theirOrg?.id].filter(Boolean)
  if (!orgIds.length) return
  // Children before parents; lab/radiology orders before the users they reference
  // (requestedById is a restrict FK).
  await db.labResult.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.labOrder.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.labTest.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.radiologyOrder.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.radiologyExam.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.prescription.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.patient.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.user.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.billCounter.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {})
})

test('a receipt built by one hospital cannot pull another hospital\'s patient name, UHID or phone', async () => {
  // The id is genuine — it is simply a different tenant's. Before the org filter
  // this returned the whole snapshot and the caller printed it on their receipt.
  assert.equal(await getPatientSnapshot(db, theirPatient.id, ourOrg.id), null)
  // Symmetric, so nobody can argue the guard only works one way.
  assert.equal(await getPatientSnapshot(db, ourPatient.id, theirOrg.id), null)
})

test('the org filter does not break the normal path — a hospital still gets its own patient\'s snapshot', async () => {
  const snapshot = await getPatientSnapshot(db, ourPatient.id, ourOrg.id)
  assert.ok(snapshot, 'a hospital must still be able to print its own patient on a receipt')
  assert.equal(snapshot.patientId, ourPatient.id)
  assert.equal(snapshot.patientName, 'Ours Own Patient')
  assert.equal(snapshot.uhid, ourPatient.mrn)
  assert.equal(snapshot.phone, '9000000001')
  assert.equal(snapshot.address, 'Pune, Maharashtra - 411001')
})

test('a walk-in sale with no patient still gets a null snapshot rather than an error', async () => {
  // OTC sales pass patientId: undefined every day; the guard must not turn that
  // into a lookup that matches an arbitrary row.
  assert.equal(await getPatientSnapshot(db, undefined, ourOrg.id), null)
  assert.equal(await getPatientSnapshot(db, '', ourOrg.id), null)
})

test('a lab order naming another hospital\'s patient is refused, not raised against that patient', async () => {
  const res = await callController(labCreate, {
    organizationId: ourOrg.id,
    body: { resource: 'order', patientId: theirPatient.id, tests: [{ testName: 'CBC' }] },
  })
  assert.equal(res.status, 404, JSON.stringify(res.body))
  assert.equal(await db.labOrder.count({ where: { patientId: theirPatient.id, organizationId: ourOrg.id } }), 0)
  // The response must not leak the demographics either — the pre-fix handler
  // returned the created order with `include: { patient: ... }`.
  assert.equal(JSON.stringify(res.body).includes('Secret'), false, 'the other tenant\'s patient details came back in the error')
})

test('a lab order for our OWN patient still succeeds — the guard must not close the ward', async () => {
  const res = await callController(labCreate, {
    organizationId: ourOrg.id,
    body: { resource: 'order', patientId: ourPatient.id, tests: [{ testName: 'CBC' }] },
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.data.patientId, ourPatient.id)
})

test('a radiology order naming another hospital\'s patient or exam is refused', async () => {
  const foreignPatient = await callController(radiologyCreate, {
    organizationId: ourOrg.id,
    body: { resource: 'order', patientId: theirPatient.id, examId: ourExam.id },
  })
  assert.equal(foreignPatient.status, 404, JSON.stringify(foreignPatient.body))

  // An exam from another tenant is just as bad: the order would be priced off
  // their catalogue and would show up on their exam's order list.
  const foreignExam = await callController(radiologyCreate, {
    organizationId: ourOrg.id,
    body: { resource: 'order', patientId: ourPatient.id, examId: theirExam.id },
  })
  assert.equal(foreignExam.status, 404, JSON.stringify(foreignExam.body))

  assert.equal(await db.radiologyOrder.count({ where: { organizationId: ourOrg.id } }), 0)
})

test('a radiology order for our own patient and our own exam still succeeds', async () => {
  const res = await callController(radiologyCreate, {
    organizationId: ourOrg.id,
    body: { resource: 'order', patientId: ourPatient.id, examId: ourExam.id },
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.data.patientId, ourPatient.id)
})

test('a prescription cannot be written for another hospital\'s patient, or signed by their doctor', async () => {
  const foreignPatient = await callController(prescriptionCreate, {
    organizationId: ourOrg.id,
    body: { patientId: theirPatient.id, doctorId: ourDoctor.id, items: [{ drugName: 'Paracetamol', quantity: 1 }] },
  })
  assert.equal(foreignPatient.status, 404, JSON.stringify(foreignPatient.body))

  // A doctorId from another tenant would put their clinician's name on our
  // prescription — and on the dispensing record that follows it.
  const foreignDoctor = await callController(prescriptionCreate, {
    organizationId: ourOrg.id,
    body: { patientId: ourPatient.id, doctorId: theirDoctor.id, items: [{ drugName: 'Paracetamol', quantity: 1 }] },
  })
  assert.equal(foreignDoctor.status, 404, JSON.stringify(foreignDoctor.body))

  assert.equal(await db.prescription.count({ where: { organizationId: ourOrg.id } }), 0)
})

test('our critical-results alarm does not move when ANOTHER hospital gets an unverified critical result', async () => {
  // The tile is a patient-safety alarm: a number that includes other tenants'
  // patients sends this lab hunting for a result it cannot see, and hides the
  // real backlog behind noise.
  const oursBefore = await criticalResultsTile(ourOrg.id)
  const theirsBefore = await criticalResultsTile(theirOrg.id)

  const foreignCritical = await db.labResult.create({
    data: {
      organizationId: theirOrg.id, orderId: theirOrder.id, testId: theirTest.id,
      resultValue: '7.9', isCritical: true, verifiedAt: null,
    },
  })

  const oursAfter = await criticalResultsTile(ourOrg.id)
  const theirsAfter = await criticalResultsTile(theirOrg.id)

  // theirs proves the row really landed and really counts — without it, "ours
  // did not move" could pass simply because nothing was created.
  assert.equal(theirsAfter, theirsBefore + 1, 'the other hospital must see its own new critical result')
  assert.equal(oursAfter, oursBefore, 'another hospital\'s critical result was counted into our alarm tile')

  await db.labResult.delete({ where: { id: foreignCritical.id } })
})
