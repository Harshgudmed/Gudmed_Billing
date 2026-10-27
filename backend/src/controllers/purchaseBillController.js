// Vendor bills (step 3: the 3-way match) — reached through /api/purchase,
// dispatched here by purchaseController for these resources:
//
// GET    ?resource=bill-candidates            orders with goods received and not yet billed
// GET    ?resource=bill-candidates&orderId=   one order's lines still to bill, with the TDS and due-date defaults
// GET    ?resource=bills                      list (search, status, view=on-hold|approved|mine, orderId, paging) + summary
// GET    ?resource=bill&id=                   one bill with its lines
// POST   {resource:'bill'}                    a new DRAFT (submit: true sends it on at once)
// PATCH  {resource:'bill', action}            save | submit | approve | reject | cancel | reopen
// DELETE ?resource=bill&id=                   a draft
//
// A bill is the vendor's invoice for goods received on ONE purchase order.
// The life of a bill:
//   draft ─submit→ approved            every line agrees (lib/vendorBills matchBill)
//              └──→ on_hold ─approve→ approved     Finance accepts the difference
//                          └─reject→ rejected ─reopen→ draft
//   approved ─cancel→ cancelled        only while no payment and no posted return is on it
//
// The rules it keeps:
//  • Every id comes from the request, so every one is checked against this
//    hospital: the order, its lines, the bill.
//  • The match is worked out when the bill is submitted, under the order's row
//    lock — the same lock goods receipts take — so it is checked against the
//    goods as they stand. A submitted bill (held or approved) counts its
//    quantities against the order lines (billedQty); rejecting or cancelling it
//    gives them back. Two bills for one order submitted at once take turns, and
//    the second sees what the first claimed.
//  • One vendor invoice, one bill: the same invoice number from the same vendor
//    is refused while another bill holds it (anything but cancelled) — the
//    commonest way a vendor is paid twice. Checked on create, save and submit
//    under an advisory lock on the number, so two at once cannot both pass.
//  • The purchase officer enters bills; Finance decides the ones on hold and
//    cancels approved ones, and never a bill they entered themselves (an
//    administrator may). The store has no part in bills (lib/purchaseAccess).
import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { round2, formatRupee } from '../lib/money.js'
import { parseUserDate, ymdInZone, dayRange } from '../lib/dates.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { listResponse } from '../lib/pagination.js'
import { auditIpd } from '../inpatient/audit.js'
import { canBill, canDecideBill, canSeeBills, isAdmin, ownsOrAdmin, othersDraftsHidden, blank, validationError, sendError } from '../lib/purchaseAccess.js'
import { lineAmounts, GST_RATES } from '../lib/purchaseOrders.js'
import { roundQty } from '../lib/purchaseReceipts.js'
import { invoiceKey, netRateOf, billableOf, billedAfter, lineProblem, matchBill, billTotals, paymentTermsFor, dueDateFor, submitOutcome } from '../lib/vendorBills.js'
import { TDS_SECTION_CODES, MAX_TDS_RATE, tdsDefault, tdsSectionsFor, resolveTds } from '../lib/tds.js'
import { lockOrder, hospital } from './purchaseOrderController.js'
import { billChanged } from '../lib/purchaseNotify.js'
import { withReturnsOnBills } from './purchaseReturnController.js'

export const BILL_READS = new Set(['bills', 'bill', 'bill-candidates'])
export const BILL_WRITES = new Set(['bill'])

// An order is billed once it is approved: goods may arrive before it is marked
// sent, and a closed order still owes the bill for what did arrive.
const BILLABLE = ['approved', 'sent', 'partly_received', 'received', 'closed']
const ACTIONS = ['save', 'submit', 'approve', 'reject', 'cancel', 'reopen']
// A bill of many lines does many writes; give it room on a slow database.
const TX = { maxWait: 10000, timeout: 30000 }
const STATUS_WORDS = { draft: 'a draft', on_hold: 'on hold', approved: 'approved', rejected: 'rejected', cancelled: 'cancelled' }
const statusWords = (s) => STATUS_WORDS[s] || s.replace('_', ' ')

// ── Validation ───────────────────────────────────────────────────────────────

// A field left OUT of a save stays as it is (undefined); one sent empty is
// cleared (null).
const keepOrClear = (fn) => (v) => (v === undefined ? undefined : blank(v) ? null : fn(v))
const amount = (label, max) => z.number({ invalid_type_error: `${label} must be a number` })
  .finite(`${label} must be a number`).min(0, `${label} cannot be below 0`).max(max, `${label} is too large`)
const optAmount = (label, max) => z.preprocess((v) => (blank(v) ? undefined : Number(v)), amount(label, max).optional())

