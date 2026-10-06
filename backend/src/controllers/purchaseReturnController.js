// Returns to the vendor and their debit notes — reached through /api/purchase,
// dispatched here by purchaseController for these resources:
//
// GET    ?resource=returns                    list (search, status, view=pending|posted-month|rejected, orderId, paging) + summary
// GET    ?resource=return&id=                 one return with its lines, its order, receipt and bill
// GET    ?resource=returnables                orders with goods still on the shelf that can go back (search)
// GET    ?resource=returnables&orderId=       that order's batches: what each can still send back (receiptId narrows to one receipt)
// POST   {resource:'return'}                  raise a return (posted at once when the hospital runs returns "direct")
// PATCH  {resource:'return', action}          approve | reject (a return waiting) · cancel (a posted one, administrator)
//
// How returns run is the hospital's choice (Settings → Purchase, lib/purchaseSettings returnMode):
//   approval (default) — the store raises it → waiting; the purchase officer
//                        approves (posted) or rejects it with a reason. Nobody
//                        decides a return they raised (an administrator may).
//   direct             — the store's return is posted as it is raised.
//
// Posting, in one transaction (lib/purchaseReturns has the rules):
//   • the goods come off the batch they arrived on ('return' stock movement);
//     refused if the batch no longer holds them
//   • the order line's returned count goes up
//   • a debit note number (DN-…) is given, and the money settled: goods already
//     billed on a bill passed for payment → the debit note goes on that bill
//     (what is still to pay drops; below 0 the vendor owes, said so); goods not
//     billed → the order line can no longer be billed for them
// Cancelling a posted return (administrator, with a reason) undoes all three.
//
// Locks, always in this order, as receipts and bills take them: the order's
// row, the items' stock (advisory, lib/storeStock lockItems — the same key
// receipts and issues take), the batches' rows, then the bill's row. Two
// returns of the last units in a batch at once: the second waits, reads what
// the first left, and is refused. The store sees no money (RETURN_MONEY).
import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { round2, formatRupee } from '../lib/money.js'
import { dayRange, ymdInZone } from '../lib/dates.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { listResponse } from '../lib/pagination.js'
import { auditIpd } from '../inpatient/audit.js'
import { canRaiseReturn, canDecideReturn, canSeeReturns, isAdmin, blank, validationError, sendError, hideMoney } from '../lib/purchaseAccess.js'
import { loadPurchaseSettings } from '../lib/purchaseSettings.js'
import { roundQty } from '../lib/purchaseReceipts.js'
import { netRateOf } from '../lib/vendorBills.js'
import { lockItems } from '../lib/storeStock.js'
import { notify, notifyRoles } from '../lib/notify.js'
import { NOTIFY_WARNING } from '../lib/purchaseNotify.js'
import {
  RETURN_REASONS, REASON_LABEL, PASSED_BILL, returnableOnLine, batchInOrderUnit, checkReturnLine, priceReturnLine,
  returnTotals, sumBy, settlementFor, stillToPay, debitNoteAfter, returnedAfter,
} from '../lib/purchaseReturns.js'
import { lockOrder, hospital } from './purchaseOrderController.js'
import { onHand } from './purchaseReceiptController.js'

export const RETURN_READS = new Set(['returns', 'return', 'returnables'])
export const RETURN_WRITES = new Set(['return'])

const EPS = 1e-9
const ACTIONS = ['approve', 'reject', 'cancel']
// A return of many lines does many writes; give it room on a slow database.
const TX = { maxWait: 10000, timeout: 30000 }
const STATUS_WORDS = { pending_approval: 'waiting for approval', posted: 'posted', rejected: 'rejected', cancelled: 'cancelled' }
// The money on a return. Kept here, not in purchaseAccess MONEY (the lead's):
// the store sees quantities, batches and the debit-note number, never a value
// or the bill it was set against.
const RETURN_MONEY = { fields: ['subtotal', 'gstAmount', 'total', 'bill', 'stillToPay', 'vendorOwes'], lineFields: ['rate', 'taxable', 'gstAmount', 'lineTotal'] }
const RETURNABLE_MONEY = { lineFields: ['rate'] }
const LINE_INCLUDE = { unit: { select: { allowsFraction: true } } }

// ── Validation ───────────────────────────────────────────────────────────────

