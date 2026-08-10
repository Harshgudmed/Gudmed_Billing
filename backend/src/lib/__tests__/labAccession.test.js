// Regression test: the accession number that labels the tube.
//
// THE BUG THIS PREVENTS
// The Laboratory screen built the accession number itself:
//
//     `ACC-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000)}`
//
// Two separate faults came out of that one line.
//
// 1. Ten thousand possible values against a @@unique([organizationId,
//    accessionNumber]) column. By the birthday bound a repeat is more likely
//    than not after about 118 samples in a year, and the repeat surfaces as a
//    P2002 — a 500 in front of a technician holding a blood tube.
//
// 2. It was called TWICE per collection — once for the request body and once
//    for the row the screen displayed — so the two calls returned different
//    numbers. The number printed on the tube was never the number stored
//    against the order. That happened on every single collection, not
//    occasionally.
//
// The number is now minted server-side by nextSeriesNumber inside the same
// transaction as the status change, and the client's value is discarded.
//
// Integration test: drives the real laboratoryController.update against the dev
// database. Skipped automatically when no DATABASE_URL is available.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '..', '..', '..')
try {
  for (const line of fs.readFileSync(path.join(backendRoot, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* no .env — tests skip below */ }

const HAS_DB = !!process.env.DATABASE_URL
const ORG = process.env.ORGANIZATION_ID || 'org-demo'

let db, create, update
const require = createRequire(path.join(backendRoot, 'package.json'))
const trash = { orderIds: [] }

/** Run a laboratoryController handler with a fake req/res and resolve {status, body}. */
function callHandler(handler, body) {
  return new Promise((resolve, reject) => {
    const req = { body, organizationId: ORG, user: null }
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(payload) { resolve({ status: this.statusCode, body: payload }) },
    }
    Promise.resolve(handler(req, res, reject)).catch(reject)
  })
}

/** A fresh pending lab order for this org. */
async function newOrder() {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  const test = await db.labTest.findFirst({ where: { organizationId: ORG }, select: { id: true, testName: true } })
  const res = await callHandler(create, {
    resource: 'order',
    patientId: patient.id,
    tests: [{ testId: test.id, testName: test.testName, urgency: 'routine' }],
    clinicalIndication: 'accession regression test',
    priority: 'routine',
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  trash.orderIds.push(res.body.data.id)
  return res.body.data
}

before(async () => {
  if (!HAS_DB) return
  const { PrismaClient } = require('@prisma/client')
  db = new PrismaClient()
  ;({ create, update } = await import('../../controllers/laboratoryController.js'))
})

after(async () => {
  if (!HAS_DB || !db) return
  await db.labOrder.deleteMany({ where: { id: { in: trash.orderIds } } }).catch(() => {})
  await db.$disconnect()
})

const skip = !HAS_DB && 'DATABASE_URL not set'

test('collecting a sample stores the accession number the caller is told about', { skip }, async () => {
  const order = await newOrder()
  assert.equal(order.accessionNumber, null, 'a pending order has no accession yet')

  const res = await callHandler(update, {
    resource: 'order',
    id: order.id,
    status: 'sample_collected',
    sampleCollectedAt: new Date().toISOString(),
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))

  const returned = res.body.data.accessionNumber
  assert.ok(returned, 'the server must mint an accession number on collection')

  const stored = await db.labOrder.findUnique({
    where: { id: order.id },
    select: { accessionNumber: true },
  })
  // This is the fault that happened on EVERY collection: the tube was labelled
  // with one number and the record kept another.
  assert.equal(returned, stored.accessionNumber,
    'the number handed back to the screen must be the number saved on the order')
  assert.match(returned, /^ACC-\d{4}-\d{2}-\d+$/, `unexpected format: ${returned}`)
})

test('an accession number sent by the client is ignored', { skip }, async () => {
  const order = await newOrder()

  const res = await callHandler(update, {
    resource: 'order',
    id: order.id,
    status: 'sample_collected',
    accessionNumber: 'ACC-9999-0001',
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.notEqual(res.body.data.accessionNumber, 'ACC-9999-0001',
    'the client must not be able to choose the label on a tube')
})

test('a second status change does not relabel a tube already in the lab', { skip }, async () => {
  const order = await newOrder()

  const first = await callHandler(update, { resource: 'order', id: order.id, status: 'sample_collected' })
  const assigned = first.body.data.accessionNumber
  assert.ok(assigned)

  // The technician clicks Collect again, then the order moves on.
  await callHandler(update, { resource: 'order', id: order.id, status: 'sample_collected' })
  await callHandler(update, { resource: 'order', id: order.id, status: 'in_progress' })

  const stored = await db.labOrder.findUnique({
    where: { id: order.id }, select: { accessionNumber: true },
  })
  assert.equal(stored.accessionNumber, assigned,
    'the tube keeps the number it was labelled with')
})

test('ten samples collected at the same instant get ten different numbers', { skip }, async () => {
  // The real failure mode: ACC-YYYY-NNNN drew from 10,000 values, so a repeat
  // inside one year was more likely than not by ~118 samples — and a repeat is
  // a P2002 on a @@unique column, i.e. a 500 at the collection counter.
  const orders = []
  for (let i = 0; i < 10; i++) orders.push(await newOrder())

  const results = await Promise.all(
    orders.map(o => callHandler(update, { resource: 'order', id: o.id, status: 'sample_collected' }))
  )
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body))

  const numbers = results.map(r => r.body.data.accessionNumber)
  assert.equal(new Set(numbers).size, numbers.length,
    `duplicate accession numbers issued: ${numbers.join(', ')}`)
})
