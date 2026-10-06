// Today's Revenue (lib/revenue.js): every counter's money taken today, minus
// refunds paid out today — the figure Billing's tile and the Dashboard share.
//
// Real-database test on a disposable org (same pattern as pharmacyRevenue.test.js):
// what is under test is the WHERE clauses of the actual aggregates.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { todayRevenue } from '../revenue.js'

let org, other, patient, admission
const YESTERDAY = new Date(Date.now() - 36 * 3600 * 1000)
let seq = 0
const no = (p) => `${p}-${Date.now()}-${++seq}`

async function invoiceFor(orgId, patientId, total) {
  return db.invoice.create({ data: { organizationId: orgId, patientId, invoiceNumber: no('TINV'), items: '[]', subtotal: total, totalAmount: total } })
}
const pay = (invoiceId, amount, extra = {}) => db.payment.create({ data: { organizationId: org.id, invoiceId, receiptNumber: no('TRCP'), amount, paymentMethod: 'cash', ...extra } })
const sale = (amountPaid, extra = {}) => db.pharmacySale.create({ data: { organizationId: org.id, receiptNumber: no('TPH'), items: '[]', subtotal: amountPaid, totalAmount: amountPaid, amountPaid, paymentStatus: 'paid', ...extra } })
const ipd = (amount, type, extra = {}) => db.billPayment.create({ data: { organizationId: org.id, admissionId: admission.id, type, amount, method: 'CASH', status: 'SUCCESS', ...extra } })

before(async () => {
  org = await db.organization.create({ data: { name: 'Test Org — todayRevenue.test.js', slug: `test-todayrev-${Date.now()}` } })
  other = await db.organization.create({ data: { name: 'Test Org — todayRevenue other', slug: `test-todayrev-o-${Date.now()}` } })
  patient = await db.patient.create({ data: { organizationId: org.id, mrn: no('TMRN'), firstName: 'Rev', lastName: 'Test', gender: 'male', dateOfBirth: new Date('1980-01-01'), phonePrimary: '9800000000' } })
  admission = await db.admission.create({ data: { organizationId: org.id, patientId: patient.id } })
})

after(async () => {
  // Admission → BillPayment is Restrict, so the ledger goes first.
  for (const o of [org, other]) {
    await db.billPayment.deleteMany({ where: { organizationId: o.id } })
    await db.organization.delete({ where: { id: o.id } })
  }
})

test('nothing taken → 0', async () => {
  const r = await todayRevenue(db, org.id)
  assert.equal(r.total, 0)
})

test('every counter adds up, refunds paid out today come off', async () => {
  const inv = await invoiceFor(org.id, patient.id, 2000)
  await pay(inv.id, 1000.5) // OPD / lab / day care — all Billing payments
  await pay(inv.id, 200, { isRefund: true, status: 'APPROVED', approvalDate: new Date() }) // refunded today
  await pay(inv.id, 50, { isRefund: true, status: 'PENDING_APPROVAL' }) // not paid out yet
  await pay(inv.id, 70, { isRefund: true, status: 'REJECTED', approvalDate: new Date() }) // never paid out
  await sale(10) // pharmacy counter
  await ipd(2000, 'ADVANCE')
  await ipd(500, 'PAYMENT')
  await ipd(-300, 'REFUND') // approved/paid today
  await ipd(-40, 'REFUND', { status: 'PENDING_APPROVAL' }) // waiting for Finance
  await ipd(-60, 'REFUND', { status: 'REJECTED' })
  await ipd(999, 'PAYMENT', { status: 'VOID' })

  const r = await todayRevenue(db, org.id)
  assert.deepEqual(
    { billing: r.billing, pharmacy: r.pharmacy, ipd: r.ipd, refunds: r.refunds },
    { billing: 1000.5, pharmacy: 10, ipd: 2500, refunds: 500 },
  )
  assert.equal(r.total, 3010.5, '1000.50 + 10 + 2500 − (200 + 300)')
})

test('yesterday is not today: a payment and a refund approved yesterday stay out', async () => {
  const before = await todayRevenue(db, org.id)
  const inv = await invoiceFor(org.id, patient.id, 100)
  await pay(inv.id, 100, { paymentDate: YESTERDAY })
  await pay(inv.id, 30, { isRefund: true, status: 'APPROVED', approvalDate: YESTERDAY })
  await ipd(400, 'PAYMENT', { paidAt: YESTERDAY })
  await sale(25, { saleDate: YESTERDAY })
  assert.equal((await todayRevenue(db, org.id)).total, before.total)
})

test('a refund raised yesterday but approved today counts today', async () => {
  const before = await todayRevenue(db, org.id)
  const inv = await invoiceFor(org.id, patient.id, 100)
  await pay(inv.id, 15, { isRefund: true, status: 'APPROVED', paymentDate: YESTERDAY, approvalDate: new Date() })
  assert.equal((await todayRevenue(db, org.id)).total, before.total - 15)
})

test('a pharmacy sale that is also a Billing payment (same receipt) or an old billing sale (invoice number) is not counted twice; a cancelled sale is out', async () => {
  const before = await todayRevenue(db, org.id)
  const inv = await invoiceFor(org.id, patient.id, 80)
  const p = await pay(inv.id, 80)
  await sale(80, { receiptNumber: p.receiptNumber }) // WhatsApp order: sale + payment, one receipt
  await sale(45, { receiptNumber: inv.invoiceNumber }) // legacy: sale minted from the invoice
  await sale(33, { paymentStatus: 'cancelled' })
  const r = await todayRevenue(db, org.id)
  assert.equal(r.total, before.total + 80, 'only the Billing payment of 80 is new money')
})

test("another hospital's money never reaches this one", async () => {
  const before = await todayRevenue(db, org.id)
  const op = await db.patient.create({ data: { organizationId: other.id, mrn: no('TMRN'), firstName: 'O', lastName: 'T', gender: 'male', dateOfBirth: new Date('1980-01-01'), phonePrimary: '9800000001' } })
  const inv = await invoiceFor(other.id, op.id, 5000)
  await db.payment.create({ data: { organizationId: other.id, invoiceId: inv.id, receiptNumber: no('TRCP'), amount: 5000, paymentMethod: 'cash' } })
  await db.pharmacySale.create({ data: { organizationId: other.id, receiptNumber: no('TPH'), items: '[]', subtotal: 70, totalAmount: 70, amountPaid: 70, paymentStatus: 'paid' } })
  assert.equal((await todayRevenue(db, org.id)).total, before.total)
  assert.equal((await todayRevenue(db, other.id)).total, 5070)
})
