// Billing → Insurance claims list (GET /insurance?resource=claims).
//
// The tiles on that screen used to be counted from the rows the browser held,
// and "Approved / Settled" opened only the approved ones, so a tile and the list
// disagreed. The server now returns one page of claims plus per-status counts
// for the same search; every tile is a sum of those counts over the statuses it
// filters by. These tests pin: each tile's count = the rows its filter returns,
// across more than one page; the search narrows the counts too; a bad status is
// refused; and another hospital's claims are never counted or listed.
//
// Real database, two disposable organizations, torn down in after().
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { getAll } from '../../controllers/insuranceController.js'

let ours, theirs

function call(organizationId, query) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(body) { resolve({ status: this.statusCode, body }) },
    }
    const next = (err) => resolve({ status: 500, body: { error: err?.message } })
    Promise.resolve(getAll({ query, body: {}, params: {}, organizationId, user: null }, res, next)).catch(reject)
  })
}

async function seedHospital(label, plan) {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
  const org = await db.organization.create({ data: { name: `Test Org — claims list (${label})`, slug: `test-claims-${label}-${stamp}` } })
  const patient = await db.patient.create({ data: { organizationId: org.id, mrn: `TCL-${label}-${stamp}`, firstName: label === 'ours' ? 'Asha' : 'Other', lastName: 'Patil', gender: 'female', dateOfBirth: new Date('1990-01-01'), phonePrimary: '9000000009' } })
  const star = await db.insuranceCase.create({ data: { organizationId: org.id, patientId: patient.id, insurerName: 'Star Health', policyNumber: 'P-STAR', coverageLimit: 1e7 } })
  const hdfc = await db.insuranceCase.create({ data: { organizationId: org.id, patientId: patient.id, insurerName: 'HDFC Ergo', policyNumber: 'P-HDFC', coverageLimit: 1e7 } })
  let n = 0
  for (const [status, count] of plan) {
    for (let i = 0; i < count; i++) {
      n++
      await db.insuranceClaim.create({ data: { organizationId: org.id, caseId: n % 2 ? star.id : hdfc.id, claimNumber: `CLM${String(n).padStart(4, '0')}`, claimAmount: 100 + n, status } })
    }
  }
  return org
}

before(async () => {
  ours = await seedHospital('ours', [['pending', 4], ['submitted', 3], ['approved', 5], ['settled', 2], ['rejected', 3]])
  theirs = await seedHospital('theirs', [['approved', 6], ['rejected', 2]])
})

after(async () => {
  for (const org of [ours, theirs].filter(Boolean)) await db.organization.delete({ where: { id: org.id } }).catch(() => {})
})

// Rows a filter returns, read page by page as the screen pages them.
async function rowsFor(orgId, extra) {
  let page = 1, rows = 0, totalPages = 1
  do {
    const r = await call(orgId, { resource: 'claims', page: String(page), limit: '5', ...extra })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    rows += r.body.data.length
    totalPages = r.body.pagination.totalPages
    page++
  } while (page <= totalPages)
  return rows
}

const TILES = { all: undefined, 'approved,settled': 'approved,settled', 'pending,submitted': 'pending,submitted', rejected: 'rejected' }
const tileValue = (summary, key) => (key === 'all' ? summary.total : key.split(',').reduce((s, k) => s + (summary.byStatus[k] || 0), 0))

test('every tile equals the rows its filter returns, across several pages', async () => {
  const first = await call(ours.id, { resource: 'claims', page: '1', limit: '5' })
  assert.equal(first.body.data.length, 5, 'one page, not the whole table')
  assert.deepEqual(first.body.summary, { total: 17, byStatus: { pending: 4, submitted: 3, approved: 5, settled: 2, rejected: 3 } })
  for (const [key, status] of Object.entries(TILES)) {
    const rows = await rowsFor(ours.id, status ? { status } : {})
    assert.equal(tileValue(first.body.summary, key), rows, `tile ${key}`)
  }
})

test('a search narrows the tiles and the rows alike', async () => {
  const first = await call(ours.id, { resource: 'claims', page: '1', limit: '5', search: 'Star Health' })
  assert.equal(first.body.summary.total, 9)
  for (const [key, status] of Object.entries(TILES)) {
    const rows = await rowsFor(ours.id, { search: 'Star Health', ...(status ? { status } : {}) })
    assert.equal(tileValue(first.body.summary, key), rows, `tile ${key} with search`)
  }
  const byNumber = await call(ours.id, { resource: 'claims', page: '1', limit: '5', search: 'CLM0003' })
  assert.deepEqual(byNumber.body.data.map((c) => c.claimNumber), ['CLM0003'])
})

test('an unknown status is refused, not ignored', async () => {
  const r = await call(ours.id, { resource: 'claims', page: '1', limit: '5', status: 'approved,bogus' })
  assert.equal(r.status, 400)
})

test("another hospital's claims are never listed or counted", async () => {
  const r = await call(ours.id, { resource: 'claims', page: '1', limit: '100' })
  assert.equal(r.body.summary.total, 17)
  assert.ok(r.body.data.every((c) => c.organizationId === ours.id))
  const searchedForTheirs = await call(ours.id, { resource: 'claims', page: '1', limit: '100', search: 'Other' })
  assert.equal(searchedForTheirs.body.summary.total, 0)
  const theirsList = await call(theirs.id, { resource: 'claims', page: '1', limit: '100' })
  assert.deepEqual(theirsList.body.summary, { total: 8, byStatus: { approved: 6, rejected: 2 } })
})

test('without ?resource=claims the Insurance / TPA screen still gets its cases with claims nested', async () => {
  const r = await call(ours.id, {})
  assert.equal(r.status, 200)
  assert.equal(r.body.data.length, 2)
  assert.equal(r.body.data.reduce((s, c) => s + c.claims.length, 0), 17)
  assert.equal(r.body.stats.claimsPending, 7)
})
