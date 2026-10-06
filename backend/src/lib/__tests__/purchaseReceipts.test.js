// Goods-receipt rules: what may be accepted against an order line, the order's
// status after receipts, expiry, stock state and unit cost. Pure functions, so
// no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pendingOf, checkReceiptLine, statusAfterReceipts, expiryProblem, stockStatus, roundQty, unitCostOf } from '../purchaseReceipts.js'

const line = (over = {}) => ({ itemName: 'Gloves', unitCode: 'BOX', quantity: 10, receivedQty: 0, ...over })

test('pending is ordered less received, never below 0', () => {
  assert.equal(pendingOf(line()), 10)
  assert.equal(pendingOf(line({ receivedQty: 4 })), 6)
  assert.equal(pendingOf(line({ receivedQty: 12 })), 0)
  assert.equal(pendingOf({}), 0)
})

test('everything that arrived and passed is accepted, up to what is still due', () => {
  assert.deepEqual(checkReceiptLine({ orderLine: line(), receivedQty: 10 }), { accepted: 10 })
  assert.deepEqual(checkReceiptLine({ orderLine: line({ receivedQty: 4 }), receivedQty: 6 }), { accepted: 6 })
  // more arrived than due, the extra turned back: what is accepted still fits
  assert.deepEqual(checkReceiptLine({ orderLine: line(), receivedQty: 12, rejectedQty: 2, rejectReason: 'Excess' }), { accepted: 10 })
  // all of it rejected: nothing accepted, and that is allowed
  assert.deepEqual(checkReceiptLine({ orderLine: line(), receivedQty: 3, rejectedQty: 3, rejectReason: 'Damaged' }), { accepted: 0 })
})

test('accepting more than is due is refused, naming what is due', () => {
  const r = checkReceiptLine({ orderLine: line({ receivedQty: 8 }), receivedQty: 3 })
  assert.match(r.error, /only 2 BOX are still due/)
  assert.ok(checkReceiptLine({ orderLine: line({ quantity: 10, receivedQty: 10 }), receivedQty: 1 }).error)
})

test('a line needs something received; rejected cannot exceed received', () => {
  assert.match(checkReceiptLine({ orderLine: line(), receivedQty: 0 }).error, /how many arrived/)
  assert.match(checkReceiptLine({ orderLine: line(), receivedQty: NaN }).error, /how many arrived/)
  assert.match(checkReceiptLine({ orderLine: line(), receivedQty: 2, rejectedQty: 3, rejectReason: 'Damaged' }).error, /cannot be more than received/)
  assert.match(checkReceiptLine({ orderLine: line(), receivedQty: 2, rejectedQty: -1 }).error, /cannot be more than received/)
})

test('a rejection needs a reason of at least three letters', () => {
  assert.match(checkReceiptLine({ orderLine: line(), receivedQty: 5, rejectedQty: 1 }).error, /say why/)
  assert.match(checkReceiptLine({ orderLine: line(), receivedQty: 5, rejectedQty: 1, rejectReason: '  ' }).error, /say why/)
  assert.match(checkReceiptLine({ orderLine: line(), receivedQty: 5, rejectedQty: 1, rejectReason: 'ab' }).error, /say why/)
  assert.deepEqual(checkReceiptLine({ orderLine: line(), receivedQty: 5, rejectedQty: 1, rejectReason: 'Torn' }), { accepted: 4 })
})

test('a whole-number unit takes whole numbers only', () => {
  assert.match(checkReceiptLine({ orderLine: line(), receivedQty: 2.5, wholeOnly: true }).error, /whole BOX/)
  assert.match(checkReceiptLine({ orderLine: line(), receivedQty: 3, rejectedQty: 0.5, rejectReason: 'Leak', wholeOnly: true }).error, /whole BOX/)
  assert.deepEqual(checkReceiptLine({ orderLine: line({ unitCode: 'L' }), receivedQty: 2.5 }), { accepted: 2.5 })
})

