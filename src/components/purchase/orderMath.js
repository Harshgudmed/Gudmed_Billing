import { formatMoney, localYmd } from '@/lib/format'

// The order arithmetic, for showing totals while a form is typed. The server
// works every figure out again on save (backend/src/lib/purchaseOrders.js —
// same rules: GST follows the vendor, CGST/SGST split with SGST taking the odd
// paisa), so what is stored never depends on this copy.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** none = vendor not GST-registered; intra = same state; inter = another state. */
export function gstTypeFor(vendor, hospitalStateCode) {
  if (!vendor?.gstNumber) return 'none'
  if (vendor.stateCode && hospitalStateCode && vendor.stateCode !== hospitalStateCode) return 'inter'
  return 'intra'
}

export function lineAmounts({ quantity, rate, discountPct = 0, gstRate = 0 }, gstType = 'intra') {
  const taxable = round2((Number(quantity) || 0) * (Number(rate) || 0) * (1 - (Number(discountPct) || 0) / 100))
  const gstAmount = gstType === 'none' ? 0 : round2(taxable * (Number(gstRate) || 0) / 100)
  return { taxable, gstAmount, lineTotal: round2(taxable + gstAmount) }
}

export function orderTotals(lines, gstType = 'intra') {
  const subtotal = round2(lines.reduce((s, l) => s + (l.taxable || 0), 0))
  const gst = round2(lines.reduce((s, l) => s + (l.gstAmount || 0), 0))
  let cgst = 0, sgst = 0, igst = 0
  if (gstType === 'intra') { cgst = round2(gst / 2); sgst = round2(gst - cgst) } else if (gstType === 'inter') igst = gst
  return { subtotal, cgst, sgst, igst, total: round2(subtotal + gst) }
}

// ── Vendor bills ─────────────────────────────────────────────────────────────
// A bill is checked three ways: the order's rate, the goods received, and what
// the vendor's invoice says. The server decides the match on save; these let
// the bill form say what will happen while it is typed, and a saved bill say
// in words why a line was held.

/** The rate per unit once its discount is taken off — what bill and order are compared on. */
export const netRateOf = (rate, discountPct = 0) => (Number(rate) || 0) * (1 - (Number(discountPct) || 0) / 100)

/** TDS is deducted on the value before GST, in whole rupees. */
export const tdsAmountFor = (subtotal, rate) => Math.round((Number(subtotal) || 0) * (Number(rate) || 0) / 100)

/** The day a bill falls due, "YYYY-MM-DD": its invoice date plus the payment days. Null when either is missing. */
export function dueDateFor(invoiceYmd, days) {
  if (!invoiceYmd || days == null || days === '') return null
  return localYmd(new Date(`${invoiceYmd}T00:00:00`), Number(days) || 0)
}

const qty3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000

/**
 * How one bill line differs from its order line and the goods received —
 * [] when it agrees. Each is { kind: 'qty' | 'rate' | 'gst', text }.
 * `against` is { billable, netRate, gstRate, unitCode }; leave gstRate out
 * when it is not known (a saved bill keeps only whether the rate matched) and
 * that check is skipped. Billing fewer than received is fine — the rest is
 * billed later. Rates agree within a paisa, as the server compares them.
 */
export function billLineDifferences({ quantity, rate, discountPct, gstRate }, { billable, netRate, gstRate: orderGst, unitCode = '' }) {
  const out = []
  const unit = unitCode ? ` ${unitCode}` : ''
  const over = qty3(qty3(quantity) - qty3(billable))
  if (over > 0) out.push({ kind: 'qty', text: `${over}${unit} more than received` })
  const diff = netRateOf(rate, discountPct) - (Number(netRate) || 0)
  if (Math.abs(diff) > 0.01 + 1e-9) out.push({ kind: 'rate', text: `${formatMoney(Math.abs(diff))}${unitCode ? ` per ${unitCode}` : ''} ${diff > 0 ? 'more' : 'less'} than ordered` })
  if (orderGst != null && (Number(gstRate) || 0) !== (Number(orderGst) || 0)) out.push({ kind: 'gst', text: `GST ${Number(gstRate) || 0}% — the order has ${Number(orderGst) || 0}%` })
  return out
}

// Money is still owed on these: waiting for Finance, approved, or part paid.
const UNPAID_BILL = new Set(['on_hold', 'approved', 'partly_paid'])

/** Is the bill past its due date with money still owed on it? */
export function billOverdue({ status, dueDate } = {}) {
  return !!dueDate && UNPAID_BILL.has(status) && localYmd(new Date(dueDate)) < localYmd()
}

/** What saving or submitting a bill did, for the toast. */
export function billOutcomeText(bill) {
  if (bill?.status === 'approved') return `${bill.number} matches the order and the goods received — approved for payment`
  if (bill?.status === 'on_hold') return `${bill.number} is on hold — Finance will check the differences`
  return `${bill?.number || 'Bill'} saved as a draft`
}
