// Regression tests for the pharmacy inventory + receipt-numbering audit.
//
// Each case is one bug that reached real shelves and real receipts:
//   - consumeFromBatches read a batch, computed the new quantity in JS and wrote
//     it back, so two tills selling the last strip at the same millisecond both
//     succeeded and the shelf went negative. The guarded updateMany now makes the
//     loser fail with 409 instead.
//   - purchase-order goods-in bumped quantityInStock with a bare `increment` and
//     wrote no StockLedger row, so the ledger could never be reconciled against
//     the shelf and every later balanceAfter was short by that receipt.
//   - a receive trusted the drugId in the body, so it could inflate ANOTHER
//     hospital's stock and attach our batch to their drug.
//   - receipt numbers came from `Date.now()` + 4 random chars; receiptNumber is
//     unique per org, so a same-millisecond collision is a hard 500 in front of a
//     pharmacist — and the numbers never joined the hospital's one receipt book.
//   - PO numbers came from `count() + 1`, which two concurrent buyers both read.
//
// Real-database integration tests, two disposable organizations (isolation cannot
// be proved with one), both torn down in after() even on failure. Same pattern as
// concurrency.test.js; controllers driven with a fake req/res as in
// refundApprovalConcurrency.test.js.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { financialYear } from '../money.js'
import { consumeFromBatches, recordStockChange } from '../../pharmacy/stockService.js'
import { create as saleCreate } from '../../pharmacy/controllers/sale.controller.js'
import { create as poCreate, receive as poReceive } from '../../pharmacy/controllers/purchaseOrder.controller.js'

let ourOrg, theirOrg, raceDrug, receiptDrug, ledgerDrug, idempotentDrug, theirDrug

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

const sellOne = (drugId, quantity = 1, organizationId = ourOrg.id) =>
  callController(saleCreate, {
    organizationId,
    body: { items: [{ drugId, quantity, unitPrice: 10 }], paymentMethod: 'cash' },
  })

const createPurchaseOrder = (organizationId = ourOrg.id) =>
  callController(poCreate, {
    organizationId,
    body: { supplierName: 'Regression Supplier', items: [{ drugName: 'Anything', quantityOrdered: 50, totalCost: 500 }] },
  })

const receivePurchaseOrder = (poId, items, organizationId = ourOrg.id) =>
  callController(poReceive, { organizationId, params: { id: poId }, body: { items } })

/** Current value of an org's document counter, 0 when it has never been drawn. */
async function counterValue(organizationId, series) {
  const row = await db.billCounter.findUnique({
    where: { organizationId_series_year: { organizationId, series, year: financialYear() } },
    select: { value: true },
  })
  return row?.value ?? 0
}

const newDrug = (organizationId, drugName, quantityInStock) =>
  db.pharmacyDrug.create({ data: { organizationId, drugName, quantityInStock, sellingPrice: 10, gstRate: 5 } })

before(async () => {
  const stamp = Date.now()
  ourOrg = await db.organization.create({ data: { name: 'Test Org — pharmacyStock (ours)', slug: `test-stock-ours-${stamp}` } })
  theirOrg = await db.organization.create({ data: { name: 'Test Org — pharmacyStock (theirs)', slug: `test-stock-theirs-${stamp}` } })

  // The last strip on the shelf, tracked by exactly one batch.
  raceDrug = await newDrug(ourOrg.id, 'Race Tablet 500mg', 1)
  await db.pharmacyBatch.create({
    data: {
      organizationId: ourOrg.id, drugId: raceDrug.id, batchNumber: 'RACE-1',
      expiryDate: new Date('2030-12-31'), quantityReceived: 1, quantityRemaining: 1, status: 'active',
    },
  })

  receiptDrug = await newDrug(ourOrg.id, 'Receipt Tablet 500mg', 100)
  await db.pharmacyBatch.create({
    data: {
      organizationId: ourOrg.id, drugId: receiptDrug.id, batchNumber: 'RCPT-1',
      expiryDate: new Date('2030-12-31'), quantityReceived: 100, quantityRemaining: 100, status: 'active',
    },
  })

  // These two start empty — their whole stock arrives through goods-in, which is
  // what makes "the ledger sums to the shelf" a meaningful assertion.
  ledgerDrug = await newDrug(ourOrg.id, 'Ledger Syrup 100ml', 0)
  idempotentDrug = await newDrug(ourOrg.id, 'Idempotent Capsule 250mg', 0)
  theirDrug = await newDrug(theirOrg.id, 'Their Injection 2ml', 0)

  // The race test below runs one transaction inside another, so the pool must
  // already hold two live connections. Opening a fresh one while the rest of the
  // suite is hammering Postgres can blow Prisma's transaction-start budget and
  // fail the test for a reason that has nothing to do with stock.
  await Promise.all([
    db.$transaction(async (tx) => { await tx.$queryRaw`SELECT 1` }),
    db.$transaction(async (tx) => { await tx.$queryRaw`SELECT 1` }),
  ])
})