test('decimals do not leave floating-point dust in what is due', () => {
  // 0.1 + 0.2 received of 0.3 ordered is all of it
  assert.deepEqual(checkReceiptLine({ orderLine: line({ quantity: 0.3, receivedQty: 0.1 }), receivedQty: 0.2 }), { accepted: 0.2 })
})

test('order status follows what its lines have received', () => {
  const sent = { status: 'sent', sentAt: new Date() }
  const approved = { status: 'approved', sentAt: null }
  assert.equal(statusAfterReceipts(sent, [{ quantity: 10, receivedQty: 10 }, { quantity: 5, receivedQty: 5 }]), 'received')
  assert.equal(statusAfterReceipts(sent, [{ quantity: 10, receivedQty: 10 }, { quantity: 5, receivedQty: 0 }]), 'partly_received')
  assert.equal(statusAfterReceipts(approved, [{ quantity: 10, receivedQty: 3 }]), 'partly_received')
  // every receipt undone: back to where it was before anything came
  assert.equal(statusAfterReceipts({ status: 'partly_received', sentAt: new Date() }, [{ quantity: 10, receivedQty: 0 }]), 'sent')
  assert.equal(statusAfterReceipts({ status: 'received', sentAt: null }, [{ quantity: 10, receivedQty: 0 }]), 'approved')
  assert.equal(statusAfterReceipts({ status: 'received', sentAt: null }, [{ quantity: 10, receivedQty: 4 }]), 'partly_received')
})

test('a closed order stays closed when a receipt on it is undone', () => {
  const closed = { status: 'closed', sentAt: new Date() }
  assert.equal(statusAfterReceipts(closed, [{ quantity: 10, receivedQty: 4 }]), 'closed')
  assert.equal(statusAfterReceipts(closed, [{ quantity: 10, receivedQty: 0 }]), 'closed')
})

test('an expiry before today cannot be accepted; today and later can', () => {
  const today = new Date('2026-10-01T00:00:00+05:30')
  assert.equal(expiryProblem(null, today), null)
  assert.equal(expiryProblem(new Date('2026-09-30'), today), 'already expired')
  assert.equal(expiryProblem(new Date('2026-10-01'), today), null)
  assert.equal(expiryProblem(new Date('2028-03-31'), today), null)
})

test('stock state: none, out, low at or under reorder level, ok', () => {
  assert.equal(stockStatus({ onHand: 0, reorderLevel: null, everReceived: false }), 'none')
  assert.equal(stockStatus({ onHand: 0, reorderLevel: 0, everReceived: false }), 'none')
  assert.equal(stockStatus({ onHand: 0, reorderLevel: 10, everReceived: false }), 'out')
  assert.equal(stockStatus({ onHand: 0, reorderLevel: null, everReceived: true }), 'out')
  assert.equal(stockStatus({ onHand: 10, reorderLevel: 10, everReceived: true }), 'low')
  assert.equal(stockStatus({ onHand: 11, reorderLevel: 10, everReceived: true }), 'ok')
  assert.equal(stockStatus({ onHand: 5, reorderLevel: null, everReceived: true }), 'ok')
})

test('quantities round to three decimals', () => {
  assert.equal(roundQty(0.1 + 0.2), 0.3)
  assert.equal(roundQty(2.12549), 2.125)
  assert.equal(roundQty(null), 0)
  assert.equal(roundQty('abc'), 0)
})

test('unit cost is the price after discount, per stock unit', () => {
  // ₹500 a box less 10% = ₹450 the box, 100 pieces in it → ₹4.5 a piece
  assert.equal(unitCostOf({ quantity: 5, rate: 500, taxable: 2250, unitFactor: 100 }), 4.5)
  // bought in the stock unit
  assert.equal(unitCostOf({ quantity: 3, rate: 33.33, taxable: 99.99, unitFactor: 1 }), 33.33)
  // a third of a rupee keeps enough places that 300 of them come back to ₹100
  const c = unitCostOf({ quantity: 1, rate: 100, taxable: 100, unitFactor: 300 })
  assert.equal(Math.round(c * 300 * 100) / 100, 100)
})
