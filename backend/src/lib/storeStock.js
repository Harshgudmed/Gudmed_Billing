// Stock going out of the store to a department (store issues) — the rules are
// pure, so each is tested on its own (__tests__/storeStock.test.js); the two
// database helpers at the end take the locks every stock-out shares.
//
// The owner's rule: oldest expiry first (FIFO by expiry), then the batch that
// came in first; a batch with no expiry date goes after every dated one. An
// expired batch is never handed to a ward — it stays on the shelf for the
// store to return or write off.
import { roundQty } from './purchaseReceipts.js'

const EPS = 1e-9

// Bought, but never on a shelf: a department cannot indent for these. (The
// goods-receipt controller keeps the same list for what enters stock.)
export const NOT_STOCKED = ['service', 'licence', 'personnel']

const time = (d) => (d ? new Date(d).getTime() : null)

/** Is this batch past its expiry on `today` (the start of the hospital's day)? */
export const isExpired = (batch, today) => !!batch.expiryDate && time(batch.expiryDate) < time(today)

/** The order batches are used in: soonest expiry, then oldest receipt, then id (so it never varies). */
export function fifoOrder(a, b) {
  const ea = time(a.expiryDate)
  const eb = time(b.expiryDate)
  if (ea !== eb) {
    if (ea == null) return 1
    if (eb == null) return -1
    return ea - eb
  }
  return (time(a.receivedAt) ?? 0) - (time(b.receivedAt) ?? 0) || String(a.id).localeCompare(String(b.id))
}

/** What can be handed out now, in stock units: every batch with stock that has not expired. */
export function issuableQty(batches, today) {
  return roundQty(batches.reduce((s, b) => s + (b.quantity > EPS && !isExpired(b, today) ? b.quantity : 0), 0))
}

/** Stock on the shelf that has expired, in stock units — shown, never issued. */
export function expiredQty(batches, today) {
  return roundQty(batches.reduce((s, b) => s + (b.quantity > EPS && isExpired(b, today) ? b.quantity : 0), 0))
}

/**
 * Which batches `stockQty` (stock units) comes out of, in FIFO order.
 * Returns { takes: [{ batch, qty }], short } — `short` is what the shelf could
 * not cover (0 when it all fits). The caller refuses a short issue; this never
 * takes more than a batch holds, nor from an expired one.
 */
export function planFifo(batches, stockQty, today) {
  let left = roundQty(stockQty)
  const takes = []
  for (const batch of [...batches].sort(fifoOrder)) {
    if (left <= EPS) break
    if (!(batch.quantity > EPS) || isExpired(batch, today)) continue
    const qty = roundQty(Math.min(batch.quantity, left))
    takes.push({ batch, qty })
    left = roundQty(left - qty)
  }
  return { takes, short: left > EPS ? left : 0 }
}

/** What is still to be issued on an indent line, in its unit. */
export const pendingOf = (line) => Math.max(0, roundQty((line.quantity || 0) - (line.issuedQty || 0)))

/**
 * An indent's status from its lines: everything issued → issued, some →
 * partly_issued, nothing → submitted. A closed or cancelled indent stays as it
 * is: closing was the store's decision that the rest will not be given, and
 * undoing an issue does not change that.
 */
export function indentStatusAfter(currentStatus, lines) {
  if (currentStatus === 'closed' || currentStatus === 'cancelled') return currentStatus
  const any = lines.some((l) => (l.issuedQty || 0) > EPS)
  const all = lines.length > 0 && lines.every((l) => (l.issuedQty || 0) >= (l.quantity || 0) - EPS)
  if (all) return 'issued'
  return any ? 'partly_issued' : 'submitted'
}

/**
 * One line of an issue checked against its indent line. `quantity` is in the
 * indent's unit; `available` is the issuable stock in stock units. Returns
 * { stockQty } or { error } naming the item.
 */
export function checkIssueLine({ line, quantity, available, wholeOnly }) {
  const name = line.itemName
  if (!(quantity > 0)) return { error: `${name}: enter how much to give` }
  if (wholeOnly && !Number.isInteger(quantity)) return { error: `${name} is counted in whole ${line.unitCode} — ${quantity} is not a whole number` }
  const pending = pendingOf(line)
  if (quantity > pending + EPS) return { error: `${name}: only ${pending} ${line.unitCode} is still to be issued on this indent — ${quantity} is more than that` }
  const stockQty = roundQty(quantity * (line.unitFactor || 1))
  if (stockQty > available + EPS) {
    const inUnit = roundQty(available / (line.unitFactor || 1))
    return { error: `${name}: only ${inUnit} ${line.unitCode} is in stock and not expired — give at most that, or close the rest of the indent` }
  }
  return { stockQty }
}

/** An indent line's issued count once an issue that gave `quantity` of it is undone — null when that would go below 0. */
export function issuedAfterUndo(issuedQty, quantity) {
  const next = roundQty((issuedQty || 0) - quantity)
  return next < -EPS ? null : Math.max(0, next)
}

// ── Database helpers ─────────────────────────────────────────────────────────

/**
 * Locks these items' stock for the rest of the transaction, in sorted order —
 * the SAME advisory key goods receipts take (purchaseReceiptController.js
 * lockItems: 'stock:' + itemId), so a receipt and an issue of one item take
 * turns and each ledger balance is worked out on the latest figure.
 */
export async function lockItems(tx, itemIds) {
  for (const id of [...new Set(itemIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock:' + id}))`
  }
}

/**
 * The batches of these items, read under a row lock (SELECT … FOR UPDATE), so
 * two issues at once can never both take the same stock. Call after lockItems.
 */
export async function lockedBatches(tx, organizationId, itemIds) {
  const ids = [...new Set(itemIds)]
  if (!ids.length) return []
  await tx.$queryRaw`SELECT "id" FROM "StockBatch" WHERE "organizationId" = ${organizationId} AND "itemId" = ANY(${ids}) ORDER BY "id" FOR UPDATE`
  return tx.stockBatch.findMany({ where: { organizationId, itemId: { in: ids } } })
}