const createSchema = z.object({
  orderId: z.string({ required_error: 'Choose the order the goods came on' }).min(1, 'Choose the order the goods came on'),
  reason: z.enum(RETURN_REASONS, { errorMap: () => ({ message: 'Choose why the goods go back' }) }),
  notes: z.preprocess((v) => (blank(v) ? null : String(v).trim()), z.string().max(500, 'Notes can be at most 500 characters').nullable().optional()),
  lines: z.array(z.object({
    receiptLineId: z.string({ required_error: 'A line is missing its batch' }).min(1, 'A line is missing its batch'),
    quantity: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
      z.number({ required_error: 'Enter how much goes back on every line', invalid_type_error: 'Quantity must be a number' })
        .finite('Quantity must be a number').max(1e7, 'Quantity is too large').transform(roundQty)),
  }), { required_error: 'Add at least one batch to send back', invalid_type_error: 'Lines must be a list' })
    .min(1, 'Add at least one batch to send back').max(100, 'At most 100 lines on one return'),
}).refine((v) => v.reason !== 'other' || (v.notes || '').length >= 3, { message: 'Say what is wrong with the goods when the reason is "Other"', path: ['notes'] })

// ── Shared steps ─────────────────────────────────────────────────────────────

/**
 * Adds to each order line `returnedOnBillsQty`: what posted returns set against
 * a vendor bill took of it. lib/vendorBills billableOf needs it to tell a
 * return of billed goods (the bill's debit note covers it) from one of goods
 * never billed (no longer billable). One grouped read; none when nothing was
 * ever returned. Changes the lines in place and returns them.
 */
export async function withReturnsOnBills(client, ORG_ID, orderLines) {
  const ids = orderLines.filter((l) => (l.returnedQty || 0) > EPS).map((l) => l.id)
  const onBills = ids.length ? await client.purchaseReturnLine.groupBy({
    by: ['orderLineId'],
    where: { organizationId: ORG_ID, orderLineId: { in: ids }, purchaseReturn: { status: 'posted', billId: { not: null } } },
    _sum: { quantity: true },
  }) : []
  const byLine = new Map(onBills.map((r) => [r.orderLineId, r._sum.quantity || 0]))
  for (const l of orderLines) l.returnedOnBillsQty = byLine.get(l.id) || 0
  return orderLines
}

/** What returns still waiting for approval hold, per batch (stock units) and per order line (order units). */
async function waitingOn(client, ORG_ID, where) {
  const rows = await client.purchaseReturnLine.findMany({
    where: { organizationId: ORG_ID, purchaseReturn: { status: 'pending_approval' }, ...where },
    select: { batchId: true, orderLineId: true, quantity: true, stockQty: true },
  })
  return { byBatch: sumBy(rows, (r) => r.batchId, (r) => r.stockQty), byLine: sumBy(rows, (r) => r.orderLineId) }
}

/**
 * Where this return's money would go now (lib/purchaseReturns settlementFor),
 * from the order's lines as they stand and its bills that claim quantities.
 * `rows` are the return's lines (one per batch).
 */
async function settlementOf(tx, ORG_ID, po, rows) {
  await withReturnsOnBills(tx, ORG_ID, po.lines)
  const byLine = new Map(po.lines.map((l) => [l.id, l]))
  const lines = [...sumBy(rows, (r) => r.orderLineId)].map(([orderLineId, quantity]) => ({ orderLineId, quantity, itemName: byLine.get(orderLineId)?.itemName }))
  const bills = await tx.vendorBill.findMany({
    where: { organizationId: ORG_ID, orderId: po.id, status: { in: ['on_hold', ...PASSED_BILL] } },
    orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
    select: { id: true, number: true, status: true, lines: { select: { orderLineId: true, quantity: true } } },
  })
  if (bills.length) {
    const taken = await tx.purchaseReturnLine.findMany({
      where: { organizationId: ORG_ID, purchaseReturn: { status: 'posted', billId: { in: bills.map((b) => b.id) } } },
      select: { orderLineId: true, quantity: true, purchaseReturn: { select: { billId: true } } },
    })
    for (const b of bills) b.returned = sumBy(taken.filter((t) => t.purchaseReturn.billId === b.id), (t) => t.orderLineId)
  }
  return settlementFor({ lines, orderLines: byLine, bills })
}

/** The return's batches, row-locked after their items' stock lock, as a Map id → batch. */
async function lockBatches(tx, ORG_ID, lines) {
  await lockItems(tx, lines.map((l) => l.itemId))
  const ids = [...new Set(lines.map((l) => l.batchId).filter(Boolean))].sort()
  if (ids.length) await tx.$queryRaw`SELECT "id" FROM "StockBatch" WHERE "id" = ANY(${ids}) AND "organizationId" = ${ORG_ID} ORDER BY "id" FOR UPDATE`
  const batches = ids.length ? await tx.stockBatch.findMany({ where: { id: { in: ids }, organizationId: ORG_ID } }) : []
  return new Map(batches.map((b) => [b.id, b]))
}

