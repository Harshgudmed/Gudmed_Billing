// Cancelling an invoice must undo what billing it actually DID, not just flip a
// status column.
//
// fulfillInvoiceItems turns a billed line into real-world consequences: pharmacy
// stock is drawn down, a PharmacySale is written, and lab / radiology orders are
// raised onto the departments' worklists. Cancelling used to change only
// Invoice.status, so every one of those survived a voided bill — the medicine
// stayed off the shelf and could never be sold again, the sale kept counting as
// pharmacy revenue, and the lab kept processing work nobody would pay for.
//
// The one thing cancellation must NOT undo is work somebody has already done.
// Once a sample is collected or an exam performed, that is a real clinical
// record; silently dropping it off the worklist would lose a result. Those are
// left alone for a human to decide on.
//
// Integration test: drives the real billingController against the dev database,
// same fake-req/res harness as refundApprovalConcurrency.test.js. Skipped when
// no DATABASE_URL is available.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

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
const skip = !HAS_DB && 'DATABASE_URL not set'

let db, create, update
const require = createRequire(path.join(backendRoot, 'package.json'))

// Everything inserted, tracked so the database is left exactly as found.
const trash = { invoiceIds: [], invoiceNumbers: [] }

function callController(fn, body) {
  return new Promise((resolve, reject) => {
    const req = { body, organizationId: ORG, user: null }
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(payload) { resolve({ status: this.statusCode, body: payload }) },
    }
    Promise.resolve(fn(req, res)).catch(reject)
  })
}

async function billFor(items) {
  const { body } = await callController(create, { resource: 'invoice', patientId: fixtures.patientId, items })
  assert.ok(body?.data?.id, `invoice creation failed: ${JSON.stringify(body?.error)}`)
  trash.invoiceIds.push(body.data.id)
  trash.invoiceNumbers.push(body.data.invoiceNumber)
  return body.data
}

const cancelInvoice = (id) =>
  callController(update, { resource: 'invoice', id, updates: { status: 'cancelled', cancellationReason: 'test' } })

const stockOf = async (drugId) =>
  (await db.pharmacyDrug.findUnique({ where: { id: drugId }, select: { quantityInStock: true } })).quantityInStock

const fixtures = {}

before(async () => {
  if (!HAS_DB) return
  const { PrismaClient } = require('@prisma/client')
  db = new PrismaClient()
  ;({ create, update } = await import('../../controllers/billingController.js'))

  fixtures.patientId = (await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } }))?.id
  fixtures.drug = await db.pharmacyDrug.findFirst({
    where: { organizationId: ORG, isActive: true, quantityInStock: { gte: 20 } },
    select: { id: true, drugName: true },
  })
  fixtures.labTest = await db.labTest.findFirst({ where: { organizationId: ORG }, select: { id: true, testName: true } })
  fixtures.exam = await db.radiologyExam.findFirst({ where: { organizationId: ORG }, select: { id: true, examName: true } })
})

after(async () => {
  if (!HAS_DB || !db) return
  for (const number of trash.invoiceNumbers) {
    await db.labResult.deleteMany({ where: { order: { orderNumber: `LAB-${number}` } } }).catch(() => {})
    await db.labOrder.deleteMany({ where: { orderNumber: `LAB-${number}` } }).catch(() => {})
    await db.radiologyOrder.deleteMany({ where: { orderNumber: { startsWith: `RAD-${number}-` } } }).catch(() => {})
    const sales = await db.pharmacySale.findMany({ where: { receiptNumber: number }, select: { id: true } }).catch(() => [])
    await db.stockLedger.deleteMany({ where: { reference: { in: sales.map((s) => s.id) } } }).catch(() => {})
    await db.pharmacySale.deleteMany({ where: { id: { in: sales.map((s) => s.id) } } }).catch(() => {})
  }
  await db.payment.deleteMany({ where: { invoiceId: { in: trash.invoiceIds } } }).catch(() => {})
  await db.auditLog.deleteMany({ where: { entityId: { in: trash.invoiceIds } } }).catch(() => {})
  await db.invoice.deleteMany({ where: { id: { in: trash.invoiceIds } } }).catch(() => {})
  await db.$disconnect()
})

test('cancelling a pharmacy bill puts the medicine back on the shelf', { skip }, async () => {
  const before = await stockOf(fixtures.drug.id)
  const invoice = await billFor([{
    serviceName: fixtures.drug.drugName, quantity: 6, unitPrice: 100, total: 600,
    sourceType: 'pharmacy', sourceId: fixtures.drug.id,
  }])

  assert.equal(await stockOf(fixtures.drug.id), before - 6, 'billing must draw the stock down first')

  await cancelInvoice(invoice.id)
  assert.equal(await stockOf(fixtures.drug.id), before,
    'a voided bill must not leave the shelf short — the medicine was never handed over')
})

test('the stock return is written to the ledger, so the shelf can be reconciled', { skip }, async () => {
  const invoice = await billFor([{
    serviceName: fixtures.drug.drugName, quantity: 3, unitPrice: 100, total: 300,
    sourceType: 'pharmacy', sourceId: fixtures.drug.id,
  }])
  await cancelInvoice(invoice.id)

  const entries = await db.stockLedger.findMany({
    where: { drugId: fixtures.drug.id, note: { contains: invoice.invoiceNumber } },
    orderBy: { createdAt: 'asc' },
    select: { changeType: true, quantityDelta: true, balanceAfter: true },
  })
  const sale = entries.find((e) => e.quantityDelta < 0)
  const ret = entries.find((e) => e.quantityDelta > 0)
  assert.ok(sale, 'the sale must appear in the ledger')
  assert.ok(ret, 'the return must appear in the ledger — a bare stock increment leaves every later balance wrong')
  assert.equal(ret.changeType, 'return')
  assert.equal(ret.quantityDelta, -sale.quantityDelta, 'exactly what was taken is what comes back')
  assert.equal(ret.balanceAfter, await stockOf(fixtures.drug.id), 'the ledger balance matches the real shelf count')
})

