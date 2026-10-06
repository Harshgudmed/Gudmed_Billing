// Who may do what in Billing — one table, read by billingController for every
// write and mirrored for the screens in src/lib/billing.js (useBillingAccess).
//
// Separation of duties, as hospitals run it: the counters raise bills and take
// money; the Finance Controller sets prices and releases refunds, and does not
// take money itself — the person who approves a refund is never the one who
// collected it. An administrator may do everything. Reading invoices stays open
// to every staff role: other screens (receipts, lab and radiology orders) read
// them.
//
// With login switched off (the demo) there is no user and nothing is refused,
// as on every other route.
import { getActor } from './reqContext.js'

const ADMINS = ['admin', 'super_admin']

export const BILLING_ROLES = {
  // Raise an invoice, add a line to it, take a payment: the billing counters,
  // and the departments that bill their own work (a pharmacy sale, a lab or
  // radiology order) through the same API.
  raise: ['receptionist', 'billing', 'billing_clerk', 'pharmacist', 'lab_technician', 'radiology_technician'],
  // Ask for a refund, cancel or re-date an invoice: the billing counters.
  adjust: ['receptionist', 'billing', 'billing_clerk'],
  // Approve or reject a refund: it releases hospital money.
  approve: ['finance_controller'],
  // Add or change the prices in the service catalogue.
  catalog: ['finance_controller'],
  // Raise and move insurance claims (TPA): the billing desk.
  claims: ['billing', 'billing_clerk'],
}

// Who may read insurance cases and claims at all: the billing desk, and Finance
// to review them (routes/index.js guards /insurance with this list).
export const INSURANCE_READERS = ['billing', 'billing_clerk', 'finance_controller']

export const BILLING_REFUSED = {
  raise: 'Only the billing counter raises invoices and takes payments',
  adjust: 'Only the billing counter asks for refunds or cancels invoices',
  approve: 'Only the Finance Controller or an administrator approves refunds',
  catalog: 'Only the Finance Controller or an administrator changes service prices',
  claims: 'Only the billing desk raises or changes insurance claims',
}

/** May the signed-in person do `what` (a BILLING_ROLES key)? */
export function billingAllows(req, what) {
  if (!req.user) return true
  const { role } = getActor(req)
  return ADMINS.includes(role) || (BILLING_ROLES[what] || []).includes(role)
}

// Which rule each write needs, by resource.
export const CREATE_NEEDS = { service: 'catalog', invoice: 'raise', payment: 'raise', invoiceItem: 'raise', refund: 'adjust', approve_refund: 'approve' }
export const UPDATE_NEEDS = { service: 'catalog', invoice: 'adjust' }

/** 403 with the reason when `needs[resource]` is not allowed; null when it is (or the resource is not a write we know). */
export function refuseBilling(req, res, needs, resource) {
  const need = needs[resource]
  if (!need || billingAllows(req, need)) return null
  return res.status(403).json({ success: false, error: BILLING_REFUSED[need], code: 'FORBIDDEN' })
}
