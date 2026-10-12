// The platform owner's API is for the `platform_owner` role alone. authorize()
// always lets admin / super_admin through, so it cannot guard this API: a
// hospital's administrator would read the other hospitals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requirePlatformOwner } from '../../middleware/auth.js'

// Runs the guard on a fake request and says what happened: 'next' or the status it answered with.
function run(user) {
  let outcome = null
  const res = { status: (code) => ({ json: (body) => { outcome = { code, body } } }) }
  requirePlatformOwner({ user }, res, () => { outcome = 'next' })
  return outcome
}

test('the platform owner gets through', () => {
  assert.equal(run({ role: 'platform_owner' }), 'next')
})

test('no hospital role gets through, administrators included', () => {
  for (const role of ['admin', 'super_admin', 'doctor', 'receptionist', 'nurse', 'pharmacist', 'billing', 'finance_controller', 'purchase_officer', 'store_keeper', 'patient']) {
    const outcome = run({ role })
    assert.equal(outcome.code, 403, role)
    assert.equal(outcome.body.code, 'FORBIDDEN', role)
  }
})

test('nobody signed in, or a session without a role, is refused (the demo too)', () => {
  assert.equal(run(undefined).code, 403)
  assert.equal(run(null).code, 403)
  assert.equal(run({}).code, 403)
  assert.equal(run({ role: '' }).code, 403)
})

test('the role must match exactly: no near-misses', () => {
  for (const role of ['Platform_Owner', 'platform-owner', 'platform_owner ', 'PLATFORM_OWNER', 'platformowner']) {
    assert.equal(run({ role }).code, 403, JSON.stringify(role))
  }
})

test('the error says nothing about what the platform holds', () => {
  const { body } = run({ role: 'admin' })
  assert.equal(body.success, false)
  assert.equal(body.error, 'Platform owner access only')
})
