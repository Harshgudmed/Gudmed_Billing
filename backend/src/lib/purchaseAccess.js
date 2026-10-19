// Who may do what in Purchase, and how its handlers answer — shared by the
// request and order controllers so the two never drift apart.
import { db } from '../config/db.js'
import { getActor, getOrgId } from './reqContext.js'

// Purchase is OFF for a hospital until an administrator switches it on
// (Settings → Modules) — the screen's rule, src/lib/roleConfig.js isModuleOn:
// no `purchase` key reads as off. The API refuses the same, reads and writes;
// hiding the sidebar entry alone left the whole module answering.
//
// Read on every Purchase request, so an "on" answer is kept for a few seconds.
// An "off" answer is never kept: switching Purchase on works at once, and
// switching it off takes hold within ON_TTL_MS.
const ON_TTL_MS = 15_000
const purchaseOnAt = new Map() // orgId → when it was last read as on

export async function isPurchaseOn(orgId) {
  const at = purchaseOnAt.get(orgId)
  if (at && Date.now() - at < ON_TTL_MS) return true
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { modulesEnabled: true } })
  let modules = {}
  try { modules = JSON.parse(org?.modulesEnabled || '{}') || {} } catch { /* unreadable setting: treated as off below */ }
  const on = modules.purchase === true
  if (on) {
    if (purchaseOnAt.size > 5000) purchaseOnAt.clear()
    purchaseOnAt.set(orgId, Date.now())
  } else {
    purchaseOnAt.delete(orgId)
  }
  return on
}

/** Router guard for /api/purchase: refuses every request while Purchase is off for the hospital. */
export async function requirePurchaseOn(req, res, next) {
  try {
    if (await isPurchaseOn(getOrgId(req))) return next()
    return res.status(403).json({
      success: false,
      error: 'Purchase is switched off for this hospital — an administrator can turn it on in Settings → Modules',
      code: 'MODULE_OFF',
    })
  } catch (e) {
    next(e)
  }
}

// Who raises requests and orders and keeps the masters. A Finance Controller
// reaches Purchase to approve and to read, but does not buy.
// Doctors and nurses may raise a purchase request (they need something from
// the store); they cannot order, receive, bill or pay — and they see only
// their own requests with no money fields.
export const REQUEST_CREATOR_ROLES = new Set(['admin', 'super_admin', 'purchase_officer', 'store_keeper', 'doctor', 'nurse'])
export const canRaiseRequest = (req) => !req.user || REQUEST_CREATOR_ROLES.has(getActor(req).role)

export const BUYER_ROLES = new Set(['admin', 'super_admin', 'purchase_officer', 'store_keeper'])
export const ADMIN_ROLES = new Set(['admin', 'super_admin'])

// With login switched off (the demo) there is no user: everything is allowed,
// as on every other route.
export const canBuy = (req) => !req.user || BUYER_ROLES.has(getActor(req).role)
export const isAdmin = (req) => !req.user || ADMIN_ROLES.has(getActor(req).role)
/** A draft is its author's to change; an administrator may step in. */
export const ownsOrAdmin = (req, ownerId) => isAdmin(req) || (!!ownerId && ownerId === getActor(req).id)
/**
 * The part of a Prisma `where` that keeps other people's drafts out of a list
 * or a count — a draft is its author's until it is sent (an administrator may
 * look), so what cannot be opened is neither listed nor counted. `authorKey`
 * is the field naming the author on that document. Goes under `AND`.
 */
export const othersDraftsHidden = (admin, actorId, authorKey) =>
  (admin ? {} : { OR: [{ status: { not: 'draft' } }, { [authorKey]: actorId ?? '__none__' }] })

// Purchase orders carry the price, so placing one is for those who set prices.
// The store raises requests and receives goods; it does not order.
export const ORDER_ROLES = new Set(['admin', 'super_admin', 'purchase_officer'])
export const canOrder = (req) => !req.user || ORDER_ROLES.has(getActor(req).role)
// Receiving goods into stock: the store (and an administrator). Not the
// purchase officer: the person who places an order does not also confirm that
// its goods arrived — that is how a receipt for goods that never came is made.
export const RECEIVE_ROLES = new Set(['admin', 'super_admin', 'store_keeper'])
export const canReceive = (req) => !req.user || RECEIVE_ROLES.has(getActor(req).role)

// Vendors and items — the masters orders and prices are built on — are kept by
// those who order. Finance reads vendors (it pays them); the store does not need
// the vendor list: it raises requests from the item list and receives against
// orders, which carry the vendor's name and phone.
export const canManageMasters = canOrder
export const VENDOR_READERS = new Set(['admin', 'super_admin', 'purchase_officer', 'finance_controller'])
export const canSeeVendors = (req) => !req.user || VENDOR_READERS.has(getActor(req).role)

// Who sees every request and every order. The store sees its own requests, and
// of the orders only those it receives against (or has received).
export const OVERSEER_ROLES = new Set(['admin', 'super_admin', 'purchase_officer', 'finance_controller'])
export const seesEverything = (req) => !req.user || OVERSEER_ROLES.has(getActor(req).role)
export const STORE_ORDER_STATUSES = ['approved', 'sent', 'partly_received', 'received', 'closed']

// The store's shelf, item by item: the store, the purchase officer (who
// reorders) and an administrator. Finance sees the stock's total value on its
// dashboard, not the shelf; it still reads goods receipts — the evidence a
// vendor bill is checked against.
export const STOCK_ROLES = new Set(['admin', 'super_admin', 'store_keeper', 'purchase_officer'])
export const canSeeStock = (req) => !req.user || STOCK_ROLES.has(getActor(req).role)