const lineSchema = z.object({
  orderLineId: z.string({ required_error: 'A line is missing its order line' }).min(1, 'A line is missing its order line'),
  quantity: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number({ required_error: 'Enter the quantity billed on every line', invalid_type_error: 'Quantity must be a number' })
      .finite('Quantity must be a number').max(1e7, 'Quantity is too large')
      .transform(roundQty).refine((v) => v > 0, 'The quantity billed must be more than 0')),
  rate: optAmount('Rate', 1e9),
  discountPct: optAmount('Discount', 100),
  gstRate: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number({ invalid_type_error: 'GST must be a number' })
      .refine((v) => GST_RATES.includes(v), () => ({ message: `GST must be one of ${GST_RATES.join(', ')}%` })).optional()),
})

const headerFields = {
  orderId: z.string({ required_error: 'Choose the purchase order this bill is for' }).min(1, 'Choose the purchase order this bill is for'),
  vendorInvoiceNumber: z.preprocess((v) => (blank(v) ? undefined : String(v).trim()),
    z.string({ required_error: 'Enter the invoice number printed on the vendor\'s bill' }).max(60, 'The invoice number can be at most 60 characters')),
  vendorInvoiceDate: z.preprocess((v) => (blank(v) ? undefined : v),
    z.string({ required_error: 'Enter the date on the vendor\'s invoice', invalid_type_error: 'Enter the invoice date like 2026-10-01' })),
  invoiceTotal: z.preprocess(keepOrClear(Number), amount('Invoice total', 1e10).nullable().optional()),
  // null or '' = no TDS on this bill; left out = the vendor's default (create) or as it is (save)
  tdsSection: z.preprocess(keepOrClear((v) => String(v).trim().toUpperCase()),
    z.enum(TDS_SECTION_CODES, { errorMap: () => ({ message: 'Choose a TDS section from the list' }) }).nullable().optional()),
  tdsRate: z.preprocess((v) => (blank(v) ? undefined : Number(v)),
    z.number({ invalid_type_error: 'TDS rate must be a number' }).finite('TDS rate must be a number')
      .min(0, 'TDS rate cannot be below 0').max(MAX_TDS_RATE, `TDS rate can be at most ${MAX_TDS_RATE}%`).optional()),
  notes: z.preprocess(keepOrClear((v) => String(v).trim()), z.string().max(500, 'Notes can be at most 500 characters').nullable().optional()),
  lines: z.array(lineSchema, { required_error: 'Add at least one line to bill', invalid_type_error: 'Lines must be a list' })
    .min(1, 'Add at least one line to bill').max(300, 'At most 300 lines on one bill'),
}
const createSchema = z.object({ ...headerFields, submit: z.boolean().optional() })
const saveSchema = z.object({ id: z.string().min(1, 'Which bill?'), ...headerFields })
  .partial({ orderId: true, vendorInvoiceNumber: true, vendorInvoiceDate: true, lines: true })

/** The vendor's invoice date: a real calendar date, and not after today. */
function invoiceDateOf(value) {
  const date = parseUserDate(value, 'The vendor\'s invoice date', { minYear: 2000 })
  // A date, not a moment, so it is compared by the hospital's calendar day:
  // "2026-10-02" is 05:30 that morning in India, and a clock comparison would
  // call today's invoice "the future" between midnight and half past five.
  if (ymdInZone(date) > ymdInZone(new Date())) throw bad('The vendor\'s invoice date cannot be in the future')
  return date
}

/** The invoice number's duplicate-check key; a number of only dashes and spaces has none. */
function keyOf(number) {
  const key = invoiceKey(number)
  if (!key) throw bad('The invoice number needs at least one letter or digit')
  return key
}

// ── Shared steps ─────────────────────────────────────────────────────────────

// Each order line with whether its unit takes fractions (2.5 L, not 2.5 BOX).
const LINE_INCLUDE = { unit: { select: { allowsFraction: true } } }

const BILL_INCLUDE = {
  lines: {
    orderBy: { sortOrder: 'asc' },
    include: {
      // The order line as it stands now, so an open draft can show what is
      // still billable and whether its unit takes fractions.
      orderLine: { select: { quantity: true, receivedQty: true, billedQty: true, rate: true, discountPct: true, gstRate: true, unit: { select: { allowsFraction: true } } } },
    },
  },
  order: { select: { id: true, number: true, status: true } },
  vendor: { select: { id: true, name: true, gstNumber: true, pan: true, msmeNumber: true } },
  // Attached invoice / supporting files (newest first), for the bill detail screen.
  documents: {
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, docType: true, label: true, fileName: true, fileUrl: true, uploadedAt: true },
  },
}

async function readFull(ORG_ID, id, client = db) {
  const bill = await client.vendorBill.findFirst({ where: { id, organizationId: ORG_ID }, include: BILL_INCLUDE })
  if (!bill) return null
  // with the hospital, for the printed bill
  return { ...bill, hospital: await hospital(ORG_ID, client) }
}