/** One stock movement on a batch: its quantity changed by `delta` (stock units), the item's balance after it. */
async function moveStock(tx, ORG_ID, batch, delta, { type, ret, note, actor }) {
  const was = await onHand(tx, ORG_ID, batch.itemId)
  const quantity = roundQty(batch.quantity + delta)
  await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity } })
  batch.quantity = quantity
  await tx.stockMovement.create({
    data: {
      organizationId: ORG_ID, itemId: batch.itemId, batchId: batch.id, type, quantity: delta, balanceAfter: roundQty(was + delta),
      reference: ret.number, referenceId: ret.id, note, createdById: actor.id, createdByName: actor.name,
    },
  })
}

/** The bill a debit note goes on, row-locked. */
async function lockBillRow(tx, ORG_ID, billId) {
  await tx.$executeRaw`SELECT 1 FROM "VendorBill" WHERE "id" = ${billId} AND "organizationId" = ${ORG_ID} FOR UPDATE`
  return tx.vendorBill.findFirst({ where: { id: billId, organizationId: ORG_ID }, select: { id: true, number: true, status: true, payable: true, amountPaid: true, debitNoteTotal: true } })
}

/**
 * Posts a return that was raised (its lines with it): the goods off their
 * batches, the order lines' returned counts up, the debit note numbered and
 * set against money. `po` is the order, locked in this transaction.
 * `decision` is who approved it (empty when the hospital posts returns directly).
 */
async function postReturn(tx, ORG_ID, ret, po, actor, decision = {}) {
  const byLine = new Map(po.lines.map((l) => [l.id, l]))
  const perLine = sumBy(ret.lines, (l) => l.orderLineId)
  for (const [orderLineId, quantity] of perLine) {
    const ol = byLine.get(orderLineId)
    if (!ol) throw conflict(`${ret.number}: a line is no longer on ${po.number} — the return and its order do not agree. Nothing was changed.`)
    const left = returnableOnLine(ol)
    if (quantity > left + EPS) throw conflict(`${ol.itemName}: only ${left} ${ol.unitCode} received on ${po.number} can still go back — ${ret.number} sends ${quantity}. Reject it and raise it again for what is left.`)
  }
  const plan = await settlementOf(tx, ORG_ID, po, ret.lines)
  if (plan.error) throw conflict(plan.error)

  const batches = await lockBatches(tx, ORG_ID, ret.lines)
  for (const line of ret.lines) {
    const batch = line.batchId && batches.get(line.batchId)
    if (!batch || batch.itemId !== line.itemId) throw conflict(`${line.itemName}: batch ${line.batchNumber || '(no number)'} is no longer in the store's records — nothing can be taken out of it. Reject this return.`)
    if (batch.quantity < line.stockQty - EPS) {
      const left = batchInOrderUnit(batch.quantity, line.unitFactor)
      throw conflict(`${line.itemName}, batch ${line.batchNumber || '(no number)'}: only ${left} ${line.unitCode} is left on the shelf, ${line.quantity} to send back — it was used, issued or returned since. Nothing was changed.`)
    }
    await moveStock(tx, ORG_ID, batch, -line.stockQty, { type: 'return', ret, note: `Returned to ${ret.vendorName} — ${REASON_LABEL[ret.reason] || ret.reason}`, actor })
  }
  for (const [orderLineId, quantity] of perLine) {
    const ol = byLine.get(orderLineId)
    ol.returnedQty = returnedAfter(ol.returnedQty, quantity, 1)
    await tx.purchaseOrderLine.update({ where: { id: orderLineId }, data: { returnedQty: ol.returnedQty } })
  }
  if (plan.billId) {
    const bill = await lockBillRow(tx, ORG_ID, plan.billId)
    await tx.vendorBill.update({ where: { id: bill.id }, data: { debitNoteTotal: debitNoteAfter(bill.debitNoteTotal, ret.total, 1) } })
  }
  const debitNoteNumber = await nextSeriesNumber(tx, ORG_ID, 'DEBIT_NOTE', 'DN')
  await tx.purchaseReturn.update({ where: { id: ret.id }, data: { status: 'posted', postedAt: new Date(), debitNoteNumber, billId: plan.billId, ...decision } })
}

/**
 * Undoes a posted return (administrator): the goods back on the batch they
 * left, the order lines' returned counts down, the debit note off its bill.
 * Refused, with the reason, when the batch is gone or a count would go below 0
 * (the books disagree) — the whole cancel rolls back.
 */
