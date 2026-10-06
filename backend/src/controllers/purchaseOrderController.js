// Purchase orders (PO) — reached through /api/purchase, dispatched here by
// purchaseController for these resources:
//
// GET    ?resource=orders             list (status, vendorId, search, view=to-approve|mine|to-send, paging)
// GET    ?resource=order&id=          one order: lines (with the request each came from), vendor, approval steps
// GET    ?resource=order-candidates   approved request lines not yet on an order (requestId= narrows to one request)
// POST   {resource:'order'}           a new DRAFT
// PATCH  {resource:'order', action}   save | submit | approve | reject | cancel | reopen | send | close
// DELETE ?resource=order&id=          a draft that was never sent for approval
//
// The life of an order:
//   draft ─submit→ submitted ─approve (every level)→ approved ─send→ sent
//                      └─reject→ rejected ─reopen→ draft
//   draft / submitted / approved / sent ─cancel→ cancelled   (only before anything is received)
//   approved / sent ─goods received (GRN)→ partly_received → received
//   partly_received ─close→ closed   (the vendor will not supply the rest)
//
// Placing, sending and closing orders is for those who set prices (admin,
// purchase officer); the store sees orders without their money (lib/purchaseAccess).
//
// The rules it keeps, each tested in scripts and the browser:
//  • Every id comes from the request body, so every one is checked against this
//    hospital: vendor, items, units, request lines.
//  • The price and the GST are settled here. GST follows the vendor: none when
//    it is not GST-registered, CGST + SGST in the hospital's state, IGST outside.
//  • An approved request line goes on one live order only. A cancelled order
//    frees its lines; the request goes back from "ordered" to "approved".
//  • Two people acting at once (approve twice, submit and cancel) take turns on
//    a row lock; two orders claiming the same request line take turns too.
//  • Money approval: the hospital's PO rules (Settings → Approval rules), by total.
import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { startOfToday } from '../lib/dates.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { listResponse } from '../lib/pagination.js'
import { round2 } from '../lib/money.js'
import { auditIpd } from '../inpatient/audit.js'
import { stateCodeByName } from '../lib/gst.js'
import { canOrder, isAdmin, ownsOrAdmin, othersDraftsHidden, blank, validationError, sendError, hideMoney, MONEY, seesEverything, STORE_ORDER_STATUSES } from '../lib/purchaseAccess.js'
import { resolveLines } from '../lib/purchaseLines.js'
import { gstTypeFor, lineAmounts, orderTotals, GST_RATES } from '../lib/purchaseOrders.js'
import { currentStep, decide, openSteps, cancelSteps, stepsOf, awaitingFor } from '../lib/approvals.js'
import { orderChanged } from '../lib/purchaseNotify.js'
import { billableOf } from '../lib/vendorBills.js'
// Its own functions call back into this file's lockOrder / hospital; the
// cycle is safe because both sides only call each other at run time.
import { withReturnsOnBills } from './purchaseReturnController.js'

const DOC = 'PO'
export const PO_READS = new Set(['orders', 'order', 'order-candidates'])
export const PO_WRITES = new Set(['order'])

// Statuses in which an order holds its request lines (all but cancelled).
// The request detail lists the orders a line is on from the same list.
export const HOLDING = ['draft', 'submitted', 'approved', 'sent', 'partly_received', 'received', 'closed', 'rejected']

const num = (label, { min = 0, max = 1e9 } = {}) => z.preprocess((v) => (blank(v) ? undefined : Number(v)),
  z.number({ invalid_type_error: `${label} must be a number` }).finite().min(min, `${label} cannot be below ${min}`).max(max, `${label} is too large`).optional())

