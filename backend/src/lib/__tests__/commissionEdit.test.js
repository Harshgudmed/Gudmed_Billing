// PATCH /doctor-accountability?resource=commission — editing a commission.
//
// The Commissions tab had an Edit button, a dialog and a save that called this,
// and the handler only knew 'settle': every save was a 400 "Unknown resource".
// These tests pin down what the edit may and may not do, because the field it
// changes is somebody's pay.
//
// Runs against the real database with a disposable doctor and commissions in
// the demo org, all removed afterwards. Calls the controller directly, the same
// way doctorPayload.test.js does.
//
// Run: node --test --test-force-exit src/lib/__tests__/commissionEdit.test.js
import { test, before, after, describe } from 'node:test'
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
} catch { /* no .env — skips below */ }

const HAS_DB = !!process.env.DATABASE_URL
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const skip = !HAS_DB && 'DATABASE_URL not set'
const require = createRequire(path.join(backendRoot, 'package.json'))
const stamp = `COMMEDIT-${Date.now()}`

let db, handlePatch, doctor, otherOrg

// A logged-in admin: scopedDoctorId() returns null for any non-doctor role.
const ADMIN = { userId: 'admin-test', role: 'admin', organizationId: ORG }

function patch(query, body, user = ADMIN) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(payload) { resolve({ status: this.statusCode, body: payload }) },
    }
    const req = { query, body, user, organizationId: user?.organizationId || ORG }
    Promise.resolve(handlePatch(req, res, reject)).catch(reject)
  })
}

async function commission(over = {}) {
  return db.doctorCommission.create({
    data: {
      organizationId: ORG,
      doctorId: doctor.id,
      invoiceAmount: 1000,
      commissionRate: 10,
      commissionType: 'percentage',
      commissionAmount: 100,
      status: 'pending',
      ...over,
    },
  })
}

before(async () => {
  if (!HAS_DB) return
  const { PrismaClient } = require('@prisma/client')
  db = new PrismaClient()
  handlePatch = (await import('../../controllers/doctorAccountabilityController.js')).handlePatch
  doctor = await db.user.create({
    data: { organizationId: ORG, email: `${stamp}@commedit.local`.toLowerCase(), fullName: 'Dr Commission Test', role: 'doctor' },
  })
  otherOrg = await db.organization.create({ data: { name: `${stamp} other`, slug: `${stamp}-other`.toLowerCase() } })
})

after(async () => {
  if (!db) return
  await db.doctorCommission.deleteMany({ where: { doctorId: doctor?.id } }).catch(() => {})
  await db.user.deleteMany({ where: { id: doctor?.id } }).catch(() => {})
  await db.organization.deleteMany({ where: { id: otherOrg?.id } }).catch(() => {})
  await db.$disconnect()
})

describe('editing a commission', () => {
  test('a pending commission is updated, and the amount is recomputed from its rate', { skip }, async () => {
    const c = await commission()
    const res = await patch({ resource: 'commission', id: c.id }, { invoiceAmount: 2500 })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const row = await db.doctorCommission.findUnique({ where: { id: c.id } })
    assert.equal(row.invoiceAmount, 2500)
    assert.equal(row.commissionAmount, 250, '10% of 2500')
  })

  // The dialog computes an amount in the browser and sends it. A payout figure
  // taken from the client is a payout anyone with devtools can set.
  test('a commissionAmount sent by the browser is ignored', { skip }, async () => {
    const c = await commission()
    await patch({ resource: 'commission', id: c.id }, { invoiceAmount: 2000, commissionAmount: 99999 })
    const row = await db.doctorCommission.findUnique({ where: { id: c.id } })
    assert.equal(row.commissionAmount, 200, 'server-computed 10% of 2000, not the 99999 sent')
  })

  test('a fixed-type commission keeps its fixed amount whatever the invoice', { skip }, async () => {
    const c = await commission({ commissionType: 'fixed', commissionRate: 300, commissionAmount: 300 })
    await patch({ resource: 'commission', id: c.id }, { invoiceAmount: 9000 })
    const row = await db.doctorCommission.findUnique({ where: { id: c.id } })
    assert.equal(row.invoiceAmount, 9000)
    assert.equal(row.commissionAmount, 300)
  })

  test('money is rounded to paise', { skip }, async () => {
    const c = await commission({ commissionRate: 7.5 })
    await patch({ resource: 'commission', id: c.id }, { invoiceAmount: 1234.567 })
    const row = await db.doctorCommission.findUnique({ where: { id: c.id } })
    assert.equal(row.invoiceAmount, 1234.57)
    assert.equal(row.commissionAmount, 92.59, '7.5% of 1234.567 = 92.5925 → 92.59')
  })
})

describe('what the edit refuses', () => {
  // Settled means paid; rewriting the invoice under it would leave the payout
  // and the ledger disagreeing.
  test('a settled commission cannot be edited', { skip }, async () => {
    const c = await commission({ status: 'settled', settledAt: new Date() })
    const res = await patch({ resource: 'commission', id: c.id }, { invoiceAmount: 5000 })
    assert.equal(res.status, 409)
    const row = await db.doctorCommission.findUnique({ where: { id: c.id } })
    assert.equal(row.invoiceAmount, 1000, 'unchanged')
  })

  test('a doctor cannot edit a commission — not even their own', { skip }, async () => {
    const c = await commission()
    const asDoctor = { userId: doctor.id, role: 'doctor', organizationId: ORG }
    const res = await patch({ resource: 'commission', id: c.id }, { invoiceAmount: 50000 }, asDoctor)
    assert.equal(res.status, 403)
    const row = await db.doctorCommission.findUnique({ where: { id: c.id } })
    assert.equal(row.invoiceAmount, 1000, 'unchanged')
  })

  test('another hospital\'s commission is not found', { skip }, async () => {
    const c = await commission()
    const foreignAdmin = { userId: 'admin-other', role: 'admin', organizationId: otherOrg.id }
    const res = await patch({ resource: 'commission', id: c.id }, { invoiceAmount: 5000 }, foreignAdmin)
    assert.equal(res.status, 404)
  })

  for (const [label, value] of [['zero', 0], ['negative', -100], ['text', 'abc'], ['Infinity', Infinity], ['missing', undefined]]) {
    test(`an invoice amount that is ${label} is refused`, { skip }, async () => {
      const c = await commission()
      const res = await patch({ resource: 'commission', id: c.id }, { invoiceAmount: value })
      assert.equal(res.status, 400)
    })
  }

  test('an invoice from another hospital cannot be attached', { skip }, async () => {
    const c = await commission()
    const res = await patch({ resource: 'commission', id: c.id }, { invoiceAmount: 1500, invoiceId: 'not-an-invoice-here' })
    assert.equal(res.status, 400)
    const row = await db.doctorCommission.findUnique({ where: { id: c.id } })
    assert.equal(row.invoiceId, null, 'nothing attached')
  })

  test('an unknown resource still answers 400', { skip }, async () => {
    const res = await patch({ resource: 'nope' }, {})
    assert.equal(res.status, 400)
  })
})
