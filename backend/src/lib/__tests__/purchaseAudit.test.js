// A Purchase write and its audit row commit together or not at all.
//
// The audit row used to be written after the commit, outside the transaction,
// and a failure there was only warned about — the change stood with no record
// of who made it. Now each Purchase write puts its row in its own transaction
// (inpatient/audit.js with a `tx`), so an audit store that refuses the row
// rolls the write back, and a normal write leaves exactly one row.
//
// Drives the real controllers against the real database in a throwaway
// hospital. "Audit down" is a stub: the audit table's create, on the client and
// inside every transaction, rejects.
//
// Run: node --env-file=.env --test --test-force-exit src/lib/__tests__/purchaseAudit.test.js
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// `npm run test:unit` passes no env file; read backend/.env as billingAudit.test.js does.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
try {
  for (const line of fs.readFileSync(path.join(backendRoot, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* no .env — every test skips below */ }

const HAS_DB = !!process.env.DATABASE_URL
const skip = !HAS_DB && 'DATABASE_URL not set'

let db, auditIpd, ctl
let org, admin, store, dept, unitPcs, category, vendor, item
let auditDown = false

const broken = { create: () => Promise.reject(new Error('audit store down')) }
// The transaction client with its audit table broken, everything else as it is.
const withBrokenAudit = (tx) => new Proxy(tx, {
  get(target, key) {
    if (key === 'auditLog') return broken
    const v = target[key]
    return typeof v === 'function' ? v.bind(target) : v
  },
})

function call(handler, { body = {}, query = {}, user = admin } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      body, query, organizationId: org.id, headers: {}, ip: '127.0.0.1',
      user: { id: user.id, userId: user.id, role: user.role, email: user.email, fullName: user.fullName },
    }
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(payload) { resolve({ status: this.statusCode, ...payload }) },
    }
    Promise.resolve(handler(req, res, (err) => resolve({ status: 500, error: err?.message }))).catch(reject)
  })
}
const down = async (fn) => { auditDown = true; try { return await fn() } finally { auditDown = false } }
const auditRows = (entityId, action) => db.auditLog.count({ where: { organizationId: org.id, entityId, ...(action ? { action } : {}) } })

before(async () => {
  if (!HAS_DB) return
  ;({ db } = await import('../../config/db.js'))
  ;({ auditIpd } = await import('../../inpatient/audit.js'))
  ctl = await import('../../controllers/purchaseController.js')
  const realTx = db.$transaction.bind(db)
  db.$transaction = (arg, opts) => (typeof arg === 'function'
    ? realTx((tx) => arg(auditDown ? withBrokenAudit(tx) : tx), opts)
    : realTx(arg, opts))
  const realCreate = db.auditLog.create.bind(db.auditLog)
  db.auditLog.create = (args) => (auditDown ? broken.create() : realCreate(args))

  const stamp = Date.now()
  org = await db.organization.create({ data: { name: 'Purchase audit test', slug: `test-purchase-audit-${stamp}`, region: 'Maharashtra', modulesEnabled: JSON.stringify({ purchase: true }) } })
  admin = await db.user.create({ data: { organizationId: org.id, email: `admin-${stamp}@pa.local`, fullName: 'Asha Admin', role: 'admin', passwordHash: 'x', isActive: true } })
  store = await db.user.create({ data: { organizationId: org.id, email: `sk-${stamp}@pa.local`, fullName: 'Sunil Store', role: 'store_keeper', passwordHash: 'x', isActive: true } })
  dept = await db.department.create({ data: { organizationId: org.id, name: 'ICU', code: 'ICU' } })
  await call(ctl.getAll, { query: { resource: 'units' } }) // plants the default units and categories
  unitPcs = await db.unit.findFirst({ where: { organizationId: org.id, code: 'PCS' } })
  category = await db.itemCategory.findFirst({ where: { organizationId: org.id, systemCode: 'SURGICAL_CONSUMABLES' } })
})

