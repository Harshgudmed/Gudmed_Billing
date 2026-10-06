// Vendor-bill rules — the 3-way match, the totals and the due date. Pure, so
// each is tested on its own and the bill form and the server can never
// disagree about whether a bill matches.
//
// The three ways a vendor's invoice is checked, line by line:
//   1. the ORDER   — the net rate (after discount) and the GST rate are what was ordered
//   2. the GOODS   — the quantity billed was received (GRN) and is not on another bill
//   3. the INVOICE — the total printed on it, when typed, is what the lines add up to
// Everything agrees → the bill is approved for payment by itself. Anything
// else → on hold until Finance looks at it.
import { round2, formatRupee } from './money.js'
import { roundQty } from './purchaseReceipts.js'
import { orderTotals } from './purchaseOrders.js'
import { tdsAmountOf } from './tds.js'

const EPS = 1e-9
// A rate is the order's when it is within a paisa: ₹333.33 less 10% is
// ₹299.997, which no invoice prints.
export const RATE_TOLERANCE = 0.01
// Invoices round their grand total to the rupee.
export const TOTAL_TOLERANCE = 1
export const DEFAULT_TERMS_DAYS = 30
// MSMED Act, section 15: a micro or small enterprise is paid within 45 days,
// whatever was agreed.
export const MSME_MAX_DAYS = 45
export const AUTO_DECIDER = 'Auto — 3-way match'

/**
 * The invoice number as the duplicate check compares it: capitals, letters and
 * digits only. "inv/24-25/001", "INV 24-25 001" and "Inv2425001" are one
 * invoice — the same paper typed by two people, the commonest way a vendor is
 * paid twice.
 */
