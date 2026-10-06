// listResponse — the one list shape every table uses. Pure: a fake Prisma
// delegate holding `rows`, so no database is needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listResponse } from '../pagination.js'

const model = (n) => {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1 }))
  return {
    findMany: async ({ skip = 0, take } = {}) => rows.slice(skip, take == null ? undefined : skip + take),
    count: async () => rows.length,
  }
}
const req = (query = {}) => ({ query })

test('a whole list under its cap says how many it holds', async () => {
  const body = await listResponse(model(3), { req: req(), fullListTake: 5 })
  assert.equal(body.data.length, 3)
  assert.deepEqual(body.meta, { total: 3 })
})

test('a whole list over its cap gives the real total and says it is cut short', async () => {
  // It used to say total: 5 — a caller could not tell "all 5" from "the first 5 of 8".
  const body = await listResponse(model(8), { req: req(), fullListTake: 5 })
  assert.equal(body.data.length, 5)
  assert.deepEqual(body.meta, { total: 8, truncated: true })
})

test('a list exactly at its cap is not called cut short', async () => {
  const body = await listResponse(model(5), { req: req(), fullListTake: 5 })
  assert.deepEqual(body.meta, { total: 5 })
})

test('an uncapped list returns every row', async () => {
  const body = await listResponse(model(12), { req: req(), fullListTake: null })
  assert.equal(body.data.length, 12)
  assert.deepEqual(body.meta, { total: 12 })
})

test('a paged list returns one page and the pagination block', async () => {
  const body = await listResponse(model(23), { req: req({ page: '3', limit: '10' }) })
  assert.deepEqual(body.data.map((r) => r.id), [21, 22, 23])
  assert.equal(body.pagination.totalRecords, 23)
  assert.equal(body.pagination.totalPages, 3)
  assert.equal(body.meta.total, 23)
})