after(async () => {
  if (org) await db.organization.delete({ where: { id: org.id } })
})

test('a vendor is not added when its audit row cannot be written; added, it has exactly one', { skip }, async () => {
  const count = () => db.vendor.count({ where: { organizationId: org.id } })
  const r = await down(() => call(ctl.create, { body: { resource: 'vendor', name: 'Ghost Traders' } }))
  assert.notEqual(r.status, 201, 'the vendor must not be reported added')
  assert.equal(await count(), 0, 'no vendor row without its audit row')
  const ok = await call(ctl.create, { body: { resource: 'vendor', name: 'Surgimed' } })
  assert.equal(ok.status, 201)
  vendor = ok.data
  assert.equal(await auditRows(vendor.id, 'create'), 1)
})

test('a unit edit and an item save roll back with their audit row', { skip }, async () => {
  const u = await call(ctl.create, { body: { resource: 'unit', code: 'CYL', name: 'Cylinder', kind: 'count' } })
  assert.equal(u.status, 201)
  assert.equal(await auditRows(u.data.id, 'create'), 1)
  await down(() => call(ctl.update, { body: { resource: 'unit', id: u.data.id, name: 'Gas cylinder' } }))
  assert.equal((await db.unit.findUnique({ where: { id: u.data.id } })).name, 'Cylinder')
  assert.equal(await auditRows(u.data.id, 'update'), 0)

  const itemBody = { resource: 'item', name: 'Gloves', categoryId: category.id, stockUnitId: unitPcs.id }
  await down(() => call(ctl.create, { body: itemBody }))
  assert.equal(await db.item.count({ where: { organizationId: org.id, name: 'Gloves' } }), 0)
  const it = await call(ctl.create, { body: itemBody })
  assert.equal(it.status, 201)
  item = it.data
  await db.item.update({ where: { id: item.id }, data: { lastPurchasePrice: 20 } })
  assert.equal(await auditRows(item.id), 1)
})

test('approval rules stay as they were when the audit row fails', { skip }, async () => {
  const rules = (documentType) => ({ resource: 'approval-rules', documentType, rules: [{ approverRole: 'admin', minAmount: 0 }] })
  await down(() => call(ctl.update, { body: rules('PR') }))
  assert.equal(await db.approvalRule.count({ where: { organizationId: org.id } }), 0)
  assert.equal((await call(ctl.update, { body: rules('PR') })).status, 200)
  assert.equal((await call(ctl.update, { body: rules('PO') })).status, 200)
  assert.equal(await db.approvalRule.count({ where: { organizationId: org.id } }), 2)
  assert.equal(await auditRows('PR', 'update'), 1)
})

test('a request is not sent for approval without its audit row', { skip }, async () => {
  const pr = await call(ctl.create, { user: store, body: { resource: 'request', departmentId: dept.id, lines: [{ itemId: item.id, quantity: 10 }] } })
  assert.equal(pr.status, 201)
  assert.equal(await auditRows(pr.data.id, 'create'), 1)
  const r = await down(() => call(ctl.update, { user: store, body: { resource: 'request', id: pr.data.id, action: 'submit' } }))
  assert.notEqual(r.status, 200)
  const row = await db.purchaseRequest.findUnique({ where: { id: pr.data.id } })
  assert.equal(row.status, 'draft', 'still a draft')
  assert.equal(await db.approvalStep.count({ where: { organizationId: org.id, documentId: pr.data.id } }), 0, 'no approval steps opened')
  const ok = await call(ctl.update, { user: store, body: { resource: 'request', id: pr.data.id, action: 'submit' } })
  assert.equal(ok.status, 200)
  assert.equal(ok.data.status, 'submitted')
  assert.equal(await auditRows(pr.data.id, 'submit'), 1)
  // a draft deleted while the audit store is down is still there
  const draft = await call(ctl.create, { user: store, body: { resource: 'request', departmentId: dept.id, lines: [{ itemId: item.id, quantity: 1 }] } })
  await down(() => call(ctl.remove, { user: store, query: { resource: 'request', id: draft.data.id } }))
  assert.equal(await db.purchaseRequest.count({ where: { id: draft.data.id } }), 1)
})

