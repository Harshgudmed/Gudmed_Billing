import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'

/**
 * A purchase action that saved but could not put its bell notifications in
 * answers `warning` (the server's lib/purchaseNotify.js). Shown beside the
 * success message and long enough to read: the approvers were not told, so the
 * person who acted must tell them.
 */
export function showNotifyWarning(response) {
  if (response?.warning) toast.warning(response.warning, { duration: 12000 })
}

// What the purchase-request screens share: how a status and a priority look,
// what an approver role is called, and what the signed-in person may do. The
// server decides every action again; these only choose which buttons to show.

export const STATUS = {
  draft:     { label: 'Draft',            cls: 'border-gray-200 bg-gray-50 text-gray-700' },
  submitted: { label: 'Awaiting approval', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  approved:  { label: 'Approved',         cls: 'border-green-200 bg-green-50 text-green-700' },
  ordered:   { label: 'Ordered',          cls: 'border-blue-200 bg-blue-50 text-blue-700' },
  rejected:  { label: 'Rejected',         cls: 'border-red-200 bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelled',        cls: 'border-gray-200 bg-white text-gray-500' },
}

// A purchase order's statuses, in the HMS status colours.
export const ORDER_STATUS = {
  draft:           { label: 'Draft',             cls: 'border-gray-200 bg-gray-50 text-gray-700' },
  submitted:       { label: 'Awaiting approval', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  approved:        { label: 'Approved — to send', cls: 'border-green-200 bg-green-50 text-green-700' },
  sent:            { label: 'Sent to vendor',    cls: 'border-blue-200 bg-blue-50 text-blue-700' },
  partly_received: { label: 'Part received',     cls: 'border-orange-200 bg-orange-50 text-orange-700' },
  received:        { label: 'Received',          cls: 'border-purple-200 bg-purple-50 text-purple-700' },
  closed:          { label: 'Closed short',      cls: 'border-slate-300 bg-slate-50 text-slate-700' },
  rejected:        { label: 'Rejected',          cls: 'border-red-200 bg-red-50 text-red-700' },
  cancelled:       { label: 'Cancelled',         cls: 'border-gray-200 bg-white text-gray-500' },
}

// Several order statuses at once, as the dashboard counts them (orderFigures in
// purchaseOrderController.js), so a tile can open the orders it counts.
export const OPEN_ORDERS = 'approved,sent,partly_received' // ordered, not all in yet
export const GOODS_IN_ORDERS = 'partly_received,received,closed' // some or all of it received

// A goods receipt, and an item's stock.
export const RECEIPT_STATUS = {
  posted:    { label: 'Received',  cls: 'border-green-200 bg-green-50 text-green-700' },
  cancelled: { label: 'Cancelled', cls: 'border-gray-200 bg-white text-gray-500 line-through' },
}
// A vendor bill.
export const BILL_STATUS = {
  draft:     { label: 'Draft',                cls: 'border-gray-200 bg-gray-50 text-gray-700' },
  on_hold:   { label: 'On hold — mismatch',   cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  approved:  { label: 'Approved — to pay',    cls: 'border-green-200 bg-green-50 text-green-700' },
  rejected:  { label: 'Rejected',             cls: 'border-red-200 bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelled',            cls: 'border-gray-200 bg-white text-gray-500' },
  partly_paid: { label: 'Part paid',          cls: 'border-blue-200 bg-blue-50 text-blue-700' },
  paid:      { label: 'Paid',                 cls: 'border-purple-200 bg-purple-50 text-purple-700' },
}
export const STOCK_STATUS = {
  ok:   { label: 'In stock',     cls: 'border-green-200 bg-green-50 text-green-700' },
  low:  { label: 'Low',          cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  out:  { label: 'Out of stock', cls: 'border-red-200 bg-red-50 text-red-700' },
  none: { label: 'Never received', cls: 'border-gray-200 bg-gray-50 text-gray-500' },
}

export const GST_TYPE_LABEL = { intra: 'CGST + SGST', inter: 'IGST', none: 'No GST' }

export const PRIORITY = {
  normal:    { label: 'Normal',    cls: '' },
  urgent:    { label: 'Urgent',    cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  emergency: { label: 'Emergency', cls: 'border-red-300 bg-red-50 text-red-700' },
}

export const APPROVER_LABEL = {
  admin: 'Administrator',
  finance_controller: 'Finance Controller',
  purchase_officer: 'Purchase Officer',
}

// Mirrors backend/src/lib/purchaseAccess.js.
const BUYERS = new Set(['admin', 'super_admin', 'purchase_officer', 'store_keeper'])
const ADMINS = new Set(['admin', 'super_admin'])
const ORDERERS = new Set(['admin', 'super_admin', 'purchase_officer'])
const NO_MONEY = new Set(['store_keeper'])
const BILLERS = new Set(['admin', 'super_admin', 'purchase_officer'])
const RECEIVERS = new Set(['admin', 'super_admin', 'store_keeper'])
const VENDOR_READERS = new Set(['admin', 'super_admin', 'purchase_officer', 'finance_controller'])
const OVERSEERS = new Set(['admin', 'super_admin', 'purchase_officer', 'finance_controller'])
const STOCK_READERS = new Set(['admin', 'super_admin', 'store_keeper', 'purchase_officer'])
const BILL_DECIDERS = new Set(['admin', 'super_admin', 'finance_controller'])
const ISSUERS = new Set(['admin', 'super_admin', 'store_keeper'])
const INDENT_READERS = new Set(['admin', 'super_admin', 'store_keeper', 'purchase_officer'])
const PAYMENT_READERS = new Set(['admin', 'super_admin', 'finance_controller', 'purchase_officer'])
const RETURN_RAISERS = new Set(['admin', 'super_admin', 'store_keeper'])
const RETURN_DECIDERS = new Set(['admin', 'super_admin', 'purchase_officer'])
const RETURN_READERS = new Set(['admin', 'super_admin', 'store_keeper', 'purchase_officer', 'finance_controller'])
const RFQ_WRITERS = new Set(['admin', 'super_admin', 'purchase_officer'])
const RFQ_READERS = new Set(['admin', 'super_admin', 'purchase_officer', 'finance_controller'])
const REPORT_READERS = new Set(['admin', 'super_admin', 'purchase_officer', 'finance_controller', 'store_keeper'])

/**
 * The signed-in person, as the request screens need them. With login switched
 * off (the demo) there is no user, and the server allows everything — so the
 * screens do too.
 *
 *   canBuy     raises requests, keeps vendors and items
 *   canOrder   places, sends and closes purchase orders (sets prices)
 *   canReceive receives goods into stock — the store, never the person who ordered
 *   canManageMasters  adds and changes vendors and items (those who order)
 *   canSeeVendors     the vendor list (not the store)
 *   seesEverything    every request and order; the store sees its own requests
 *                     and the orders it receives against
 *   canSeeStock       the shelf item by item (Finance gets its value on the dashboard)
 *   seesMoney  rates, totals and stock value — the store works in quantities,
 *              and the server leaves money out of what it sends the store
 *   canBill    enters vendor bills (the purchase officer)
 *   canDecideBill  approves or rejects a bill that does not match; cancels one (Finance)
 *   canIssue / canSeeIndents   issues against department indents (the store) / reads them
 *   canSeePayments  vendor payments; who records and approves follows the hospital's setting
 *   canRaiseReturn / canDecideReturn / canSeeReturns  returns to the vendor
 *   canRfq / canSeeRfqs   requests for quotation
 *   canSeeReports   purchase reports (the store's without money)
 */
export function useMe() {
  const { user } = useAuth()
  if (!user) return { id: null, role: null, isAdmin: true, canBuy: true, canOrder: true, canReceive: true, seesMoney: true, canBill: true, canDecideBill: true, canManageMasters: true, canSeeVendors: true, seesEverything: true, canSeeStock: true, canIssue: true, canSeeIndents: true, canSeePayments: true, canRaiseReturn: true, canDecideReturn: true, canSeeReturns: true, canRfq: true, canSeeRfqs: true, canSeeReports: true }
  const id = user.id || user.userId || null
  const canBuy = BUYERS.has(user.role)
  return {
    id, role: user.role, isAdmin: ADMINS.has(user.role), canBuy,
    canOrder: ORDERERS.has(user.role), canReceive: RECEIVERS.has(user.role), seesMoney: !NO_MONEY.has(user.role),
    canManageMasters: ORDERERS.has(user.role), canSeeVendors: VENDOR_READERS.has(user.role), seesEverything: OVERSEERS.has(user.role),
    canSeeStock: STOCK_READERS.has(user.role),
    canBill: BILLERS.has(user.role), canDecideBill: BILL_DECIDERS.has(user.role),
    canIssue: ISSUERS.has(user.role), canSeeIndents: INDENT_READERS.has(user.role),
    canSeePayments: PAYMENT_READERS.has(user.role),
    canRaiseReturn: RETURN_RAISERS.has(user.role), canDecideReturn: RETURN_DECIDERS.has(user.role), canSeeReturns: RETURN_READERS.has(user.role),
    canRfq: RFQ_WRITERS.has(user.role), canSeeRfqs: RFQ_READERS.has(user.role),
    canSeeReports: REPORT_READERS.has(user.role),
  }
}

/** May `me` decide the request's current step? Mirrors lib/approvals.js actError. */
export function canDecide(me, pr) {
  const step = pr?.currentStep
  if (!step || pr.status !== 'submitted') return false
  if (me.isAdmin) return true
  // …and not who approved an earlier level: the next one is another person's.
  const approvedEarlier = (pr.steps || []).some((s) => s.status === 'approved' && s.actedById === me.id)
  return me.role === step.approverRole && me.id !== pr.requestedById && !approvedEarlier
}

/** May `me` change, send, cancel or delete this request (its author, or an administrator)? */
export const ownsOrAdmin = (me, pr) => me.isAdmin || (!!me.id && me.id === pr?.requestedById)
