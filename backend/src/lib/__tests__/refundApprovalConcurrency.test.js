// Regression test for the refund double-approval race (BUG #1).
//
// Two refund requests left pending on ONE invoice, approved CONCURRENTLY, used to
// both succeed: the archived-once guard read `oldInvoice.isArchived` from a snapshot
// taken before it was set, so both approvals passed it and each created a revised
// invoice from the same superseded totals — refunding the money twice with no book
// entry for the second. The fix folds the check and the set into one conditional
// updateMany (compare-and-swap) so exactly one approval wins.
//
// This is an integration test: it drives the real billingController.create against
// the dev database. It is skipped automatically when no DATABASE_URL is available.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// backend/.env holds DATABASE_URL; nothing loads it for a bare `node --test` run.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '..', '..', '..')
try {
  for (const line of fs.readFileSync(path.join(backendRoot, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* no .env — test will skip below */ }

const HAS_DB = !!process.env.DATABASE_URL
const ORG = process.env.ORGANIZATION_ID || 'org-demo'

// Imported lazily inside the guarded block so a machine with no DB can still load
// the file without constructing a Prisma client that immediately fails.
let db, create
const require = createRequire(path.join(backendRoot, 'package.json'))

// Track everything we insert so the DB is left exactly as we found it.
const trash = { invoiceIds: [], paymentIds: [] }

/** Run billingController.create with a fake req/res and resolve {status, body}. */
function callCreate(body) {
  return new Promise((resolve, reject) => {
    const req = { body, organizationId: ORG, user: null }
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(payload) { resolve({ status: this.statusCode, body: payload }) },
    }
    Promise.resolve(create(req, res)).catch(reject)
  })
}

before(async () => {
  if (!HAS_DB) return
  const { PrismaClient } = require('@prisma/client')
  db = new PrismaClient()
  ;({ create } = await import('../../controllers/billingController.js'))
})

after(async () => {
  if (!HAS_DB || !db) return
  // Delete children before parents; revised invoices (parentInvoiceId set) first.
  await db.payment.deleteMany({ where: { invoiceId: { in: trash.invoiceIds } } }).catch(() => {})
  await db.auditLog.deleteMany({ where: { entityId: { in: [...trash.invoiceIds, ...trash.paymentIds] } } }).catch(() => {})
  await db.invoice.deleteMany({ where: { id: { in: trash.invoiceIds }, parentInvoiceId: { not: null } } }).catch(() => {})
  await db.invoice.deleteMany({ where: { id: { in: trash.invoiceIds } } }).catch(() => {})
  await db.$disconnect()
})

test('two concurrent refund approvals: exactly one wins, exactly one revised invoice', { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  assert.ok(patient, `needs at least one patient in ${ORG}`)

  // Invoice of 1000, paid in full.
  const inv = await callCreate({ resource: 'invoice', patientId: patient.id,
    items: [{ serviceName: 'Consultation', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }] })
  assert.equal(inv.status, 201, JSON.stringify(inv.body))
  const invoiceId = inv.body.data.id
  trash.invoiceIds.push(invoiceId)

  const pay = await callCreate({ resource: 'payment', invoiceId, amount: 1000, paymentMethod: 'cash' })
  assert.equal(pay.status, 201, JSON.stringify(pay.body))

  // Two independent 300 refund requests, both left PENDING_APPROVAL.
  const r1 = await callCreate({ resource: 'refund', invoiceId, amount: 300, refundReason: 'regression A', paymentMethod: 'cash' })
  const r2 = await callCreate({ resource: 'refund', invoiceId, amount: 300, refundReason: 'regression B', paymentMethod: 'cash' })
  assert.equal(r1.status, 201, JSON.stringify(r1.body))
  assert.equal(r2.status, 201, JSON.stringify(r2.body))
  trash.paymentIds.push(r1.body.data.id, r2.body.data.id)

  // Approve BOTH at once — the race.
  const [a1, a2] = await Promise.all([
    callCreate({ resource: 'approve_refund', paymentId: r1.body.data.id, action: 'APPROVE' }),
    callCreate({ resource: 'approve_refund', paymentId: r2.body.data.id, action: 'APPROVE' }),
  ])

  // Record whatever revised invoices exist so cleanup removes them either way.
  const revised = await db.invoice.findMany({ where: { parentInvoiceId: invoiceId }, select: { id: true } })
  for (const rv of revised) trash.invoiceIds.push(rv.id)

  const statuses = [a1.status, a2.status].sort((x, y) => x - y)
  assert.deepEqual(statuses, [200, 409], `expected one 200 and one 409, got ${statuses} — bodies: ${JSON.stringify([a1.body, a2.body])}`)
  assert.equal(revised.length, 1, `expected exactly ONE revised invoice, found ${revised.length}`)

  // The money that actually left the books must be a single 300 refund, not 600.
  const approvedRefunds = await db.payment.aggregate({
    where: { invoiceId, isRefund: true, status: 'APPROVED' }, _sum: { amount: true },
  })
  assert.equal(approvedRefunds._sum.amount, 300, 'only the winning refund should be APPROVED')
})
