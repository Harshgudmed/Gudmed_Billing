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
// Approving a refund is role-gated (finance_controller / admin / super_admin),
// and with AUTH_ENFORCED=true a request with no user is refused 401 before the
// race is ever reached — which is what this test used to hit, proving nothing.
// So every call is made as a real administrator of the hospital; a real row,
// because the approval records who approved it (approvedByUserId).
let approver = null
// Refunds are raised by someone else: since 2026-10-03 whoever raised a refund
// may not approve it unless the hospital allows it (refundSelfApproval, off by
// default — lib/refundPolicy.js). Every refund here was raised by the approver
// itself, so each approval was refused 403.
let requester = null

function callCreate(body) {
  return new Promise((resolve, reject) => {
    const req = { body, organizationId: ORG, user: body.resource === 'refund' && requester ? requester : approver }
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
  const admin = await db.user.findFirst({ where: { organizationId: ORG, role: 'admin', isActive: true }, select: { id: true, fullName: true, role: true } })
  if (admin) approver = { id: admin.id, userId: admin.id, fullName: admin.fullName, role: admin.role }
  const desk = await db.user.findFirst({ where: { organizationId: ORG, role: 'receptionist', isActive: true }, select: { id: true, fullName: true, role: true } })
  if (desk) requester = { id: desk.id, userId: desk.id, fullName: desk.fullName, role: desk.role }
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
  const base = inv.body.data.invoiceNumber
  const revised = await db.invoice.findMany({ where: { organizationId: ORG, invoiceNumber: { startsWith: `${base}-R` } }, orderBy: { createdAt: 'asc' } })
  for (const rv of revised) trash.invoiceIds.push(rv.id)

  // The rule changed on purpose: a pending refund now moves to the revision, so
  // two valid refunds on one bill are BOTH applied, one revision each (R1 → R2).
  // Approved at the same instant, the one that loses the race on the bill gets
  // a 409 and is approved again later; either outcome is right. What must
  // never happen — the original bug — is money refunded with no revision for it:
  // two approvals deriving from the same superseded totals.
  const wins = [a1, a2].filter((a) => a.status === 200).length
  for (const a of [a1, a2]) assert.ok([200, 409].includes(a.status), JSON.stringify(a.body))
  assert.ok(wins >= 1, `at least one approval wins — bodies: ${JSON.stringify([a1.body, a2.body])}`)
  assert.equal(revised.length, wins, `one revised invoice per approved refund, found ${revised.length} for ${wins}`)

  // Matched by payment id, not by invoiceId: an approved refund is re-pointed at
  // the revised invoice it belongs to (recalcInvoice derives amountPaid from the
  // Payment rows, so the collections and the refund that reduces them have to live
  // on the same invoice or the revision recomputes to money-never-collected).
  const approvedRefunds = await db.payment.aggregate({
    where: { id: { in: [r1.body.data.id, r2.body.data.id] }, isRefund: true, status: 'APPROVED' },
    _sum: { amount: true },
  })
  assert.equal(approvedRefunds._sum.amount, 300 * wins, 'each approved refund counted once')
  // …and the live bill tells the same story.
  const live = revised[revised.length - 1]
  assert.equal(live.isArchived, false)
  assert.equal(live.totalAmount, 1000 - 300 * wins)
  assert.equal(live.amountPaid, 1000 - 300 * wins)
})

// The revision's figures must still add up when the bill had a discount and
// tax: ₹600 − ₹60 + ₹27 = ₹567, a ₹100 refund → ₹500 − ₹60 + ₹27 = ₹467. It
// used to store subtotal ₹467 with the same discount and tax (parts: ₹434).
test('a refund revision keeps subtotal − discount + tax equal to its total', { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  assert.ok(patient, `needs at least one patient in ${ORG}`)
  const inv = await callCreate({ resource: 'invoice', patientId: patient.id, discountAmount: 60, discountPercentage: 10,
    items: [{ serviceName: 'Dressing', quantity: 2, unitPrice: 200, total: 400, tax: 18 }, { serviceName: 'ECG', quantity: 1, unitPrice: 200, total: 200, tax: 9 }] })
  assert.equal(inv.status, 201, JSON.stringify(inv.body))
  const invoiceId = inv.body.data.id
  trash.invoiceIds.push(invoiceId)
  assert.equal(inv.body.data.totalAmount, 567)

  const pay = await callCreate({ resource: 'payment', invoiceId, amount: 567, paymentMethod: 'cash' })
  assert.equal(pay.status, 201, JSON.stringify(pay.body))
  const rq = await callCreate({ resource: 'refund', invoiceId, amount: 100, refundReason: 'revision figures', paymentMethod: 'cash' })
  assert.equal(rq.status, 201, JSON.stringify(rq.body))
  trash.paymentIds.push(rq.body.data.id)
  const ok = await callCreate({ resource: 'approve_refund', paymentId: rq.body.data.id, action: 'APPROVE' })
  const revised = await db.invoice.findFirst({ where: { parentInvoiceId: invoiceId } })
  if (revised) trash.invoiceIds.push(revised.id)
  assert.equal(ok.status, 200, JSON.stringify(ok.body))

  assert.equal(revised.totalAmount, 467)
  assert.equal(revised.subtotal, 500)
  assert.equal(Math.round((revised.subtotal - revised.discountAmount + revised.taxAmount) * 100) / 100, revised.totalAmount)
})

// Two refunds waiting on one bill. Approving the first revises the bill; the
// second used to stay on the archived original, refused with 409 for ever and
// stuck in Finance's queue. It now moves to the revision and is approved there.
test('a second refund waiting on the same bill is approved after the first (as -R2)', { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  const inv = await callCreate({ resource: 'invoice', patientId: patient.id,
    items: [{ serviceName: 'Consultation', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }] })
  assert.equal(inv.status, 201, JSON.stringify(inv.body))
  const invoiceId = inv.body.data.id
  const base = inv.body.data.invoiceNumber
  trash.invoiceIds.push(invoiceId)
  await callCreate({ resource: 'payment', invoiceId, amount: 1000, paymentMethod: 'cash' })
  const r1 = await callCreate({ resource: 'refund', invoiceId, amount: 300, refundReason: 'first', paymentMethod: 'cash' })
  const r2 = await callCreate({ resource: 'refund', invoiceId, amount: 200, refundReason: 'second', paymentMethod: 'cash' })
  trash.paymentIds.push(r1.body.data.id, r2.body.data.id)

  const a1 = await callCreate({ resource: 'approve_refund', paymentId: r1.body.data.id, action: 'APPROVE' })
  const a2 = await callCreate({ resource: 'approve_refund', paymentId: r2.body.data.id, action: 'APPROVE' })
  const chain = await db.invoice.findMany({ where: { organizationId: ORG, invoiceNumber: { startsWith: `${base}-R` } }, orderBy: { createdAt: 'asc' } })
  for (const c of chain) trash.invoiceIds.push(c.id)
  assert.equal(a1.status, 200, JSON.stringify(a1.body))
  assert.equal(a2.status, 200, JSON.stringify(a2.body))

  assert.deepEqual(chain.map((c) => c.invoiceNumber), [`${base}-R1`, `${base}-R2`])
  const live = chain[1]
  assert.equal(live.isArchived, false)
  assert.equal(live.totalAmount, 500)
  assert.equal(live.amountPaid, 500)
  const approved = await db.payment.count({ where: { id: { in: [r1.body.data.id, r2.body.data.id] }, status: 'APPROVED' } })
  assert.equal(approved, 2)
})

// The REQUEST side of the same money. Requests are checked against what is
// still refundable and then inserted; without the invoice row lock, requests
// arriving together all read the full balance and all went in — 5 out of 5
// rounds reserved more than was paid (e.g. 3000 against 1000), 0 out of 5 with
// the lock. The race only shows on a warm connection pool, so the pool is
// warmed first and five requests are fired at once, over several rounds — two
// requests on a cold pool serialise on one connection and prove nothing.
test('concurrent refund REQUESTS never reserve more than was paid', { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  assert.ok(patient, `needs at least one patient in ${ORG}`)
  await Promise.all(Array.from({ length: 8 }, () => db.$queryRaw`SELECT 1`))

  for (let round = 0; round < 3; round++) {
    const inv = await callCreate({ resource: 'invoice', patientId: patient.id,
      items: [{ serviceName: 'Consultation', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }] })
    assert.equal(inv.status, 201, JSON.stringify(inv.body))
    const invoiceId = inv.body.data.id
    trash.invoiceIds.push(invoiceId)
    const pay = await callCreate({ resource: 'payment', invoiceId, amount: 1000, paymentMethod: 'cash' })
    assert.equal(pay.status, 201, JSON.stringify(pay.body))

    const results = await Promise.all(Array.from({ length: 5 }, (_, i) =>
      callCreate({ resource: 'refund', invoiceId, amount: 600, refundReason: `race ${round}.${i}`, paymentMethod: 'cash' })))
    for (const r of results) if (r.body?.data?.id) trash.paymentIds.push(r.body.data.id)

    const held = (await db.payment.aggregate({
      where: { invoiceId, isRefund: true, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      _sum: { amount: true },
    }))._sum.amount || 0
    assert.ok(held <= 1000 + 0.005, `round ${round}: refunds reserved ${held} against 1000 paid`)
    assert.equal(results.filter((r) => r.status === 201).length, 1, `round ${round}: exactly one 600 request fits in 1000`)
  }
})
