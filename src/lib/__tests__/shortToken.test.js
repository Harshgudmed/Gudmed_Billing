import test from 'node:test'
import assert from 'node:assert/strict'
import { shortToken } from '../queueToken.js'

// The stored token is long because @@unique([organizationId, queueNumber]) holds
// for all time. What a patient reads across a hall has to be short. These tests
// pin the one rule that makes both true at once.

test('a counter token shows only the number a patient has to remember', () => {
  assert.equal(shortToken('OPD20260812-000004'), '4')
  assert.equal(shortToken('OPD20260812-000012'), '12')
  assert.equal(shortToken('OPD20260812-000548'), '548')
})

test('two rooms on the same day never show the same number', () => {
  // The counter is per hospital per day, not per room — so consecutive patients
  // land in different rooms with different numbers. Per-room numbering would
  // give both rooms a "1", and one announcement would stand two people up.
  const room19 = shortToken('OPD20260812-000012')
  const room20 = shortToken('OPD20260812-000013')
  assert.notEqual(room19, room20)
})

test('the same number on two different days is still two different stored tokens', () => {
  // Both display as "4". They are only ever shown on their own day's board, and
  // the DATABASE still holds them apart — which is the half that must not break.
  assert.equal(shortToken('OPD20260812-000004'), '4')
  assert.equal(shortToken('OPD20260813-000004'), '4')
  assert.notEqual('OPD20260812-000004', 'OPD20260813-000004')
})

test('emergency and OPD are separate series, so both can be at 4 — and are told apart by their board', () => {
  assert.equal(shortToken('OPD20260812-000004'), '4')
  assert.equal(shortToken('EME20260812-000004'), '4')
})

test('a legacy random token is left alone rather than truncated into a collision', () => {
  // 197,598 rows predate the counter and carry a random six-digit number. There
  // is no small form of 759407; inventing one — the last two digits, say — would
  // silently make it equal to some other patient's.
  assert.equal(shortToken('OPD20260716-759407'), 'OPD20260716-759407')
})

test('anything unexpected passes through instead of becoming blank', () => {
  assert.equal(shortToken(''), '')
  assert.equal(shortToken(null), '')
  assert.equal(shortToken(undefined), '')
  assert.equal(shortToken('WALKIN-7'), 'WALKIN-7')
  assert.equal(shortToken('  OPD20260812-000009  '), '9')
})

test('a zero counter is not shown as "0" — it means the token was never minted', () => {
  assert.equal(shortToken('OPD20260812-000000'), 'OPD20260812-000000')
})
