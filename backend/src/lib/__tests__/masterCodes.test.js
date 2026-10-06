// Master codes (VEN-0001, ITM-0001): no year, never restart, unique under
// concurrency, and never handed out twice when rows exist that the counter
// does not know about. Real database — the atomicity lives in Postgres.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { nextMasterCode } from '../counters.js'

let org

before(async () => {
  org = await db.organization.create({ data: { name: 'Test Org — masterCodes.test.js', slug: `test-mastercodes-${Date.now()}` } })
})

after(async () => {
  await db.organization.delete({ where: { id: org.id } })
})

const newVendor = (name) => db.$transaction(async (tx) => {
  const code = await nextMasterCode(tx, org.id, 'VENDOR', 'VEN')
  return tx.vendor.create({ data: { organizationId: org.id, name, code } })
})

test('the first vendor of a hospital is VEN-0001 — no financial year in a master code', async () => {
  const v = await newVendor('First')
  assert.equal(v.code, 'VEN-0001')
})

test('ten vendors added at the same moment get ten different, consecutive codes', async () => {
  const made = await Promise.all(Array.from({ length: 10 }, (_, i) => newVendor(`Parallel ${i}`)))
  const codes = made.map((v) => v.code).sort()
  assert.equal(new Set(codes).size, 10)
  assert.deepEqual(codes, Array.from({ length: 10 }, (_, i) => `VEN-${String(i + 2).padStart(4, '0')}`))
})

test('a row the counter never saw (imported data) is jumped over, not collided with', async () => {
  await db.vendor.create({ data: { organizationId: org.id, name: 'Imported', code: 'VEN-0500' } })
  const v = await newVendor('After import')
  assert.equal(v.code, 'VEN-0501')
})
