// What each Purchase role is shown, and how the tiles count: other people's
// drafts left out of lists and counts, the ₹ approval thresholds left out for
// the store, and the stock tiles counted with the Stock tab's own definitions.
// Pure functions, so no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { othersDraftsHidden, hideMoney, MONEY } from '../purchaseAccess.js'
import { stockStatus, stockSummary } from '../purchaseReceipts.js'

const as = (role, id = 'u-1') => ({ user: { role, id } })

test('an administrator sees every draft; anyone else only their own', () => {
  assert.deepEqual(othersDraftsHidden(true, 'u-1', 'createdById'), {})
  assert.deepEqual(othersDraftsHidden(false, 'u-1', 'createdById'), { OR: [{ status: { not: 'draft' } }, { createdById: 'u-1' }] })
  // requests name their author differently
  assert.deepEqual(othersDraftsHidden(false, 'u-1', 'requestedById'), { OR: [{ status: { not: 'draft' } }, { requestedById: 'u-1' }] })
})

test('someone with no id owns no draft — not every draft with no author', () => {
  // { createdById: undefined } would be no filter at all in Prisma
  assert.deepEqual(othersDraftsHidden(false, null, 'createdById'), { OR: [{ status: { not: 'draft' } }, { createdById: '__none__' }] })
  assert.deepEqual(othersDraftsHidden(false, undefined, 'createdById').OR[1], { createdById: '__none__' })
})

const rules = {
  documentType: 'PR', isDefault: false, roles: ['purchase_officer', 'finance_controller'],
  rules: [{ level: 1, approverRole: 'purchase_officer', minAmount: 0 }, { level: 2, approverRole: 'finance_controller', minAmount: 1000 }],
  approverNames: { purchase_officer: ['Priya'], finance_controller: ['Farah'] },
}

test('the store gets the approval levels without their ₹ thresholds', () => {
  const shown = hideMoney(as('store_keeper'), rules, MONEY.approvalRules)
  assert.deepEqual(shown.rules, [{ level: 1, approverRole: 'purchase_officer' }, { level: 2, approverRole: 'finance_controller' }])
  // the rest of the answer is as it was, and the original is not changed
  assert.deepEqual(shown.approverNames, rules.approverNames)
  assert.equal(shown.documentType, 'PR')
  assert.equal(rules.rules[1].minAmount, 1000)
})

test('everyone who sees money gets the thresholds', () => {
  for (const role of ['purchase_officer', 'finance_controller', 'admin']) {
    assert.deepEqual(hideMoney(as(role), rules, MONEY.approvalRules), rules, role)
  }
  // login switched off (the demo): everything is shown
  assert.deepEqual(hideMoney({}, rules, MONEY.approvalRules), rules)
})

// A stock row as the Stock tab builds it.
const row = (onHand, reorderLevel, { everReceived = onHand > 0, value = 0, expiringSoon = false } = {}) =>
  ({ onHand, value, expiringSoon, status: stockStatus({ onHand, reorderLevel, everReceived }) })

test('Low Stock counts some left at or under the reorder level — not what has run out', () => {
  const rows = [
    row(300, 300), // at the level: low
    row(4, 5), // under it: low
    row(0, 10, { everReceived: true }), // received, all gone: out
    row(0, 50), // never received but has a reorder level: out
    row(0, 0), // never received, no level: neither
    row(6, 5), // above: in stock
  ]
  const s = stockSummary(rows)
  assert.equal(s.low, 2)
  assert.equal(s.out, 2)
  assert.equal(s.inStock, 3)
  assert.equal(s.items, 6)
  // each tile is the count of the rows its click lists
  assert.equal(s.low, rows.filter((r) => r.status === 'low').length)
  assert.equal(s.out, rows.filter((r) => r.status === 'out').length)
})

test('Expiring Soon and the stock value come from the same rows', () => {
  const s = stockSummary([row(10, 0, { value: 0.1, expiringSoon: true }), row(5, 0, { value: 0.2 }), row(0, 0, { everReceived: true })])
  assert.equal(s.expiring, 1)
  assert.equal(s.value, 0.3) // to the paisa, not 0.30000000000000004
})

test('an empty store counts nothing', () => {
  assert.deepEqual(stockSummary([]), { items: 0, inStock: 0, low: 0, out: 0, expiring: 0, value: 0 })
})