after(async () => {
  const orgIds = [ourOrg?.id, theirOrg?.id].filter(Boolean)
  if (!orgIds.length) return
  await db.stockLedger.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.pharmacySale.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.pharmacyBatch.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.pharmacyPurchaseOrder.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.pharmacyDrug.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.billCounter.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {})
})

test('a till selling the last strip while another till is mid-sale is refused, not served into negative stock', async () => {
  // Till 1 is held open mid-sale so till 2 provably runs INSIDE its transaction:
  // two plain concurrent requests are not reliable here — the first one often
  // finishes before the second reads, and then the drug-level check masks the
  // batch race this test exists to cover.
  let secondTill
  await db.$transaction(async (tx) => {
    await consumeFromBatches(tx, { drugId: raceDrug.id, quantity: 1 })
    await recordStockChange(tx, {
      organizationId: ourOrg.id, drugId: raceDrug.id, changeType: 'sale', quantityDelta: -1, note: 'till 1',
    })
    // Fired, not awaited: till 2 reads the batch as still available (till 1 has
    // not committed) and then blocks on the row it is trying to decrement.
    secondTill = sellOne(raceDrug.id)
    await new Promise((resolve) => setTimeout(resolve, 300))
  }, { maxWait: 15000, timeout: 30000 })

  const sale = await secondTill
  assert.equal(sale.status, 409, `the losing till must be told to retry, not silently served: ${JSON.stringify(sale.body)}`)

  const drug = await db.pharmacyDrug.findUnique({ where: { id: raceDrug.id }, select: { quantityInStock: true } })
  const batch = await db.pharmacyBatch.findFirst({ where: { drugId: raceDrug.id }, select: { quantityRemaining: true } })
  assert.equal(drug.quantityInStock, 0, 'stock went negative — medicine was billed that does not exist')
  assert.equal(batch.quantityRemaining, 0, 'the batch went negative — FIFO and expiry tracking are now unusable')
  assert.equal(await db.pharmacySale.count({ where: { organizationId: ourOrg.id } }), 0, 'the losing till still printed a bill')
})

test('goods-in and a sale both land in the StockLedger, so the ledger still sums to the real shelf count', async () => {
  const po = await createPurchaseOrder()
  assert.equal(po.status, 201, JSON.stringify(po.body))

  const received = await receivePurchaseOrder(po.body.data.id, [{
    drugId: ledgerDrug.id, batchNumber: 'LEDG-1', expiryDate: '2030-12-31', quantityReceived: 50, costPricePerUnit: 4,
  }])
  assert.equal(received.status, 200, JSON.stringify(received.body))

  const sale = await sellOne(ledgerDrug.id, 5)
  assert.equal(sale.status, 201, JSON.stringify(sale.body))

  const drug = await db.pharmacyDrug.findUnique({ where: { id: ledgerDrug.id }, select: { quantityInStock: true } })
  const ledger = await db.stockLedger.findMany({ where: { drugId: ledgerDrug.id }, orderBy: { createdAt: 'asc' } })
  const purchaseRow = ledger.find((row) => row.changeType === 'purchase')
  const saleRow = ledger.find((row) => row.changeType === 'sale')

  assert.equal(drug.quantityInStock, 45)
  // A bare `increment` on goods-in leaves no row here at all, and the shelf count
  // can then never be explained from the ledger.
  assert.ok(purchaseRow, 'the purchase receipt never reached the StockLedger')
  assert.equal(purchaseRow.quantityDelta, 50)
  assert.equal(purchaseRow.balanceAfter, 50)
  assert.ok(purchaseRow.batchId, 'the ledger row must name the batch the stock arrived in')
  assert.equal(saleRow.quantityDelta, -5)
  assert.equal(saleRow.balanceAfter, 45)
  assert.equal(
    ledger.reduce((sum, row) => sum + row.quantityDelta, 0),
    drug.quantityInStock,
    'the ledger no longer reconciles against quantityInStock',
  )
})

