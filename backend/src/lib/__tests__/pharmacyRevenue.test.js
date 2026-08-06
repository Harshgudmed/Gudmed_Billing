// A cancelled pharmacy sale must stop counting as money taken.
//
// Cancelling an invoice does not delete the PharmacySale it created — the row is
// voided (paymentStatus 'cancelled') so the stock return stays traceable to a
// document. The pharmacy dashboard's "today's sales" therefore has to exclude
// it, or the tile reports cash the hospital never kept and a manager reconciles
// the till against a number that was never real.
//
// Real-database test on a disposable org, same pattern as concurrency.test.js —
// the point is the actual aggregate query, not a mock of it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { startOfToday } from '../dates.js'

let org

// Mirrors the aggregate in pharmacy/controllers/stats.controller.js. Kept here
// rather than importing getStats because that is an Express handler; this is the
// query whose WHERE clause is under test.
async function todaysSales(organizationId) {
  const today = startOfToday()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const agg = await db.pharmacySale.aggregate({
    where: {
      organizationId,
      createdAt: { gte: today, lt: tomorrow },
      paymentStatus: { not: 'cancelled' },
    },
    _sum: { totalAmount: true },
    _count: { id: true },
  })
  return { total: agg._sum.totalAmount ?? 0, count: agg._count.id }
}

const sale = (organizationId, receiptNumber, totalAmount, paymentStatus) => ({
  organizationId,
  receiptNumber,
  items: JSON.stringify([{ drugName: 'Test Drug', quantity: 1, unitPrice: totalAmount, total: totalAmount }]),
  subtotal: totalAmount,
  totalAmount,
  amountPaid: paymentStatus === 'cancelled' ? 0 : totalAmount,
  paymentMethod: 'cash',
  paymentStatus,
})

before(async () => {
  org = await db.organization.create({
    data: { name: 'Test Org — pharmacyRevenue.test.js', slug: `test-pharmrev-${Date.now()}` },
  })
})

after(async () => {
  await db.pharmacySale.deleteMany({ where: { organizationId: org.id } })
  await db.organization.delete({ where: { id: org.id } })
})

test("a cancelled sale is not counted as today's pharmacy revenue", async () => {
  const stamp = Date.now()
  await db.pharmacySale.createMany({
    data: [
      sale(org.id, `TESTRCP-${stamp}-A`, 500, 'paid'),
      sale(org.id, `TESTRCP-${stamp}-B`, 300, 'paid'),
      sale(org.id, `TESTRCP-${stamp}-C`, 900, 'cancelled'), // voided by an invoice cancel
    ],
  })

  const { total, count } = await todaysSales(org.id)
  assert.equal(total, 800, 'only the two live sales (500 + 300) are revenue; the cancelled 900 is not')
  assert.equal(count, 2, 'the cancelled sale must not inflate the sale count either')
})

test('a partially paid sale still counts — only cancelled is excluded', async () => {
  const stamp = Date.now()
  await db.pharmacySale.create({ data: sale(org.id, `TESTRCP-${stamp}-D`, 250, 'partially_paid') })

  const { total } = await todaysSales(org.id)
  // 500 + 300 from the previous test, plus this 250. The cancelled 900 stays out.
  assert.equal(total, 1050, 'excluding cancelled must not also drop unpaid/partial sales')
})

test('cancelling a sale removes exactly its amount from the total, nothing else', async () => {
  const before = await todaysSales(org.id)
  const stamp = Date.now()
  const row = await db.pharmacySale.create({ data: sale(org.id, `TESTRCP-${stamp}-E`, 400, 'paid') })

  const withSale = await todaysSales(org.id)
  assert.equal(withSale.total, before.total + 400, 'a new paid sale adds its full amount')

  await db.pharmacySale.update({ where: { id: row.id }, data: { paymentStatus: 'cancelled' } })

  const afterCancel = await todaysSales(org.id)
  assert.equal(afterCancel.total, before.total, 'cancelling it takes back exactly that amount')
  assert.equal(afterCancel.count, before.count, 'and drops it from the count')

  // The row itself survives — the stock return has to stay traceable to it.
  const stillThere = await db.pharmacySale.findUnique({ where: { id: row.id }, select: { paymentStatus: true } })
  assert.equal(stillThere?.paymentStatus, 'cancelled', 'the sale is voided, never deleted')
})

test("another hospital's sales never leak into this one's revenue", async () => {
  const other = await db.organization.create({
    data: { name: 'Test Org — pharmacyRevenue other', slug: `test-pharmrev-other-${Date.now()}` },
  })
  try {
    const before = await todaysSales(org.id)
    await db.pharmacySale.create({ data: sale(other.id, `TESTRCP-OTHER-${Date.now()}`, 9999, 'paid') })
    const after = await todaysSales(org.id)
    assert.equal(after.total, before.total, "a sale in another org must not move this org's revenue")
  } finally {
    await db.pharmacySale.deleteMany({ where: { organizationId: other.id } })
    await db.organization.delete({ where: { id: other.id } })
  }
})
