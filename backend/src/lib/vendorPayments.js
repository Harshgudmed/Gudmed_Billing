// Vendor-payment rules — who pays, how much is still due, how old a payable
// is, and the MSME 45-day limit. Pure, so each is tested on its own
// (__tests__/vendorPayments.test.js); the payables query in
// purchasePaymentController.js works the same figures out in SQL for many
// bills at once, and its API check compares the two.
import { round2 } from './money.js'
import { MSME_MAX_DAYS, DEFAULT_TERMS_DAYS } from './vendorBills.js'

export { MSME_MAX_DAYS, DEFAULT_TERMS_DAYS }

/** How the money went: bank transfers, UPI, cheque, demand draft, cash. */
export const PAY_MODES = ['neft', 'rtgs', 'imps', 'upi', 'cheque', 'dd', 'cash']
/** What the reference is called for each — the words the refusal uses. */
export const REFERENCE_NAME = { neft: 'UTR number', rtgs: 'UTR number', imps: 'IMPS reference', upi: 'UPI reference', cheque: 'cheque number', dd: 'demand draft number' }

/** An MSME bill this many days or fewer from its 45-day limit is flagged. */
export const MSME_WARN_DAYS = 7

// The ageing buckets, by days past the due date. Due today is not overdue
// (the bill list's "Overdue" agrees: the due day itself is still in time).
export const BUCKETS = [
  { key: 'notDue', label: 'Not yet due', max: 0 },
  { key: 'd1_30', label: '1–30 days', max: 30 },
  { key: 'd31_60', label: '31–60 days', max: 60 },
  { key: 'd61_90', label: '61–90 days', max: 90 },
  { key: 'd90plus', label: 'Over 90 days', max: Infinity },
]
export const BUCKET_KEYS = BUCKETS.map((b) => b.key)

const ADMIN_ROLES = ['admin', 'super_admin']

/**
 * Who records a payment in each mode (lib/purchaseSettings.js paymentMode),
 * whether it posts at once or waits for approval, and who approves:
 *   finance          Finance (or an administrator) records → posted
 *   officer_finance  the purchase officer (or an administrator) records → pending;
 *                    Finance (or an administrator) approves or rejects
 *   admin            only an administrator records → posted
 * A payment left pending when the mode changes is still decided — in admin
 * mode by an administrator only.
 */
export function paymentRules(mode) {
  if (mode === 'officer_finance') {
    return { recorders: ['purchase_officer', ...ADMIN_ROLES], status: 'pending_approval', deciders: ['finance_controller', ...ADMIN_ROLES] }
  }
  if (mode === 'admin') return { recorders: ADMIN_ROLES, status: 'posted', deciders: ADMIN_ROLES }
  return { recorders: ['finance_controller', ...ADMIN_ROLES], status: 'posted', deciders: ['finance_controller', ...ADMIN_ROLES] }
}

/** What is still owed on a bill: payable, less debit notes, less posted payments. Never below 0. */
export const stillDue = ({ payable, debitNoteTotal, amountPaid } = {}) =>
  Math.max(0, round2((Number(payable) || 0) - (Number(debitNoteTotal) || 0) - (Number(amountPaid) || 0)))

/** What a new payment may be: still due, less what pending payments already hold. Never below 0. */
export const payableNow = (bill, pendingTotal = 0) => Math.max(0, round2(stillDue(bill) - (Number(pendingTotal) || 0)))

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' (calendar arithmetic, no time zone involved). */
export function addDays(ymd, days) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + (Number(days) || 0))).toISOString().slice(0, 10)
}

/** Whole days from calendar day `from` to calendar day `to` (both 'YYYY-MM-DD'); negative when `to` is earlier. */
export function daysBetween(from, to) {
  const t = (ymd) => { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((t(to) - t(from)) / 86400000)
}

/**
 * The day a bill is due: its own due date (set when it was entered), or —
 * for a bill without one — the vendor's payment terms (30 days when none)
 * from the bill's date. Both days as the hospital's calendar reads them.
 */
export const dueDayOf = ({ dueDay, invoiceDay, vendorTermsDays }) => dueDay || addDays(invoiceDay, vendorTermsDays ?? DEFAULT_TERMS_DAYS)

/** The ageing bucket for so many days past due (0 or less: not yet due). */
export function bucketOf(daysOverdue) {
  return BUCKETS.find((b) => daysOverdue <= b.max).key
}

/**
 * The MSMED Act, section 15: a micro or small enterprise is paid within 45
 * days of accepting its goods. The bill's date stands for the acceptance (the
 * bill's own due date is worked out from it too). Returns the last day, the
 * days left (negative once past), and the flag: 'past', 'near' (≤ 7 days
 * left) or null. Not an MSME → no flag.
 */
export function msmeStatus({ msme, invoiceDay, today }) {
  if (!msme) return { msmeDeadline: null, msmeDaysLeft: null, msmeFlag: null }
  const msmeDeadline = addDays(invoiceDay, MSME_MAX_DAYS)
  const msmeDaysLeft = daysBetween(today, msmeDeadline)
  const msmeFlag = msmeDaysLeft < 0 ? 'past' : msmeDaysLeft <= MSME_WARN_DAYS ? 'near' : null
  return { msmeDeadline, msmeDaysLeft, msmeFlag }
}

/** Everything the payables list says about one bill on `today`. */
export function ageOf({ dueDay, invoiceDay, vendorTermsDays, msme, today }) {
  const due = dueDayOf({ dueDay, invoiceDay, vendorTermsDays })
  const daysOverdue = daysBetween(due, today)
  return { dueDay: due, daysOverdue, bucket: bucketOf(daysOverdue), ...msmeStatus({ msme, invoiceDay, today }) }
}
