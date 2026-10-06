// Returns to the vendor — the arithmetic and the rules, pure, so each is
// tested on its own (__tests__/purchaseReturns.test.js) and the controller
// (controllers/purchaseReturnController.js) only reads, locks and writes.
//
// A return sends goods that are already in stock back to the vendor, from the
// batch they came in on. Posting it (directly or once the purchase officer
// approves, per the hospital's setting) takes them off the shelf and raises a
// debit note, which is set against money in one of two ways:
//   • the goods were not billed yet → the order line can no longer be billed
//     for them (lib/vendorBills billableOf counts them out)
//   • they were billed on a bill passed for payment → the debit note goes on
//     that bill, and what is still to pay on it goes down by the return's value
//     (below zero = the vendor owes the hospital; kept, and said so)
import { round2 } from './money.js'
import { roundQty } from './purchaseReceipts.js'
import { lineAmounts } from './purchaseOrders.js'
import { netRateOf, billableOf } from './vendorBills.js'

const EPS = 1e-9

export const RETURN_REASONS = ['damaged', 'wrong_item', 'expired', 'near_expiry', 'quality', 'other']
export const REASON_LABEL = {
  damaged: 'Damaged', wrong_item: 'Wrong item', expired: 'Expired', near_expiry: 'Near expiry', quality: 'Quality problem', other: 'Other',
}

// A bill whose money is settled by Finance: approved for payment, and — once
// payments are recorded — part paid or paid. A debit note goes only on one of these.
export const PASSED_BILL = ['approved', 'partly_paid', 'paid']

/**
 * What can still go back on an order line, in its unit: received, less what
 * was returned already and what other returns are waiting to send. Never below 0.
 */
export const returnableOnLine = (orderLine, waitingQty = 0) =>
  Math.max(0, roundQty((orderLine?.receivedQty || 0) - (orderLine?.returnedQty || 0) - (waitingQty || 0)))

/**
 * What a batch holds in the order's unit (stock units ÷ the unit's size). A
 * unit counted whole (BOX) gives only the whole ones: 250 PCS of 100-piece
 * boxes is 2 boxes that can go back.
 */
export function batchInOrderUnit(batchQty, unitFactor = 1, wholeOnly = false) {
  const q = roundQty((Number(batchQty) || 0) / (Number(unitFactor) || 1))
  return Math.max(0, wholeOnly ? Math.floor(q + 1e-6) : q)
}

/**
 * One line of a return checked before it is saved. `onShelf` is what the
 * batch holds in the order's unit, less what other waiting returns take from
 * it; `onLine` is what the order line can still send back (returnableOnLine).
 * Returns { stockQty } or { error } naming the item and the batch.
 */
export function checkReturnLine({ itemName, unitCode, batchNumber, quantity, onShelf, onLine, unitFactor = 1, wholeOnly = false }) {
  const batch = batchNumber ? `batch ${batchNumber}` : 'this batch'
  if (!(quantity > 0)) return { error: `${itemName}: enter how much goes back` }
  if (wholeOnly && !Number.isInteger(quantity)) return { error: `${itemName} is counted in whole ${unitCode} — ${quantity} is not a whole number` }
  if (quantity > onLine + EPS) {
    return { error: onLine > 0
      ? `${itemName}: only ${onLine} ${unitCode} received on this order can still go back — ${quantity} is more than that`
      : `${itemName}: everything received on this order has already gone back (or is waiting to)` }
  }
  if (quantity > onShelf + EPS) {
    return { error: onShelf > 0
      ? `${itemName}, ${batch}: only ${onShelf} ${unitCode} is on the shelf to send back — ${quantity} is more than that`
      : `${itemName}, ${batch}: nothing of it is left on the shelf — it has been used, issued or returned` }
  }
  return { stockQty: roundQty(quantity * (Number(unitFactor) || 1)) }
}

/**
 * A returned line's money, at the order line's price: its net rate (after the
 * discount, before GST) and the order's GST — the same arithmetic as the order
 * itself (lib/purchaseOrders lineAmounts), so a return of everything is the
 * order line's own amount to the paisa.
 */
export function priceReturnLine(orderLine, quantity, gstType = 'intra') {
  const gstRate = gstType === 'none' ? 0 : Number(orderLine.gstRate) || 0
  const amounts = lineAmounts({ quantity, rate: orderLine.rate, discountPct: orderLine.discountPct, gstRate }, gstType)
  return { rate: round2(netRateOf(orderLine)), gstRate, ...amounts }
}