async function undoReturn(tx, ORG_ID, ret, po, actor, reason) {
  const byLine = new Map(po.lines.map((l) => [l.id, l]))
  const perLine = sumBy(ret.lines, (l) => l.orderLineId)
  const next = new Map()
  for (const [orderLineId, quantity] of perLine) {
    const ol = byLine.get(orderLineId)
    const after = ol ? returnedAfter(ol.returnedQty, quantity, -1) : null
    if (after === null) throw conflict(`${ret.number}: ${po.number} shows less returned than this return sent — the order and its returns do not agree, so it cannot be undone. Nothing was changed.`)
    next.set(orderLineId, after)
  }
  if (ret.billId) {
    const bill = await lockBillRow(tx, ORG_ID, ret.billId)
    const dn = bill && debitNoteAfter(bill.debitNoteTotal, ret.total, -1)
    if (dn == null) throw conflict(`${bill?.number || 'Its bill'} carries ${formatRupee(bill?.debitNoteTotal || 0)} of debit notes, less than this return's ${formatRupee(ret.total)} — the bill and its returns do not agree, so it cannot be undone. Nothing was changed.`)
    await tx.vendorBill.update({ where: { id: bill.id }, data: { debitNoteTotal: dn } })
  }
  const batches = await lockBatches(tx, ORG_ID, ret.lines)
  for (const line of ret.lines) {
    const batch = line.batchId && batches.get(line.batchId)
    if (!batch || batch.itemId !== line.itemId) {
      throw conflict(`${line.itemName}: batch ${line.batchNumber || '(no number)'} is no longer in the store's records — the goods cannot be put back where they came from, so the return cannot be undone. Nothing was changed.`)
    }
    await moveStock(tx, ORG_ID, batch, line.stockQty, { type: 'return_cancel', ret, note: `Return cancelled: ${reason}`, actor })
  }
  for (const [orderLineId, returnedQty] of next) await tx.purchaseOrderLine.update({ where: { id: orderLineId }, data: { returnedQty } })
  await tx.purchaseReturn.update({ where: { id: ret.id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason } })
}

const RETURN_INCLUDE = {
  lines: { orderBy: { itemName: 'asc' }, include: { batch: { select: { expiryDate: true } } } },
  order: { select: { id: true, number: true, orderDate: true, gstType: true } },
  receipt: { select: { id: true, number: true, receivedAt: true, challanNumber: true } },
  bill: { select: { id: true, number: true, status: true, vendorInvoiceNumber: true, payable: true, debitNoteTotal: true, amountPaid: true } },
  vendor: { select: { name: true, gstNumber: true, pan: true, phone: true, contactPerson: true, houseNumber: true, street: true, locality: true, city: true, district: true, pincode: true } },
}

/** One return as the screen and the printed debit note need it; null when not this hospital's. */
async function readFull(ORG_ID, id, client = db) {
  const r = await client.purchaseReturn.findFirst({ where: { id, organizationId: ORG_ID }, include: RETURN_INCLUDE })
  if (!r) return null
  const toPay = r.bill ? stillToPay(r.bill) : null
  return {
    ...r,
    lines: r.lines.map(({ batch, ...l }) => ({ ...l, expiryDate: batch?.expiryDate || null })),
    stillToPay: toPay, vendorOwes: toPay != null && toPay < 0 ? -toPay : 0,
    hospital: await hospital(ORG_ID, client),
  }
}

// ── Notifications ────────────────────────────────────────────────────────────

const itemsText = (ret) => {
  const shown = ret.lines.slice(0, 3).map((l) => `${l.itemName} ${l.quantity} ${l.unitCode}`).join(', ')
  return ret.lines.length > 3 ? `${shown} and ${ret.lines.length - 3} more` : shown
}
const link = (ret) => ({ entityType: 'purchase.return', entityId: ret.id })

/**
 * Who hears about a return, after it has committed (never failing it):
 *   raised, waiting           → the purchase officers (none: the administrators)
 *   posted directly           → the purchase officers (the debit note goes to the vendor)
 *   approved / rejected       → whoever raised it
 *   posted against a bill     → Finance (less to pay on that bill)
 *   cancelled                 → whoever raised and whoever decided it
 * The store's messages carry no money. A failed bell comes back as a warning.
 */
