// Day-care cases and ambulance trips are billed in Billing (lib/invoiceFulfillment.js):
// one bill per record, found by its key "DAYCARE:<case number>"; its payments are the
// one ledger; a charge follows the case only while nothing is paid; Billing cancelling
// the bill calls off a case nobody has started.
//
// Integration test against the dev database, in a throwaway hospital created here and
// deleted at the end (the delete cascades). Skipped when no DATABASE_URL is available.
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

const skip = !process.env.DATABASE_URL && 'DATABASE_URL not set'
const require = createRequire(path.join(backendRoot, 'package.json'))
let db, lib, org, patientId
let n = 0

async function caseWithBill({ fee, paid = 0, status = 'admitted' }) {
  n += 1
  const caseNumber = `DAY-T-${n}`
  const dayCase = await db.dayCareCase.create({ data: { organizationId: org.id, caseNumber, patientId, fee, status } })
  const invoice = await db.invoice.create({
    data: {
      organizationId: org.id, patientId, invoiceNumber: `INV-T-${n}`, idempotencyKey: lib.moduleBillKey('daycare', caseNumber),
      items: JSON.stringify([{ serviceName: 'Day care', quantity: 1, unitPrice: fee, total: fee, tax: 0, type: 'daycare' }]),
      subtotal: fee, totalAmount: fee, balanceDue: fee, notes: `[Day Care] Day Care Case ${caseNumber}`,
    },
  })
  if (paid > 0) {
    await db.payment.create({ data: { organizationId: org.id, invoiceId: invoice.id, patientId, amount: paid, paymentMethod: 'cash', receiptNumber: `RCP-T-${n}` } })
    await lib.recalc(db, invoice.id)
  }
  return { dayCase, invoice }
}

before(async () => {
  if (skip) return
  const { PrismaClient } = require('@prisma/client')
  db = new PrismaClient()
  const fulfil = await import('../invoiceFulfillment.js')
  const ledger = await import('../invoiceLedger.js')
  lib = { ...fulfil, recalc: ledger.recalcInvoice }
  org = await db.organization.create({ data: { name: 'Test record bills', slug: `test-record-bills-${Date.now()}`, email: 'rb@x.local', phone: '9000000000' } })
  patientId = (await db.patient.create({ data: { organizationId: org.id, mrn: 'RB-1', firstName: 'Test', lastName: 'Patient', gender: 'female', dateOfBirth: new Date('1990-01-01'), phonePrimary: '9000000001' } })).id
})

after(async () => {
  if (skip || !db) return
  await db.organization.delete({ where: { id: org.id } }).catch(() => {})
  await db.$disconnect()
})

test('the list reads each case\'s live bill in one go, following a refund revision', { skip }, async () => {
  const a = await caseWithBill({ fee: 1000, paid: 300 })
  const b = await caseWithBill({ fee: 500 })
  // b's bill revised by a refund: the original archived, -R1 live.
  await db.invoice.update({ where: { id: b.invoice.id }, data: { isArchived: true } })
  const rev = await db.invoice.create({ data: { organizationId: org.id, patientId, invoiceNumber: `${b.invoice.invoiceNumber}-R1`, parentInvoiceId: b.invoice.id, items: '[]', subtotal: 400, totalAmount: 400, balanceDue: 400 } })
  const bills = await lib.billsOfRecords(db, org.id, 'daycare', [a.dayCase.caseNumber, b.dayCase.caseNumber, 'DAY-NONE'])
  assert.equal(bills.get(a.dayCase.caseNumber).amountPaid, 300)
  assert.equal(bills.get(a.dayCase.caseNumber).balanceDue, 700)
  assert.equal(bills.get(b.dayCase.caseNumber).id, rev.id)
  assert.equal(bills.has('DAY-NONE'), false)
  // Another hospital's lookup sees none of them.
  assert.equal((await lib.billsOfRecords(db, 'another-org', 'daycare', [a.dayCase.caseNumber])).size, 0)
})