test('double-clicking cancel does not return the stock twice', { skip }, async () => {
  const before = await stockOf(fixtures.drug.id)
  const invoice = await billFor([{
    serviceName: fixtures.drug.drugName, quantity: 4, unitPrice: 100, total: 400,
    sourceType: 'pharmacy', sourceId: fixtures.drug.id,
  }])

  const [first, second] = await Promise.all([cancelInvoice(invoice.id), cancelInvoice(invoice.id)])
  const outcomes = [first.status, second.status].sort()
  assert.deepEqual(outcomes, [200, 409], 'exactly one cancel wins; the other is refused as already cancelled')
  assert.equal(await stockOf(fixtures.drug.id), before,
    'the shelf must not gain goods that were only ever dispensed once')
})

test('the cancelled sale is voided, never deleted, so the return stays traceable', { skip }, async () => {
  const invoice = await billFor([{
    serviceName: fixtures.drug.drugName, quantity: 2, unitPrice: 100, total: 200,
    sourceType: 'pharmacy', sourceId: fixtures.drug.id,
  }])
  await cancelInvoice(invoice.id)

  const sale = await db.pharmacySale.findFirst({
    where: { receiptNumber: invoice.invoiceNumber }, select: { paymentStatus: true },
  })
  assert.ok(sale, 'the sale row must survive — the stock ledger points at it')
  assert.equal(sale.paymentStatus, 'cancelled', 'and it must stop counting as pharmacy revenue')
})

test('no money can be taken against a cancelled invoice', { skip }, async () => {
  const invoice = await billFor([{ serviceName: 'Cancel guard consult', quantity: 1, unitPrice: 500, total: 500 }])
  await cancelInvoice(invoice.id)

  const { status, body } = await callController(create, {
    resource: 'payment', invoiceId: invoice.id, amount: 500, paymentMethod: 'cash',
  })
  assert.notEqual(status, 201, 'a voided bill must never accept a payment')
  assert.match(String(body?.error), /cancel/i)
})

test('cancelling the bill takes a not-yet-started lab order off the worklist', { skip }, async () => {
  const invoice = await billFor([{
    serviceName: fixtures.labTest.testName, quantity: 1, unitPrice: 300, total: 300,
    sourceType: 'lab', sourceId: fixtures.labTest.id,
  }])
  const order = await db.labOrder.findFirst({
    where: { orderNumber: `LAB-${invoice.invoiceNumber}` }, select: { id: true, status: true },
  })
  assert.ok(order, 'billing a lab line must raise the order')
  assert.equal(order.status, 'pending')

  await cancelInvoice(invoice.id)
  const after = await db.labOrder.findUnique({ where: { id: order.id }, select: { status: true } })
  assert.equal(after.status, 'cancelled', 'the lab must not keep processing work nobody will pay for')
})

test('a lab order whose sample was already collected survives the cancellation', { skip }, async () => {
  const invoice = await billFor([{
    serviceName: fixtures.labTest.testName, quantity: 1, unitPrice: 300, total: 300,
    sourceType: 'lab', sourceId: fixtures.labTest.id,
  }])
  const order = await db.labOrder.findFirst({
    where: { orderNumber: `LAB-${invoice.invoiceNumber}` }, select: { id: true },
  })
  await db.labOrder.update({ where: { id: order.id }, data: { status: 'sample_collected', sampleCollectedAt: new Date() } })

  await cancelInvoice(invoice.id)
  const after = await db.labOrder.findUnique({ where: { id: order.id }, select: { status: true } })
  assert.equal(after.status, 'sample_collected',
    'the sample is drawn and the patient has been stuck once — cancelling a bill must not erase that')
})

test('cancelling the bill takes a not-yet-performed radiology order off the worklist', { skip }, async () => {
  const invoice = await billFor([{
    serviceName: fixtures.exam.examName, quantity: 1, unitPrice: 900, total: 900,
    sourceType: 'radiology', sourceId: fixtures.exam.id,
  }])
  const order = await db.radiologyOrder.findFirst({
    where: { orderNumber: { startsWith: `RAD-${invoice.invoiceNumber}-` } }, select: { id: true, status: true },
  })
  assert.ok(order, 'billing a radiology line must raise the order')

  await cancelInvoice(invoice.id)
  const after = await db.radiologyOrder.findUnique({ where: { id: order.id }, select: { status: true } })
  assert.equal(after.status, 'cancelled')
})

test('cancelling one bill does not disturb another bill\'s orders', { skip }, async () => {
  const keep = await billFor([{
    serviceName: fixtures.labTest.testName, quantity: 1, unitPrice: 300, total: 300,
    sourceType: 'lab', sourceId: fixtures.labTest.id,
  }])
  const drop = await billFor([{
    serviceName: fixtures.labTest.testName, quantity: 1, unitPrice: 300, total: 300,
    sourceType: 'lab', sourceId: fixtures.labTest.id,
  }])

  await cancelInvoice(drop.id)

  const untouched = await db.labOrder.findFirst({
    where: { orderNumber: `LAB-${keep.invoiceNumber}` }, select: { status: true },
  })
  assert.equal(untouched.status, 'pending',
    'the reversal is matched on the invoice number — it must never reach a neighbouring order')
})
