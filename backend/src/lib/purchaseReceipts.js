// Goods-receipt rules — pure, so each is tested on its own.
import { round2 } from './money.js'

const EPS = 1e-9

/** Quantities keep three decimals (2.125 L), so sums of them stay exact. */
export const roundQty = (n) => Math.round((Number(n) || 0) * 1000) / 1000

/**
 * What one stock unit cost, before GST: the order line's price after its
 * discount (taxable ÷ quantity), spread over the units in one of its unit
 * (₹450 a Box of 100 → ₹4.5 a Piece). Six decimals, so a batch's value
 * (quantity × cost) comes back to the paisa.
 */
export function unitCostOf(orderLine) {
  const perOrderUnit = orderLine.quantity > 0 ? orderLine.taxable / orderLine.quantity : orderLine.rate || 0
  return Math.round((perOrderUnit / (orderLine.unitFactor || 1)) * 1e6) / 1e6
}

/** What is still to come on an order line, in the order's unit. */
export const pendingOf = (line) => Math.max(0, (line.quantity || 0) - (line.receivedQty || 0))

/**
 * An order line's received count once a receipt that accepted `acceptedQty`
 * of it is undone — or null when that would go below 0. A receipt is counted
 * into its line once, so below 0 means the line and its receipts disagree
 * (the ledger was changed outside Purchase): the caller refuses rather than
 * write 0. Rounded first, so decimals (0.3 − 0.1 − 0.2) end at 0, not −0.0000001.
 */
export function receivedAfterUndo(receivedQty, acceptedQty) {
  const next = roundQty((receivedQty || 0) - acceptedQty)
  return next < 0 ? null : next
}

/**
 * One received line checked against its order line. Returns
 * { accepted } or { error }. Rejected goods (damaged, wrong, short-dated) do
 * not count as received: the vendor still owes them.
 */
export function checkReceiptLine({ orderLine, receivedQty, rejectedQty = 0, rejectReason, wholeOnly }) {
  const name = orderLine.itemName
  if (!(receivedQty > 0)) return { error: `${name}: enter how many arrived` }
  if (rejectedQty < 0 || rejectedQty > receivedQty + EPS) return { error: `${name}: rejected cannot be more than received` }
  if (wholeOnly && (!Number.isInteger(receivedQty) || !Number.isInteger(rejectedQty))) {
    return { error: `${name} is counted in whole ${orderLine.unitCode}` }
  }
  if (rejectedQty > 0 && !(rejectReason && rejectReason.trim().length >= 3)) return { error: `${name}: say why ${rejectedQty} ${orderLine.unitCode} were rejected` }
  const accepted = receivedQty - rejectedQty
  const pending = pendingOf(orderLine)
  if (accepted > pending + EPS) {
    return { error: `${name}: only ${pending} ${orderLine.unitCode} are still due on this order — ${accepted} cannot be accepted` }
  }
  return { accepted }
}

/**
 * An order's status from what its lines have received: everything → received,
 * some → partly_received, nothing → back to sent (or approved if it was never
 * marked sent). A short-closed order stays closed: closing it was a decision
 * that the rest will not come, and undoing a receipt does not change that.
 */
export function statusAfterReceipts(order, lines) {
  const any = lines.some((l) => (l.receivedQty || 0) > EPS)
  const all = lines.length > 0 && lines.every((l) => (l.receivedQty || 0) >= (l.quantity || 0) - EPS)
  if (all) return 'received'
  if (order.status === 'closed') return 'closed'
  if (any) return 'partly_received'
  return order.sentAt ? 'sent' : 'approved'
}

/** Why an expiry date cannot be accepted (already expired), or null. */
export function expiryProblem(expiryDate, today) {
  if (!expiryDate) return null
  return expiryDate < today ? 'already expired' : null
}

/** A stock row's state: none (never received), out, low (at or under the reorder level), ok. */
export function stockStatus({ onHand, reorderLevel, everReceived }) {
  if (onHand <= EPS) return everReceived || reorderLevel > 0 ? 'out' : 'none'
  if (reorderLevel != null && onHand <= reorderLevel) return 'low'
  return 'ok'
}

/**
 * The Stock tab's tile counts from its rows (each with onHand, value,
 * expiringSoon and its stockStatus). The dashboard counts from the same, so
 * "Low Stock" there is the Stock tab's Low list: some left, at or under the
 * reorder level — nothing left is Out of Stock. `value` is money: the caller
 * leaves it out for the store.
 */
export function stockSummary(rows) {
  return {
    items: rows.length,
    inStock: rows.filter((r) => r.onHand > 0).length,
    low: rows.filter((r) => r.status === 'low').length,
    out: rows.filter((r) => r.status === 'out').length,
    expiring: rows.filter((r) => r.expiringSoon).length,
    value: round2(rows.reduce((s, r) => s + r.value, 0)),
  }
}