export const invoiceKey = (number) => String(number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Price per unit after the discount, before GST. */
export const netRateOf = ({ rate, discountPct } = {}) => (Number(rate) || 0) * (1 - (Number(discountPct) || 0) / 100)

/**
 * What may still be billed on an order line: received, less what bills already
 * claim, less what went back to the vendor before it was billed. Never below 0.
 *
 * A posted return is either set against a bill (the goods were billed: its
 * debit note lowers what is paid on that bill) or not (they were never billed:
 * the line stops being billable for them). `returnedQty` counts both, so the
 * ones on bills are added back from `returnedOnBillsQty` — which is not a
 * column: the caller reads it from the posted returns
 * (purchaseReturnController withReturnsOnBills). Left out, every return counts
 * as unbilled: the safe side — a bill then goes on hold for Finance rather
 * than through.
 */
export const unbilledReturnedOf = (orderLine) => Math.max(0, (orderLine?.returnedQty || 0) - (orderLine?.returnedOnBillsQty || 0))
export const billableOf = (orderLine) => Math.max(0, roundQty((orderLine?.receivedQty || 0) - (orderLine?.billedQty || 0) - unbilledReturnedOf(orderLine)))

/**
 * An order line's billed count once a bill's `quantity` is counted in (sign 1)
 * or given back (sign −1) — or null when giving back would go below 0. A bill
 * is counted in once and given back once, so below 0 means the line and its
 * bills disagree (the ledger was changed outside Purchase): the caller refuses
 * rather than write 0. Rounded first, so decimals end at 0, not −0.0000001.
 * (Billed above received is legitimate — Finance may approve a bill for more
 * than arrived — so only the floor is checked.)
 */
export function billedAfter(billedQty, quantity, sign) {
  const next = roundQty((billedQty || 0) + sign * quantity)
  return next < 0 ? null : next
}

// ₹3,000 rather than ₹3,000.00 — the mismatch is read, not added up.
const rupees = (n) => formatRupee(round2(n)).replace(/\.00$/, '')

/**
 * A billed line that cannot be stored at all, in words, or null. Whole-number
 * units (BOX, PCS) take whole numbers — half a box billed is a typing mistake,
 * not a difference to approve.
 */
export function lineProblem(orderLine, { quantity }, { wholeOnly = false } = {}) {
  if (!(quantity > 0)) return `${orderLine.itemName}: enter the quantity billed`
  if (wholeOnly && !Number.isInteger(quantity)) return `${orderLine.itemName} is counted in whole ${orderLine.unitCode}`
  return null
}

/**
 * One billed line beside its order line. `orderLine.billedQty` must not include
 * this bill. Returns what the bill line keeps — the order's net rate, what was
 * billable, and whether the quantity and the price agree — and the difference
 * in words (null when it all agrees).
 */
export function matchLine(orderLine, { quantity, rate, discountPct, gstRate }) {
  const billableQty = billableOf(orderLine)
  const orderNet = netRateOf(orderLine)
  const billNet = netRateOf({ rate, discountPct })
  const qtyOk = quantity <= billableQty + EPS
  const priceOk = Math.abs(billNet - orderNet) <= RATE_TOLERANCE + EPS
  const gstOk = (Number(gstRate) || 0) === (Number(orderLine.gstRate) || 0)

  const words = []
  if (!qtyOk) {
    words.push(billableQty > 0
      ? `${quantity} ${orderLine.unitCode} billed, only ${billableQty} received and not billed`
      : `${quantity} ${orderLine.unitCode} billed, none received and not yet billed`)
  }
  if (!priceOk) {
    const which = (Number(discountPct) || 0) || (Number(orderLine.discountPct) || 0) ? 'rate after discount' : 'rate'
    words.push(`${which} ${rupees(billNet)} vs ordered ${rupees(orderNet)}`)
  }
  if (!gstOk) words.push(`GST ${Number(gstRate) || 0}% vs ordered ${Number(orderLine.gstRate) || 0}%`)

  return {
    orderRate: round2(orderNet), billableQty, qtyOk, rateOk: priceOk && gstOk,
    problem: words.length ? `${orderLine.itemName}: ${words.join(', ')}` : null,
  }
}

/**
 * The whole bill matched. `orderLines` are the order's lines as they stand
 * (under its lock, when it counts); `billLines` the bill's, each with its
 * `orderLineId`. Returns each line's match (same order as `billLines`), and
 * the verdict: `matched`, and `mismatch` — every difference in plain words,
 * "Gloves: 12 BOX billed, only 10 received and not billed; Chair: rate
 * ₹3,100 vs ordered ₹3,000" — or null.
 */
export function matchBill(orderLines, billLines, { total, invoiceTotal } = {}) {
  const byId = new Map(orderLines.map((l) => [l.id, l]))
  const problems = []
  const lines = billLines.map((bl) => {
    const ol = byId.get(bl.orderLineId)
    if (!ol) {
      problems.push(`${bl.itemName}: no longer on the order`)
      return { orderRate: 0, billableQty: 0, qtyOk: false, rateOk: false }
    }
    const { problem, ...m } = matchLine(ol, bl)
    if (problem) problems.push(problem)
    return m
  })
  if (invoiceTotal != null && Math.abs(Number(invoiceTotal) - (Number(total) || 0)) > TOTAL_TOLERANCE + EPS) {
    problems.push(`Invoice total ${rupees(invoiceTotal)} vs ${rupees(total)} from the lines`)
  }
  return { lines, matched: problems.length === 0, mismatch: problems.length ? problems.join('; ') : null }
}

/**
 * The bill's money: the order's arithmetic for GST (lib/purchaseOrders), then
 * TDS on the value before GST, and what the vendor is paid.
 */
export function billTotals(lines, gstType, tdsRate = 0) {
  const t = orderTotals(lines, gstType)
  const tdsAmount = tdsAmountOf(t.subtotal, tdsRate)
  return { ...t, tdsAmount, payable: round2(t.total - tdsAmount) }
}

/**
 * Days the hospital has to pay: the order's terms, else the vendor's, else
 * 30. An MSME vendor is paid within 45 days by law, so longer terms are cut
 * to 45 (`capped`).
 */
export function paymentTermsFor({ orderTerms, vendorTerms, msme = false } = {}) {
  const agreed = orderTerms ?? vendorTerms ?? DEFAULT_TERMS_DAYS
  const days = msme ? Math.min(agreed, MSME_MAX_DAYS) : agreed
  return { days, capped: days < agreed }
}

/** The day payment is due: so many days after the vendor's invoice date. */
export const dueDateFor = (invoiceDate, days) => new Date(new Date(invoiceDate).getTime() + (Number(days) || 0) * 86400000)

/**
 * What submitting does to the bill, from the match: approved by itself when
 * everything agrees, otherwise on hold for Finance with the differences.
 */
export function submitOutcome({ matched, mismatch }, now = new Date()) {
  return matched
    ? { status: 'approved', matched: true, mismatch: null, submittedAt: now, decidedAt: now, decidedById: null, decidedByName: AUTO_DECIDER, decisionRemark: null }
    : { status: 'on_hold', matched: false, mismatch, submittedAt: now, decidedAt: null, decidedById: null, decidedByName: null, decisionRemark: null }
}
