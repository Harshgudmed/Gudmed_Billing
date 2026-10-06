// Who may do what in Billing — the separation of duties in lib/billingAccess.js.
// Pure: a fake req carrying only the signed-in role.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { billingAllows, refuseBilling, CREATE_NEEDS, UPDATE_NEEDS } from '../billingAccess.js'

const as = (role) => ({ user: role ? { id: 'u1', role } : undefined })
const can = (role) => Object.fromEntries(['raise', 'adjust', 'approve', 'catalog'].map((w) => [w, billingAllows(as(role), w)]))

test('the counters raise bills and adjust them, but neither approve refunds nor set prices', () => {
  for (const role of ['receptionist', 'billing', 'billing_clerk']) {
    assert.deepEqual(can(role), { raise: true, adjust: true, approve: false, catalog: false }, role)
  }
})

test('departments that bill their own work may raise, but not refund or cancel', () => {
  for (const role of ['pharmacist', 'lab_technician', 'radiology_technician']) {
    assert.deepEqual(can(role), { raise: true, adjust: false, approve: false, catalog: false }, role)
  }
})

test('the Finance Controller approves refunds and sets prices, and takes no money', () => {
  assert.deepEqual(can('finance_controller'), { raise: false, adjust: false, approve: true, catalog: true })
})

test('an administrator may do everything; with login off nothing is refused', () => {
  for (const role of ['admin', 'super_admin', null]) {
    assert.deepEqual(can(role), { raise: true, adjust: true, approve: true, catalog: true }, String(role))
  }
})

test('clinical and purchase roles may not write to billing at all', () => {
  for (const role of ['doctor', 'nurse', 'purchase_officer', 'store_keeper', 'patient']) {
    assert.deepEqual(can(role), { raise: false, adjust: false, approve: false, catalog: false }, role)
  }
})

test('every billing write maps to a rule', () => {
  assert.deepEqual(CREATE_NEEDS, { service: 'catalog', invoice: 'raise', payment: 'raise', invoiceItem: 'raise', refund: 'adjust', approve_refund: 'approve' })
  assert.deepEqual(UPDATE_NEEDS, { service: 'catalog', invoice: 'adjust' })
})

test('a refused write answers 403 with the reason; an allowed one goes on', () => {
  const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  assert.ok(refuseBilling(as('finance_controller'), res, CREATE_NEEDS, 'invoice'))
  assert.equal(res.code, 403)
  assert.match(res.body.error, /billing counter raises invoices/)
  const ok = { status() { throw new Error('must not answer') } }
  assert.equal(refuseBilling(as('receptionist'), ok, CREATE_NEEDS, 'invoice'), null)
  // a resource that is not a write we know is left to the controller
  assert.equal(refuseBilling(as('doctor'), ok, CREATE_NEEDS, 'nonsense'), null)
})