const lineSchema = z.object({
  itemId: z.string().min(1, 'Choose an item on every line'),
  unitId: z.string().optional().nullable(),
  quantity: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number({ required_error: 'Enter a quantity on every line', invalid_type_error: 'Quantity must be a number' })
      .finite().positive('Quantity must be more than 0').max(1e7, 'Quantity is too large')),
  rate: num('Rate'),
  discountPct: num('Discount', { max: 100 }),
  gstRate: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number().refine((v) => GST_RATES.includes(v), `GST must be one of ${GST_RATES.join(', ')}%`).optional()),
  requestLineId: z.string().optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
})
const headerFields = {
  vendorId: z.string().min(1, 'Choose the vendor'),
  expectedDate: z.preprocess((v) => (blank(v) ? null : v), z.coerce.date({ invalid_type_error: 'Enter a valid date' }).nullable().optional()),
  terms: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  lines: z.array(lineSchema).min(1, 'Add at least one item').max(200, 'At most 200 lines on one order'),
}
const createSchema = z.object(headerFields)
const saveSchema = z.object({ id: z.string().min(1), ...headerFields }).partial({ vendorId: true, lines: true })

const ORDER_INCLUDE = {
  vendor: { select: { id: true, code: true, name: true, gstNumber: true, stateCode: true, phone: true, email: true, contactPerson: true, houseNumber: true, street: true, locality: true, city: true, district: true, pincode: true, paymentTermsDays: true, msmeNumber: true } },
  lines: {
    orderBy: { sortOrder: 'asc' },
    include: {
      requestLine: { select: { id: true, request: { select: { id: true, number: true } } } },
      // whether the receiving screen may take 2.5 of it
      unit: { select: { allowsFraction: true } },
      // the unit stock is kept in, so receiving can say 5 BOX = 500 PCS
      item: { select: { stockUnit: { select: { code: true } } } },
    },
  },
  // The goods receipts against it — what has come in.
  receipts: { orderBy: { receivedAt: 'desc' }, select: { id: true, number: true, status: true, receivedAt: true, receivedByName: true, challanNumber: true } },
}

/** The hospital's GST state and name/address, for GST and the printed PO. */
/** The hospital as a printed document names it, with its GST state. `client` is a transaction when read inside one. */
export async function hospital(ORG_ID, client = db) {
  const org = await client.organization.findUnique({ where: { id: ORG_ID }, select: { name: true, address: true, city: true, region: true } })
  return { ...org, stateCode: stateCodeByName(org?.region) }
}

const defaultTerms = (h) => [
  `Deliver to ${h?.name || 'the hospital'} stores${h?.address ? `, ${h.address}` : ''}.`,
  'Quote this PO number on the invoice and the delivery challan.',
  'Goods are accepted after inspection on receipt; short or damaged supply will be returned.',
].join('\n')

export async function checkVendor(ORG_ID, vendorId, { allowRetired = false } = {}) {
  const v = await db.vendor.findFirst({ where: { id: vendorId, organizationId: ORG_ID } })
  if (!v) throw bad('Choose the vendor from the list')
  if (!v.isActive && !allowRetired) throw bad(`${v.name} is retired — choose another vendor`)
  return v
}

/** Typed lines → rows to store, priced and taxed for this vendor's GST type. */
export async function buildLines(ORG_ID, lines, gstType) {
  const resolved = await resolveLines(db, ORG_ID, lines, { noun: 'order' })
  return resolved.map(({ line: l, item, unit }, i) => {
    // A rate not typed starts at the last price paid (per stock unit, scaled to this unit).
    // Rounded to paisa BEFORE the amounts, so the printed rate × quantity is
    // the amount (₹0.999999 used to print as ₹1.00 against ₹9,999.99 for 10,000).
    const rate = round2(l.rate ?? (item.lastPurchasePrice != null ? item.lastPurchasePrice * unit.factor : 0))
    const gstRate = gstType === 'none' ? 0 : (l.gstRate ?? item.gstRate)
    const amounts = lineAmounts({ quantity: l.quantity, rate, discountPct: l.discountPct ?? 0, gstRate }, gstType)
    return {
      organizationId: ORG_ID,
      itemId: item.id, itemCode: item.code, itemName: item.name, hsnCode: item.hsnCode,
      unitId: unit.id, unitCode: unit.code, unitFactor: unit.factor,
      quantity: l.quantity, rate, discountPct: l.discountPct ?? 0, gstRate,
      ...amounts,
      requestLineId: l.requestLineId || null,
      note: blank(l.note) ? null : l.note.trim(),
      sortOrder: i,
    }
  })
}