/**
 * Runs `work` and reads the bill back in the same transaction, so a write
 * answers with exactly what it committed. Read after the commit, a dropped
 * connection answered 500 for a bill that had changed (and the client may
 * repeat it), and a draft deleted in that moment answered null.
 * `audit(tx, after)` writes the audit row in the same transaction, so the
 * change and its record commit together or not at all.
 */
function writeBill(ORG_ID, id, audit, work) {
  return db.$transaction(async (tx) => {
    await work(tx)
    const after = await readFull(ORG_ID, id, tx)
    await audit(tx, after)
    return after
  }, TX)
}

function assertBillable(po) {
  if (!BILLABLE.includes(po.status)) {
    throw conflict(`Bills are entered against an approved order — ${po.number} is ${po.status.replace('_', ' ')}`)
  }
}

/** The order's vendor, as it is today (its PAN and terms decide TDS and the due date). */
async function vendorOf(tx, ORG_ID, vendorId) {
  const v = await tx.vendor.findFirst({
    where: { id: vendorId, organizationId: ORG_ID },
    select: { id: true, name: true, pan: true, msmeNumber: true, paymentTermsDays: true, defaultTdsSection: true },
  })
  if (!v) throw notFound('The order\'s vendor was not found')
  return v
}

/**
 * Refuses a second bill for the same vendor invoice. The advisory lock on
 * (hospital, vendor, number) is held to the end of the transaction, so two
 * people entering the same paper at the same moment take turns and the second
 * is refused. Always taken AFTER the order's row lock, in every path, so two
 * transactions can never wait on each other.
 */
async function guardDuplicate(tx, ORG_ID, vendor, key, exceptId = null) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${ORG_ID}:${vendor.id}:${key}`}))`
  const twin = await tx.vendorBill.findFirst({
    where: { organizationId: ORG_ID, vendorId: vendor.id, vendorInvoiceKey: key, status: { not: 'cancelled' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { number: true, vendorInvoiceNumber: true, status: true },
  })
  if (twin) {
    throw conflict(`Invoice ${twin.vendorInvoiceNumber} from ${vendor.name} is already entered as ${twin.number} (${statusWords(twin.status)}) — the same invoice cannot be billed twice`, 'DUPLICATE_INVOICE')
  }
}

/**
 * Typed lines → bill lines, priced and taxed. A rate, discount or GST rate
 * not typed is the order line's. Each line must be a line of this order, once.
 */
function priceLines(po, lines) {
  const byId = new Map(po.lines.map((l) => [l.id, l]))
  const seen = new Set()
  return lines.map((l, i) => {
    const ol = byId.get(l.orderLineId)
    if (!ol) throw bad('A line is not on this order — reload the order and try again')
    if (seen.has(ol.id)) throw bad(`${ol.itemName} is on the bill twice`)
    seen.add(ol.id)
    const problem = lineProblem(ol, l, { wholeOnly: !ol.unit?.allowsFraction })
    if (problem) throw bad(problem)
    const priced = {
      quantity: l.quantity,
      rate: round2(l.rate ?? ol.rate),
      discountPct: l.discountPct ?? ol.discountPct,
      // A vendor that is not GST-registered charges none, whatever was typed.
      gstRate: po.gstType === 'none' ? 0 : (l.gstRate ?? ol.gstRate),
    }
    return {
      organizationId: po.organizationId, orderLineId: ol.id,
      itemId: ol.itemId, itemCode: ol.itemCode, itemName: ol.itemName, hsnCode: ol.hsnCode, unitCode: ol.unitCode,
      ...priced, ...lineAmounts(priced, po.gstType), sortOrder: i,
    }
  })
}

/**
 * Everything a bill's header holds that follows from its lines, its vendor and
 * its dates: totals, TDS, terms and due date, and the match as it would come
 * out now. On a draft the match is a preview (lines' flags and `mismatch`);
 * `matched` stays false until the bill is submitted and the verdict is given.
 */
function figures(po, vendor, rows, { tds, invoiceTotal, vendorInvoiceDate }) {
  const totals = billTotals(rows, po.gstType, tds.tdsRate)
  const terms = paymentTermsFor({ orderTerms: po.paymentTermsDays, vendorTerms: vendor.paymentTermsDays, msme: !blank(vendor.msmeNumber) })
  const preview = matchBill(po.lines, rows, { total: totals.total, invoiceTotal })
  return {
    rows: rows.map((r, i) => ({ ...r, ...preview.lines[i] })),
    header: {
      // The bill is billed in the order's currency (copied so the document shows both).
      gstType: po.gstType, currency: po.currency ?? 'INR', exchangeRate: po.exchangeRate ?? 1, ...totals, ...tds,
      paymentTermsDays: terms.days, dueDate: dueDateFor(vendorInvoiceDate, terms.days),
      matched: false, mismatch: preview.mismatch,
    },
  }
}

/**
 * The order, row-locked, with each line's unit and what posted returns set
 * against bills took of it (withReturnsOnBills) — so the match's "billable"
 * leaves out goods sent back before billing, and counts those on a bill once.
 */
async function lockOrderForBill(tx, ORG_ID, orderId) {
  const po = await lockOrder(tx, ORG_ID, orderId, { lineInclude: LINE_INCLUDE })
  await withReturnsOnBills(tx, ORG_ID, po.lines)
  return po
}

/**
 * The order, row-locked, then the bill, row-locked, re-read under both — the
 * same order of locks as every other path, so a submit, a decision and a goods
 * receipt on one order take turns instead of waiting on each other.
 */
async function lockBill(tx, ORG_ID, id) {
  const head = await tx.vendorBill.findFirst({ where: { id, organizationId: ORG_ID }, select: { orderId: true } })
  if (!head) throw notFound('Vendor bill not found')
  const po = await lockOrderForBill(tx, ORG_ID, head.orderId)
  await tx.$executeRaw`SELECT 1 FROM "VendorBill" WHERE "id" = ${id} AND "organizationId" = ${ORG_ID} FOR UPDATE`
  const bill = await tx.vendorBill.findFirst({ where: { id, organizationId: ORG_ID }, include: { lines: { orderBy: { sortOrder: 'asc' } } } })
  return { bill, po }
}

/**
 * Adds (sign 1) or gives back (sign −1) the bill's quantities on its order
 * lines. Only ever on the order locked in this transaction.
 *
 * A bill's lines are its own order's (priceLines) and an order that can be
 * billed never loses a line, so a line missing from the order — like a count
 * that would go below 0 (lib/vendorBills billedAfter) — means the ledger was
 * changed outside Purchase: it is refused, and the caller's transaction rolls
 * back, instead of being skipped or cut to 0, which hid the mismatch.
 */
async function moveBilled(tx, po, bill, sign) {
  const byId = new Map(po.lines.map((l) => [l.id, l]))
  for (const line of bill.lines) {
    const ol = byId.get(line.orderLineId)
    if (!ol) throw conflict(`${bill.number}: its ${line.itemName} line is not on ${po.number} — the bill and its order do not agree. Nothing was changed.`)
    const billedQty = billedAfter(ol.billedQty, line.quantity, sign)
    if (billedQty === null) {
      throw conflict(`${bill.number}: ${po.number} shows ${ol.billedQty || 0} ${line.unitCode} of ${line.itemName} billed, less than the ${line.quantity} on this bill — the order and its bills do not agree. Nothing was changed.`)
    }
    await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { billedQty } })
    ol.billedQty = billedQty
  }
}