test('receiving a purchase order against another hospital\'s drug is refused, not silently added to their stock', async () => {
  const po = await createPurchaseOrder()
  assert.equal(po.status, 201, JSON.stringify(po.body))

  const received = await receivePurchaseOrder(po.body.data.id, [{
    drugId: theirDrug.id, batchNumber: 'XTENANT-1', expiryDate: '2030-12-31', quantityReceived: 50,
  }])
  assert.equal(received.status, 404, JSON.stringify(received.body))

  const drug = await db.pharmacyDrug.findUnique({ where: { id: theirDrug.id }, select: { quantityInStock: true } })
  assert.equal(drug.quantityInStock, 0, 'another hospital\'s stock was inflated by our purchase order')
  assert.equal(await db.pharmacyBatch.count({ where: { drugId: theirDrug.id } }), 0, 'our batch was attached to their drug')
  // The whole receive is one transaction, so a rejected line must leave the PO
  // open — otherwise the real goods can never be booked in.
  const order = await db.pharmacyPurchaseOrder.findUnique({ where: { id: po.body.data.id }, select: { status: true } })
  assert.equal(order.status, 'draft')
})

test('a burst of sales draws consecutive numbers from the hospital\'s one receipt book, never a duplicate', async () => {
  // receiptNumber is unique per org: a repeat is a hard 500 at the counter. And a
  // number minted outside the OPD_RCP series is a second receipt book that walks
  // back over numbers billing has already issued.
  const before = await counterValue(ourOrg.id, 'OPD_RCP')
  const results = await Promise.all(Array.from({ length: 5 }, () => sellOne(receiptDrug.id)))
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body))

  const issued = results.map((r) => r.body.data.receiptNumber)
  assert.equal(new Set(issued).size, issued.length, `duplicate receipt number issued: ${issued.join(', ')}`)

  const after = await counterValue(ourOrg.id, 'OPD_RCP')
  assert.equal(after - before, 5, 'the shared receipt counter did not advance — these numbers came from somewhere else')
  const expected = Array.from({ length: 5 }, (_, i) => `RCP-${financialYear()}-${String(before + i + 1).padStart(6, '0')}`)
  assert.deepEqual([...issued].sort(), expected.sort(), 'receipt numbers are not the block the shared counter handed out')
})

test('a delivery booked in twice does not add its quantities to stock twice', async () => {
  const po = await createPurchaseOrder()
  assert.equal(po.status, 201, JSON.stringify(po.body))
  const items = [{ drugId: idempotentDrug.id, batchNumber: 'IDEM-1', expiryDate: '2030-12-31', quantityReceived: 30 }]

  const first = await receivePurchaseOrder(po.body.data.id, items)
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const second = await receivePurchaseOrder(po.body.data.id, items)
  assert.equal(second.status, 409, `a second "Receive" click must be rejected: ${JSON.stringify(second.body)}`)

  const drug = await db.pharmacyDrug.findUnique({ where: { id: idempotentDrug.id }, select: { quantityInStock: true } })
  assert.equal(drug.quantityInStock, 30, 'the delivery was counted twice — the shelf now claims stock that was never delivered')
  assert.equal(await db.pharmacyBatch.count({ where: { drugId: idempotentDrug.id } }), 1, 'a duplicate batch was created for one delivery')
})

test('two buyers raising a purchase order together get different PO numbers', async () => {
  // poNumber has no unique constraint, so `count() + 1` wrote the duplicate
  // silently and two different orders answered to one number forever.
  const [a, b] = await Promise.all([createPurchaseOrder(), createPurchaseOrder()])
  assert.equal(a.status, 201, JSON.stringify(a.body))
  assert.equal(b.status, 201, JSON.stringify(b.body))
  assert.notEqual(a.body.data.poNumber, b.body.data.poNumber)
  for (const po of [a, b]) {
    assert.match(po.body.data.poNumber, new RegExp(`^PO-${financialYear()}-\\d{6}$`))
  }
})