/**
 * The request lines these rows fill must be this hospital's, approved, for the
 * same item, and not already on another live order. Locked for the rest of the
 * transaction so two orders cannot claim the same line at once.
 */
async function claimRequestLines(tx, ORG_ID, rows, orderId = null) {
  const ids = [...new Set(rows.map((r) => r.requestLineId).filter(Boolean))]
  if (!ids.length) return []
  await tx.$executeRaw`SELECT 1 FROM "PurchaseRequestLine" WHERE "id" = ANY(${ids}) AND "organizationId" = ${ORG_ID} FOR UPDATE`
  const found = await tx.purchaseRequestLine.findMany({
    where: { id: { in: ids }, organizationId: ORG_ID },
    include: {
      request: { select: { id: true, number: true, status: true } },
      orderLines: { where: { order: { status: { in: HOLDING } }, ...(orderId ? { orderId: { not: orderId } } : {}) }, select: { order: { select: { number: true } } } },
    },
  })
  const byId = new Map(found.map((f) => [f.id, f]))
  for (const r of rows.filter((x) => x.requestLineId)) {
    const rl = byId.get(r.requestLineId)
    if (!rl) throw bad(`${r.itemName}: the request line it fills was not found`)
    if (!['approved', 'ordered'].includes(rl.request.status)) throw conflict(`${rl.request.number} is ${rl.request.status} — only an approved request can be ordered`)
    if (rl.itemId !== r.itemId) throw bad(`${r.itemName} does not match the item on ${rl.request.number}`)
    if (rl.orderLines.length) throw conflict(`${r.itemName} from ${rl.request.number} is already on ${rl.orderLines[0].order.number}`)
  }
  return [...new Set(found.map((f) => f.request.id))]
}

/**
 * A request is "ordered" when every one of its lines is on a live order, and
 * back to "approved" when an order is cancelled and frees a line.
 */
async function syncRequests(tx, ORG_ID, requestIds) {
  for (const id of new Set(requestIds)) {
    const pr = await tx.purchaseRequest.findFirst({
      where: { id, organizationId: ORG_ID, status: { in: ['approved', 'ordered'] } },
      include: { lines: { select: { orderLines: { where: { order: { status: { in: HOLDING } } }, select: { id: true } } } } },
    })
    if (!pr) continue
    const all = pr.lines.length > 0 && pr.lines.every((l) => l.orderLines.length > 0)
    const status = all ? 'ordered' : 'approved'
    if (status !== pr.status) await tx.purchaseRequest.update({ where: { id }, data: { status } })
  }
}

/**
 * The order, row-locked for the rest of the transaction, so two changes to it
 * take turns. `lineInclude` adds to each line (a goods receipt needs its unit).
 */
export async function lockOrder(tx, ORG_ID, id, { lineInclude } = {}) {
  await tx.$executeRaw`SELECT 1 FROM "PurchaseOrder" WHERE "id" = ${id} AND "organizationId" = ${ORG_ID} FOR UPDATE`
  const po = await tx.purchaseOrder.findFirst({ where: { id, organizationId: ORG_ID }, include: { lines: lineInclude ? { include: lineInclude } : true } })
  if (!po) throw notFound('Purchase order not found')
  return po
}

function submitProblem(po) {
  if (!po.lines.length) return 'Add at least one item'
  const unpriced = po.lines.find((l) => !(l.rate > 0))
  if (unpriced) return `Enter the rate for ${unpriced.itemName} — an order is placed at a price`
  if (po.expectedDate && po.expectedDate < startOfToday()) return 'The expected date is in the past'
  return null
}

