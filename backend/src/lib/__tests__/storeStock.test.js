// Store issue rules: which batches stock leaves from (oldest expiry first),
// what may be issued against an indent line, and the indent's status after.
// Pure functions, so no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isExpired, fifoOrder, issuableQty, expiredQty, planFifo, pendingOf,
  indentStatusAfter, checkIssueLine, issuedAfterUndo,
} from '../storeStock.js'

const today = new Date('2026-10-03T18:30:00Z') // start of 4 Oct 2026 in India
const b = (id, quantity, expiryDate, receivedAt = '2026-01-01') => ({ id, quantity, expiryDate: expiryDate ? new Date(expiryDate) : null, receivedAt: new Date(receivedAt) })

test('a batch expires after its expiry day, not on it', () => {
  assert.equal(isExpired(b('a', 1, '2026-10-03'), today), true)
  assert.equal(isExpired(b('a', 1, '2026-10-04'), today), false)
  assert.equal(isExpired(b('a', 1, null), today), false)
})

test('FIFO: soonest expiry first, then the oldest receipt, undated batches last', () => {
  const batches = [
    b('nodate-old', 5, null, '2025-01-01'),
    b('jan', 5, '2027-01-31', '2026-06-01'),
    b('dec', 5, '2026-12-31', '2026-07-01'),
    b('nodate-new', 5, null, '2026-02-01'),
    b('dec-older', 5, '2026-12-31', '2026-05-01'),
  ]
  assert.deepEqual([...batches].sort(fifoOrder).map((x) => x.id), ['dec-older', 'dec', 'jan', 'nodate-old', 'nodate-new'])
})

test('a plan takes whole batches in FIFO order and part of the last one', () => {
  const batches = [b('G1', 150, '2027-01-31'), b('G2', 80, '2026-12-31'), b('G3', 50, null)]
  const { takes, short } = planFifo(batches, 100, today)
  assert.equal(short, 0)
  assert.deepEqual(takes.map((t) => [t.batch.id, t.qty]), [['G2', 80], ['G1', 20]])
})

test('expired and empty batches are never taken, and a shortfall is reported', () => {
  const batches = [b('old', 30, '2026-01-31'), b('empty', 0, '2026-11-01'), b('ok', 10, '2027-01-01')]
  const { takes, short } = planFifo(batches, 25, today)
  assert.deepEqual(takes.map((t) => [t.batch.id, t.qty]), [['ok', 10]])
  assert.equal(short, 15)
  assert.equal(issuableQty(batches, today), 10)
  assert.equal(expiredQty(batches, today), 30)
})

test('decimal quantities stay exact (0.1 + 0.2 litres)', () => {
  const { takes, short } = planFifo([b('a', 0.1, '2027-01-01'), b('b', 0.2, '2027-02-01')], 0.3, today)
  assert.equal(short, 0)
  assert.deepEqual(takes.map((t) => t.qty), [0.1, 0.2])
})

test('the plan does not change the batches it was given', () => {
  const batches = [b('x', 5, '2027-02-01'), b('y', 5, '2027-01-01')]
  planFifo(batches, 7, today)
  assert.deepEqual(batches.map((x) => [x.id, x.quantity]), [['x', 5], ['y', 5]])
})

test('pending is asked less issued, never below 0', () => {
  assert.equal(pendingOf({ quantity: 10, issuedQty: 4 }), 6)
  assert.equal(pendingOf({ quantity: 10, issuedQty: 12 }), 0)
  assert.equal(pendingOf({}), 0)
})

test('indent status follows its lines; closed and cancelled stay', () => {
  const l = (quantity, issuedQty) => ({ quantity, issuedQty })
  assert.equal(indentStatusAfter('submitted', [l(10, 0), l(5, 0)]), 'submitted')
  assert.equal(indentStatusAfter('submitted', [l(10, 4), l(5, 0)]), 'partly_issued')
  assert.equal(indentStatusAfter('partly_issued', [l(10, 10), l(5, 5)]), 'issued')
  // an issue undone takes it back
  assert.equal(indentStatusAfter('issued', [l(10, 0), l(5, 0)]), 'submitted')
  assert.equal(indentStatusAfter('closed', [l(10, 0)]), 'closed')
  assert.equal(indentStatusAfter('cancelled', [l(10, 0)]), 'cancelled')
})

test('an issue line: within what is pending, within stock, whole units whole', () => {
  const line = { itemName: 'Gloves', unitCode: 'BOX', unitFactor: 100, quantity: 3, issuedQty: 1 }
  assert.deepEqual(checkIssueLine({ line, quantity: 2, available: 250, wholeOnly: true }), { stockQty: 200 })
  assert.match(checkIssueLine({ line, quantity: 3, available: 1000, wholeOnly: true }).error, /only 2 BOX is still to be issued/)
  assert.match(checkIssueLine({ line, quantity: 2, available: 150, wholeOnly: true }).error, /only 1\.5 BOX is in stock/)
  assert.match(checkIssueLine({ line, quantity: 1.5, available: 1000, wholeOnly: true }).error, /whole BOX/)
  assert.match(checkIssueLine({ line, quantity: 0, available: 1000, wholeOnly: true }).error, /enter how much/)
})

test('undoing an issue never takes a line below 0', () => {
  assert.equal(issuedAfterUndo(5, 2), 3)
  assert.equal(issuedAfterUndo(0.3, 0.1 + 0.2), 0)
  assert.equal(issuedAfterUndo(1, 2), null)
})
