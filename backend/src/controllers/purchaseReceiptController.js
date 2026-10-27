// Goods receipts (GRN) and the store's stock — reached through /api/purchase,
// dispatched here by purchaseController for these resources:
//
// GET    ?resource=receipts          list (search, orderId, status, startDate/endDate = received on, paging)
// GET    ?resource=receipt&id=       one receipt with its lines
// GET    ?resource=stock             every stocked item with what is on hand (search, categoryId, status, paging) + summary
// GET    ?resource=stock-item&id=    one item: its batches and its movements
// POST   {resource:'receipt'}        receive goods against an order
// PATCH  {resource:'receipt', action:'cancel'}   undo a receipt (administrator)
//
// What receiving does, in one transaction:
//   • the accepted goods become a stock batch (with batch no. and expiry) and a
//     movement in the ledger, in the item's stock unit (5 Box × 100 = 500 Piece)
//   • the order line's received quantity goes up; the order becomes "part
//     received" or "received"
//   • the item's last price becomes this order's price — the next request and
//     order start from it
// Rejected goods do not enter stock and stay due on the order.
//
// Every id from the request is checked against this hospital. Two receipts at
// once against one order take turns on the order's row lock, so together they
// can never accept more than was ordered; stock balances per item take turns
// on an advisory lock, taken in one fixed order so two receipts can never wait
// on each other. The store sees no money (lib/purchaseAccess hideMoney).
import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { round2 } from '../lib/money.js'
import { startOfToday, ymdInZone, dayRange, todayRange } from '../lib/dates.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { listResponse, getPagination, paginationMeta } from '../lib/pagination.js'
import { auditIpd } from '../inpatient/audit.js'
import { canReceive, canSeeStock, isAdmin, blank, validationError, sendError, hideMoney, seesMoney, MONEY } from '../lib/purchaseAccess.js'
import { itemSearchWhere } from '../lib/purchaseLines.js'
import { checkReceiptLine, statusAfterReceipts, expiryProblem, stockStatus, stockSummary, roundQty, unitCostOf, receivedAfterUndo } from '../lib/purchaseReceipts.js'
import { lockOrder, hospital } from './purchaseOrderController.js'
import { receiptChanged } from '../lib/purchaseNotify.js'

export const RECEIPT_READS = new Set(['receipts', 'receipt', 'stock', 'stock-item'])
export const RECEIPT_WRITES = new Set(['receipt'])

const RECEIVABLE = ['approved', 'sent', 'partly_received']
// Bought, but never on a shelf.
const NOT_STOCKED = ['service', 'licence', 'personnel']
const EXPIRING_DAYS = 60
// A receipt of many lines does many writes; give it room on a slow database.
const TX = { maxWait: 10000, timeout: 30000 }
const SOON_MINUTES = 5 * 60000

const qty = (label) => z.preprocess((v) => (blank(v) ? 0 : Number(v)),
  z.number({ invalid_type_error: `${label} must be a number` }).finite().min(0, `${label} cannot be below 0`).max(1e7, `${label} is too large`).transform(roundQty))
const optDate = z.preprocess((v) => (blank(v) ? null : v), z.coerce.date({ invalid_type_error: 'Enter a valid date' }).nullable().optional())
const optText = (max) => z.preprocess((v) => (blank(v) ? null : String(v).trim()), z.string().max(max).nullable().optional())

const receiptSchema = z.object({
  orderId: z.string().min(1, 'Choose the order the goods came against'),
  receivedAt: optDate,
  challanNumber: optText(60),
  challanDate: optDate,
  notes: optText(500),
  lines: z.array(z.object({
    orderLineId: z.string().min(1),
    receivedQty: qty('Received'),
    rejectedQty: qty('Rejected'),
    rejectReason: optText(200),
    // Quality inspection: passed (into stock) | hold (set aside) | failed.
    qualityStatus: z.enum(['passed', 'hold', 'failed']).optional().default('passed'),
    // Whether this lot may be sent back to the vendor (a return lot) or not.
    returnLot: z.preprocess((v) => v !== false && v !== 'false', z.boolean()).optional().default(true),
    batchNumber: optText(40),
    expiryDate: optDate,
  })).min(1, 'Nothing to receive').max(300),
})

