// financialYear — the year in every bill, receipt and order number. Read on the
// hospital's calendar (IST), whatever clock the server runs on (UTC on Render).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { financialYear } from '../money.js'

test('1 April in India is the new year, even while it is still 31 March in UTC', () => {
  // 00:30 IST on 1 April 2027 = 19:00 UTC on 31 March. Numbered 2026-27 before the fix.
  assert.equal(financialYear(new Date('2027-03-31T19:00:00Z')), '2027-28')
  // 05:29 IST, the last minute the UTC calendar still says 31 March.
  assert.equal(financialYear(new Date('2027-03-31T23:59:00Z')), '2027-28')
})

test('31 March in India is still the old year', () => {
  assert.equal(financialYear(new Date('2027-03-31T18:29:00Z')), '2026-27') // 23:59 IST
})

test('the rest of the year', () => {
  assert.equal(financialYear(new Date('2026-10-02T06:00:00Z')), '2026-27')
  assert.equal(financialYear(new Date('2027-01-15T06:00:00Z')), '2026-27')
  assert.equal(financialYear(new Date('2099-04-01T06:00:00Z')), '2099-00')
})
