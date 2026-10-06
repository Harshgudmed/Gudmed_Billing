// Approval rules: which levels a document needs, which rule sets are valid,
// and who may act. Pure functions, so no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { levelsFor, rulesError, currentStep, actError } from '../approvals.js'

const RULES = [
  { level: 2, approverRole: 'finance_controller', minAmount: 25000 },
  { level: 1, approverRole: 'admin', minAmount: 0 },
]

test('a document needs every level its amount reaches, lowest first', () => {
  assert.deepEqual(levelsFor(RULES, 10000).map((r) => r.level), [1])
  assert.deepEqual(levelsFor(RULES, 25000).map((r) => r.level), [1, 2]) // the threshold itself counts
  assert.deepEqual(levelsFor(RULES, 90000).map((r) => r.level), [1, 2])
})

test('an amount under the first level needs no approval at all', () => {
  assert.deepEqual(levelsFor([{ level: 1, approverRole: 'admin', minAmount: 2000 }], 1500), [])
})

test('rules must run 1, 2, 3 without gaps and never start lower at a higher level', () => {
  assert.equal(rulesError([{ level: 1, approverRole: 'admin', minAmount: 0 }]), null)
  assert.equal(rulesError(RULES), null)
  // No rows would read back as the default (admin approves all), not "nobody".
  assert.match(rulesError([]), /at least one level/)
  assert.match(rulesError([{ level: 2, approverRole: 'admin', minAmount: 0 }]), /without gaps/)
  assert.match(rulesError([
    { level: 1, approverRole: 'admin', minAmount: 10000 },
    { level: 2, approverRole: 'finance_controller', minAmount: 5000 },
  ]), /cannot start lower/)
  assert.match(rulesError([{ level: 1, approverRole: 'nurse', minAmount: 0 }]), /choose who approves/)
  assert.match(rulesError([{ level: 1, approverRole: 'admin', minAmount: -1 }]), /0 or more/)
  assert.match(rulesError([{ level: 1, approverRole: 'admin', minAmount: NaN }]), /0 or more/)
})

test('the current step is the lowest level still pending', () => {
  const steps = [
    { level: 2, status: 'pending' }, { level: 1, status: 'approved' }, { level: 3, status: 'pending' },
  ]
  assert.equal(currentStep(steps).level, 2)
  assert.equal(currentStep([{ level: 1, status: 'approved' }]), null)
})

test('only the level\'s role (or an administrator) may act, and never on their own request', () => {
  const step = { level: 2, approverRole: 'finance_controller' }
  assert.equal(actError(step, { id: 'f1', role: 'finance_controller' }, 'u1'), null)
  assert.match(actError(step, { id: 'p1', role: 'purchase_officer' }, 'u1'), /approved by the Finance Controller/)
  assert.match(actError(step, { id: 'u1', role: 'finance_controller' }, 'u1'), /raised yourself/)
  // An administrator may act on any level, even their own request — a small
  // hospital may have only one.
  assert.equal(actError(step, { id: 'a1', role: 'admin' }, 'a1'), null)
  assert.match(actError(null, { id: 'a1', role: 'admin' }, 'u1'), /Nothing is waiting/)
})

test('who approved one level may not approve the next, even when both are their role', () => {
  // Both levels given to the Finance Controller: one person used to approve both.
  const steps = [
    { level: 1, approverRole: 'finance_controller', status: 'approved', actedById: 'f1' },
    { level: 2, approverRole: 'finance_controller', status: 'pending' },
  ]
  assert.match(actError(steps[1], { id: 'f1', role: 'finance_controller' }, 'u1', steps), /approved level 1 — level 2 needs another person/)
  assert.equal(actError(steps[1], { id: 'f2', role: 'finance_controller' }, 'u1', steps), null)
  // The administrator stays the one who may act on anything — a small hospital may have only one.
  const adminSteps = steps.map((s) => (s.level === 1 ? { ...s, actedById: 'a1' } : s))
  assert.equal(actError(steps[1], { id: 'a1', role: 'admin' }, 'u1', adminSteps), null)
})
