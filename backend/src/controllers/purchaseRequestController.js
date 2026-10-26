// Purchase requests (PR) and their approval — reached through /api/purchase,
// dispatched here by purchaseController for these resources:
//
// GET    ?resource=requests         list (status, priority, departmentId, search, view=mine|to-approve, paging)
// GET    ?resource=dashboard        the Purchase landing page, for the signed-in person
// GET    ?resource=request&id=      one request: lines, department, approval steps
// GET    ?resource=approval-rules   who approves how much (documentType=PR)
// POST   {resource:'request'}       a new DRAFT
// PATCH  {resource:'request', action}   save | submit | approve | reject | cancel | reopen
// PATCH  {resource:'approval-rules'}    replace the rules (administrator)
// DELETE ?resource=request&id=      a draft that was never sent
//
// The life of a request:
//   draft ─submit→ submitted ─approve (every level)→ approved
//                      └─reject→ rejected ─reopen→ draft
//   draft / submitted ─cancel→ cancelled
import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { round2 } from '../lib/money.js'
import { startOfToday, ymdInZone, dayRange } from '../lib/dates.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { listResponse } from '../lib/pagination.js'
import { auditIpd } from '../inpatient/audit.js'
import { canBuy, canRaiseRequest, canSeeBills, isAdmin, ownsOrAdmin, othersDraftsHidden, blank, validationError, sendError, seesMoney, seesEverything, hideMoney, MONEY } from '../lib/purchaseAccess.js'
import { resolveLines } from '../lib/purchaseLines.js'
import { orderFigures, HOLDING } from './purchaseOrderController.js'
import { requestChanged } from '../lib/purchaseNotify.js'
import { stockFigures } from './purchaseReceiptController.js'
import { billFigures } from './purchaseBillController.js'
import {
  APPROVER_ROLES, DOCUMENT_TYPES, currentStep, decide, loadRules, openSteps,
  cancelSteps, rulesError, stepsOf, awaitingFor,
} from '../lib/approvals.js'

const DOC = 'PR'

// The resources this file answers; purchaseController hands these over.
export const PR_READS = new Set(['requests', 'request', 'approval-rules', 'dashboard'])
export const PR_WRITES = new Set(['request', 'approval-rules'])

// Who may buy or approve: lib/purchaseAccess.js (shared with orders).
export { canBuy }

const PRIORITIES = ['normal', 'urgent', 'emergency']

const optNum = (label) => z.preprocess((v) => (blank(v) ? undefined : Number(v)),
  z.number({ invalid_type_error: `${label} must be a number` }).finite().optional())

const lineSchema = z.object({
  itemId: z.string().min(1, 'Choose an item on every line'),
  unitId: z.string().optional().nullable(),
  quantity: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number({ required_error: 'Enter a quantity on every line', invalid_type_error: 'Quantity must be a number' })
      .finite().positive('Quantity must be more than 0').max(1e7, 'Quantity is too large')),
  estimatedRate: optNum('Rate').refine((v) => v == null || (v >= 0 && v <= 1e9), 'Rate must be 0 or more'),
  note: z.string().trim().max(200).optional().nullable(),
})

const headerFields = {
  departmentId: z.string().min(1, 'Choose the department asking for it'),
  requiredBy: z.preprocess((v) => (blank(v) ? null : v), z.coerce.date({ invalid_type_error: 'Enter a valid date' }).nullable().optional()),
  priority: z.enum(PRIORITIES).optional(),
  purpose: z.string().trim().max(500).optional().nullable(),
  lines: z.array(lineSchema).max(100, 'At most 100 lines on one request'),
}
const createSchema = z.object(headerFields)
const saveSchema = z.object({ id: z.string().min(1), ...headerFields }).partial({ departmentId: true, lines: true })

const REQUEST_INCLUDE = {
  department: { select: { id: true, name: true } },
  lines: { orderBy: { sortOrder: 'asc' } },
}