/** The return's totals from its priced lines. */
export function returnTotals(lines) {
  const subtotal = round2(lines.reduce((s, l) => s + (l.taxable || 0), 0))
  const gstAmount = round2(lines.reduce((s, l) => s + (l.gstAmount || 0), 0))
  return { subtotal, gstAmount, total: round2(subtotal + gstAmount) }
}

/** Quantities summed per key: [{ key, quantity }] → Map key → total. */
export function sumBy(rows, keyOf, qtyOf = (r) => r.quantity) {
  const out = new Map()
  for (const r of rows) {
    const k = keyOf(r)
    out.set(k, roundQty((out.get(k) || 0) + (Number(qtyOf(r)) || 0)))
  }
  return out
}

/**
 * Where a return's money goes — decided when it is posted, under the order's
 * lock, from the order as it stands:
 *
 *   lines       [{ orderLineId, itemName, quantity }] (one row per order line: summed over batches)
 *   orderLines  Map orderLineId → the order line with `returnedOnBillsQty`
 *               (what posted returns already set against bills), so billableOf
 *               gives what is received and not billed
 *   bills       the order's bills that claim quantities (on hold or passed),
 *               newest first: [{ id, number, status, lines: [{ orderLineId,
 *               quantity }], returned: Map orderLineId → quantity already
 *               returned against this bill }]
 *
 * Returns { billId: null } — nothing of it is billed: every line fits in what
 * is received and not yet billed, so the order line stops being billable for it;
 * { billId, number } — it was billed: one bill passed for payment holds every
 * line (less what earlier returns took against it), and the whole return is
 * set against that bill; or { error } in words.
 *
 * A return is either all unbilled or all on one bill, so the books can always
 * tell which it was: a return mixing the two is split by the person raising it.
 */
export function settlementFor({ lines, orderLines, bills = [] }) {
  const unbilled = lines.every((l) => l.quantity <= billableOf(orderLines.get(l.orderLineId)) + EPS)
  if (unbilled) return { billId: null }

  const holds = (bill) => lines.every((l) => {
    const onBill = bill.lines.filter((b) => b.orderLineId === l.orderLineId).reduce((s, b) => s + b.quantity, 0)
    return l.quantity <= roundQty(onBill - (bill.returned?.get(l.orderLineId) || 0)) + EPS
  })
  const passed = bills.find((b) => PASSED_BILL.includes(b.status) && holds(b))
  if (passed) return { billId: passed.id, number: passed.number }

  const held = bills.find((b) => b.status === 'on_hold' && holds(b))
  if (held) return { error: `These goods are billed on ${held.number}, which is on hold — Finance approves or rejects it first, then the return can be posted` }
  const notBilled = lines.filter((l) => l.quantity <= billableOf(orderLines.get(l.orderLineId)) + EPS).map((l) => l.itemName)
  if (notBilled.length && notBilled.length < lines.length) {
    return { error: `${notBilled.join(', ')} ${notBilled.length === 1 ? 'is' : 'are'} not billed yet but the rest is — send them back on two returns, one for the billed goods and one for the rest` }
  }
  return { error: 'These goods are billed across more than one vendor bill — raise one return per bill' }
}

/** What is still to pay on a bill: payable, less debit notes, less what was paid. Below 0 = the vendor owes the hospital. */
export const stillToPay = (bill) => round2((Number(bill?.payable) || 0) - (Number(bill?.debitNoteTotal) || 0) - (Number(bill?.amountPaid) || 0))

/**
 * A bill's debit-note total once a return of `total` is set against it (sign
 * 1) or taken off it (sign −1) — or null when taking it off would go below 0,
 * which means the bill and its returns disagree (the caller refuses).
 */
export function debitNoteAfter(debitNoteTotal, total, sign) {
  const next = round2((Number(debitNoteTotal) || 0) + sign * (Number(total) || 0))
  return next < -0.005 ? null : Math.max(0, next)
}

/** An order line's returned count once `quantity` goes back (1) or is undone (−1); null below 0. */
export function returnedAfter(returnedQty, quantity, sign) {
  const next = roundQty((Number(returnedQty) || 0) + sign * (Number(quantity) || 0))
  return next < -EPS ? null : Math.max(0, next)
}