/** The item's whole stock, read inside the transaction (after its lock). Returns use it too. */
export async function onHand(tx, ORG_ID, itemId) {
  const s = await tx.stockBatch.aggregate({ where: { organizationId: ORG_ID, itemId }, _sum: { quantity: true } })
  return s._sum.quantity || 0
}

/**
 * Locks the stock of these items for the rest of the transaction, so each
 * ledger balance is worked out on the latest figure. Always in sorted order:
 * two receipts holding X and Y in opposite orders would otherwise wait on each
 * other forever.
 */
async function lockItems(tx, itemIds) {
  for (const id of [...new Set(itemIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock:' + id}))`
  }
}

const RECEIPT_INCLUDE = {
  lines: { orderBy: { itemName: 'asc' } },
  order: { select: { id: true, number: true, status: true } },
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function grnGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query

    if (resource === 'receipts') {
      const { search, orderId, status, startDate, endDate } = req.query
      const where = { organizationId: ORG_ID }
      if (orderId) where.orderId = String(orderId)
      if (status && status !== 'all') where.status = String(status)
      // Whole calendar days in the hospital's zone: "received today" is the
      // same day the dashboard counts (stockFigures).
      if (startDate || endDate) where.receivedAt = dayRange(startDate, endDate)
      const term = String(search || '').trim()
      if (term) {
        where.OR = [
          { number: { contains: term, mode: 'insensitive' } },
          { vendorName: { contains: term, mode: 'insensitive' } },
          { challanNumber: { contains: term, mode: 'insensitive' } },
          { order: { number: { contains: term, mode: 'insensitive' } } },
          { lines: { some: { itemName: { contains: term, mode: 'insensitive' } } } },
        ]
      }
      const body = await listResponse(db.goodsReceipt, {
        where, req, orderBy: [{ receivedAt: 'desc' }, { number: 'desc' }],
        include: { order: { select: { number: true } }, _count: { select: { lines: true } } },
      })
      body.data = body.data.map(({ _count, ...r }) => hideMoney(req, { ...r, lineCount: _count.lines }, MONEY.receipt))
      return res.json(body)
    }

    if (resource === 'receipt') {
      const r = await db.goodsReceipt.findFirst({ where: { id: String(req.query.id || ''), organizationId: ORG_ID }, include: RECEIPT_INCLUDE })
      if (!r) return res.status(404).json({ success: false, error: 'Goods receipt not found' })
      // with the hospital, for the printed GRN
      return res.json({ success: true, data: hideMoney(req, { ...r, hospital: await hospital(ORG_ID) }, MONEY.receipt) })
    }

    if ((resource === 'stock' || resource === 'stock-item') && !canSeeStock(req)) {
      return res.status(403).json({ success: false, error: 'The stock list is the store\'s and the purchase officer\'s' })
    }

    if (resource === 'stock') return res.json(await stockList(req, ORG_ID))

    if (resource === 'stock-item') {
      const id = String(req.query.id || '')
      const item = await db.item.findFirst({
        where: { id, organizationId: ORG_ID },
        select: {
          id: true, code: true, name: true, reorderLevel: true, isActive: true, purchaseType: true,
          category: { select: { name: true } }, stockUnit: { select: { code: true, name: true } },
          conversions: { select: { factor: true, isPurchaseDefault: true, unit: { select: { code: true } } } },
        },
      })
      if (!item) return res.status(404).json({ success: false, error: 'Item not found' })
      const [batches, movements] = await Promise.all([
        db.stockBatch.findMany({
          where: { organizationId: ORG_ID, itemId: id }, orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
          include: { receiptLines: { select: { receipt: { select: { id: true, number: true } } } } },
        }),
        db.stockMovement.findMany({ where: { organizationId: ORG_ID, itemId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      ])
      const onHandQty = roundQty(batches.reduce((s, b) => s + b.quantity, 0))
      const data = {
        ...item, onHand: onHandQty,
        value: round2(batches.reduce((s, b) => s + b.quantity * b.unitCost, 0)),
        status: stockStatus({ onHand: onHandQty, reorderLevel: item.reorderLevel, everReceived: batches.length > 0 }),
        // Batches still holding stock first (soonest expiry first), emptied ones after.
        batches: batches
          .map(({ receiptLines, ...b }) => ({ ...b, value: round2(b.quantity * b.unitCost), receipt: receiptLines[0]?.receipt || null }))
          .sort((a, b) => (b.quantity > 0) - (a.quantity > 0)),
        movements,
      }
      return res.json({ success: true, data: hideMoney(req, data, MONEY.stock) })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (e) {
    sendError(res, e, next)
  }
}

/**
 * Every stocked item of this hospital with what is on hand and its state —
 * the one place stock is summed and judged, so the Stock tab (tiles and list)
 * and the dashboard's tiles count the same rows. Batches pile up for years, so
 * they are summed per item in the database; the catalogue (a few thousand
 * items at most) is read whole, so it can be filtered by state — low, out,
 * expiring — and paged like any list. A retired item still holding stock
 * stays on the list until its stock is gone.
 */
async function stockRows(ORG_ID, { search, categoryId } = {}) {
  const sums = await db.$queryRaw`
    SELECT "itemId",
      COALESCE(SUM("quantity"), 0)::float AS "onHand",
      COALESCE(SUM("quantity" * "unitCost"), 0)::float AS "value",
      MIN("expiryDate") FILTER (WHERE "quantity" > 0) AS "nearestExpiry",
      BOOL_OR("quantity" > 0) AS "holding"
    FROM "StockBatch" WHERE "organizationId" = ${ORG_ID} GROUP BY "itemId"`
  const byItem = new Map(sums.map((s) => [s.itemId, s]))
  const holding = sums.filter((s) => s.holding).map((s) => s.itemId)
  const where = itemSearchWhere({ organizationId: ORG_ID }, { search, categoryId })
  where.AND = [...(where.AND || []), { OR: [{ isActive: true, purchaseType: { notIn: NOT_STOCKED } }, { id: { in: holding } }] }]
  const items = await db.item.findMany({
    where, orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, isActive: true, reorderLevel: true, category: { select: { name: true } }, stockUnit: { select: { code: true } } },
  })

  const soon = new Date(startOfToday().getTime() + EXPIRING_DAYS * 86400000)
  return items.map((i) => {
    const a = byItem.get(i.id)
    const onHandQty = roundQty(a?.onHand)
    return {
      ...i, onHand: onHandQty, value: round2(a?.value), nearestExpiry: a?.nearestExpiry || null,
      expiringSoon: !!(a?.nearestExpiry && a.nearestExpiry <= soon),
      status: stockStatus({ onHand: onHandQty, reorderLevel: i.reorderLevel, everReceived: !!a }),
    }
  })
}

async function stockList(req, ORG_ID) {
  const { search, categoryId, status } = req.query
  const rows = await stockRows(ORG_ID, { search, categoryId })
  const money = seesMoney(req)
  const summary = stockSummary(rows)
  if (!money) delete summary.value
  const filtered = status === 'in_stock' ? rows.filter((r) => r.onHand > 0)
    : status === 'expiring' ? rows.filter((r) => r.expiringSoon).sort((a, b) => a.nearestExpiry - b.nearestExpiry)
      : ['low', 'out'].includes(status) ? rows.filter((r) => r.status === status)
        : rows
  const { page, limit, skip } = getPagination(req.query)
  const data = filtered.slice(skip, skip + limit).map((r) => {
    if (money) return r
    const { value, ...rest } = r
    return rest
  })
  return { success: true, data, pagination: paginationMeta(page, limit, filtered.length), meta: { total: filtered.length }, summary }
}

/** The landing page's store figures. Quantities only, so every role may see them. */
export async function stockFigures(ORG_ID) {
  const [toReceive, receivedToday, rows] = await Promise.all([
    db.purchaseOrder.count({ where: { organizationId: ORG_ID, status: { in: ['approved', 'sent', 'partly_received'] } } }),
    // Today as the receipts list filters it, so the tile is what its click lists.
    db.goodsReceipt.count({ where: { organizationId: ORG_ID, status: 'posted', receivedAt: todayRange() } }),
    stockRows(ORG_ID),
  ])
  // Counted from the Stock tab's own rows: Low Stock and Expiring Soon are
  // exactly what those tiles list.
  const { low, expiring, value } = stockSummary(rows)
  return {
    toReceive,
    receivedToday,
    expiringItems: expiring,
    belowReorder: low,
    // What the shelf is worth at purchase price, before GST. Money: the
    // dashboard leaves it out for the store.
    value,
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function grnCreate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canReceive(req)) throw forbidden('Only store and purchase staff receive goods')
    const parsed = receiptSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const { orderId, challanNumber, challanDate, notes, lines } = parsed.data
    const now = new Date()
    const receivedAt = parsed.data.receivedAt || now
    if (receivedAt > new Date(now.getTime() + SOON_MINUTES)) throw bad('The received date cannot be in the future')
    // A challan carries a day, not a time: compare calendar days in the
    // hospital's zone. As instants, "today" (midnight UTC = 05:30 IST) was
    // "in the future" for a delivery taken in before 05:30.
    if (challanDate && ymdInZone(challanDate) > ymdInZone(now)) throw bad('The challan date cannot be in the future')
    if (challanDate && ymdInZone(challanDate) > ymdInZone(receivedAt)) throw bad('The challan date cannot be after the goods arrived')
    const today = startOfToday()
    const actor = getActor(req)

    const grn = await db.$transaction(async (tx) => {
      const po = await lockOrder(tx, ORG_ID, orderId, { lineInclude: { unit: { select: { allowsFraction: true } } } })
      if (!RECEIVABLE.includes(po.status)) {
        throw conflict(po.status === 'received' ? `Everything on ${po.number} has been received`
          : po.status === 'closed' ? `${po.number} is closed — the rest is not coming`
            : `Goods are received only on an approved order — ${po.number} is ${po.status.replace('_', ' ')}`)
      }
      // The same delivery entered twice is the commonest store mistake.
      if (challanNumber) {
        const twin = await tx.goodsReceipt.findFirst({
          where: { organizationId: ORG_ID, orderId: po.id, status: 'posted', challanNumber: { equals: challanNumber, mode: 'insensitive' } },
          select: { number: true },
        })
        if (twin) throw conflict(`Challan ${challanNumber} is already received on ${twin.number}`)
      }

      const byId = new Map(po.lines.map((l) => [l.id, l]))
      const seen = new Set()
      const rows = []
      for (const l of lines) {
        const ol = byId.get(l.orderLineId)
        if (!ol) throw bad('A line is not on this order — reload the order and try again')
        if (seen.has(ol.id)) throw bad(`${ol.itemName} is on the receipt twice`)
        seen.add(ol.id)
        if (!(l.receivedQty > 0) && !(l.rejectedQty > 0)) continue // did not come this time
        const check = checkReceiptLine({ orderLine: ol, receivedQty: l.receivedQty, rejectedQty: l.rejectedQty, rejectReason: l.rejectReason, wholeOnly: !ol.unit.allowsFraction })
        if (check.error) throw bad(check.error)
        const accepted = roundQty(check.accepted)
        if (accepted > 0 && expiryProblem(l.expiryDate, today)) {
          throw bad(`${ol.itemName}: ${l.batchNumber ? `batch ${l.batchNumber}` : 'this batch'} has already expired — reject it instead of accepting it`)
        }
        rows.push({ ol, l, accepted, stockQty: roundQty(accepted * (ol.unitFactor || 1)), unitCost: unitCostOf(ol) })
      }
      if (!rows.length) throw bad('Enter how much arrived on at least one line')

      // Reconcile check: this receipt reconciles when nothing was rejected and
      // every line passed quality inspection (what arrived matched the order).
      const reconciled = rows.every((r) => !(r.l.rejectedQty > 0) && (r.l.qualityStatus || 'passed') === 'passed')

      const number = await nextSeriesNumber(tx, ORG_ID, 'PURCHASE_GRN', 'GRN')
      const receipt = await tx.goodsReceipt.create({
        data: {
          organizationId: ORG_ID, number, orderId: po.id, vendorId: po.vendorId, vendorName: po.vendorName,
          receivedAt, challanNumber: challanNumber || null, challanDate: challanDate || null,
          receivedById: actor.id, receivedByName: actor.name || 'Staff', notes: notes || null,
          totalValue: round2(rows.reduce((s, r) => s + r.stockQty * r.unitCost, 0)),
          reconciled,
        },
      })

      await lockItems(tx, rows.filter((r) => r.stockQty > 0).map((r) => r.ol.itemId))
      for (const { ol, l, accepted, stockQty, unitCost } of rows) {
        let batchId = null
        if (stockQty > 0) {
          const before = await onHand(tx, ORG_ID, ol.itemId)
          const batch = await tx.stockBatch.create({
            data: {
              organizationId: ORG_ID, itemId: ol.itemId, batchNumber: l.batchNumber || null, expiryDate: l.expiryDate || null,
              quantity: stockQty, receivedQty: stockQty, unitCost, receivedAt,
            },
          })
          batchId = batch.id
          await tx.stockMovement.create({
            data: {
              organizationId: ORG_ID, itemId: ol.itemId, batchId, type: 'receipt', quantity: stockQty, balanceAfter: roundQty(before + stockQty),
              reference: number, referenceId: receipt.id, note: `From ${po.vendorName} on ${po.number}`, createdById: actor.id, createdByName: actor.name,
            },
          })
          // The next request and order for this item start from this price —
          // unless a later delivery has already set a newer one.
          await tx.item.updateMany({
            where: { id: ol.itemId, organizationId: ORG_ID, OR: [{ lastPurchaseDate: null }, { lastPurchaseDate: { lte: receivedAt } }] },
            data: { lastPurchasePrice: unitCost, lastPurchaseDate: receivedAt },
          })
        }
        await tx.goodsReceiptLine.create({
          data: {
            organizationId: ORG_ID, receiptId: receipt.id, orderLineId: ol.id,
            itemId: ol.itemId, itemCode: ol.itemCode, itemName: ol.itemName, unitId: ol.unitId, unitCode: ol.unitCode, unitFactor: ol.unitFactor,
            receivedQty: l.receivedQty, acceptedQty: accepted, rejectedQty: l.rejectedQty || 0,
            rejectReason: l.rejectedQty > 0 ? l.rejectReason : null,
            qualityStatus: l.qualityStatus || 'passed', returnLot: l.returnLot !== false,
            batchNumber: l.batchNumber || null, expiryDate: l.expiryDate || null,
            rate: round2(unitCost * (ol.unitFactor || 1)), stockQty, batchId,
          },
        })
        if (accepted > 0) await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { receivedQty: roundQty(ol.receivedQty + accepted) } })
      }

      const after = await tx.purchaseOrderLine.findMany({ where: { orderId: po.id }, select: { quantity: true, receivedQty: true } })
      const status = statusAfterReceipts(po, after)
      if (status !== po.status) await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } })
      // Read back before the commit, so the answer is what was committed: read
      // after it, a dropped connection answered 500 for goods already in stock,
      // and the store would receive them again.
      const created = await tx.goodsReceipt.findFirst({ where: { id: receipt.id, organizationId: ORG_ID }, include: RECEIPT_INCLUDE })
      // In the transaction: goods taken into stock with no record of it are not.
      await auditIpd(req, ORG_ID, { action: 'create', entityType: 'purchase.receipt', entityId: created.id, after: created }, tx)
      return created
    }, TX)
    // Committed; the bell cannot undo it, a failed one comes back as a warning.
    const warning = await receiptChanged(ORG_ID, 'create', grn, actor)
    return res.status(201).json({ success: true, data: hideMoney(req, grn, MONEY.receipt), ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

/**
 * A receipt whose goods left the store on another document is not undone
 * (CLAUDE.md: undoing a document without its dependants): returns to the
 * vendor — posted, or waiting for approval (approving one later would take
 * goods this cancel had already taken) — and store issues to departments,
 * found by the batches this receipt made. Each is named, so the administrator
 * knows what to undo first. The batch-quantity check below still catches stock
 * that left any other way.
 */
async function refuseIfDependants(tx, ORG_ID, grn) {
  const batchIds = grn.lines.map((l) => l.batchId).filter(Boolean)
  if (!batchIds.length) return
  const [returns, issues] = await Promise.all([
    tx.purchaseReturn.findMany({
      where: { organizationId: ORG_ID, status: { in: ['posted', 'pending_approval'] }, lines: { some: { batchId: { in: batchIds } } } },
      select: { number: true, status: true }, orderBy: { number: 'asc' },
    }),
    tx.storeIssue.findMany({
      where: { organizationId: ORG_ID, status: 'posted', lines: { some: { batchId: { in: batchIds } } } },
      select: { number: true }, orderBy: { number: 'asc' },
    }),
  ])
  const parts = []
  if (returns.length) parts.push(`sent back to the vendor on ${returns.map((r) => `${r.number}${r.status === 'pending_approval' ? ' (waiting for approval — reject it)' : ''}`).join(', ')}`)
  if (issues.length) parts.push(`issued to departments on ${issues.map((i) => i.number).join(', ')}`)
  if (parts.length) throw conflict(`${grn.number} cannot be undone: goods from it were ${parts.join(' and ')} — cancel ${returns.length + issues.length === 1 ? 'that' : 'those'} first`)
}

export async function grnUpdate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const id = String(req.body.id || '')
    if (req.body.action !== 'cancel') throw bad('Unknown action. Use: cancel')
    if (!isAdmin(req)) throw forbidden('Only an administrator cancels a goods receipt')
    const reason = String(req.body.reason || '').trim().slice(0, 300)
    if (reason.length < 3) throw bad('Say why the receipt is cancelled')
    const actor = getActor(req)
    let before

    const full = await db.$transaction(async (tx) => {
      // The order first, as receiving does, so a cancel and a receipt on the
      // same order take turns instead of waiting on each other.
      const head = await tx.goodsReceipt.findFirst({ where: { id, organizationId: ORG_ID }, select: { orderId: true } })
      if (!head) throw notFound('Goods receipt not found')
      const po = await lockOrder(tx, ORG_ID, head.orderId)
      await tx.$executeRaw`SELECT 1 FROM "GoodsReceipt" WHERE "id" = ${id} AND "organizationId" = ${ORG_ID} FOR UPDATE`
      const grn = await tx.goodsReceipt.findFirst({ where: { id, organizationId: ORG_ID }, include: { lines: true } })
      before = grn
      if (grn.status !== 'posted') throw conflict(`${grn.number} is already ${grn.status}`)
      await refuseIfDependants(tx, ORG_ID, grn)

      await lockItems(tx, grn.lines.filter((l) => l.stockQty > 0).map((l) => l.itemId))
      const received = new Map(po.lines.map((l) => [l.id, l.receivedQty]))
      for (const line of grn.lines) {
        if (line.stockQty > 0) {
          const batch = line.batchId ? await tx.stockBatch.findFirst({ where: { id: line.batchId, organizationId: ORG_ID } }) : null
          const left = batch?.quantity || 0
          if (left < line.stockQty - 1e-9) {
            throw conflict(`${line.itemName}: ${roundQty(line.stockQty - left)} of the ${line.stockQty} received has already left the store — the receipt cannot be undone`)
          }
          const was = await onHand(tx, ORG_ID, line.itemId)
          await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity: roundQty(left - line.stockQty) } })
          await tx.stockMovement.create({
            data: {
              organizationId: ORG_ID, itemId: line.itemId, batchId: batch.id, type: 'receipt_cancel', quantity: -line.stockQty,
              balanceAfter: roundQty(was - line.stockQty), reference: grn.number, referenceId: grn.id,
              note: `Receipt cancelled: ${reason}`, createdById: actor.id, createdByName: actor.name,
            },
          })
        }
        if (line.acceptedQty > 0) {
          // A receipt is made from its own order's lines (an order that has
          // goods never loses a line), so a line missing from the order — like
          // a received count below what this receipt accepted
          // (lib/purchaseReceipts receivedAfterUndo) — means the ledger was
          // changed outside Purchase: refuse, and the whole cancel rolls back,
          // rather than write a guessed 0, or write it on another order's line.
          const ol = po.lines.find((x) => x.id === line.orderLineId)
          if (!ol) throw conflict(`${grn.number}: its ${line.itemName} line is not on ${po.number} — the receipt and its order do not agree, so it cannot be undone. Nothing was changed.`)
          const next = receivedAfterUndo(received.get(ol.id), line.acceptedQty)
          if (next === null) {
            throw conflict(`${grn.number}: ${po.number} shows ${received.get(ol.id)} ${line.unitCode} of ${line.itemName} received, less than the ${line.acceptedQty} this receipt accepted — the order and its receipts do not agree, so it cannot be undone. Nothing was changed.`)
          }
          // Goods the vendor has billed (and Finance may pay) cannot leave the
          // order's received count: the bill would be for goods never received.
          if ((ol.billedQty || 0) > next + 1e-9) {
            const bills = await tx.vendorBill.findMany({
              where: { organizationId: ORG_ID, status: { in: ['on_hold', 'approved'] }, lines: { some: { orderLineId: line.orderLineId } } },
              select: { number: true },
            })
            throw conflict(`${line.itemName}: ${ol.billedQty} ${ol.unitCode} is on vendor bill ${bills.map((b) => b.number).join(', ') || 'a bill'} — cancel or reject that bill before undoing this receipt`)
          }
          received.set(line.orderLineId, next)
          await tx.purchaseOrderLine.update({ where: { id: line.orderLineId }, data: { receivedQty: next } })
        }
      }
      await tx.goodsReceipt.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledByName: actor.name || 'Administrator', cancelReason: reason } })
      const status = statusAfterReceipts(po, po.lines.map((l) => ({ quantity: l.quantity, receivedQty: received.get(l.id) })))
      if (status !== po.status) await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } })
      // Read back before the commit — see grnCreate.
      const after = await tx.goodsReceipt.findFirst({ where: { id, organizationId: ORG_ID }, include: RECEIPT_INCLUDE })
      await auditIpd(req, ORG_ID, { action: 'cancel', entityType: 'purchase.receipt', entityId: id, before, after }, tx)
      return after
    }, TX)
    // Committed; the bell cannot undo it, a failed one comes back as a warning.
    const warning = await receiptChanged(ORG_ID, 'cancel', full, actor, { reason })
    return res.json({ success: true, data: hideMoney(req, full, MONEY.receipt), ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}
