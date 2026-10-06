// A bell notification that cannot be written must not undo the purchase
// decision it follows (that has committed), but it must not vanish into the
// server log either: the person who acted is told, so they can tell the
// approvers themselves. These stub the database client, so no database is
// needed — the stubs stand in for a notification table that refuses the write.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { notify } from '../notify.js'
import * as purchaseNotify from '../purchaseNotify.js'

const { requestChanged, orderChanged, receiptChanged, billChanged } = purchaseNotify
const NOTIFY_WARNING = purchaseNotify.NOTIFY_WARNING ?? 'NOTIFY_WARNING is not exported'

const real = {
  userFindMany: db.user.findMany, createMany: db.notification.createMany, poFindFirst: db.purchaseOrder.findFirst,
  consoleError: console.error,
}
afterEach(() => {
  db.user.findMany = real.userFindMany
  db.notification.createMany = real.createMany
  db.purchaseOrder.findFirst = real.poFindFirst
  console.error = real.consoleError
})
const logged = []
const quiet = () => { logged.length = 0; console.error = (...a) => logged.push(a.join(' ')) }

// Everyone asked about exists; who is in which role is up to `byRole`.
function people(byRole = {}) {
  db.user.findMany = async ({ where }) => {
    if (where.role?.in) return where.role.in.flatMap((r) => (byRole[r] || []).map((id) => ({ id })))
    return (where.id?.in || []).map((id) => ({ id }))
  }
}
const written = []
const tableWorks = () => { written.length = 0; db.notification.createMany = async ({ data }) => { written.push(...data); return { count: data.length } } }
const tableDown = () => { db.notification.createMany = async () => { throw new Error('connection to the notification table lost') } }

const actor = { id: 'u-sk', name: 'Sunil Store' }
const submittedPr = {
  id: 'pr-1', number: 'PR-2026-27-000001', status: 'submitted', priority: 'normal', estimatedTotal: 2000,
  department: { name: 'ICU' }, requestedById: 'u-sk', requestedByName: 'Sunil Store',
  currentStep: { level: 1, approverRole: 'purchase_officer' }, steps: [{ level: 1 }],
}

test('notify itself no longer swallows a failed write: it throws, and the caller decides', async () => {
  people(); tableDown()
  await assert.rejects(() => notify('org-1', ['u-po'], { type: 't', title: 'x', message: 'y' }), /notification table lost/)
})

test('a request sent while the bell cannot be written: no throw, a warning to show, and a log line naming the document', async () => {
  people({ purchase_officer: ['u-po'] }); tableDown(); quiet()
  const warning = await requestChanged('org-1', 'submit', submittedPr, actor)
  assert.equal(warning, NOTIFY_WARNING)
  assert.match(warning, /tell them directly/i)
  assert.ok(logged.some((l) => l.includes('PR-2026-27-000001') && l.includes('submit') && l.includes('org-1') && l.includes('notification table lost')), logged.join('\n'))
})

test('when the bell works there is no warning, and the approver gets the row', async () => {
  people({ purchase_officer: ['u-po'] }); tableWorks()
  const warning = await requestChanged('org-1', 'submit', submittedPr, actor)
  assert.equal(warning, null)
  assert.deepEqual(written.map((n) => n.userId), ['u-po'])
})

test('nobody else in the approver role still falls back to the administrators — not a warning', async () => {
  people({ purchase_officer: [], admin: ['u-admin'] }); tableWorks()
  const warning = await requestChanged('org-1', 'submit', submittedPr, actor)
  assert.equal(warning, null)
  assert.deepEqual(written.map((n) => n.userId), ['u-admin'])
})

test('nothing to tell (a draft saved) is not a failure', async () => {
  people(); tableDown()
  assert.equal(await requestChanged('org-1', 'save', { ...submittedPr, status: 'draft' }, actor), null)
})

test('orders, receipts and bills answer the same way when the bell is down', async () => {
  people({ store_keeper: ['u-sk2'], admin: ['u-admin'], finance_controller: ['u-fc'] }); tableDown(); quiet()
  const po = { id: 'po-1', number: 'PO-1', status: 'sent', vendorName: 'Surgimed', lines: [{}], createdById: 'u-po', total: 100 }
  assert.equal(await orderChanged('org-1', 'send', po, { id: 'u-po' }), NOTIFY_WARNING)
  db.purchaseOrder.findFirst = async () => ({ number: 'PO-1', status: 'partly_received', createdById: 'u-po', lines: [] })
  const grn = { id: 'g-1', number: 'GRN-1', orderId: 'po-1', vendorName: 'Surgimed', lines: [{ acceptedQty: 1, rejectedQty: 0, itemName: 'Gloves' }] }
  assert.equal(await receiptChanged('org-1', 'create', grn, actor), NOTIFY_WARNING)
  const bill = { id: 'b-1', number: 'BILL-1', status: 'on_hold', vendorName: 'Surgimed', payable: 100, mismatch: 'rate differs', createdById: 'u-po', createdByName: 'Priya', order: { number: 'PO-1' } }
  assert.equal(await billChanged('org-1', 'submit', bill, { id: 'u-po' }), NOTIFY_WARNING)
})