/**
 * Sends a draft on: the 3-way match against the order as it stands now (its
 * row lock is held), each line's result stored, the quantities claimed, and
 * the bill approved by itself or put on hold. Returns the new status.
 */
async function submitBill(tx, ORG_ID, bill, po, vendor) {
  assertBillable(po)
  await guardDuplicate(tx, ORG_ID, vendor, bill.vendorInvoiceKey, bill.id)
  const match = matchBill(po.lines, bill.lines, { total: bill.total, invoiceTotal: bill.invoiceTotal })
  for (const [i, line] of bill.lines.entries()) {
    await tx.vendorBillLine.update({ where: { id: line.id }, data: match.lines[i] })
  }
  await moveBilled(tx, po, bill, 1)
  const outcome = submitOutcome(match)
  await tx.vendorBill.update({ where: { id: bill.id }, data: outcome })
  return outcome.status
}

/**
 * A bill with documents built on it is not cancelled (CLAUDE.md: undoing a
 * document without its dependants): payments posted or waiting for approval on
 * it, and posted returns whose debit note is set against it. Each is named, so
 * Finance knows what to undo first.
 */
async function refuseIfDependants(tx, ORG_ID, bill) {
  const [payments, returns] = await Promise.all([
    tx.vendorPayment.findMany({ where: { organizationId: ORG_ID, billId: bill.id, status: { in: ['posted', 'pending_approval'] } }, select: { number: true, status: true, amount: true }, orderBy: { number: 'asc' } }),
    tx.purchaseReturn.findMany({ where: { organizationId: ORG_ID, billId: bill.id, status: 'posted' }, select: { number: true, debitNoteNumber: true }, orderBy: { number: 'asc' } }),
  ])
  const parts = []
  if (payments.length) parts.push(`payment${payments.length === 1 ? '' : 's'} ${payments.map((p) => `${p.number} (${formatRupee(p.amount)}${p.status === 'pending_approval' ? ', waiting for approval' : ''})`).join(', ')}`)
  if (returns.length) parts.push(`return${returns.length === 1 ? '' : 's'} ${returns.map((r) => `${r.number}${r.debitNoteNumber ? ` (debit note ${r.debitNoteNumber})` : ''}`).join(', ')}`)
  const one = payments.length + returns.length === 1
  if (parts.length) throw conflict(`${bill.number} cannot be cancelled: ${parts.join(' and ')} ${one ? 'is' : 'are'} set against it — cancel ${one ? 'it' : 'them'} first`)
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Orders of this hospital with something received and not yet billed. Worked
 * out in the database: received − billed cannot be put in a Prisma filter, and
 * received orders pile up for years. Quantities keep three decimals, so
 * anything under half a thousandth is dust. Goods sent back before they were
 * billed are not billable; those sent back against a bill are already on it —
 * the same rule as lib/vendorBills billableOf.
 */
async function candidateOrderIds(ORG_ID) {
  const rows = await db.$queryRaw`
    SELECT DISTINCT o."id" FROM "PurchaseOrder" o
    JOIN "PurchaseOrderLine" l ON l."orderId" = o."id" AND l."organizationId" = ${ORG_ID}
    WHERE o."organizationId" = ${ORG_ID} AND o."status" = ANY(${BILLABLE})
      AND l."receivedQty" - l."billedQty" - l."returnedQty" + COALESCE((
        SELECT SUM(rl."quantity") FROM "PurchaseReturnLine" rl
        JOIN "PurchaseReturn" r ON r."id" = rl."returnId"
        WHERE rl."orderLineId" = l."id" AND r."status" = 'posted' AND r."billId" IS NOT NULL), 0) > 0.0005`
  return rows.map((r) => r.id)
}

/** The value still to bill on an order line, before GST, at the order's price. */
const unbilledValueOf = (l) => lineAmounts({ quantity: billableOf(l), rate: l.rate, discountPct: l.discountPct }, 'none').taxable

// `draftsShown` (othersDraftsHidden) keeps out of the counts the drafts the
// list leaves out — another person's, which cannot be opened.
async function billSummary(ORG_ID, draftsShown = {}) {
  const sum = (status) => db.vendorBill.aggregate({ where: { organizationId: ORG_ID, status }, _count: { _all: true }, _sum: { payable: true } })
  const [onHold, approved, drafts, toBill, all] = await Promise.all([
    sum('on_hold'), sum('approved'),
    db.vendorBill.count({ where: { organizationId: ORG_ID, status: 'draft', AND: [draftsShown] } }),
    candidateOrderIds(ORG_ID),
    db.vendorBill.count({ where: { organizationId: ORG_ID, AND: [draftsShown] } }),
  ])
  const pair = (a) => ({ count: a._count._all, amount: round2(a._sum.payable) })
  return { onHold: pair(onHold), approved: pair(approved), drafts, toBill: toBill.length, all }
}

/** The Purchase dashboard's bill figures: on hold and approved (what is to be paid), and orders still to bill. */
export async function billFigures(ORG_ID) {
  const { onHold, approved, toBill } = await billSummary(ORG_ID)
  return { onHold, approved, toBill }
}

async function candidates(req, res, ORG_ID) {
  const orderId = req.query.orderId ? String(req.query.orderId) : null

  if (!orderId) {
    const ids = await candidateOrderIds(ORG_ID)
    const orders = ids.length ? await db.purchaseOrder.findMany({
      where: { id: { in: ids }, organizationId: ORG_ID }, orderBy: { createdAt: 'asc' },
      select: { id: true, number: true, status: true, vendorId: true, vendorName: true, lines: { select: { id: true, receivedQty: true, billedQty: true, returnedQty: true, rate: true, discountPct: true } } },
    }) : []
    await withReturnsOnBills(db, ORG_ID, orders.flatMap((o) => o.lines))
    const data = orders.map((o) => {
      const open = o.lines.filter((l) => billableOf(l) > 0)
      return {
        orderId: o.id, number: o.number, vendorId: o.vendorId, vendorName: o.vendorName, status: o.status,
        unbilledLines: open.length, unbilledValue: round2(open.reduce((s, l) => s + unbilledValueOf(l), 0)),
      }
    })
    return res.json({ success: true, data })
  }

  // One order: what the bill form starts from.
  const po = await db.purchaseOrder.findFirst({
    where: { id: orderId, organizationId: ORG_ID },
    include: {
      vendor: { select: { gstNumber: true, pan: true, msmeNumber: true, defaultTdsSection: true, paymentTermsDays: true } },
      lines: { orderBy: { sortOrder: 'asc' }, include: LINE_INCLUDE },
    },
  })
  if (!po) return res.status(404).json({ success: false, error: 'Purchase order not found' })
  assertBillable(po)
  await withReturnsOnBills(db, ORG_ID, po.lines)
  const msme = !blank(po.vendor.msmeNumber)
  const terms = paymentTermsFor({ orderTerms: po.paymentTermsDays, vendorTerms: po.vendor.paymentTermsDays, msme })
  const lines = po.lines.filter((l) => billableOf(l) > 0).map((l) => ({
    orderLineId: l.id, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, hsnCode: l.hsnCode,
    unitCode: l.unitCode, allowsFraction: l.unit.allowsFraction,
    ordered: l.quantity, received: l.receivedQty, billed: l.billedQty, returned: l.returnedQty, billable: billableOf(l),
    rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate, netRate: round2(netRateOf(l)),
  }))
  return res.json({
    success: true,
    data: {
      order: {
        id: po.id, number: po.number, status: po.status, gstType: po.gstType, paymentTermsDays: po.paymentTermsDays,
        // the date it is printed with: the form warns of an invoice dated before it
        orderDate: po.orderDate,
        vendorId: po.vendorId, vendorName: po.vendorName, vendor: po.vendor,
      },
      lines, tds: tdsDefault(po.vendor), dueDays: terms.days, msme,
    },
    meta: { tdsSections: tdsSectionsFor(po.vendor.pan) },
  })
}

export async function billGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canSeeBills(req)) throw forbidden('Vendor bills are for the purchase team and Finance')
    const { resource } = req.query

    if (resource === 'bill-candidates') return await candidates(req, res, ORG_ID)

    if (resource === 'bills') {
      const { search, status, view, orderId, startDate, endDate } = req.query
      const where = { organizationId: ORG_ID }
      if (startDate || endDate) where.vendorInvoiceDate = dayRange(startDate, endDate)
      if (status && status !== 'all') where.status = { in: String(status).split(',') }
      if (orderId) where.orderId = String(orderId)
      if (view === 'on-hold') where.status = 'on_hold'
      if (view === 'approved') where.status = 'approved'
      if (view === 'mine') where.createdById = getActor(req).id ?? '__none__'
      // A draft is its maker's until it is sent (an administrator may look).
      const draftsShown = othersDraftsHidden(isAdmin(req), getActor(req).id, 'createdById')
      where.AND = [...(where.AND || []), draftsShown]
      const term = String(search || '').trim()
      if (term) {
        const key = invoiceKey(term)
        where.OR = [
          { number: { contains: term, mode: 'insensitive' } },
          { vendorName: { contains: term, mode: 'insensitive' } },
          { vendorInvoiceNumber: { contains: term, mode: 'insensitive' } },
          // "inv 24/001" finds INV-24-001
          ...(key ? [{ vendorInvoiceKey: { contains: key } }] : []),
          { order: { number: { contains: term, mode: 'insensitive' } } },
        ]
      }
      const body = await listResponse(db.vendorBill, {
        where, req, orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        select: {
          id: true, number: true, status: true, vendorId: true, vendorName: true, vendorInvoiceNumber: true, vendorInvoiceDate: true,
          order: { select: { id: true, number: true } },
          subtotal: true, total: true, tdsAmount: true, payable: true, amountPaid: true, debitNoteTotal: true, dueDate: true,
          matched: true, mismatch: true, createdByName: true, createdAt: true,
          _count: { select: { lines: true } },
        },
      })
      body.data = body.data.map(({ _count, ...r }) => ({ ...r, lineCount: _count.lines }))
      // For the whole hospital, not the page: the cards above the list.
      body.summary = await billSummary(ORG_ID, draftsShown)
      return res.json(body)
    }

    if (resource === 'bill') {
      const bill = await readFull(ORG_ID, String(req.query.id || ''))
      if (!bill || (bill.status === 'draft' && !ownsOrAdmin(req, bill.createdById))) return res.status(404).json({ success: false, error: 'Vendor bill not found' })
      return res.json({ success: true, data: bill, meta: { tdsSections: tdsSectionsFor(bill.vendor?.pan) } })
    }

    return res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (e) {
    sendError(res, e, next)
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

export async function billCreate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    if (!canBill(req)) throw forbidden('Only the purchase officer or an administrator enters vendor bills')
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed.error)
    const input = parsed.data
    const vendorInvoiceDate = invoiceDateOf(input.vendorInvoiceDate)
    const key = keyOf(input.vendorInvoiceNumber)
    const actor = getActor(req)

    const full = await db.$transaction(async (tx) => {
      const po = await lockOrderForBill(tx, ORG_ID, input.orderId)
      assertBillable(po)
      const vendor = await vendorOf(tx, ORG_ID, po.vendorId)
      await guardDuplicate(tx, ORG_ID, vendor, key)
      const tds = resolveTds({ section: input.tdsSection, rate: input.tdsRate }, vendor)
      const invoiceTotal = input.invoiceTotal ?? null
      const { rows, header } = figures(po, vendor, priceLines(po, input.lines), { tds, invoiceTotal, vendorInvoiceDate })
      const number = await nextSeriesNumber(tx, ORG_ID, 'PURCHASE_BILL', 'BILL')
      const bill = await tx.vendorBill.create({
        data: {
          organizationId: ORG_ID, number, status: 'draft',
          vendorId: vendor.id, vendorName: po.vendorName, orderId: po.id,
          vendorInvoiceNumber: input.vendorInvoiceNumber, vendorInvoiceKey: key, vendorInvoiceDate, invoiceTotal,
          ...header, notes: input.notes ?? null,
          createdById: actor.id, createdByName: actor.name || 'Staff',
          lines: { create: rows },
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      })
      if (input.submit) await submitBill(tx, ORG_ID, bill, po, vendor)
      // Read back before the commit — see writeBill.
      const created = await readFull(ORG_ID, bill.id, tx)
      await auditIpd(req, ORG_ID, { action: input.submit ? 'create and submit' : 'create', entityType: 'purchase.bill', entityId: created.id, after: created }, tx)
      return created
    }, TX)

    // Committed; the bell cannot undo it, a failed one comes back as a warning.
    const warning = input.submit ? await billChanged(ORG_ID, 'submit', full, actor) : null
    return res.status(201).json({ success: true, data: full, ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function billUpdate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { action } = req.body
    const id = String(req.body.id || '')
    if (!ACTIONS.includes(action)) throw bad(`Unknown action. Use: ${ACTIONS.join(', ')}`)
    const actor = getActor(req)
    const words = String(req.body.remark || req.body.reason || '').trim()
    // `after` is the bill as its transaction committed it (writeBill).
    let before, after
    // Run inside that transaction, after `work` has set `before`.
    const audit = (tx, committed) => auditIpd(req, ORG_ID, { action, entityType: 'purchase.bill', entityId: id, before, after: committed }, tx)

    if (action === 'save') {
      if (!canBill(req)) throw forbidden('Only the purchase officer or an administrator changes vendor bills')
      const parsed = saveSchema.safeParse(req.body)
      if (!parsed.success) return validationError(res, parsed.error)
      const input = parsed.data
      const newDate = input.vendorInvoiceDate !== undefined ? invoiceDateOf(input.vendorInvoiceDate) : undefined
      const newKey = input.vendorInvoiceNumber !== undefined ? keyOf(input.vendorInvoiceNumber) : undefined

      after = await writeBill(ORG_ID, id, audit, async (tx) => {
        const { bill, po } = await lockBill(tx, ORG_ID, id)
        before = bill
        if (bill.status !== 'draft') throw conflict(`${bill.number} is ${statusWords(bill.status)} — only a draft can be changed`)
        if (!ownsOrAdmin(req, bill.createdById)) throw forbidden(`Only ${bill.createdByName} or an administrator can change this draft`)
        if (input.orderId && input.orderId !== bill.orderId) throw bad(`A bill stays on its order (${po.number}) — delete this draft and start one on the other order`)
        assertBillable(po)
        const vendor = await vendorOf(tx, ORG_ID, bill.vendorId)
        const key = newKey ?? bill.vendorInvoiceKey
        await guardDuplicate(tx, ORG_ID, vendor, key, bill.id)

        // Left out → as it is. A section sent without a rate takes the
        // section's rate for this vendor; a rate sent alone keeps the section.
        const tds = resolveTds({
          section: input.tdsSection !== undefined ? input.tdsSection : bill.tdsSection,
          rate: input.tdsRate !== undefined ? input.tdsRate : input.tdsSection !== undefined ? undefined : bill.tdsRate,
        }, vendor)
        const invoiceTotal = input.invoiceTotal !== undefined ? input.invoiceTotal : bill.invoiceTotal
        const vendorInvoiceDate = newDate ?? bill.vendorInvoiceDate
        const source = input.lines || bill.lines.map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate }))
        const { rows, header } = figures(po, vendor, priceLines(po, source), { tds, invoiceTotal, vendorInvoiceDate })

        await tx.vendorBillLine.deleteMany({ where: { billId: id, organizationId: ORG_ID } })
        await tx.vendorBillLine.createMany({ data: rows.map((r) => ({ ...r, billId: id })) })
        await tx.vendorBill.update({
          where: { id },
          data: {
            ...header, invoiceTotal, vendorInvoiceDate,
            ...(input.vendorInvoiceNumber !== undefined ? { vendorInvoiceNumber: input.vendorInvoiceNumber, vendorInvoiceKey: key } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
          },
        })
      })
    } else if (action === 'submit') {
      if (!canBill(req)) throw forbidden('Only the purchase officer or an administrator sends vendor bills on')
      after = await writeBill(ORG_ID, id, audit, async (tx) => {
        const { bill, po } = await lockBill(tx, ORG_ID, id)
        before = bill
        if (bill.status !== 'draft') throw conflict(`${bill.number} is already ${statusWords(bill.status)}`)
        if (!ownsOrAdmin(req, bill.createdById)) throw forbidden(`Only ${bill.createdByName} or an administrator can send this bill on`)
        if (!bill.lines.length) throw bad('Add at least one line to bill')
        await submitBill(tx, ORG_ID, bill, po, await vendorOf(tx, ORG_ID, bill.vendorId))
      })
    } else if (action === 'approve' || action === 'reject') {
      if (!canDecideBill(req)) throw forbidden('Only Finance or an administrator decides a bill on hold')
      const remark = words.slice(0, 500)
      if (action === 'reject' && remark.length < 3) throw bad('Say why it is rejected — the purchase officer needs to know what to correct')
      after = await writeBill(ORG_ID, id, audit, async (tx) => {
        const { bill, po } = await lockBill(tx, ORG_ID, id)
        before = bill
        if (bill.status !== 'on_hold') throw conflict(`${bill.number} is ${statusWords(bill.status)} — only a bill on hold is approved or rejected`)
        // Whoever entered a bill does not pass it for payment too; a small
        // hospital's administrator may have to.
        if (!isAdmin(req) && bill.createdById && bill.createdById === actor.id) throw forbidden('You entered this bill — someone else must decide it')
        // Rejected, its quantities are free to bill again (on a corrected bill).
        if (action === 'reject') await moveBilled(tx, po, bill, -1)
        await tx.vendorBill.update({
          where: { id },
          data: {
            status: action === 'approve' ? 'approved' : 'rejected',
            decidedAt: new Date(), decidedById: actor.id, decidedByName: actor.name || 'Finance', decisionRemark: remark || null,
          },
        })
      })
    } else if (action === 'cancel') {
      if (!canDecideBill(req)) throw forbidden('Only Finance or an administrator cancels an approved bill')
      const reason = words.slice(0, 300)
      if (reason.length < 3) throw bad('Say why the bill is cancelled')
      after = await writeBill(ORG_ID, id, audit, async (tx) => {
        const { bill, po } = await lockBill(tx, ORG_ID, id)
        before = bill
        if (bill.status !== 'approved') {
          throw conflict(bill.status === 'on_hold' ? `${bill.number} is on hold — reject it instead`
            : bill.status === 'draft' ? `${bill.number} is a draft — delete it instead`
              : `${bill.number} is ${statusWords(bill.status)} — only an approved bill can be cancelled`)
        }
        await refuseIfDependants(tx, ORG_ID, bill)
        if (bill.amountPaid > 0) throw conflict(`${formatRupee(bill.amountPaid)} has already been paid on ${bill.number} — it can no longer be cancelled`)
        await moveBilled(tx, po, bill, -1)
        await tx.vendorBill.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason } })
      })
    } else if (action === 'reopen') {
      if (!canBill(req)) throw forbidden('Only the purchase officer or an administrator reopens vendor bills')
      after = await writeBill(ORG_ID, id, audit, async (tx) => {
        const { bill } = await lockBill(tx, ORG_ID, id)
        before = bill
        if (bill.status !== 'rejected') throw conflict('Only a rejected bill can be reopened')
        if (!ownsOrAdmin(req, bill.createdById)) throw forbidden(`Only ${bill.createdByName} or an administrator can reopen this bill`)
        // Who rejected it and why stay on the draft, so they can be read while
        // it is corrected; submitting clears them.
        await tx.vendorBill.update({ where: { id }, data: { status: 'draft', submittedAt: null, decidedAt: null, matched: false } })
      })
    }

    // The write and its audit row have committed; the bell cannot undo them, a
    // failed one comes back as a warning for the screen.
    const warning = await billChanged(ORG_ID, action, after, actor, { remark: words, reason: words })
    return res.json({ success: true, data: after, ...(warning ? { warning } : {}) })
  } catch (e) {
    sendError(res, e, next)
  }
}

export async function billRemove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const id = String(req.query.id || '')
    if (!canBill(req)) throw forbidden('Only the purchase officer or an administrator deletes vendor bills')
    let before
    await db.$transaction(async (tx) => {
      const { bill } = await lockBill(tx, ORG_ID, id)
      before = bill
      if (bill.status !== 'draft') throw conflict(`${bill.number} is ${statusWords(bill.status)} — only a draft can be deleted`)
      if (!ownsOrAdmin(req, bill.createdById)) throw forbidden(`Only ${bill.createdByName} or an administrator can delete this draft`)
      await tx.vendorBill.delete({ where: { id } })
      await auditIpd(req, ORG_ID, { action: 'delete', entityType: 'purchase.bill', entityId: id, before }, tx)
    }, TX)
    return res.json({ success: true })
  } catch (e) {
    sendError(res, e, next)
  }
}