async function returnChanged(orgId, action, ret, actor, { remark } = {}) {
  try {
    const who = { except: actor.id }
    const what = `${itemsText(ret)} back to ${ret.vendorName} — ${REASON_LABEL[ret.reason] || ret.reason}`
    if (action === 'create' && ret.status === 'pending_approval') {
      const payload = { type: 'purchase.return.to_approve', title: `Return ${ret.number} needs your approval`, message: `${what}. Raised by ${ret.createdByName}.`, ...link(ret) }
      if (!(await notifyRoles(orgId, ['purchase_officer'], payload, who))) await notifyRoles(orgId, ['admin'], payload, who)
    }
    if (action === 'create' && ret.status === 'posted') {
      await notifyRoles(orgId, ['purchase_officer'], { type: 'purchase.return.posted', title: `Goods returned to ${ret.vendorName} — ${ret.debitNoteNumber}`, message: `${ret.number}: ${what}. Send the debit note to the vendor.`, ...link(ret) }, who)
    }
    if (action === 'approve') {
      await notify(orgId, [ret.createdById], { type: 'purchase.return.approved', title: `Your return ${ret.number} is approved`, message: `Debit note ${ret.debitNoteNumber}. Hand the goods over to ${ret.vendorName}.`, ...link(ret) }, who)
    }
    if (action === 'reject') {
      await notify(orgId, [ret.createdById], { type: 'purchase.return.rejected', title: `Your return ${ret.number} was rejected`, message: `${actor.name || 'The purchase officer'}: ${remark || 'no reason given'}. The goods stay in stock.`, priority: 'high', ...link(ret) }, who)
    }
    if ((action === 'create' || action === 'approve') && ret.status === 'posted' && ret.bill) {
      const due = ret.stillToPay
      await notifyRoles(orgId, ['finance_controller'], {
        type: 'purchase.return.debit_note', title: `Debit note ${ret.debitNoteNumber} on ${ret.bill.number}`,
        message: `${ret.vendorName}: ${formatRupee(ret.total)} less to pay. ${due < 0 ? `The vendor now owes ${formatRupee(-due)} on this bill.` : `Still to pay: ${formatRupee(due)}.`}`, ...link(ret),
      }, who)
    }
    if (action === 'cancel') {
      await notify(orgId, [ret.createdById, ret.decidedById], { type: 'purchase.return.cancelled', title: `Return ${ret.number} was cancelled`, message: `${actor.name || 'An administrator'}: ${remark || ''}. Its goods are back in stock and its debit note ${ret.debitNoteNumber} no longer counts.`, priority: 'high', ...link(ret) }, who)
    }
    return null
  } catch (e) {
    console.error(`[notify] returnChanged "${action}" on ${ret?.number || ret?.id} (hospital ${orgId}): its bell notifications were not (all) sent — ${e.message}`)
    return NOTIFY_WARNING
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** The first moment of this calendar month in the hospital's zone. */
const monthStart = () => dayRange(`${ymdInZone().slice(0, 8)}01`).gte

// Each tile is exactly the rows its click lists.
const VIEW_WHERE = {
  pending: () => ({ status: 'pending_approval' }),
  'posted-month': () => ({ status: 'posted', postedAt: { gte: monthStart() } }),
  rejected: () => ({ status: 'rejected' }),
}

async function returnSummary(ORG_ID) {
  const agg = (where) => db.purchaseReturn.aggregate({ where: { organizationId: ORG_ID, ...where }, _count: { _all: true }, _sum: { total: true } })
  const [pending, postedMonth, rejected, all] = await Promise.all([
    agg(VIEW_WHERE.pending()), agg(VIEW_WHERE['posted-month']()),
    db.purchaseReturn.count({ where: { organizationId: ORG_ID, ...VIEW_WHERE.rejected() } }),
    db.purchaseReturn.count({ where: { organizationId: ORG_ID } }),
  ])
  const pair = (a) => ({ count: a._count._all, amount: round2(a._sum.total) })
  return { pending: pair(pending), postedThisMonth: pair(postedMonth), rejected, all }
}

/**
 * Orders with goods that can still go back: a posted receipt whose batch holds
 * stock, on an order line not all returned. Worked out in the database (orders
 * pile up for years), at most 30, newest first.
 */
async function returnableOrders(ORG_ID, search) {
  const term = String(search || '').trim()
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return db.$queryRaw`
    SELECT o."id", o."number", o."vendorName", o."status", o."orderDate"
    FROM "PurchaseOrder" o
    JOIN "GoodsReceipt" g ON g."orderId" = o."id" AND g."organizationId" = ${ORG_ID} AND g."status" = 'posted'
    JOIN "GoodsReceiptLine" gl ON gl."receiptId" = g."id"
    JOIN "StockBatch" b ON b."id" = gl."batchId" AND b."quantity" > 0.0005
    JOIN "PurchaseOrderLine" l ON l."id" = gl."orderLineId" AND l."receivedQty" - l."returnedQty" > 0.0005
    WHERE o."organizationId" = ${ORG_ID}
      AND (${term} = '' OR o."number" ILIKE ${like} OR o."vendorName" ILIKE ${like} OR g."number" ILIKE ${like} OR gl."itemName" ILIKE ${like})
    GROUP BY o."id", o."number", o."vendorName", o."status", o."orderDate"
    ORDER BY o."orderDate" DESC
    LIMIT 30`
}

/** One order's batches that can go back, with how much each can still send. */
async function returnableLines(req, ORG_ID, orderId, receiptId) {
  const po = await db.purchaseOrder.findFirst({
    where: { id: orderId, organizationId: ORG_ID },
    select: {
      id: true, number: true, status: true, vendorId: true, vendorName: true, gstType: true, orderDate: true,
      lines: { include: { ...LINE_INCLUDE, item: { select: { stockUnit: { select: { code: true } } } } } },
    },
  })
  if (!po) throw notFound('Purchase order not found')
  const receiptLines = await db.goodsReceiptLine.findMany({
    where: { organizationId: ORG_ID, batchId: { not: null }, receipt: { orderId: po.id, status: 'posted', ...(receiptId ? { id: receiptId } : {}) } },
    include: { receipt: { select: { id: true, number: true, receivedAt: true } }, batch: { select: { quantity: true, expiryDate: true } } },
    orderBy: [{ receipt: { receivedAt: 'asc' } }, { itemName: 'asc' }],
  })
  const waiting = await waitingOn(db, ORG_ID, { orderLineId: { in: po.lines.map((l) => l.id) } })
  const byLine = new Map(po.lines.map((l) => [l.id, l]))
  const lines = receiptLines.filter((rl) => rl.batch && rl.batch.quantity > EPS && byLine.has(rl.orderLineId)).map((rl) => {
    const ol = byLine.get(rl.orderLineId)
    const wholeOnly = !ol.unit.allowsFraction
    const onShelf = batchInOrderUnit(rl.batch.quantity - (waiting.byBatch.get(rl.batchId) || 0), ol.unitFactor, wholeOnly)
    const onLine = returnableOnLine(ol, waiting.byLine.get(ol.id))
    return {
      receiptLineId: rl.id, receiptId: rl.receipt.id, receiptNumber: rl.receipt.number, receivedAt: rl.receipt.receivedAt,
      orderLineId: ol.id, itemId: ol.itemId, itemCode: ol.itemCode, itemName: ol.itemName,
      unitCode: ol.unitCode, unitFactor: ol.unitFactor, allowsFraction: ol.unit.allowsFraction, stockUnitCode: ol.item?.stockUnit?.code || null,
      batchId: rl.batchId, batchNumber: rl.batchNumber, expiryDate: rl.batch.expiryDate,
      onShelf: batchInOrderUnit(rl.batch.quantity, ol.unitFactor, wholeOnly),
      waiting: batchInOrderUnit(waiting.byBatch.get(rl.batchId) || 0, ol.unitFactor),
      received: ol.receivedQty, returned: ol.returnedQty,
      returnable: Math.max(0, Math.min(onShelf, onLine)),
      rate: round2(netRateOf(ol)), gstRate: po.gstType === 'none' ? 0 : ol.gstRate,
    }
  })
  const { lines: _, ...order } = po
  return { order, lines: hideMoney(req, { lines }, RETURNABLE_MONEY).lines }
}

export async function returnGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canSeeReturns(req)) throw forbidden('Returns to vendors are for the store, the purchase team and Finance')
    const { resource } = req.query

    if (resource === 'returns') {
      const { search, status, view, orderId } = req.query
      const where = { organizationId: ORG_ID }
      if (VIEW_WHERE[view]) Object.assign(where, VIEW_WHERE[view]())
      else if (status && status !== 'all') where.status = { in: String(status).split(',') }
      if (orderId) where.orderId = String(orderId)
      const term = String(search || '').trim()
      if (term) {
        where.OR = [
          { number: { contains: term, mode: 'insensitive' } },
          { debitNoteNumber: { contains: term, mode: 'insensitive' } },
          { vendorName: { contains: term, mode: 'insensitive' } },
          { order: { number: { contains: term, mode: 'insensitive' } } },
          { lines: { some: { OR: [{ itemName: { contains: term, mode: 'insensitive' } }, { batchNumber: { contains: term, mode: 'insensitive' } }] } } },
        ]
      }
      const body = await listResponse(db.purchaseReturn, {
        where, req, orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        select: {
          id: true, number: true, status: true, vendorName: true, reason: true, total: true, debitNoteNumber: true,
          createdByName: true, createdAt: true, postedAt: true, decidedByName: true,
          order: { select: { id: true, number: true } }, bill: { select: { id: true, number: true } },
          lines: { select: { itemName: true, quantity: true, unitCode: true }, orderBy: { itemName: 'asc' }, take: 3 },
          _count: { select: { lines: true } },
        },
      })
      body.data = body.data.map(({ _count, ...r }) => hideMoney(req, { ...r, lineCount: _count.lines }, RETURN_MONEY))
      // For the whole hospital, not the page: the tiles above the list.
      const summary = await returnSummary(ORG_ID)
      if (!hideMoney(req, { total: 1 }, RETURN_MONEY).total) for (const k of ['pending', 'postedThisMonth']) delete summary[k].amount
      body.summary = summary
      return res.json(body)
    }

    if (resource === 'return') {
      const ret = await readFull(ORG_ID, String(req.query.id || ''))
      if (!ret) return res.status(404).json({ success: false, error: 'Return not found' })
      return res.json({ success: true, data: hideMoney(req, ret, RETURN_MONEY) })
    }

    if (resource === 'returnables') {
      if (req.query.orderId) {
        const data = await returnableLines(req, ORG_ID, String(req.query.orderId), req.query.receiptId ? String(req.query.receiptId) : null)
        return res.json({ success: true, data })
      }
      return res.json({ success: true, data: await returnableOrders(ORG_ID, req.query.search) })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (e) {
    sendError(res, e, next)
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function returnCreate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canRaiseReturn(req)) throw forbidden('Only the store (or an administrator) sends goods back to a vendor')
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const input = parsed.data
    const actor = getActor(req)
    // The hospital's setting, read here for this decision — never from the body.
    const { returnMode } = await loadPurchaseSettings(db, ORG_ID)

    const full = await db.$transaction(async (tx) => {
      const po = await lockOrder(tx, ORG_ID, input.orderId, { lineInclude: LINE_INCLUDE })
      const ids = input.lines.map((l) => l.receiptLineId)
      if (new Set(ids).size !== ids.length) throw bad('A batch is on the return twice — enter it once, with the whole quantity')
      const found = await tx.goodsReceiptLine.findMany({
        where: { id: { in: ids }, organizationId: ORG_ID },
        include: { receipt: { select: { id: true, number: true, status: true, orderId: true } }, batch: { select: { quantity: true } } },
      })
      const byId = new Map(found.map((f) => [f.id, f]))
      const byLine = new Map(po.lines.map((l) => [l.id, l]))
      const waiting = await waitingOn(tx, ORG_ID, { orderLineId: { in: po.lines.map((l) => l.id) } })
      const usedOnLine = new Map()
      const rows = []
      for (const l of input.lines) {
        const rl = byId.get(l.receiptLineId)
        if (!rl || rl.receipt.orderId !== po.id) throw bad(`A batch is not from ${po.number}'s goods receipts — reload the order and try again`)
        if (rl.receipt.status !== 'posted') throw conflict(`${rl.receipt.number} was cancelled — its goods are no longer in stock`)
        const ol = byLine.get(rl.orderLineId)
        if (!rl.batchId || !rl.batch || !ol) throw conflict(`${rl.itemName}: ${rl.receipt.number} put nothing into stock on this line — there is nothing to send back`)
        const wholeOnly = !ol.unit?.allowsFraction
        const onShelf = batchInOrderUnit(rl.batch.quantity - (waiting.byBatch.get(rl.batchId) || 0), ol.unitFactor, wholeOnly)
        const onLine = roundQty(returnableOnLine(ol, waiting.byLine.get(ol.id)) - (usedOnLine.get(ol.id) || 0))
        const check = checkReturnLine({ itemName: ol.itemName, unitCode: ol.unitCode, batchNumber: rl.batchNumber, quantity: l.quantity, onShelf, onLine, unitFactor: ol.unitFactor, wholeOnly })
        if (check.error) throw bad(check.error)
        usedOnLine.set(ol.id, roundQty((usedOnLine.get(ol.id) || 0) + l.quantity))
        rows.push({
          organizationId: ORG_ID, orderLineId: ol.id, itemId: ol.itemId, itemCode: ol.itemCode, itemName: ol.itemName,
          unitCode: ol.unitCode, unitFactor: ol.unitFactor, quantity: l.quantity, stockQty: check.stockQty,
          batchId: rl.batchId, batchNumber: rl.batchNumber, ...priceReturnLine(ol, l.quantity, po.gstType),
        })
      }
      // Refused now rather than at approval when the money cannot be settled
      // (billed on a bill on hold, or across bills); decided again on posting.
      const plan = await settlementOf(tx, ORG_ID, po, rows)
      if (plan.error) throw conflict(plan.error)

      const receiptIds = [...new Set(found.map((f) => f.receiptId))]
      const number = await nextSeriesNumber(tx, ORG_ID, 'PURCHASE_RETURN', 'RTV')
      const created = await tx.purchaseReturn.create({
        data: {
          organizationId: ORG_ID, number, status: 'pending_approval',
          vendorId: po.vendorId, vendorName: po.vendorName, orderId: po.id, receiptId: receiptIds.length === 1 ? receiptIds[0] : null,
          reason: input.reason, notes: input.notes ?? null, ...returnTotals(rows),
          createdById: actor.id, createdByName: actor.name || 'Store',
          lines: { create: rows },
        },
        include: { lines: true },
      })
      if (returnMode === 'direct') await postReturn(tx, ORG_ID, created, po, actor)
      // Read back before the commit, so the answer is what was committed.
      const after = await readFull(ORG_ID, created.id, tx)
      await auditIpd(req, ORG_ID, { action: returnMode === 'direct' ? 'create and post' : 'create', entityType: 'purchase.return', entityId: after.id, after }, tx)
      return after
    }, TX)

    const warning = await returnChanged(ORG_ID, 'create', full, actor)
    return res.status(201).json({ success: true, data: hideMoney(req, full, RETURN_MONEY), ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function returnUpdate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { action } = req.body
    const id = String(req.body.id || '')
    if (!ACTIONS.includes(action)) throw bad(`Unknown action. Use: ${ACTIONS.join(', ')}`)
    const words = String(req.body.remark || req.body.reason || '').trim().slice(0, 500)
    if (action === 'cancel') {
      if (!isAdmin(req)) throw forbidden('Only an administrator cancels a posted return')
      if (words.length < 3) throw bad('Say why the return is cancelled')
    } else {
      if (!canDecideReturn(req)) throw forbidden('Only the purchase officer or an administrator approves or rejects a return')
      if (action === 'reject' && words.length < 3) throw bad('Say why it is rejected — the store needs to know')
    }
    const actor = getActor(req)
    let before

    const full = await db.$transaction(async (tx) => {
      // The order first, as receipts and bills take it, so every path on one
      // order takes turns instead of waiting on each other.
      const head = await tx.purchaseReturn.findFirst({ where: { id, organizationId: ORG_ID }, select: { orderId: true } })
      if (!head) throw notFound('Return not found')
      const po = await lockOrder(tx, ORG_ID, head.orderId)
      await tx.$executeRaw`SELECT 1 FROM "PurchaseReturn" WHERE "id" = ${id} AND "organizationId" = ${ORG_ID} FOR UPDATE`
      const ret = await tx.purchaseReturn.findFirst({ where: { id, organizationId: ORG_ID }, include: { lines: true } })
      before = ret

      if (action === 'cancel') {
        if (ret.status !== 'posted') throw conflict(`${ret.number} is ${STATUS_WORDS[ret.status] || ret.status} — only a posted return is cancelled${ret.status === 'pending_approval' ? ' (reject it instead)' : ''}`)
        await undoReturn(tx, ORG_ID, ret, po, actor, words)
      } else {
        if (ret.status !== 'pending_approval') throw conflict(`${ret.number} is already ${STATUS_WORDS[ret.status] || ret.status}`)
        // Whoever raised a return does not pass it too; a small hospital's
        // administrator may have to.
        if (!isAdmin(req) && ret.createdById && ret.createdById === actor.id) throw forbidden('You raised this return — someone else must decide it')
        const decision = { decidedAt: new Date(), decidedById: actor.id, decidedByName: actor.name || 'Purchase', decisionRemark: words || null }
        if (action === 'approve') await postReturn(tx, ORG_ID, ret, po, actor, decision)
        else await tx.purchaseReturn.update({ where: { id }, data: { status: 'rejected', ...decision } })
      }
      const after = await readFull(ORG_ID, id, tx)
      await auditIpd(req, ORG_ID, { action, entityType: 'purchase.return', entityId: id, before, after }, tx)
      return after
    }, TX)

    const warning = await returnChanged(ORG_ID, action, full, actor, { remark: words })
    return res.json({ success: true, data: hideMoney(req, full, RETURN_MONEY), ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

// Nothing about a return is deleted: its number and its trail stay.
export async function returnRemove(req, res) {
  return res.status(400).json({ success: false, error: 'A return is not deleted — the purchase officer rejects one waiting for approval; an administrator cancels a posted one' })
}