// Where each line went: the orders still holding it (a cancelled one has let
// it go). The store reads this, so only quantities, numbers and statuses are
// selected — no rate or amount ever leaves the database here.
const ordersOnLine = (ORG_ID) => ({
  where: { organizationId: ORG_ID, order: { status: { in: HOLDING } } },
  orderBy: { order: { createdAt: 'asc' } },
  select: { quantity: true, receivedQty: true, unitCode: true, order: { select: { number: true, status: true, createdById: true } } },
})

/**
 * One order a request line is on, as this person may see it. A draft order is
 * its maker's (and an administrator's) until it is sent, so anyone else gets
 * only that the line is on an order being prepared — not its number. Leaving
 * it out instead would make an "Ordered" request look as if a line were not.
 */
function orderOnLine(req, { order, quantity, receivedQty, unitCode }) {
  if (order.status === 'draft' && !ownsOrAdmin(req, order.createdById)) return { number: null, status: 'draft' }
  return { number: order.number, status: order.status, quantity, receivedQty, unitCode }
}

/**
 * Turns the lines as typed into rows to store. Every id is checked against
 * this hospital; what the request keeps (name, unit, GST, rate) is copied from
 * the item now. Throws a 400 with a message naming the line.
 */
// `ownRates` false for those who do not see money (the store): a rate they
// send is ignored, so every estimate starts at the last price paid — the
// approval levels are decided by it.
async function buildLines(ORG_ID, lines, { ownRates = true } = {}) {
  // Item, unit, whole numbers, no twice: the checks every purchase document makes.
  const resolved = await resolveLines(db, ORG_ID, lines, { noun: 'request' })
  return resolved.map(({ line: l, item, unit }, i) => {
    // The estimate starts at the last price paid, per stock unit, scaled to
    // the unit asked for (a box of 100 at ₹2 a piece is ₹200).
    const typed = ownRates ? l.estimatedRate : undefined
    // Rounded before the total, so the shown rate × quantity is the total.
    const rate = round2(typed ?? (item.lastPurchasePrice != null ? item.lastPurchasePrice * unit.factor : 0))
    return {
      organizationId: ORG_ID,
      itemId: item.id, itemCode: item.code, itemName: item.name,
      unitId: unit.id, unitCode: unit.code, unitFactor: unit.factor,
      quantity: l.quantity, estimatedRate: rate, gstRate: item.gstRate,
      lineTotal: round2(l.quantity * rate * (1 + item.gstRate / 100)),
      note: blank(l.note) ? null : l.note.trim(),
      sortOrder: i,
    }
  })
}

async function checkDepartment(ORG_ID, departmentId) {
  const dept = await db.department.findFirst({ where: { id: departmentId, organizationId: ORG_ID }, select: { isActive: true, name: true } })
  if (!dept) throw bad('Choose the department from the list')
  if (!dept.isActive) throw bad(`The ${dept.name} department is closed`)
}

const total = (rows) => round2(rows.reduce((s, r) => s + r.lineTotal, 0))

/** Locks the request row for the rest of the transaction and reads it. */
async function lockRequest(tx, ORG_ID, id) {
  // Two people pressing Approve (or Submit and Cancel) at the same moment:
  // the second waits here and then sees the first one's result, instead of
  // both reading "submitted" and both acting.
  await tx.$executeRaw`SELECT 1 FROM "PurchaseRequest" WHERE "id" = ${id} AND "organizationId" = ${ORG_ID} FOR UPDATE`
  const pr = await tx.purchaseRequest.findFirst({ where: { id, organizationId: ORG_ID }, include: { lines: true } })
  if (!pr) throw notFound('Purchase request not found')
  return pr
}

/** What stops a draft being sent, or null. */
function submitProblem(pr) {
  if (!pr.lines.length) return 'Add at least one item before sending the request'
  // No rate is required: the person asking rarely knows the price. The price
  // is settled on the purchase order, where the money approval happens.
  if (pr.priority !== 'normal' && blank(pr.purpose)) return `Say why it is ${pr.priority} — the approver reads that first`
  if (pr.requiredBy && pr.requiredBy < startOfToday()) return 'The required-by date is in the past'
  return null
}