async function readFull(ORG_ID, id, client = db) {
  const po = await client.purchaseOrder.findFirst({ where: { id, organizationId: ORG_ID }, include: ORDER_INCLUDE })
  if (!po) return null
  // What each line can still be billed for — the bill's own rule (vendorBills
  // billableOf), so the screen never works it out from received − billed and
  // gets returned goods wrong.
  await withReturnsOnBills(client, ORG_ID, po.lines)
  for (const l of po.lines) l.billable = billableOf(l)
  const steps = await stepsOf(client, ORG_ID, DOC, id)
  return { ...po, steps, currentStep: currentStep(steps), hospital: await hospital(ORG_ID, client) }
}

/**
 * A new DRAFT order, inside the caller's transaction: claims the request lines
 * its rows fill (refusing one already on a live order, naming it), numbers it,
 * moves its requests to "ordered", writes its audit row, and reads it back.
 * `rows` come from buildLines() for this vendor's `gstType`. Placing an order
 * (poCreate) and awarding an RFQ (purchaseRfqController) both make orders here,
 * so an awarded RFQ's order is the same as one made by hand.
 */
export async function insertDraftOrder(tx, req, ORG_ID, { vendor, h, gstType, rows, expectedDate, terms, notes, actor }) {
  const requestIds = await claimRequestLines(tx, ORG_ID, rows)
  const number = await nextSeriesNumber(tx, ORG_ID, 'PURCHASE_PO', 'PO')
  const created = await tx.purchaseOrder.create({
    data: {
      organizationId: ORG_ID, number, status: 'draft',
      vendorId: vendor.id, vendorName: vendor.name, expectedDate: expectedDate ?? null,
      gstType, paymentTermsDays: vendor.paymentTermsDays,
      terms: blank(terms) ? defaultTerms(h) : terms, notes: blank(notes) ? null : notes,
      ...orderTotals(rows, gstType),
      createdById: actor.id, createdByName: actor.name || 'Staff',
      lines: { create: rows },
    },
  })
  await syncRequests(tx, ORG_ID, requestIds)
  await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.order', entityId: created.id, after: created }, tx)
  // Read back before the commit — see writeOrder.
  return readFull(ORG_ID, created.id, tx)
}

/**
 * Runs `work` and reads the order back in the same transaction, so a write
 * answers with exactly what it committed. Read after the commit, a dropped
 * connection answered 500 for an order that had changed (and the client may
 * repeat it), and a draft deleted in that moment answered null.
 * `audit(tx, after)` writes the audit row in the same transaction, so the
 * change and its record commit together or not at all.
 */