// Vendor bills (step 3): the purchase officer enters them; Finance decides the
// ones that do not match and may cancel an approved one. The store has no part
// in bills — they are money.
export const BILL_ROLES = new Set(['admin', 'super_admin', 'purchase_officer'])
export const DECIDE_BILL_ROLES = new Set(['admin', 'super_admin', 'finance_controller'])
export const canBill = (req) => !req.user || BILL_ROLES.has(getActor(req).role)
export const canDecideBill = (req) => !req.user || DECIDE_BILL_ROLES.has(getActor(req).role)
export const canSeeBills = (req) => canBill(req) || canDecideBill(req)

// Store indents: any department raises one (/api/store-indents, the
// storeIndent module); the store issues against it, and the purchase officer
// reads them (what the wards use is what gets reordered).
export const ISSUE_ROLES = new Set(['admin', 'super_admin', 'store_keeper'])
export const INDENT_READ_ROLES = new Set(['admin', 'super_admin', 'store_keeper', 'purchase_officer'])
export const canIssue = (req) => !req.user || ISSUE_ROLES.has(getActor(req).role)
export const canSeeIndents = (req) => !req.user || INDENT_READ_ROLES.has(getActor(req).role)

// Vendor payments are money: never the store. Who records and who approves
// depends on the hospital's setting (lib/purchaseSettings.js paymentMode) —
// the payment controller decides with it; these are who may look.
export const PAYMENT_READ_ROLES = new Set(['admin', 'super_admin', 'finance_controller', 'purchase_officer'])
export const canSeePayments = (req) => !req.user || PAYMENT_READ_ROLES.has(getActor(req).role)

// Returns to the vendor: the store raises one (it holds the goods); the
// purchase officer approves it when the hospital asks for approval
// (purchaseSettings returnMode).
export const RETURN_RAISE_ROLES = new Set(['admin', 'super_admin', 'store_keeper'])
export const RETURN_DECIDE_ROLES = new Set(['admin', 'super_admin', 'purchase_officer'])
export const RETURN_READ_ROLES = new Set(['admin', 'super_admin', 'store_keeper', 'purchase_officer', 'finance_controller'])
export const canRaiseReturn = (req) => !req.user || RETURN_RAISE_ROLES.has(getActor(req).role)
export const canDecideReturn = (req) => !req.user || RETURN_DECIDE_ROLES.has(getActor(req).role)
export const canSeeReturns = (req) => !req.user || RETURN_READ_ROLES.has(getActor(req).role)

// RFQs: the purchase officer asks vendors and awards; Finance may read.
export const RFQ_ROLES = new Set(['admin', 'super_admin', 'purchase_officer'])
export const RFQ_READ_ROLES = new Set(['admin', 'super_admin', 'purchase_officer', 'finance_controller'])
export const canRfq = (req) => !req.user || RFQ_ROLES.has(getActor(req).role)
export const canSeeRfqs = (req) => !req.user || RFQ_READ_ROLES.has(getActor(req).role)

// Reports: every purchase role; the store's carry no money (hideMoney).
export const REPORT_ROLES = new Set(['admin', 'super_admin', 'purchase_officer', 'finance_controller', 'store_keeper'])
export const canSeeReports = (req) => !req.user || REPORT_ROLES.has(getActor(req).role)

// The store works in quantities. Rates, order totals and stock value are
// taken out of every response it gets — not hidden by the screen, absent from
// the data — so a store login cannot read what a vendor is paid.
const NO_MONEY_ROLES = new Set(['store_keeper', 'doctor', 'nurse'])
export const seesMoney = (req) => !req.user || !NO_MONEY_ROLES.has(getActor(req).role)

/**
 * A copy of `doc` without its money fields, and without the money fields of
 * each row in `doc[linesKey]`, when `req` may not see money. Otherwise `doc`
 * as it is.
 */
export function hideMoney(req, doc, { fields = [], lineFields = [], linesKey = 'lines' } = {}) {
  if (!doc || seesMoney(req)) return doc
  const out = { ...doc }
  for (const f of fields) delete out[f]
  if (Array.isArray(out[linesKey])) {
    out[linesKey] = out[linesKey].map((l) => { const c = { ...l }; for (const f of lineFields) delete c[f]; return c })
  }
  return out
}

// The money on each document, in one place.
export const MONEY = {
  order: { fields: ['subtotal', 'cgst', 'sgst', 'igst', 'total'], lineFields: ['rate', 'discountPct', 'taxable', 'gstAmount', 'lineTotal'] },
  receipt: { fields: ['totalValue'], lineFields: ['rate'] },
  stock: { fields: ['value'], lineFields: ['unitCost', 'value'], linesKey: 'batches' },
  // An item's last purchase price is what the vendor was last paid.
  item: { fields: ['lastPurchasePrice'] },
  // A request's estimate starts at that price, so it goes too.
  request: { fields: ['estimatedTotal'], lineFields: ['estimatedRate', 'lineTotal'] },
  // The ₹ amount each approval level starts at. The store's request form does
  // not need it: the levels are worked out from the last prices on sending.
  approvalRules: { lineFields: ['minAmount'], linesKey: 'rules' },
}

export const blank = (v) => v == null || String(v).trim() === ''

/** 400 with the first problem in words, and every problem in `details`. */
export const validationError = (res, error) =>
  res.status(400).json({ success: false, error: error.issues?.[0]?.message || 'Validation error', details: error.issues })

/** A thrown bad()/conflict()/forbidden() becomes its status; anything else goes to the error handler. */
export const sendError = (res, e, next) =>
  (e.status ? res.status(e.status).json({ success: false, error: e.message, code: e.code }) : next(e))
