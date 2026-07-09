// OPD invoice ledger. The Payment rows are the source of truth; Invoice.amountPaid /
// balanceDue / paymentStatus are a cache derived from them.
//
// WHY: these three values used to be recomputed by hand in four different places
// (record payment, refund, add invoice item, approve refund), each with a slightly
// different rule — so the "payment" path could never produce 'unpaid' and the
// "add item" path could never produce 'refunded'. This mirrors the IPD engine,
// where a single `recalcBill()` already does the same job (inpatient/billPaymentService.js).
import { round2 } from './money.js'

// Money compares need a paisa-width tolerance: totals are Float columns.
const EPS = 0.005

/**
 * Sum the ledger for one invoice.
 *  - paid:            money actually taken in (non-refund payments)
 *  - approvedRefunds: refunds a finance approver has signed off (money went back out)
 *  - pendingRefunds:  refunds awaiting approval — no cash has moved, but the amount
 *                     is RESERVED so the same money cannot be requested twice
 */
export async function invoiceLedger(tx, invoiceId) {
  const [paidAgg, approvedAgg, pendingAgg] = await Promise.all([
    tx.payment.aggregate({ where: { invoiceId, isRefund: false }, _sum: { amount: true } }),
    tx.payment.aggregate({ where: { invoiceId, isRefund: true, status: 'APPROVED' }, _sum: { amount: true } }),
    tx.payment.aggregate({ where: { invoiceId, isRefund: true, status: 'PENDING_APPROVAL' }, _sum: { amount: true } }),
  ])
  return {
    paid: round2(paidAgg._sum.amount || 0),
    approvedRefunds: round2(approvedAgg._sum.amount || 0),
    pendingRefunds: round2(pendingAgg._sum.amount || 0),
  }
}

/**
 * How much of this invoice can still be refunded.
 *   refundable = money taken in − (already-approved refunds + refunds awaiting approval)
 *
 * A REJECTED refund is deliberately NOT counted: the request was declined, no cash
 * moved, so it must release the amount it was holding. (Previously rejected refunds
 * kept consuming the balance forever, permanently blocking a legitimate refund.)
 */
export async function refundableAmount(tx, invoiceId) {
  const { paid, approvedRefunds, pendingRefunds } = await invoiceLedger(tx, invoiceId)
  return round2(paid - approvedRefunds - pendingRefunds)
}

/**
 * Recompute Invoice.amountPaid / balanceDue / paymentStatus from its Payment rows.
 * Call inside a transaction after any payment/refund/line-item change.
 *
 * `status` (the document lifecycle: draft|sent|overdue|paid|cancelled) is only
 * advanced once money has actually arrived, so an untouched draft stays a draft
 * and a cancelled invoice is never silently reopened.
 */
export async function recalcInvoice(tx, invoiceId) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { totalAmount: true, status: true },
  })
  if (!invoice) return null

  const { paid: grossPaid, approvedRefunds } = await invoiceLedger(tx, invoiceId)
  const total = round2(invoice.totalAmount)
  const amountPaid = round2(grossPaid - approvedRefunds)

  let paymentStatus
  if (amountPaid <= EPS) paymentStatus = approvedRefunds > 0 ? 'refunded' : 'unpaid'
  else if (amountPaid >= total - EPS) paymentStatus = 'paid'
  else paymentStatus = 'partially_paid'

  const data = { amountPaid, balanceDue: round2(total - amountPaid), paymentStatus }
  if (amountPaid > EPS && invoice.status !== 'cancelled') {
    data.status = paymentStatus === 'paid' ? 'paid' : 'sent'
  }

  await tx.invoice.update({ where: { id: invoiceId }, data })
  return { ...data, totalAmount: total }
}
