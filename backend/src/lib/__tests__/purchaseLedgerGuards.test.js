// Undoing a goods receipt or a vendor bill gives its quantities back to the
// order line. A count that would go below 0 used to be cut to 0 without a
// word, hiding a ledger that no longer matched its documents; it is now
// refused (the controllers answer 409, naming the document). These are the
// pure calculations behind that rule — and proof that legitimate decimal
// quantities never trip it. Pure functions, so no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { receivedAfterUndo } from '../purchaseReceipts.js'
import { billedAfter } from '../vendorBills.js'

test('undoing a receipt gives back what it accepted', () => {
  assert.equal(receivedAfterUndo(10, 4), 6)
  assert.equal(receivedAfterUndo(4, 4), 0)
  assert.equal(receivedAfterUndo(2.75, 0.75), 2)
})

test('a received count below what the receipt accepted is refused (null), not cut to 0', () => {
  assert.equal(receivedAfterUndo(20, 60), null)
  assert.equal(receivedAfterUndo(0, 1), null)
  assert.equal(receivedAfterUndo(undefined, 0.001), null)
})

test('decimal receipts undone one by one end at exactly 0, never refused for float dust', () => {
  // 0.1 + 0.2 received on two receipts is stored rounded, as 0.3
  let received = Math.round((0.1 + 0.2) * 1000) / 1000
  received = receivedAfterUndo(received, 0.1)
  assert.equal(received, 0.2)
  received = receivedAfterUndo(received, 0.2)
  assert.equal(received, 0)
  // === on purpose: a rounded −0 is still 0, and not refused
  assert.ok(receivedAfterUndo(0.3, 0.3) === 0)
  assert.ok(receivedAfterUndo(1.751, 1.751) === 0)
})

test('a bill is counted in, and given back, on its order line', () => {
  assert.equal(billedAfter(0, 6, 1), 6)
  assert.equal(billedAfter(6, 6, -1), 0)
  assert.equal(billedAfter(10, 4, -1), 6)
  assert.equal(billedAfter(undefined, 2.5, 1), 2.5)
})

test('giving back more than the line counts as billed is refused (null), not cut to 0', () => {
  assert.equal(billedAfter(2, 6, -1), null)
  assert.equal(billedAfter(0, 0.001, -1), null)
})

test('billed above received is not this check\'s business: counting in is never refused', () => {
  // Finance may approve a bill for more than arrived; only the floor is guarded.
  assert.equal(billedAfter(1e6, 5, 1), 1000005)
})

test('decimal bills given back one by one end at exactly 0', () => {
  let billed = billedAfter(billedAfter(0, 0.1, 1), 0.2, 1)
  assert.equal(billed, 0.3)
  billed = billedAfter(billed, 0.1, -1)
  assert.equal(billed, 0.2)
  billed = billedAfter(billed, 0.2, -1)
  assert.equal(billed, 0)
})
