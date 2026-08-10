// Regression test: the billing counter must not accept a price from the client.
//
// THE BUG THIS PREVENTS
// billingController recomputed `total = quantity x unitPrice` server-side, which
// reads like repricing but multiplies whatever unitPrice arrived in the request
// body. Anyone who could reach the billing endpoint could bill a 5,000 test at
// 1 — and the resulting invoice was indistinguishable from a real one: correct
// patient, correct test name, correct arithmetic, a lab order raised as usual.
// Nothing downstream could tell it apart, so it would never surface in a report.
//
// The fix (lib/catalogPrice.js) looks each line's price up in the catalogue it
// came from and overrides whatever the caller sent.
//
// Integration test: drives the real billingController.create against the dev
// database. Skipped automatically when no DATABASE_URL is available.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// backend/.env holds DATABASE_URL; nothing loads it for a bare `node --test` run.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '..', '..', '..')
try {
  for (const line of fs.readFileSync(path.join(backendRoot, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* no .env — tests skip below */ }

const HAS_DB = !!process.env.DATABASE_URL
const ORG = process.env.ORGANIZATION_ID || 'org-demo'

let db, create
const require = createRequire(path.join(backendRoot, 'package.json'))

// Track everything inserted so the database is left exactly as we found it.
const trash = { invoiceIds: [], labOrderIds: [] }

/** Run billingController.create with a fake req/res and resolve {status, body}. */
function callCreate(body) {
  return new Promise((resolve, reject) => {
    const req = { body, organizationId: ORG, user: null }
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(payload) { resolve({ status: this.statusCode, body: payload }) },
    }
    Promise.resolve(create(req, res)).catch(reject)
  })
}

/** Record the invoice AND the lab order billing raised for it, so both get cleaned up. */
async function trackInvoice(invoice) {
  trash.invoiceIds.push(invoice.id)
  const orders = await db.labOrder.findMany({
    where: { organizationId: ORG, orderNumber: `LAB-${invoice.invoiceNumber}` },
    select: { id: true },
  })
  for (const o of orders) trash.labOrderIds.push(o.id)
}

before(async () => {
  if (!HAS_DB) return
  const { PrismaClient } = require('@prisma/client')
  db = new PrismaClient()
  ;({ create } = await import('../../controllers/billingController.js'))
})

after(async () => {
  if (!HAS_DB || !db) return
  await db.labOrder.deleteMany({ where: { id: { in: trash.labOrderIds } } }).catch(() => {})
  await db.payment.deleteMany({ where: { invoiceId: { in: trash.invoiceIds } } }).catch(() => {})
  await db.auditLog.deleteMany({ where: { entityId: { in: trash.invoiceIds } } }).catch(() => {})
  await db.invoice.deleteMany({ where: { id: { in: trash.invoiceIds } } }).catch(() => {})
  await db.$disconnect()
})

const skip = !HAS_DB && 'DATABASE_URL not set'

test('a lab test billed at a price the caller invented is stored at the catalogue price', { skip }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  const labTest = await db.labTest.findFirst({
    where: { organizationId: ORG, price: { gt: 0 } },
    select: { id: true, testName: true, price: true },
  })
  assert.ok(patient, `needs at least one patient in ${ORG}`)
  assert.ok(labTest, `needs at least one priced lab test in ${ORG}`)

  // The attack: bill a real test, for a real patient, at ₹1.
  const res = await callCreate({
    resource: 'invoice',
    patientId: patient.id,
    items: [{
      serviceName: labTest.testName,
      quantity: 2,
      unitPrice: 1,
      total: 2,
      tax: 0,
      sourceType: 'lab',
      sourceId: labTest.id,
    }],
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  await trackInvoice(res.body.data)

  const stored = await db.invoice.findUnique({ where: { id: res.body.data.id } })
  const line = JSON.parse(stored.items)[0]

  const expectedTotal = Math.round(labTest.price * 2 * 100) / 100
  assert.equal(line.unitPrice, labTest.price,
    `caller sent unitPrice 1; catalogue says ${labTest.price} — the catalogue must win`)
  assert.equal(line.total, expectedTotal)
  assert.equal(stored.subtotal, expectedTotal)
  assert.equal(stored.totalAmount, expectedTotal,
    `invoice total must be ${expectedTotal}, not the ₹2 the caller asked for`)
})

test('a sourceId that is not in this hospital\'s catalogue is refused, not billed', { skip }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  assert.ok(patient)

  const res = await callCreate({
    resource: 'invoice',
    patientId: patient.id,
    items: [{
      serviceName: 'Not our test',
      quantity: 1,
      unitPrice: 500,
      total: 500,
      tax: 0,
      sourceType: 'lab',
      sourceId: 'lab-test-that-does-not-exist',
    }],
  })
  assert.equal(res.status, 404, `expected 404, got ${res.status}: ${JSON.stringify(res.body)}`)
  if (res.body?.data?.id) await trackInvoice(res.body.data)
})

test('a test with no catalogue price bills at zero and is flagged — a price sent for it is ignored', { skip }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  const unpriced = await db.labTest.findFirst({
    where: { organizationId: ORG, OR: [{ price: null }, { price: { lte: 0 } }] },
    select: { id: true, testName: true },
  })
  assert.ok(patient)
  if (!unpriced) return // catalogue fully priced — nothing to assert here

  // 569 lab tests and 1,673 radiology exams have no catalogue price today, and
  // they already bill at 0 because the billing screen sends `Number(price || 0)`
  // and has no price input. So there is no human-entered figure to preserve —
  // a price arriving on such a line could only have been fabricated.
  const res = await callCreate({
    resource: 'invoice',
    patientId: patient.id,
    items: [{
      serviceName: unpriced.testName,
      quantity: 1,
      unitPrice: 777,
      total: 777,
      tax: 0,
      sourceType: 'lab',
      sourceId: unpriced.id,
    }],
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  await trackInvoice(res.body.data)

  const stored = await db.invoice.findUnique({ where: { id: res.body.data.id } })
  const line = JSON.parse(stored.items)[0]
  assert.equal(line.unitPrice, 0, 'the catalogue has no price, so neither does the bill')
  assert.equal(line.priceSource, 'unpriced', 'flagged so the zero-value bills are findable')
  assert.equal(stored.totalAmount, 0)
})

test('over-billing is blocked too: a price above the catalogue is discarded like one below it', { skip }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  const labTest = await db.labTest.findFirst({
    where: { organizationId: ORG, price: { gt: 0 } },
    select: { id: true, testName: true, price: true },
  })
  assert.ok(patient && labTest)

  // The catalogue is the authority in BOTH directions. Under-billing is the
  // fraud case, but a patient over-charged by an inflated line is the one who
  // complains — and the invoice would have looked just as ordinary.
  const inflated = labTest.price * 100
  const res = await callCreate({
    resource: 'invoice',
    patientId: patient.id,
    items: [{
      serviceName: labTest.testName, quantity: 1, unitPrice: inflated, total: inflated, tax: 0,
      sourceType: 'lab', sourceId: labTest.id,
    }],
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  await trackInvoice(res.body.data)

  const stored = await db.invoice.findUnique({ where: { id: res.body.data.id } })
  assert.equal(JSON.parse(stored.items)[0].unitPrice, labTest.price)
  assert.equal(stored.totalAmount, labTest.price, `patient must be charged ${labTest.price}, not ${inflated}`)
})

test('a free-typed line with no catalogue behind it is unaffected', { skip }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  assert.ok(patient)

  // Billing lets staff type any service name. There is no catalogue row to
  // check it against, so this must keep working exactly as before.
  const res = await callCreate({
    resource: 'invoice',
    patientId: patient.id,
    items: [{ serviceName: 'Dressing charge', quantity: 3, unitPrice: 150, total: 450, tax: 0 }],
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  await trackInvoice(res.body.data)

  const stored = await db.invoice.findUnique({ where: { id: res.body.data.id } })
  const line = JSON.parse(stored.items)[0]
  assert.equal(line.unitPrice, 150)
  assert.equal(line.total, 450)
  assert.equal(stored.totalAmount, 450)
})

test('an add-on test appended after billing is priced from the catalogue too', { skip }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  const labTest = await db.labTest.findFirst({
    where: { organizationId: ORG, price: { gt: 0 } },
    select: { id: true, testName: true, price: true },
  })
  assert.ok(patient && labTest)

  const inv = await callCreate({
    resource: 'invoice',
    patientId: patient.id,
    items: [{ serviceName: 'Consultation', quantity: 1, unitPrice: 300, total: 300, tax: 0 }],
  })
  assert.equal(inv.status, 201, JSON.stringify(inv.body))
  await trackInvoice(inv.body.data)

  // The same attack on the add-item path, which had its own copy of the flaw.
  const add = await callCreate({
    resource: 'invoiceItem',
    invoiceId: inv.body.data.id,
    item: {
      serviceName: labTest.testName,
      quantity: 1,
      unitPrice: 1,
      total: 1,
      tax: 0,
      sourceType: 'lab',
      sourceId: labTest.id,
    },
  })
  assert.equal(add.status, 201, JSON.stringify(add.body))

  const stored = await db.invoice.findUnique({ where: { id: inv.body.data.id } })
  const added = JSON.parse(stored.items).find((i) => i.serviceName === labTest.testName)
  assert.equal(added.unitPrice, labTest.price,
    `add-on billed at 1 must be stored at the catalogue price ${labTest.price}`)
  assert.equal(stored.totalAmount, Math.round((300 + labTest.price) * 100) / 100)
})

test('the discount ceiling is checked against the repriced total, not the caller\'s', { skip }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  const labTest = await db.labTest.findFirst({
    where: { organizationId: ORG, price: { gt: 100 } },
    select: { id: true, testName: true, price: true },
  })
  assert.ok(patient && labTest)

  // A discount below the real price but above the understated one must be
  // accepted — the guard has to use the catalogue total or it would reject a
  // perfectly legitimate discount.
  const discount = Math.floor(labTest.price / 2)
  const res = await callCreate({
    resource: 'invoice',
    patientId: patient.id,
    discountAmount: discount,
    items: [{
      serviceName: labTest.testName, quantity: 1, unitPrice: 1, total: 1, tax: 0,
      sourceType: 'lab', sourceId: labTest.id,
    }],
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  await trackInvoice(res.body.data)

  const stored = await db.invoice.findUnique({ where: { id: res.body.data.id } })
  assert.equal(stored.totalAmount, Math.round((labTest.price - discount) * 100) / 100)
})
