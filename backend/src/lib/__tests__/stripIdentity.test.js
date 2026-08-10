// Regression test: a PATCH must never move a record onto another patient.
//
// THE BUG THIS PREVENTS
// The update handlers validate with `.passthrough()` schemas, so any key the
// caller sends is kept and spread into `prisma.update({ data })`. Each handler
// had its own hand-written list of fields to delete first, and the lists drifted:
// Laboratory's order handler deleted six, Radiology's deleted two. Against the
// running app that meant:
//
//     POST  radiology order for patient A       → RAD-2026-27-000002
//     PATCH { patientId: B, orderNumber: "RAD-HACKED-0001" }
//     → the scan moved to patient B, under a number the caller chose
//
// One patient's scan filed under another patient is the worst outcome a
// radiology system has, and a rewritten document number takes the counter series
// and the audit trail with it.
//
// The unit tests below pin the shared list. The integration test at the bottom
// drives the real controller, because a correct list that nobody calls protects
// nothing — which is exactly how Radiology was left exposed.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stripIdentity, protectedFields } from '../stripIdentity.js'

// ── unit ─────────────────────────────────────────────────────────────────────

test('a radiology order cannot be moved to another patient or renumbered', () => {
  const body = {
    patientId: 'patient-B',
    orderNumber: 'RAD-HACKED-0001',
    examId: 'some-other-exam',
    requestedById: 'another-doctor',
    organizationId: 'another-hospital',
    id: 'another-row',
    status: 'in_progress',          // legitimate — must survive
    notes: 'chest pain',            // legitimate — must survive
  }
  stripIdentity(body, 'radiologyOrder')
  assert.deepEqual(body, { status: 'in_progress', notes: 'chest pain' })
})

test('a lab order is protected exactly as radiology is — the two lists cannot drift', () => {
  const forLab = protectedFields('labOrder')
  const forRad = protectedFields('radiologyOrder')
  for (const field of ['organizationId', 'id', 'patientId', 'orderNumber', 'requestedById']) {
    assert.ok(forLab.includes(field), `labOrder must protect ${field}`)
    assert.ok(forRad.includes(field), `radiologyOrder must protect ${field}`)
  }
  // The tube's label is a lab-only concept, the exam is a radiology-only one.
  assert.ok(forLab.includes('accessionNumber'))
  assert.ok(forRad.includes('examId'))
})

test('a result or report cannot be re-pointed at a different order', () => {
  const result = { orderId: 'other-order', testId: 'other-test', resultValue: '9.1' }
  stripIdentity(result, 'labResult')
  assert.deepEqual(result, { resultValue: '9.1' })

  const report = { orderId: 'other-order', findings: 'normal' }
  stripIdentity(report, 'radiologyReport')
  assert.deepEqual(report, { findings: 'normal' })
})

test('an unknown resource throws instead of silently protecting nothing', () => {
  // A typo here would look like it worked and guard zero fields.
  assert.throws(() => stripIdentity({}, 'pharmacySale'), /unknown resource/)
})

test('audit columns are never settable by a client', () => {
  const body = { createdAt: '2020-01-01', updatedAt: '2020-01-01', createdById: 'someone-else', notes: 'x' }
  stripIdentity(body, 'labTest')
  assert.deepEqual(body, { notes: 'x' })
})

// ── integration: the real controller ─────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '..', '..', '..')
try {
  for (const line of fs.readFileSync(path.join(backendRoot, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* no .env — skips below */ }

const HAS_DB = !!process.env.DATABASE_URL
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
let db, radCreate, radUpdate
const require = createRequire(path.join(backendRoot, 'package.json'))
const trash = []

function call(handler, body) {
  return new Promise((resolve, reject) => {
    const req = { body, organizationId: ORG, user: null }
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(p) { resolve({ status: this.statusCode, body: p }) },
    }
    Promise.resolve(handler(req, res, reject)).catch(reject)
  })
}

before(async () => {
  if (!HAS_DB) return
  const { PrismaClient } = require('@prisma/client')
  db = new PrismaClient()
  const mod = await import('../../controllers/radiologyController.js')
  radCreate = mod.create
  radUpdate = mod.update
})
after(async () => {
  if (!HAS_DB || !db) return
  await db.radiologyOrder.deleteMany({ where: { id: { in: trash } } }).catch(() => {})
  await db.$disconnect()
})

test('the live radiology endpoint refuses to move a scan to another patient',
  { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  const [a, b] = await db.patient.findMany({ where: { organizationId: ORG }, select: { id: true }, take: 2 })
  const exams = await db.radiologyExam.findMany({ where: { organizationId: ORG }, select: { id: true }, take: 2 })
  assert.ok(a && b && exams.length === 2, `needs 2 patients and 2 exams in ${ORG}`)

  const created = await call(radCreate, {
    resource: 'order', patientId: a.id, examId: exams[0].id, clinicalIndication: 'strip-identity regression',
  })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const order = created.body.data
  trash.push(order.id)

  const patched = await call(radUpdate, {
    resource: 'order',
    id: order.id,
    patientId: b.id,                       // the attack
    orderNumber: 'RAD-HACKED-0001',        // the attack
    examId: exams[1].id,                   // the attack
    status: 'in_progress',                 // legitimate
  })
  assert.equal(patched.status, 200, JSON.stringify(patched.body))

  const row = await db.radiologyOrder.findUnique({
    where: { id: order.id },
    select: { patientId: true, orderNumber: true, examId: true, status: true },
  })
  assert.equal(row.patientId, a.id, 'the scan must stay with the patient it was ordered for')
  assert.equal(row.orderNumber, order.orderNumber, 'the document number is minted by the counter, not the caller')
  assert.equal(row.examId, exams[0].id, 'the exam cannot be swapped after the fact')
  assert.equal(row.status, 'in_progress', 'a legitimate field must still update')
})