// ── Landing page ─────────────────────────────────────────────────────────────

const pick = (step) => (step ? { level: step.level, approverRole: step.approverRole } : null)
const PRIORITY_RANK = { emergency: 0, urgent: 1, normal: 2 }
// Audit actions shown in the activity feed. Draft saves are left out: they are
// typing, not events anyone else needs to see.
const FEED_ACTIONS = /^(create|submit|approve|reject|cancel|reopen|delete|send|close)/
const KIND = { 'purchase.request': 'request', 'purchase.order': 'order', 'purchase.receipt': 'receipt', 'purchase.bill': 'bill' }
// The documents that start as a draft: the table each lives in and the field
// naming its author.
const DRAFTABLE = { 'purchase.request': ['purchaseRequest', 'requestedById'], 'purchase.order': ['purchaseOrder', 'createdById'], 'purchase.bill': ['vendorBill', 'createdById'] }

/**
 * Everything the Purchase landing page shows, in one read, for this person:
 * what waits for them, how requests stand across the process, where approved
 * money went in the last 30 days, and what happened lately.
 */
async function dashboard(ORG_ID, actor, admin, money = true, everything = true, bills = true) {
  const awaitingIds = await awaitingFor(db, ORG_ID, DOC, actor, admin)
  // Your own request is never yours to approve (an administrator excepted).
  const notMine = !admin && actor.id ? { requestedById: { not: actor.id } } : {}
  const mine = actor.id ? { requestedById: actor.id } : {}
  // A rolling 30 days, not the calendar month: on the 1st a month-to-date
  // chart is empty, and says nothing useful.
  const last30 = dayRange(ymdInZone(new Date(Date.now() - 29 * 86400000)), ymdInZone())

  const [waiting, urgentOpen, drafts, rejected, byStatus, approvedByDept, feed, myOpen, mineCount, mineWaiting] = await Promise.all([
    db.purchaseRequest.findMany({
      where: { organizationId: ORG_ID, status: 'submitted', id: { in: awaitingIds }, ...notMine },
      include: { department: { select: { name: true } } },
    }),
    db.purchaseRequest.count({ where: { organizationId: ORG_ID, status: 'submitted', priority: { in: ['urgent', 'emergency'] } } }),
    db.purchaseRequest.count({ where: { organizationId: ORG_ID, status: 'draft', ...mine } }),
    // A requester fixes their own; an administrator sees every one.
    db.purchaseRequest.count({ where: { organizationId: ORG_ID, status: 'rejected', ...(admin ? {} : mine) } }),
    // Where requests stand: the store's own; for everyone else all of them,
    // with the drafts their own (a draft is its author's until it is sent).
    db.purchaseRequest.groupBy({ by: ['status'], where: { organizationId: ORG_ID, ...(everything ? {} : mine) }, _count: { _all: true } }),
    db.purchaseRequest.groupBy({
      by: ['departmentId'], where: { organizationId: ORG_ID, status: 'approved', decidedAt: last30 },
      _sum: { estimatedTotal: true }, _count: { _all: true },
    }),
    db.auditLog.findMany({
      where: { organizationId: ORG_ID, entityType: { in: Object.keys(KIND) } },
      orderBy: { performedAt: 'desc' }, take: 30,
      select: { action: true, entityType: true, entityId: true, performedAt: true, newValues: true, oldValues: true, userId: true, user: { select: { fullName: true } }, userEmail: true },
    }),
    // For someone who raises requests: their own still in play, newest first.
    actor.id
      ? db.purchaseRequest.findMany({
        where: { organizationId: ORG_ID, requestedById: actor.id, status: { in: ['draft', 'submitted', 'rejected'] } },
        include: { department: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' }, take: 6,
      })
      : [],
    // Every request this person raised, any status — the "My Requests" count.
    actor.id ? db.purchaseRequest.count({ where: { organizationId: ORG_ID, requestedById: actor.id } }) : 0,
    // …and of those, the ones with the approvers now.
    actor.id ? db.purchaseRequest.count({ where: { organizationId: ORG_ID, requestedById: actor.id, status: 'submitted' } }) : 0,
  ])

  // Most pressing first: emergency, then urgent, then whatever has waited longest.
  waiting.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) || (a.submittedAt ?? a.createdAt) - (b.submittedAt ?? b.createdAt))
  const stepIds = [...waiting, ...myOpen].map((w) => w.id)
  const steps = stepIds.length
    ? await db.approvalStep.findMany({ where: { organizationId: ORG_ID, documentType: DOC, documentId: { in: stepIds } } })
    : []
  const row = (w) => ({
    id: w.id, number: w.number, department: w.department?.name, priority: w.priority, status: w.status,
    ...(money ? { estimatedTotal: w.estimatedTotal } : {}), waitingSince: w.submittedAt ?? w.createdAt,
    level: pick(currentStep(steps.filter((s) => s.documentId === w.id))),
  })

  const deptNames = approvedByDept.length
    ? new Map((await db.department.findMany({ where: { organizationId: ORG_ID, id: { in: approvedByDept.map((d) => d.departmentId) } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]))
    : new Map()

  // The request number lives in the audit row's copy of the request.
  const numberOf = (row) => {
    for (const json of [row.newValues, row.oldValues]) {
      try { const n = json && JSON.parse(json).number; if (n) return n } catch { /* not JSON */ }
    }
    return null
  }

  // The store's feed: goods received, and its own requests — not the orders
  // and approvals it has no part in.
  let shown = feed.filter((r) => FEED_ACTIONS.test(r.action))
  // Someone else starting or deleting a draft is not news: drafts are private.
  // ("create and submit" — a bill entered and sent at once — is not a draft.)
  if (!admin) {
    const me = actor.id || '__none__'
    const draftEvent = (r) => !!DRAFTABLE[r.entityType] && /^(create|delete)$/.test(r.action)
    const byMe = (r) => r.userId === me
    shown = shown.filter((r) => !draftEvent(r) || byMe(r))
    // Nor is anything said about a document that is someone else's draft now —
    // one sent back and reopened: it cannot be opened until it is sent again.
    const draftNow = new Set()
    await Promise.all(Object.entries(DRAFTABLE).map(async ([type, [model, author]]) => {
      const ids = [...new Set(shown.filter((r) => r.entityType === type).map((r) => r.entityId))]
      if (!ids.length) return
      const drafts = await db[model].findMany({ where: { organizationId: ORG_ID, id: { in: ids }, status: 'draft' }, select: { id: true, [author]: true } })
      for (const d of drafts) if (d[author] !== me) draftNow.add(d.id)
    }))
    shown = shown.filter((r) => !draftNow.has(r.entityId))
  }
  if (!everything) {
    const ownIds = new Set((await db.purchaseRequest.findMany({
      where: { organizationId: ORG_ID, requestedById: actor.id ?? '__none__', id: { in: shown.map((r) => r.entityId) } }, select: { id: true },
    })).map((r) => r.id))
    shown = shown.filter((r) => r.entityType === 'purchase.receipt' || ownIds.has(r.entityId))
  }

  const [orders, stock, billing] = await Promise.all([orderFigures(ORG_ID, actor, admin), stockFigures(ORG_ID), bills ? billFigures(ORG_ID) : null])
  // The store works in quantities: order values, the stock's value and the
  // spending by department are left out for it.
  if (!money) { delete orders.ordersToApprove.amount; delete orders.openOrders.amount; delete stock.value; approvedByDept.length = 0 }
  // Others' drafts are not counted where they cannot be opened.
  const pipelineOf = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]))
  if (everything && !admin) pipelineOf.draft = drafts
  return {
    orders,
    stock,
    // vendor bills: the purchase officer, Finance and administrators only
    ...(billing ? { bills: billing } : {}),
    cards: {
      toApprove: { count: waiting.length, ...(money ? { amount: round2(waiting.reduce((s, w) => s + w.estimatedTotal, 0)) } : {}) },
      urgentOpen,
      drafts,
      rejected,
      mine: mineCount,
      mineWaiting,
    },
    pipeline: pipelineOf,
    attention: waiting.slice(0, 6).map(row),
    myOpen: myOpen.map(row),
    approvedLast30Days: approvedByDept
      .map((d) => ({ department: deptNames.get(d.departmentId) || '—', amount: round2(d._sum.estimatedTotal ?? 0), count: d._count._all }))
      .sort((a, b) => b.amount - a.amount),
    activity: shown.slice(0, 8).map((r) => ({
      action: r.action, kind: KIND[r.entityType] || 'request',
      requestId: r.action === 'delete' ? null : r.entityId, number: numberOf(r),
      by: r.user?.fullName || r.userEmail || 'Someone', at: r.performedAt,
    })),
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function prGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query
    const actor = getActor(req)

    if (resource === 'requests') {
      const { status, departmentId, search, view, priority, startDate, endDate } = req.query
      const where = { organizationId: ORG_ID }
      if (startDate || endDate) where.createdAt = dayRange(startDate, endDate)
      if (status && status !== 'all') where.status = { in: String(status).split(',') }
      if (departmentId) where.departmentId = String(departmentId)
      if (priority && priority !== 'all') where.priority = { in: String(priority).split(',').filter((p) => PRIORITIES.includes(p)) }
      // The store sees the requests it raised; everyone else, every request.
      if (view === 'mine' || !seesEverything(req)) where.requestedById = actor.id ?? '__none__'
      // A draft is its author's until it is sent (an administrator may look).
      where.AND = [...(where.AND || []), othersDraftsHidden(isAdmin(req), actor.id, 'requestedById')]
      if (view === 'to-approve') {
        where.id = { in: await awaitingFor(db, ORG_ID, DOC, actor, isAdmin(req)) }
        where.status = 'submitted'
        // Your own request is not yours to approve (an administrator excepted).
        if (!isAdmin(req) && actor.id) where.requestedById = { not: actor.id }
      }
      const term = String(search || '').trim()
      if (term) {
        where.OR = [
          { number: { contains: term, mode: 'insensitive' } },
          { purpose: { contains: term, mode: 'insensitive' } },
          { requestedByName: { contains: term, mode: 'insensitive' } },
          { lines: { some: { itemName: { contains: term, mode: 'insensitive' } } } },
        ]
      }
      const body = await listResponse(db.purchaseRequest, {
        where, req,
        include: { department: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
        orderBy: { createdAt: 'desc' },
      })
      // Whose turn it is, for the list's status column.
      const ids = body.data.map((r) => r.id)
      const steps = ids.length
        ? await db.approvalStep.findMany({ where: { organizationId: ORG_ID, documentType: DOC, documentId: { in: ids } }, orderBy: { level: 'asc' } })
        : []
      body.data = body.data.map(({ _count, ...r }) => {
        const own = steps.filter((s) => s.documentId === r.id)
        return hideMoney(req, { ...r, lineCount: _count.lines, levels: own.length, currentStep: currentStep(own) }, MONEY.request)
      })
      return res.json(body)
    }

    if (resource === 'request') {
      const id = String(req.query.id || '')
      const pr = await db.purchaseRequest.findFirst({
        where: { id, organizationId: ORG_ID },
        include: { ...REQUEST_INCLUDE, lines: { ...REQUEST_INCLUDE.lines, include: { orderLines: ordersOnLine(ORG_ID) } } },
      })
      const hidden = (!seesEverything(req) || (pr?.status === 'draft' && !isAdmin(req))) && pr?.requestedById !== actor.id
      if (!pr || hidden) return res.status(404).json({ success: false, error: 'Purchase request not found' })
      const steps = await stepsOf(db, ORG_ID, DOC, id)
      // "Ordered" stays the request's status even when an order is closed
      // short; each line says how its order stands and how much has come.
      const lines = pr.lines.map(({ orderLines, ...l }) => ({ ...l, orders: orderLines.map((ol) => orderOnLine(req, ol)) }))
      return res.json({ success: true, data: hideMoney(req, { ...pr, lines, steps, currentStep: currentStep(steps) }, MONEY.request) })
    }

    if (resource === 'dashboard') return res.json({ success: true, data: await dashboard(ORG_ID, actor, isAdmin(req), seesMoney(req), seesEverything(req), canSeeBills(req)) })

    if (resource === 'approval-rules') {
      const documentType = String(req.query.documentType || DOC)
      if (!DOCUMENT_TYPES.includes(documentType)) return res.status(400).json({ success: false, error: 'Unknown document type' })
      const rows = await db.approvalRule.count({ where: { organizationId: ORG_ID, documentType } })
      const rules = await loadRules(db, ORG_ID, documentType)
      // Who actually holds each approving role here, so a form can say "goes to
      // Neha Kapoor" rather than a bare role. Names only — the staff list with
      // contact details stays the administrator's (settings users).
      const people = await db.user.findMany({
        where: { organizationId: ORG_ID, isActive: true, role: { in: [...new Set(rules.map((r) => r.approverRole))] } },
        select: { fullName: true, role: true },
        orderBy: { fullName: 'asc' },
      })
      const approverNames = {}
      for (const u of people) (approverNames[u.role] ||= []).push(u.fullName.trim())
      // Each level's ₹ threshold is money: left out for the store.
      return res.json({ success: true, data: hideMoney(req, { documentType, rules, isDefault: rows === 0, roles: APPROVER_ROLES, approverNames }, MONEY.approvalRules) })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (err) {
    next(err)
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────


async function readFull(ORG_ID, id, client = db) {
  const pr = await client.purchaseRequest.findFirst({ where: { id, organizationId: ORG_ID }, include: REQUEST_INCLUDE })
  const steps = await stepsOf(client, ORG_ID, DOC, id)
  return { ...pr, steps, currentStep: currentStep(steps) }
}

/**
 * Runs `work` and reads the request back in the same transaction, so a write
 * answers with exactly what it committed. Read after the commit, a dropped
 * connection answered 500 for a request that had changed (and the client may
 * repeat it), and a draft deleted in that moment answered an empty object.
 * `audit(tx, after)` writes the audit row in the same transaction, so the
 * change and its record commit together or not at all.
 */
function writeRequest(ORG_ID, id, audit, work) {
  return db.$transaction(async (tx) => {
    await work(tx)
    const after = await readFull(ORG_ID, id, tx)
    await audit(tx, after)
    return after
  })
}

export async function prCreate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canRaiseRequest(req)) throw forbidden('Only store, purchase staff, doctors and nurses raise purchase requests')
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const { departmentId, requiredBy, priority, purpose, lines } = parsed.data
    await checkDepartment(ORG_ID, departmentId)
    if (requiredBy && requiredBy < startOfToday()) throw bad('The required-by date is in the past')
    const rows = await buildLines(ORG_ID, lines, { ownRates: seesMoney(req) })
    const actor = getActor(req)

    const { full } = await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG_ID, 'PURCHASE_REQUEST', 'PR')
      const created = await tx.purchaseRequest.create({
        data: {
          organizationId: ORG_ID, number, status: 'draft', departmentId,
          requestedById: actor.id, requestedByName: actor.name || 'Staff',
          requiredBy: requiredBy ?? null, priority: priority || 'normal', purpose: blank(purpose) ? null : purpose,
          estimatedTotal: total(rows),
          lines: { create: rows },
        },
      })
      await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.request', entityId: created.id, after: created }, tx)
      // Read back before the commit — see writeRequest.
      return { created, full: await readFull(ORG_ID, created.id, tx) }
    })
    return res.status(201).json({ success: true, data: hideMoney(req, full, MONEY.request) })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function prUpdate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource, action } = req.body

    if (resource === 'approval-rules') {
      if (!isAdmin(req)) throw forbidden('Only an administrator changes approval rules')
      const documentType = req.body.documentType || DOC
      if (!DOCUMENT_TYPES.includes(documentType)) throw bad('Unknown document type')
      const rules = (req.body.rules || []).map((r, i) => ({ level: i + 1, approverRole: r.approverRole, minAmount: Number(r.minAmount) }))
      const error = rulesError(rules)
      if (error) throw bad(error)
      const before = await loadRules(db, ORG_ID, documentType)
      await db.$transaction(async (tx) => {
        await tx.approvalRule.deleteMany({ where: { organizationId: ORG_ID, documentType } })
        await tx.approvalRule.createMany({ data: rules.map((r) => ({ ...r, organizationId: ORG_ID, documentType })) })
        await auditIpd(req, ORG_ID, { action: 'update', entityType: 'purchase.approvalRules', entityId: documentType, before, after: rules }, tx)
      })
      return res.json({ success: true, data: { documentType, rules, isDefault: false, roles: APPROVER_ROLES } })
    }

    // resource === 'request'
    const id = String(req.body.id || '')
    const actor = getActor(req)
    let auditAction = action
    // `after` is the request as its transaction committed it (writeRequest).
    let before, after
    // Run inside that transaction, after `work` has set `before` and `auditAction`.
    const audit = (tx, committed) => auditIpd(req, ORG_ID, { action: auditAction, entityType: 'purchase.request', entityId: id, before, after: committed }, tx)

    if (action === 'save') {
      if (!canBuy(req)) throw forbidden('Only store and purchase staff change purchase requests')
      const parsed = saveSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const { departmentId, requiredBy, priority, purpose, lines } = parsed.data
      if (departmentId) await checkDepartment(ORG_ID, departmentId)
      if (requiredBy && requiredBy < startOfToday()) throw bad('The required-by date is in the past')
      const rows = lines ? await buildLines(ORG_ID, lines, { ownRates: seesMoney(req) }) : null

      after = await writeRequest(ORG_ID, id, audit, async (tx) => {
        const pr = await lockRequest(tx, ORG_ID, id)
        before = pr
        if (pr.status !== 'draft') throw conflict(`This request is ${pr.status} — only a draft can be changed`)
        if (!ownsOrAdmin(req, pr.requestedById)) throw forbidden(`Only ${pr.requestedByName} or an administrator can change this draft`)
        if (rows) {
          await tx.purchaseRequestLine.deleteMany({ where: { requestId: id, organizationId: ORG_ID } })
          if (rows.length) await tx.purchaseRequestLine.createMany({ data: rows.map((r) => ({ ...r, requestId: id })) })
        }
        await tx.purchaseRequest.update({
          where: { id },
          data: {
            ...(departmentId ? { departmentId } : {}),
            ...(requiredBy !== undefined ? { requiredBy } : {}),
            ...(priority ? { priority } : {}),
            ...(purpose !== undefined ? { purpose: blank(purpose) ? null : purpose } : {}),
            ...(rows ? { estimatedTotal: total(rows) } : {}),
          },
        })
      })
    } else if (action === 'submit') {
      if (!canBuy(req)) throw forbidden('Only store and purchase staff send purchase requests')
      after = await writeRequest(ORG_ID, id, audit, async (tx) => {
        const pr = await lockRequest(tx, ORG_ID, id)
        before = pr
        if (pr.status !== 'draft') throw conflict(`This request is already ${pr.status}`)
        if (!ownsOrAdmin(req, pr.requestedById)) throw forbidden(`Only ${pr.requestedByName} or an administrator can send this request`)
        const problem = submitProblem(pr)
        if (problem) throw bad(problem)
        const levels = await openSteps(tx, ORG_ID, DOC, id, pr.estimatedTotal)
        const now = new Date()
        // No steps created → amount below every threshold, auto-approved on send.
        // Admin submitting → they can satisfy every level; approve all steps at once
        // so a small-hospital admin doesn't have to click Approve after every Send.
        const adminSelf = levels && isAdmin(req)
        if (adminSelf) {
          await tx.approvalStep.updateMany({
            where: { organizationId: ORG_ID, documentType: DOC, documentId: id, status: 'pending' },
            data: { status: 'approved', actedById: actor.id, actedByName: actor.name, actedAt: now },
          })
        }
        await tx.purchaseRequest.update({
          where: { id },
          data: (!levels || adminSelf)
            ? { status: 'approved', submittedAt: now, decidedAt: now }
            : { status: 'submitted', submittedAt: now, decidedAt: null },
        })
      })
    } else if (action === 'approve' || action === 'reject') {
      const remark = String(req.body.remark || '').trim().slice(0, 500)
      if (action === 'reject' && remark.length < 3) throw bad('Say why it is rejected — the requester needs to know what to change')
      after = await writeRequest(ORG_ID, id, audit, async (tx) => {
        const pr = await lockRequest(tx, ORG_ID, id)
        before = pr
        if (pr.status !== 'submitted') throw conflict(`This request is ${pr.status} — there is nothing to ${action}`)
        const result = await decide(tx, ORG_ID, DOC, id, { actor, requestedById: pr.requestedById, approve: action === 'approve', remark })
        if (result.error) throw forbidden(result.error)
        auditAction = `${action} level ${result.step.level}`
        if (result.outcome !== 'next') {
          await tx.purchaseRequest.update({ where: { id }, data: { status: result.outcome, decidedAt: new Date() } })
        }
      })
    } else if (action === 'cancel') {
      const reason = String(req.body.reason || '').trim().slice(0, 300)
      after = await writeRequest(ORG_ID, id, audit, async (tx) => {
        const pr = await lockRequest(tx, ORG_ID, id)
        before = pr
        if (!['draft', 'submitted'].includes(pr.status)) throw conflict(`A ${pr.status} request cannot be cancelled`)
        if (!ownsOrAdmin(req, pr.requestedById)) throw forbidden(`Only ${pr.requestedByName} or an administrator can cancel this request`)
        if (pr.status === 'submitted' && reason.length < 3) throw bad('Say why it is cancelled — approvers were already looking at it')
        await cancelSteps(tx, ORG_ID, DOC, id)
        await tx.purchaseRequest.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason || null } })
      })
    } else if (action === 'reopen') {
      // A rejected request is corrected and sent again, keeping its number and
      // its history; its old approval steps are replaced when it is re-sent.
      after = await writeRequest(ORG_ID, id, audit, async (tx) => {
        const pr = await lockRequest(tx, ORG_ID, id)
        before = pr
        if (pr.status !== 'rejected') throw conflict('Only a rejected request can be reopened')
        if (!ownsOrAdmin(req, pr.requestedById)) throw forbidden(`Only ${pr.requestedByName} or an administrator can reopen this request`)
        await tx.purchaseRequest.update({ where: { id }, data: { status: 'draft', decidedAt: null } })
      })
    } else {
      throw bad('Unknown action. Use: save, submit, approve, reject, cancel, reopen')
    }

    // The write and its audit row have committed; the bell cannot undo them, a
    // failed one comes back as a warning for the screen.
    const warning = await requestChanged(ORG_ID, action, after, actor, { remark: String(req.body.remark || '').trim() })
    return res.json({ success: true, data: hideMoney(req, after, MONEY.request), ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function prRemove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const id = String(req.query.id || '')
    let before
    await db.$transaction(async (tx) => {
      const pr = await lockRequest(tx, ORG_ID, id)
      before = pr
      // Anything that was ever sent keeps its record; cancel it instead.
      if (pr.status !== 'draft') throw conflict('Only a draft can be deleted — cancel it instead')
      if (!ownsOrAdmin(req, pr.requestedById)) throw forbidden(`Only ${pr.requestedByName} or an administrator can delete this draft`)
      await tx.approvalStep.deleteMany({ where: { organizationId: ORG_ID, documentType: DOC, documentId: id } })
      await tx.purchaseRequest.delete({ where: { id } })
      await auditIpd(req, ORG_ID, { action: 'delete', entityType: 'purchase.request', entityId: id, before }, tx)
    })
    return res.json({ success: true })
  } catch (e) {
    sendError(res, e, next)
  }
}