function writeOrder(ORG_ID, id, audit, work) {
  return db.$transaction(async (tx) => {
    await work(tx)
    const after = await readFull(ORG_ID, id, tx)
    await audit(tx, after)
    return after
  })
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function poGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const actor = getActor(req)
    const { resource } = req.query

    if (resource === 'orders') {
      const { status, vendorId, search, view } = req.query
      const where = { organizationId: ORG_ID }
      if (status && status !== 'all') where.status = { in: String(status).split(',') }
      if (vendorId) where.vendorId = String(vendorId)
      if (view === 'mine') where.createdById = actor.id ?? '__none__'
      if (view === 'to-send') where.status = 'approved'
      // What the store is waiting for: approved, and not all of it in yet.
      if (view === 'to-receive') where.status = { in: ['approved', 'sent', 'partly_received'] }
      // …and what has come in full, or stopped coming.
      if (view === 'received') where.status = { in: ['received', 'closed'] }
      if (view === 'to-approve') {
        where.id = { in: await awaitingFor(db, ORG_ID, DOC, actor, isAdmin(req)) }
        where.status = 'submitted'
        if (!isAdmin(req) && actor.id) where.createdById = { not: actor.id }
      }
      const term = String(search || '').trim()
      if (term) {
        where.OR = [
          { number: { contains: term, mode: 'insensitive' } },
          { vendorName: { contains: term, mode: 'insensitive' } },
          { lines: { some: { itemName: { contains: term, mode: 'insensitive' } } } },
        ]
      }
      // The store sees the orders it receives against, not drafts or approvals.
      if (!seesEverything(req)) where.AND = [...(where.AND || []), { status: { in: STORE_ORDER_STATUSES } }]
      // A draft is its maker's until it is sent (an administrator may look).
      where.AND = [...(where.AND || []), othersDraftsHidden(isAdmin(req), actor.id, 'createdById')]
      const body = await listResponse(db.purchaseOrder, { where, req, include: { _count: { select: { lines: true } } }, orderBy: { createdAt: 'desc' } })
      const ids = body.data.map((r) => r.id)
      const steps = ids.length ? await db.approvalStep.findMany({ where: { organizationId: ORG_ID, documentType: DOC, documentId: { in: ids } } }) : []
      body.data = body.data.map(({ _count, ...r }) => {
        const own = steps.filter((s) => s.documentId === r.id)
        return hideMoney(req, { ...r, lineCount: _count.lines, levels: own.length, currentStep: currentStep(own) }, MONEY.order)
      })
      return res.json(body)
    }

    if (resource === 'order') {
      const po = await readFull(ORG_ID, String(req.query.id || ''))
      const hidden = (!seesEverything(req) && !STORE_ORDER_STATUSES.includes(po?.status)) || (po?.status === 'draft' && !ownsOrAdmin(req, po.createdById))
      if (!po || hidden) return res.status(404).json({ success: false, error: 'Purchase order not found' })
      return res.json({ success: true, data: hideMoney(req, po, MONEY.order) })
    }

    if (resource === 'order-candidates') {
      if (!canOrder(req)) throw forbidden('Only the purchase officer or an administrator makes orders')
      // Approved request lines that no live order holds yet — what can be ordered.
      const where = {
        organizationId: ORG_ID,
        request: { status: 'approved', ...(req.query.requestId ? { id: String(req.query.requestId) } : {}) },
        orderLines: { none: { order: { status: { in: HOLDING } } } },
      }
      // The oldest 300 lines at most; `total` says how many are waiting, so the
      // screen can tell the officer the rest come next time.
      const total = await db.purchaseRequestLine.count({ where })
      const data = await db.purchaseRequestLine.findMany({
        where, orderBy: [{ request: { createdAt: 'asc' } }, { sortOrder: 'asc' }], take: 300,
        include: {
          request: { select: { id: true, number: true, priority: true, requiredBy: true, department: { select: { name: true } } } },
          item: {
            select: {
              id: true, name: true, code: true, gstRate: true, hsnCode: true, lastPurchasePrice: true,
              preferredVendor: { select: { id: true, name: true, code: true, isActive: true } },
            },
          },
        },
      })
      // The hospital's GST state rides along, so a form can show CGST + SGST or
      // IGST the moment a vendor is chosen, before anything is saved.
      return res.json({ success: true, data, meta: { total, hospitalStateCode: (await hospital(ORG_ID)).stateCode } })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (e) {
    sendError(res, e, next)
  }
}

/** The Purchase dashboard's order figures, for the signed-in person. */
export async function orderFigures(ORG_ID, actor, admin) {
  const waitingIds = await awaitingFor(db, ORG_ID, DOC, actor, admin)
  const notMine = !admin && actor.id ? { createdById: { not: actor.id } } : {}
  const [toApprove, toSend, open, readyToOrder, all, receivedOrders, completedOrders] = await Promise.all([
    waitingIds.length ? db.purchaseOrder.aggregate({ where: { organizationId: ORG_ID, status: 'submitted', id: { in: waitingIds }, ...notMine }, _count: { _all: true }, _sum: { total: true } }) : null,
    db.purchaseOrder.count({ where: { organizationId: ORG_ID, status: 'approved' } }),
    db.purchaseOrder.aggregate({ where: { organizationId: ORG_ID, status: { in: ['approved', 'sent', 'partly_received'] } }, _count: { _all: true }, _sum: { total: true } }),
    db.purchaseRequest.count({ where: { organizationId: ORG_ID, status: 'approved' } }),
    // Others' drafts are not counted, as the list leaves them out.
    db.purchaseOrder.count({ where: { organizationId: ORG_ID, AND: [othersDraftsHidden(admin, actor.id, 'createdById')] } }),
    db.purchaseOrder.count({ where: { organizationId: ORG_ID, status: { in: ['partly_received', 'received', 'closed'] } } }),
    db.purchaseOrder.count({ where: { organizationId: ORG_ID, status: { in: ['received', 'closed'] } } }),
  ])
  return {
    ordersToApprove: { count: toApprove?._count._all ?? 0, amount: toApprove?._sum.total ?? 0 },
    ordersToSend: toSend,
    openOrders: { count: open._count._all, amount: open._sum.total ?? 0 },
    requestsReadyToOrder: readyToOrder,
    allOrders: all,
    receivedOrders,
    completedOrders,
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function poCreate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canOrder(req)) throw forbidden('Only the purchase officer or an administrator places orders')
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const { vendorId, expectedDate, terms, notes, lines } = parsed.data
    const vendor = await checkVendor(ORG_ID, vendorId)
    if (expectedDate && expectedDate < startOfToday()) throw bad('The expected date is in the past')
    const h = await hospital(ORG_ID)
    const gstType = gstTypeFor(vendor, h.stateCode)
    const rows = await buildLines(ORG_ID, lines, gstType)
    const actor = getActor(req)

    const full = await db.$transaction((tx) => insertDraftOrder(tx, req, ORG_ID, { vendor, h, gstType, rows, expectedDate, terms, notes, actor }))
    return res.status(201).json({ success: true, data: full })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function poUpdate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { action } = req.body
    const id = String(req.body.id || '')
    const actor = getActor(req)
    let auditAction = action
    // `after` is the order as its transaction committed it (writeOrder).
    let before, after
    // Run inside that transaction, after `work` has set `before` and `auditAction`.
    const audit = (tx, committed) => auditIpd(req, ORG_ID, { action: auditAction, entityType: 'purchase.order', entityId: id, before, after: committed }, tx)

    if (action === 'save') {
      if (!canOrder(req)) throw forbidden('Only the purchase officer or an administrator changes orders')
      const parsed = saveSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const { vendorId, expectedDate, terms, notes, lines } = parsed.data
      if (expectedDate && expectedDate < startOfToday()) throw bad('The expected date is in the past')
      const h = await hospital(ORG_ID)

      after = await writeOrder(ORG_ID, id, audit, async (tx) => {
        const po = await lockOrder(tx, ORG_ID, id)
        before = po
        if (po.status !== 'draft') throw conflict(`This order is ${po.status} — only a draft can be changed`)
        if (!ownsOrAdmin(req, po.createdById)) throw forbidden(`Only ${po.createdByName} or an administrator can change this draft`)
        const vendor = vendorId ? await checkVendor(ORG_ID, vendorId) : await checkVendor(ORG_ID, po.vendorId, { allowRetired: true })
        const gstType = gstTypeFor(vendor, h.stateCode)
        // A new vendor changes the GST on every line, so the lines are rebuilt
        // from what is sent, or from what the order already holds.
        const source = lines || po.lines.map((l) => ({
          itemId: l.itemId, unitId: l.unitId, quantity: l.quantity, rate: l.rate, discountPct: l.discountPct,
          gstRate: l.gstRate, requestLineId: l.requestLineId, note: l.note,
        }))
        const rows = await buildLines(ORG_ID, source, gstType)
        const freed = po.lines.map((l) => l.requestLineId).filter(Boolean)
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: id, organizationId: ORG_ID } })
        const claimed = await claimRequestLines(tx, ORG_ID, rows, id)
        await tx.purchaseOrderLine.createMany({ data: rows.map((r) => ({ ...r, orderId: id })) })
        await tx.purchaseOrder.update({
          where: { id },
          data: {
            vendorId: vendor.id, vendorName: vendor.name, gstType, paymentTermsDays: vendor.paymentTermsDays,
            ...(expectedDate !== undefined ? { expectedDate } : {}),
            ...(terms !== undefined ? { terms: blank(terms) ? defaultTerms(h) : terms } : {}),
            ...(notes !== undefined ? { notes: blank(notes) ? null : notes } : {}),
            ...orderTotals(rows, gstType),
          },
        })
        // Lines dropped from the draft free their request; new ones claim theirs.
        const freedRequests = freed.length
          ? (await tx.purchaseRequestLine.findMany({ where: { id: { in: freed } }, select: { requestId: true } })).map((r) => r.requestId)
          : []
        await syncRequests(tx, ORG_ID, [...claimed, ...freedRequests])
      })
    } else if (action === 'submit') {
      if (!canOrder(req)) throw forbidden('Only the purchase officer or an administrator sends orders for approval')
      after = await writeOrder(ORG_ID, id, audit, async (tx) => {
        const po = await lockOrder(tx, ORG_ID, id)
        before = po
        if (po.status !== 'draft') throw conflict(`This order is already ${po.status}`)
        if (!ownsOrAdmin(req, po.createdById)) throw forbidden(`Only ${po.createdByName} or an administrator can send this order`)
        const problem = submitProblem(po)
        if (problem) throw bad(problem)
        await checkVendor(ORG_ID, po.vendorId)
        const levels = await openSteps(tx, ORG_ID, DOC, id, po.total)
        const now = new Date()
        await tx.purchaseOrder.update({
          where: { id },
          data: levels ? { status: 'submitted', submittedAt: now, decidedAt: null } : { status: 'approved', submittedAt: now, decidedAt: now },
        })
      })
    } else if (action === 'approve' || action === 'reject') {
      const remark = String(req.body.remark || '').trim().slice(0, 500)
      if (action === 'reject' && remark.length < 3) throw bad('Say why it is rejected — the buyer needs to know what to change')
      after = await writeOrder(ORG_ID, id, audit, async (tx) => {
        const po = await lockOrder(tx, ORG_ID, id)
        before = po
        if (po.status !== 'submitted') throw conflict(`This order is ${po.status} — there is nothing to ${action}`)
        const result = await decide(tx, ORG_ID, DOC, id, { actor, requestedById: po.createdById, approve: action === 'approve', remark })
        if (result.error) throw forbidden(result.error.replace('a request you raised', 'an order you made'))
        auditAction = `${action} level ${result.step.level}`
        if (result.outcome !== 'next') await tx.purchaseOrder.update({ where: { id }, data: { status: result.outcome, decidedAt: new Date() } })
      })
    } else if (action === 'send') {
      if (!canOrder(req)) throw forbidden('Only the purchase officer or an administrator sends orders to vendors')
      after = await writeOrder(ORG_ID, id, audit, async (tx) => {
        const po = await lockOrder(tx, ORG_ID, id)
        before = po
        if (po.status !== 'approved') throw conflict(po.status === 'sent' ? 'This order was already sent' : `Only an approved order can be sent — this one is ${po.status}`)
        await tx.purchaseOrder.update({ where: { id }, data: { status: 'sent', sentAt: new Date() } })
      })
    } else if (action === 'cancel') {
      const reason = String(req.body.reason || '').trim().slice(0, 300)
      after = await writeOrder(ORG_ID, id, audit, async (tx) => {
        const po = await lockOrder(tx, ORG_ID, id)
        before = po
        if (!['draft', 'submitted', 'approved', 'sent', 'rejected'].includes(po.status)) throw conflict(`A ${po.status.replace('_', ' ')} order cannot be cancelled`)
        if (po.lines.some((l) => l.receivedQty > 0)) throw conflict('Goods have been received against this order — it can no longer be cancelled')
        const bill = await tx.vendorBill.findFirst({ where: { organizationId: ORG_ID, orderId: id, status: { not: 'cancelled' } }, select: { number: true } })
        if (bill) throw conflict(`Vendor bill ${bill.number} is entered on this order — cancel or delete it first`)
        if (!canOrder(req) || !ownsOrAdmin(req, po.createdById)) throw forbidden(`Only ${po.createdByName} or an administrator can cancel this order`)
        if (po.status !== 'draft' && reason.length < 3) throw bad(po.status === 'sent' ? 'Say why it is cancelled — and tell the vendor' : 'Say why it is cancelled')
        await cancelSteps(tx, ORG_ID, DOC, id)
        await tx.purchaseOrder.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason || null } })
        const requestIds = (await tx.purchaseRequestLine.findMany({
          where: { id: { in: po.lines.map((l) => l.requestLineId).filter(Boolean) } }, select: { requestId: true },
        })).map((r) => r.requestId)
        await syncRequests(tx, ORG_ID, requestIds)
      })
    } else if (action === 'close') {
      // Part received, and the vendor will not send the rest: stop waiting.
      // What arrived stays; nothing more can be received against it.
      if (!canOrder(req)) throw forbidden('Only the purchase officer or an administrator closes orders')
      const reason = String(req.body.reason || '').trim().slice(0, 300)
      if (reason.length < 3) throw bad('Say why the rest will not come')
      after = await writeOrder(ORG_ID, id, audit, async (tx) => {
        const po = await lockOrder(tx, ORG_ID, id)
        before = po
        if (po.status !== 'partly_received') throw conflict(po.status === 'sent' || po.status === 'approved' ? 'Nothing has been received yet — cancel the order instead' : `A ${po.status.replace('_', ' ')} order cannot be closed`)
        await tx.purchaseOrder.update({ where: { id }, data: { status: 'closed', cancelReason: reason } })
      })
    } else if (action === 'reopen') {
      after = await writeOrder(ORG_ID, id, audit, async (tx) => {
        const po = await lockOrder(tx, ORG_ID, id)
        before = po
        if (po.status !== 'rejected') throw conflict('Only a rejected order can be reopened')
        if (!ownsOrAdmin(req, po.createdById)) throw forbidden(`Only ${po.createdByName} or an administrator can reopen this order`)
        await tx.purchaseOrder.update({ where: { id }, data: { status: 'draft', decidedAt: null } })
      })
    } else {
      throw bad('Unknown action. Use: save, submit, approve, reject, send, cancel, reopen, close')
    }

    // The write and its audit row have committed; the bell cannot undo them, a
    // failed one comes back as a warning for the screen.
    const words = String(req.body.remark || req.body.reason || '').trim()
    const warning = await orderChanged(ORG_ID, action, after, getActor(req), { remark: words, reason: words, wasStatus: before?.status })
    return res.json({ success: true, data: hideMoney(req, after, MONEY.order), ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function poRemove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const id = String(req.query.id || '')
    if (!canOrder(req)) throw forbidden('Only the purchase officer or an administrator deletes orders')
    let before
    await db.$transaction(async (tx) => {
      const po = await lockOrder(tx, ORG_ID, id)
      before = po
      if (po.status !== 'draft') throw conflict('Only a draft can be deleted — cancel it instead')
      if (!ownsOrAdmin(req, po.createdById)) throw forbidden(`Only ${po.createdByName} or an administrator can delete this draft`)
      const requestIds = (await tx.purchaseRequestLine.findMany({
        where: { id: { in: po.lines.map((l) => l.requestLineId).filter(Boolean) } }, select: { requestId: true },
      })).map((r) => r.requestId)
      await tx.approvalStep.deleteMany({ where: { organizationId: ORG_ID, documentType: DOC, documentId: id } })
      await tx.purchaseOrder.delete({ where: { id } })
      await syncRequests(tx, ORG_ID, requestIds)
      await auditIpd(req, ORG_ID, { action: 'delete', entityType: 'purchase.order', entityId: id, before }, tx)
    })
    return res.json({ success: true })
  } catch (e) {
    sendError(res, e, next)
  }
}