test('withBill: payment status is the bill\'s; a case from before the sync keeps its own figures', { skip }, () => {
  assert.equal(lib.withBill({ amountPaid: 0 }, { paymentStatus: 'partially_paid', status: 'sent' }).paymentStatus, 'partial')
  assert.equal(lib.withBill({ amountPaid: 0 }, { paymentStatus: 'unpaid', status: 'cancelled' }).paymentStatus, 'cancelled')
  const legacy = lib.withBill({ amountPaid: 400, paymentStatus: 'partial' }, undefined)
  assert.equal(legacy.bill, null)
  assert.equal(legacy.paidOutsideBilling, 400)
  assert.equal(legacy.paymentStatus, 'partial')
})

test('a new fee re-prices an unpaid bill (same bill), is refused once paid, and 0 cancels the bill', { skip }, async () => {
  const unpaid = await caseWithBill({ fee: 800 })
  assert.deepEqual(await db.$transaction((tx) => lib.changeRecordCharge(tx, { organizationId: org.id, kind: 'daycare', number: unpaid.dayCase.caseNumber, charge: 900 })), {})
  const after = await db.invoice.findUnique({ where: { id: unpaid.invoice.id } })
  assert.equal(after.totalAmount, 900)
  assert.equal(after.balanceDue, 900)
  assert.equal(JSON.parse(after.items)[0].total, 900)

  const paid = await caseWithBill({ fee: 800, paid: 100 })
  const refused = await db.$transaction((tx) => lib.changeRecordCharge(tx, { organizationId: org.id, kind: 'daycare', number: paid.dayCase.caseNumber, charge: 900 }))
  assert.match(refused.refusal.error, /Change it in Billing/)
  assert.equal((await db.invoice.findUnique({ where: { id: paid.invoice.id } })).totalAmount, 800)

  await db.$transaction((tx) => lib.changeRecordCharge(tx, { organizationId: org.id, kind: 'daycare', number: unpaid.dayCase.caseNumber, charge: 0 }))
  assert.equal((await db.invoice.findUnique({ where: { id: unpaid.invoice.id } })).status, 'cancelled')
})

test('cancelling here: paid → refused naming "Cancel & refund"; unpaid → its bill goes with it', { skip }, async () => {
  const paid = await caseWithBill({ fee: 500, paid: 500 })
  const p = await lib.orderCancelCheck(db, org.id, 'daycare', paid.dayCase.caseNumber)
  assert.match(p.refusal.error, /This case is paid on .*Cancel & refund/)
  const unpaid = await caseWithBill({ fee: 500 })
  const u = await lib.orderCancelCheck(db, org.id, 'daycare', unpaid.dayCase.caseNumber)
  assert.equal(u.cancelBill.id, unpaid.invoice.id)
})

test('Billing cancelling the bill calls off a case not yet started, and leaves one in procedure', { skip }, async () => {
  const open = await caseWithBill({ fee: 300 })
  const started = await caseWithBill({ fee: 300, status: 'in_procedure' })
  const r1 = await db.$transaction((tx) => lib.callOffBilledRecord(tx, { organizationId: org.id, baseInvoiceNumber: open.invoice.invoiceNumber }))
  assert.deepEqual(r1.dayCareCaseIds, [open.dayCase.id])
  assert.equal((await db.dayCareCase.findUnique({ where: { id: open.dayCase.id } })).status, 'cancelled')
  const r2 = await db.$transaction((tx) => lib.callOffBilledRecord(tx, { organizationId: org.id, baseInvoiceNumber: started.invoice.invoiceNumber }))
  assert.deepEqual(r2.dayCareCaseIds, [])
  assert.equal((await db.dayCareCase.findUnique({ where: { id: started.dayCase.id } })).status, 'in_procedure')
  // A bill with no record key (an OPD bill) calls off nothing.
  const opd = await db.invoice.create({ data: { organizationId: org.id, patientId, invoiceNumber: 'INV-T-OPD', items: '[]', subtotal: 1, totalAmount: 1 } })
  assert.deepEqual(await db.$transaction((tx) => lib.callOffBilledRecord(tx, { organizationId: org.id, baseInvoiceNumber: opd.invoiceNumber })), { dayCareCaseIds: [], ambulanceTripIds: [] })
})