test('an order, its receipt and its bill each roll back with their audit row', { skip }, async () => {
  const po = await call(ctl.create, { body: { resource: 'order', vendorId: vendor.id, lines: [{ itemId: item.id, quantity: 5, rate: 10 }] } })
  assert.equal(po.status, 201)
  const id = po.data.id
  for (const action of ['submit', 'approve']) assert.equal((await call(ctl.update, { body: { resource: 'order', id, action } })).status, 200, action)
  await down(() => call(ctl.update, { body: { resource: 'order', id, action: 'send' } }))
  assert.equal((await db.purchaseOrder.findUnique({ where: { id } })).status, 'approved', 'not sent')
  assert.equal((await call(ctl.update, { body: { resource: 'order', id, action: 'send' } })).status, 200)
  assert.equal(await auditRows(id, 'send'), 1)
  assert.equal(await auditRows(id), 4, 'create, submit, approve level 1, send — one row each')

  const full = await db.purchaseOrder.findUnique({ where: { id }, include: { lines: true } })
  const receipt = { resource: 'receipt', orderId: id, lines: [{ orderLineId: full.lines[0].id, receivedQty: 5 }] }
  const r = await down(() => call(ctl.create, { body: receipt }))
  assert.notEqual(r.status, 201)
  assert.equal(await db.goodsReceipt.count({ where: { organizationId: org.id } }), 0, 'no receipt')
  assert.equal(await db.stockBatch.count({ where: { organizationId: org.id } }), 0, 'no stock taken in')
  assert.equal((await db.purchaseOrder.findUnique({ where: { id } })).status, 'sent', 'order untouched')
  const g = await call(ctl.create, { body: receipt })
  assert.equal(g.status, 201)
  assert.equal(await auditRows(g.data.id, 'create'), 1)
  assert.equal(await db.stockBatch.count({ where: { organizationId: org.id } }), 1)

  const bill = { resource: 'bill', orderId: id, vendorInvoiceNumber: 'INV-1', vendorInvoiceDate: '2026-10-01', lines: [{ orderLineId: full.lines[0].id, quantity: 5, rate: 10 }] }
  await down(() => call(ctl.create, { body: bill }))
  assert.equal(await db.vendorBill.count({ where: { organizationId: org.id } }), 0, 'no bill')
  const b = await call(ctl.create, { body: bill })
  assert.equal(b.status, 201, b.error)
  assert.equal(await auditRows(b.data.id), 1)
})

test('an IPD caller without a transaction keeps the old rule: the action stands, the failure is only logged', { skip }, async () => {
  const req = { user: { id: admin.id, email: admin.email, role: 'admin' }, headers: {} }
  await down(() => auditIpd(req, org.id, { action: 'create', entityType: 'ipd.test', entityId: 'ipd-1', after: { a: 1 } }))
  assert.equal(await auditRows('ipd-1'), 0)
  await auditIpd(req, org.id, { action: 'create', entityType: 'ipd.test', entityId: 'ipd-2', after: { a: 1 } })
  assert.equal(await auditRows('ipd-2'), 1)
})

test('inside a transaction, a user id that no longer resolves is kept in metadata, not a failed write', { skip }, async () => {
  const req = { user: { id: 'no-such-user', email: 'gone@pa.local', role: 'admin' }, headers: {} }
  await db.$transaction((tx) => auditIpd(req, org.id, { action: 'create', entityType: 'purchase.test', entityId: 'tx-1', after: {} }, tx))
  const row = await db.auditLog.findFirst({ where: { organizationId: org.id, entityId: 'tx-1' } })
  assert.equal(row.userId, null)
  assert.match(row.metadata, /no-such-user/)
  assert.equal(row.userEmail, 'gone@pa.local')
})
