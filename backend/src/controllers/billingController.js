import { db } from '../config/db.js'
import { patientSearchWhere } from '../lib/patientSearch.js'
import { getOrgId, getActor } from "../lib/reqContext.js";
import { todayRange, dayRange } from '../lib/dates.js'
import { nextSeriesNumber, invoiceProbe } from "../lib/counters.js";
import { recalcInvoice, refundableAmount } from "../lib/invoiceLedger.js";
import { refundSettings, isInstantRefund } from "../lib/refundPolicy.js";
import { fulfillInvoiceItems } from "../lib/invoiceFulfillment.js";
import { recordStockChange } from "../pharmacy/stockService.js";
import { round2 } from "../lib/money.js";
import { priceInvoiceItems } from "../lib/catalogPrice.js";
import { z } from 'zod'
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'

// Validation schemas
const serviceSchema = z.object({
  serviceName: z.string().min(1),
  serviceCode: z.string().min(1),
  serviceCategory: z.string().min(1),
  department: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  isTaxable: z.boolean(),
  taxPercentage: z.number().nonnegative().default(0),
  isCoveredByInsurance: z.boolean(),
  insuranceCopayPercentage: z.number().nonnegative().default(0),
  description: z.string().optional(),
})

const invoiceItemSchema = z.object({
  serviceId: z.string().optional(),
  serviceName: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
  tax: z.number().nonnegative().default(0),
  // Optional pass-through so a Pharmacy sale's GST invoice details (GST%,
  // batch, expiry) survive into the Invoice too — items is stored as opaque
  // JSON, so these just ride along for the receipt to read back out later.
  gstRate: z.number().nonnegative().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().nullish(),
  // Which module this line was billed from, and that module's record id. Set by
  // the biller's UI so the invoice can draw down pharmacy stock / raise the lab
  // and radiology orders the line implies. Absent = a plain, non-clinical line.
  sourceType: z.enum(['pharmacy', 'lab', 'radiology']).optional(),
  sourceId: z.string().optional(),
  // What KIND of service this line is, for the invoice list's Type column and
  // its filter. Distinct from sourceType, which exists only for the three lines
  // that have a catalogue row to act on (draw down stock, raise an order).
  // A consultation, a procedure or a vaccine has no such catalogue, so without
  // this they were untyped and the list could only show them as "—".
  // 'consultation' (not 'opd') because that is what appointmentController's
  // auto-voucher has always written; the two must stay one vocabulary.
  type: z.enum(['consultation', 'procedure', 'vaccine', 'pharmacy', 'lab', 'radiology']).optional(),
})

const invoiceSchema = z.object({
  patientId: z.string().min(1),
  consultationId: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1),
  discountAmount: z.number().nonnegative().default(0),
  discountPercentage: z.number().nonnegative().default(0),
  taxPercentage: z.number().nonnegative().default(0),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(1).optional(),
})

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  patientId: z.string().optional(),
  amount: z.number().positive(),
  paymentMethod: z.string().min(1),
  paymentReference: z.string().optional(),
  mobileMoneyProvider: z.string().optional(),
  bankName: z.string().optional(),
  chequeNumber: z.string().optional(),
  notes: z.string().optional(),
  // Optional client token so a retried/double-clicked submit is charged once.
  idempotencyKey: z.string().min(1).optional(),
})

// Refund / Credit Note. A refund is a Payment row with isRefund:true. Using
// paymentMethod:'credit_note' represents an adjustment (no cash out) vs an
// actual money refund. amountPaid is DECREMENTED atomically, mirroring payment.
const refundSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().positive(),
  refundReason: z.string().min(1),
  paymentMethod: z.string().min(1).default('cash'), // cash | bank_transfer | credit_note | upi ...
  originalPaymentId: z.string().optional(),
  notes: z.string().optional(),
})

// Add-on test after billing: append one line to an existing invoice and
// recompute the financial summary (spec: "add a new invoice item").
const addItemSchema = z.object({
  invoiceId: z.string().min(1),
  item: invoiceItemSchema,
})

// SECURITY: explicit whitelists — never z.record(z.any()) on financial records.
// Client-derived fields (amountPaid, balanceDue, totalAmount, organizationId,
// paymentStatus) are intentionally NOT updatable here; they are computed from
// payments inside a transaction.
const invoiceUpdateSchema = z.object({
  id: z.string().min(1),
  updates: z.object({
    status: z.enum(['draft', 'sent', 'overdue', 'paid', 'cancelled']).optional(),
    notes: z.string().optional(),
    termsAndConditions: z.string().optional(),
    dueDate: z.string().optional(),
    cancellationReason: z.string().optional(),
  }),
})

const serviceUpdateSchema = z.object({
  id: z.string().min(1),
  updates: z.object({
    serviceName: z.string().min(1).optional(),
    serviceCode: z.string().min(1).optional(),
    serviceCategory: z.string().min(1).optional(),
    department: z.string().min(1).optional(),
    unitPrice: z.number().nonnegative().optional(),
    isTaxable: z.boolean().optional(),
    taxPercentage: z.number().nonnegative().optional(),
    isCoveredByInsurance: z.boolean().optional(),
    insuranceCopayPercentage: z.number().nonnegative().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
})

// financialYear now lives in ../lib/money.js and the counter machinery in
// ../lib/counters.js (shared, single source of truth).

// What each billable line looks like inside Invoice.items, which is a JSON
// STRING column — so the filter is a substring match on that text, not a JSON
// path query. Written without spaces because JSON.stringify emits none; keep
// that fact next to these strings or the filter silently matches nothing.
//
// Two keys can mark the same kind of line. `sourceType` is set only when the
// line came from one of the three catalogues the invoice must ACT on (draw down
// pharmacy stock, raise a lab/radiology order). `type` is set by the billing UI
// for every line and is the only marker a consultation, procedure or vaccine
// ever gets. Older invoices — and every appointment auto-voucher — carry only
// one of the two, so each filter matches on either.
//
// Keep in step with BILL_TYPE_LABEL and CATEGORY_TYPE in
// src/components/billing/BillingModule.jsx, which render and send these.
const INVOICE_TYPE_MATCH = {
  opd: ['"type":"consultation"'],
  pharmacy: ['"sourceType":"pharmacy"', '"type":"pharmacy"'],
  lab: ['"sourceType":"lab"', '"type":"lab"'],
  radiology: ['"sourceType":"radiology"', '"type":"radiology"'],
  procedure: ['"type":"procedure"'],
  vaccine: ['"type":"vaccine"'],
}

// Atomic, gap-free, per-org invoice number. Format: INV-2026-27-000123.
// `invoiceProbe` lets the counter self-heal past invoices that a data migration
// copied without their BillCounter row (the live incident that deadlocked billing).
async function nextInvoiceNumber(tx, organizationId) {
  return nextSeriesNumber(tx, organizationId, 'INV', 'INV', invoiceProbe(tx, organizationId))
}

// Receipt numbers for OPD payments and refunds. Dedicated series so they never
// touch the IPD counters. Format: RCP-2026-27-000001 / REF-2026-27-000001.
function nextReceiptNumber(tx, organizationId) {
  return nextSeriesNumber(tx, organizationId, 'OPD_RCP', 'RCP')
}
function nextRefundNumber(tx, organizationId) {
  return nextSeriesNumber(tx, organizationId, 'OPD_REF', 'REF')
}

/**
 * Undo everything `fulfillInvoiceItems` (lib/invoiceFulfillment.js) created for an
 * invoice that is being cancelled. Returns what was reversed, for the audit row.
 *
 * WHY: cancelling only flipped Invoice.status, so the real-world side effects of
 * billing survived a voided bill — the medicine stayed deducted from pharmacy
 * stock (it can never be sold again), the PharmacySale kept counting as pharmacy
 * revenue, and the lab / radiology orders were still collected and reported on.
 *
 * The links back are structural, not note text: the sale carries
 * receiptNumber = invoiceNumber, the lab order is `LAB-<invoiceNumber>` and each
 * radiology order is `RAD-<invoiceNumber>-<n>` — all three columns are @unique.
 *
 * Must be called inside the caller's transaction so the cancellation and the
 * reversal commit together.
 */
async function reverseInvoiceFulfillment(tx, { organizationId, invoice, actorId }) {
  const reversed = { saleId: null, stockReturned: [], labOrderIds: [], radiologyOrderIds: [] }

  const sale = await tx.pharmacySale.findFirst({
    where: { organizationId, receiptNumber: invoice.invoiceNumber },
    select: { id: true, items: true },
  })
  if (sale) {
    let soldItems = []
    try { soldItems = JSON.parse(sale.items || '[]') } catch { soldItems = [] }

    for (const item of soldItems) {
      const quantity = Number(item.quantity) || 0
      if (!item.drugId || quantity <= 0) continue
      // Positive delta THROUGH recordStockChange, never a bare increment: the
      // StockLedger must show the return, or every later balanceAfter is wrong
      // and the shelf count can never be audited back to a document.
      // Batch quantities are intentionally not restored — one line can be drawn
      // FIFO across several batches and batch tracking is best-effort
      // (stockService.js); quantityInStock stays the authority for selling.
      await recordStockChange(tx, {
        organizationId,
        drugId: item.drugId,
        changeType: 'return',
        quantityDelta: quantity,
        reference: sale.id,
        note: `Cancelled billing invoice ${invoice.invoiceNumber}`,
        createdById: actorId || null,
      })
      reversed.stockReturned.push({ drugId: item.drugId, quantity })
    }

    // Void the sale rather than delete it: the row is the record of what was
    // dispensed and later reversed, and the ledger rows point at its id.
    await tx.pharmacySale.update({ where: { id: sale.id }, data: { paymentStatus: 'cancelled' } })
    reversed.saleId = sale.id
  }

  // Only orders nobody has acted on yet are cancelled. Once a sample is collected
  // or an exam performed, the clinical work exists — silently dropping it off the
  // worklist would lose a real result; that case needs a human (re-bill or reject).
  const pendingOrderWhere = { organizationId, status: 'pending' }

  const labOrders = await tx.labOrder.findMany({
    where: { ...pendingOrderWhere, orderNumber: `LAB-${invoice.invoiceNumber}` },
    select: { id: true },
  })
  if (labOrders.length) {
    await tx.labOrder.updateMany({
      where: { id: { in: labOrders.map((o) => o.id) } },
      data: { status: 'cancelled', rejectionReason: `Invoice ${invoice.invoiceNumber} cancelled` },
    })
    reversed.labOrderIds = labOrders.map((o) => o.id)
  }

  const radiologyOrders = await tx.radiologyOrder.findMany({
    where: { ...pendingOrderWhere, orderNumber: { startsWith: `RAD-${invoice.invoiceNumber}-` } },
    select: { id: true },
  })
  if (radiologyOrders.length) {
    await tx.radiologyOrder.updateMany({
      where: { id: { in: radiologyOrders.map((o) => o.id) } },
      data: { status: 'cancelled', cancellationReason: `Invoice ${invoice.invoiceNumber} cancelled` },
    })
    reversed.radiologyOrderIds = radiologyOrders.map((o) => o.id)
  }

  return reversed
}


/**
 * Turn a raised refund into money that has actually left: lock the original
 * invoice, issue its revision, move the payment ledger across and recalculate.
 *
 * Lifted out of approve_refund so the instant path -- a hospital whose Settings
 * say refundMode 'instant' -- runs THIS code rather than a second copy. Every
 * guard here was written for a bug already paid for once: the compare-and-swap
 * that lets only one of two concurrent approvals through, the revision number
 * counted over the whole chain, and the rule about which Payment rows move.
 *
 * Caller loads `payment` with its `invoice`, inside the transaction.
 */
async function applyApprovedRefund(tx, { organizationId, payment, actor }) {
// APPROVE LOGIC: Lock old invoice, generate new revised invoice
const oldInvoice = payment.invoice
const refundedAmount = payment.amount

// An invoice can only be revised ONCE. CLAIM IT ATOMICALLY: the conditional
// update matches only while the invoice is still un-archived, so of two
// refunds approved concurrently on the same invoice exactly one wins the
// compare-and-swap and the loser sees count===0 and gets a clean 409.
//
// The previous guard read `oldInvoice.isArchived` from a snapshot taken
// BEFORE this line (payment.invoice, loaded at the top of the tx), then set
// isArchived in a separate unconditional update below — a check-then-act
// race. Under concurrency both approvals read isArchived:false, both passed
// the guard, and each derived a revised invoice from the SAME superseded
// totals, refunding the money twice with no book entry for the second.
// Folding the check and the set into one conditional write closes the race.
// Mirrors the bed-claiming compare-and-swap in inpatientController.js (~1013).
const claimed = await tx.invoice.updateMany({
  where: { id: oldInvoice.id, organizationId: organizationId, isArchived: false },
  data: {
    paymentStatus: 'refunded',
    isArchived: true, // lock it: immutable, kept as-is for the audit trail
  },
})
if (claimed.count !== 1) {
  const err = new Error('This invoice has already been revised by an approved refund. Re-raise this request against the revised invoice.')
  err.status = 409; throw err
}

// 1. Update Payment (only the CAS winner reaches here)
const approvedPayment = await tx.payment.update({
  where: { id: payment.id, organizationId: organizationId },
  data: {
    status: 'APPROVED',
    approvedByUserId: actor.id,
    approvalDate: new Date()
  }
})

// 3. Generate Revised Invoice
let parsedItems = []
try { parsedItems = JSON.parse(oldInvoice.items) } catch (e) { parsedItems = [] }

const newTotalAmount = round2(oldInvoice.totalAmount - refundedAmount)

// Keep line-item integrity: carry the original lines and append a negative
// "Refund Adjustment" line so the items SUM equals the revised total (the old
// code copied items unchanged while lowering the total → items ≠ total).
const revisedItems = [
  ...parsedItems,
  {
    serviceName: `Refund Adjustment (${payment.receiptNumber})`,
    quantity: 1,
    unitPrice: -refundedAmount,
    total: -refundedAmount,
    tax: 0,
  },
]

// Sequential, collision-free revision number: base + -R<n> (was random(0-999)).
// Counted over the whole chain, not this parent's direct children: revising
// an already-revised invoice (the normal flow — a second refund is raised
// against the revision) found zero children and reissued "-R1", which died
// on the unique (organizationId, invoiceNumber) index as a 500 at approval.
const baseNumber = oldInvoice.invoiceNumber.replace(/-R\d+$/, '')
const revCount = await tx.invoice.count({
  where: { organizationId: organizationId, invoiceNumber: { startsWith: `${baseNumber}-R` } },
})
const revisedNumber = `${baseNumber}-R${revCount + 1}`

const revisedInvoice = await tx.invoice.create({
  data: {
    organizationId: organizationId,
    patientId: oldInvoice.patientId,
    consultationId: oldInvoice.consultationId,
    parentInvoiceId: oldInvoice.id,
    invoiceNumber: revisedNumber,
    items: JSON.stringify(revisedItems),
    subtotal: newTotalAmount,
    taxAmount: oldInvoice.taxAmount,
    taxPercentage: oldInvoice.taxPercentage,
    discountAmount: oldInvoice.discountAmount,
    discountPercentage: oldInvoice.discountPercentage,
    totalAmount: newTotalAmount,
    // Placeholders only — recalcInvoice below derives the real figures from
    // the Payment rows once they have been moved across.
    amountPaid: 0,
    balanceDue: newTotalAmount,
    paymentStatus: 'unpaid',
    insuranceClaimAmount: oldInvoice.insuranceClaimAmount,
    patientCopayAmount: oldInvoice.patientCopayAmount,
    notes: 'Revised Invoice due to Refund ' + payment.receiptNumber,
  }
})

// 4. Move the whole payment ledger onto the revised invoice.
//
// WHY: Payment rows are the source of truth — recalcInvoice derives
// amountPaid from them and overwrites whatever is cached on the invoice.
// The revised invoice used to be created with a hand-copied
// `amountPaid = old.amountPaid - refund` while every Payment row stayed
// attached to the archived original. The first later recalc (the patient
// pays the balance, or a line is added) then saw ONLY that new payment and
// reset amountPaid to it — ₹10,000 billed / ₹6,000 collected / ₹1,000
// refunded became "₹4,000 paid, ₹5,000 due" and the counter re-billed money
// it had already taken.
//
// Exactly the rows invoiceLedger() reads move across: every collection, plus
// refunds that are APPROVED (recalc computes paid − approvedRefunds, so the
// approved refund must sit alongside the collections it reduces). A refund
// still PENDING_APPROVAL — or REJECTED — stays with the superseded document:
// it belongs to a bill that no longer exists and must be re-raised against
// the revision, which is exactly what the 409 above tells the approver.
await tx.payment.updateMany({
  where: {
    invoiceId: oldInvoice.id,
    organizationId: organizationId,
    OR: [{ isRefund: false }, { isRefund: true, status: 'APPROVED' }],
  },
  data: { invoiceId: revisedInvoice.id },
})
await recalcInvoice(tx, revisedInvoice.id)

// The archived original deliberately keeps its frozen amountPaid/balanceDue
// as the historical document; it is paymentStatus 'refunded', so no
// outstanding-balance report counts it twice.
const revisedWithTotals = await tx.invoice.findUnique({ where: { id: revisedInvoice.id } })

await tx.auditLog.create({
  data: {
    organizationId: organizationId,
    action: 'REFUND_APPROVED',
    entityType: 'Invoice',
    entityId: oldInvoice.id,
    metadata: JSON.stringify({
      refundId: payment.id,
      revisedInvoiceId: revisedInvoice.id,
      // The figures the ledger derived, so the money trail is provable
      // from the audit row alone.
      revisedAmountPaid: revisedWithTotals.amountPaid,
      revisedBalanceDue: revisedWithTotals.balanceDue,
    }),
    performedAt: new Date(),
  }
})

return { payment: approvedPayment, revisedInvoice: revisedWithTotals }
}


export async function getAll(req, res) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource, category, status, patientId, invoiceId, search, type, startDate, endDate } = req.query
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 1000) // hard cap → no unbounded query DoS
    // Guard like `limit`: a bare parseInt let `offset=-5` (or `offset=abc` → NaN)
    // reach Prisma, which threw a 500. A bad page offset is a client mistake — it
    // must clamp to a valid skip, never crash and page the on-call.
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)

    if (resource === 'services') {
      const where = {
        organizationId: ORGANIZATION_ID,
        isActive: true,
      }
      if (category) {
        where.serviceCategory = category
      }

      const [services, total] = await Promise.all([
        db.billingService.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: [{ serviceCategory: 'asc' }, { serviceName: 'asc' }],
        }),
        db.billingService.count({ where }),
      ])

      return res.json({
        success: true,
        data: services,
        meta: { total, limit, offset, hasMore: offset + limit < total },
      })
    }

    if (resource === 'invoices') {
      const where = { organizationId: ORGANIZATION_ID }
      if (status) {
        if (status === 'partial') where.paymentStatus = 'partially_paid'
        else if (status === 'pending') where.paymentStatus = { in: ['unpaid', 'pending'] }
        else where.paymentStatus = status
      }
      if (patientId) where.patientId = patientId
      const searchWhere = patientSearchWhere(search, 'patient', (term) => [
        { invoiceNumber: { contains: term, mode: 'insensitive' } },
      ])
      if (searchWhere) Object.assign(where, searchWhere)
      // Filter by what the invoice actually billed for. Done in the DB, not by
      // loading rows and filtering in the browser — the table grows without
      // bound and a page-local filter would only ever search the current page.
      // An invoice matches if ANY marker for that kind appears, since a line may
      // be tagged by `type`, by `sourceType`, or (older rows) by only one.
      // Appended to AND — and AFTER the search assign, which Object.assigns its
      // own AND over `where` — so search and type compose instead of one
      // silently replacing the other.
      const markers = INVOICE_TYPE_MATCH[type]
      if (markers) {
        where.AND = [...(where.AND ?? []), { OR: markers.map((m) => ({ items: { contains: m } })) }]
      }
      // Date range, in the HOSPITAL's timezone — not the server's. `dayRange`
      // turns 2026-08-10 into that whole day in IST, which is 18:30 the previous
      // day in UTC. Slicing an ISO string instead would put every bill raised
      // after 18:30 into tomorrow, and the counter's day-end total would be wrong
      // for the busiest hours of the evening.
      //
      // Only assigned when a bound is actually present: `dayRange('', '')` is `{}`,
      // and `invoiceDate: {}` matches nothing in Prisma — an empty filter would
      // silently return zero invoices instead of all of them.
      if (startDate || endDate) {
        const range = dayRange(startDate, endDate)
        if (range.gte || range.lte) where.invoiceDate = range
      }
      // Single-invoice fetch (with its payments) — used to render a receipt.
      if (invoiceId) where.id = invoiceId

      const [invoices, total] = await Promise.all([
        db.invoice.findMany({
          where,
          take: limit,
          skip: offset,
          include: {
            patient: {
              select: {
                ...PATIENT_NAME_SELECT,
                phonePrimary: true,
                hasInsurance: true,
                insuranceProvider: true,
              },
            },
            payments: true,
          },
          orderBy: { invoiceDate: 'desc' },
        }),
        db.invoice.count({ where }),
      ])

      return res.json({
        success: true,
        data: invoices,
        meta: { total, limit, offset, hasMore: offset + limit < total },
      })
    }

    if (resource === 'payments') {
      const where = { organizationId: ORGANIZATION_ID }
      if (invoiceId) where.invoiceId = invoiceId
      if (req.query.status) where.status = req.query.status
      if (req.query.isRefund !== undefined) where.isRefund = req.query.isRefund === 'true'

      const [payments, total] = await Promise.all([
        db.payment.findMany({
          where,
          take: limit,
          skip: offset,
          include: {
            patient: {
              select: { ...PATIENT_NAME_SELECT, },
            },
            // Include the parent invoice so receipts can show Total / Paid / Balance
            // (Dr-Lal style) and the payments table can show patient + invoice no.
            invoice: {
              select: {
                invoiceNumber: true,
                totalAmount: true,
                amountPaid: true,
                balanceDue: true,
                patient: {
                  select: { ...PATIENT_NAME_SELECT, },
                },
              },
            },
          },
          orderBy: { paymentDate: 'desc' },
        }),
        db.payment.count({ where }),
      ])

      return res.json({
        success: true,
        data: payments,
        meta: { total, limit, offset, hasMore: offset + limit < total },
      })
    }

    if (resource === 'stats') {
      // "Today" = the hospital's day, not the server's (see lib/dates.js).
      const { gte: todayStart, lte: todayEnd } = todayRange()

      const [
        todayRevenueResult,
        pendingInvoicesCount,
        collectedTodayResult,
        outstandingBalanceResult,
        totalServicesCount,
      ] = await Promise.all([
        db.payment.aggregate({
          _sum: { amount: true },
          where: {
            organizationId: ORGANIZATION_ID,
            paymentDate: { gte: todayStart, lte: todayEnd },
            isRefund: false,
          },
        }),
        db.invoice.count({
          where: {
            organizationId: ORGANIZATION_ID,
            paymentStatus: { in: ['unpaid', 'partially_paid'] },
          },
        }),
        db.payment.aggregate({
          _sum: { amount: true },
          where: {
            organizationId: ORGANIZATION_ID,
            paymentDate: { gte: todayStart, lte: todayEnd },
            isRefund: false,
          },
        }),
        db.invoice.aggregate({
          _sum: { balanceDue: true },
          where: {
            organizationId: ORGANIZATION_ID,
            paymentStatus: { in: ['unpaid', 'partially_paid'] },
          },
        }),
        db.billingService.count({
          where: { organizationId: ORGANIZATION_ID },
        }),
      ])

      const stats = {
        todayRevenue: todayRevenueResult._sum.amount || 0,
        pendingInvoices: pendingInvoicesCount,
        collectedToday: collectedTodayResult._sum.amount || 0,
        outstandingBalance: outstandingBalanceResult._sum.balanceDue || 0,
        totalServices: totalServicesCount,
      }

      return res.json({ success: true, data: stats })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource type' })
  } catch (error) {
    console.error('Billing getAll error:', error)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
}

export async function create(req, res) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource } = req.body

    if (resource === 'service') {
      const parsed = serviceSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.flatten() })
      }

      const data = parsed.data
      const service = await db.billingService.create({
        data: {
          ...data,
          organizationId: ORGANIZATION_ID,
          isActive: true,
        },
      })

      return res.status(201).json({ success: true, data: service })
    }

    if (resource === 'invoice') {
      const parsed = invoiceSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.flatten() })
      }

      const { patientId, consultationId, discountAmount, discountPercentage, taxPercentage, notes, idempotencyKey } =
        parsed.data

      // IDEMPOTENCY: if this exact submit was already recorded (same client token),
      // return that invoice instead of creating again. Prevents duplicate invoices
      // on a double-click / network retry.
      if (idempotencyKey) {
        const existing = await db.invoice.findFirst({
          where: { organizationId: ORGANIZATION_ID, idempotencyKey },
          include: {
            patient: {
              select: {
                ...PATIENT_NAME_SELECT,
                phonePrimary: true,
                hasInsurance: true,
                insuranceProvider: true,
              },
            },
          },
        })
        if (existing) {
          if (existing.patientId !== patientId) {
            return res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_REUSED', error: 'This invoice reference was already used for a different patient.' })
          }
          return res.status(200).json({ success: true, data: existing, idempotent: true })
        }
      }

      let invoice
      try {
        // Transaction: the invoice number is drawn from a per-org counter inside
        // the same tx, so concurrent creates cannot collide on the @unique column.
        invoice = await db.$transaction(async (tx) => {
          // Verify the patient actually exists in THIS database before writing the
        // invoice. Without this check, a stale/foreign patientId (e.g. from a UI
        // still holding IDs from a different environment or an old DB snapshot)
        // hits the `patientId` foreign key at insert time and Prisma throws a raw
        // P2003 error — which the outer catch has no `.status` for, so it falls
        // through to a generic, unhelpful 500. Fail fast here with a clear 404.
        const patientExists = await tx.patient.findFirst({
          where: { id: patientId, organizationId: ORGANIZATION_ID },
          select: { id: true },
        })
        if (!patientExists) {
          const err = new Error(`Patient not found: ${patientId}`)
          err.status = 404
          throw err
        }

        // Price every line from the CATALOGUE, not from the request body. The
        // old code recomputed `total = quantity x unitPrice` server-side, which
        // looks like repricing but multiplies whatever price the client sent —
        // so a 5,000 test could be billed at 1 and the invoice looked normal.
        // Inside the transaction, so the price stored is the one in force when
        // the invoice committed rather than one read moments earlier.
        const items = await priceInvoiceItems(tx, {
          organizationId: ORGANIZATION_ID,
          items: parsed.data.items,
        })
        const subtotal = round2(items.reduce((sum, item) => sum + item.total, 0))
        const taxAmount = round2(items.reduce((sum, item) => sum + (item.tax || 0), 0))

        // Checked against the repriced total, not the client's: a request that
        // understated the prices could otherwise carry a discount larger than
        // what the items are really worth.
        if (discountAmount > subtotal + taxAmount) {
          const err = new Error('Discount cannot exceed the total value of the items')
          err.status = 400
          throw err
        }
        const totalAmount = round2(subtotal - discountAmount + taxAmount)

        const invoiceNumber = await nextInvoiceNumber(tx, ORGANIZATION_ID)
        const created = await tx.invoice.create({
          data: {
            organizationId: ORGANIZATION_ID,
            invoiceNumber,
            patientId,
            consultationId: consultationId || null,
            items: JSON.stringify(items),
            subtotal,
            taxAmount,
            taxPercentage,
            discountAmount,
            discountPercentage,
            totalAmount,
            notes: notes || null,
            status: 'draft',
            paymentStatus: 'unpaid',
            balanceDue: totalAmount,
            amountPaid: 0,
            invoiceDate: new Date(),
            idempotencyKey: idempotencyKey || null,
          },
          include: {
            patient: {
              select: {
                ...PATIENT_NAME_SELECT,
                phonePrimary: true,
                hasInsurance: true,
                insuranceProvider: true,
              },
            },
          },
        })

        // Billing a medicine must draw it out of pharmacy stock, and billing a
        // lab test / radiology exam must raise the order that produces the report.
        // Same transaction: a short-stocked line rolls the whole invoice back
        // rather than leaving a bill for goods that were never deducted.
        await fulfillInvoiceItems(tx, {
          organizationId: ORGANIZATION_ID,
          items,
          invoice: created,
          patientId,
          actorId: getActor(req).id,
        })

        return created
      })
      } catch (e) {
        if (e?.code === 'P2002' && idempotencyKey) {
          const winner = await db.invoice.findFirst({ 
            where: { organizationId: ORGANIZATION_ID, idempotencyKey },
            include: {
              patient: {
                select: {
                  ...PATIENT_NAME_SELECT,
                  phonePrimary: true,
                  hasInsurance: true,
                  insuranceProvider: true,
                },
              },
            },
          })
          if (winner) return res.status(200).json({ success: true, data: winner, idempotent: true })
        }
        throw e
      }

      return res.status(201).json({ success: true, data: invoice })
    }

    if (resource === 'payment') {
      const parsed = paymentSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.flatten() })
      }

      const {
        invoiceId,
        patientId,
        amount,
        paymentMethod,
        paymentReference,
        mobileMoneyProvider,
        bankName,
        chequeNumber,
        notes,
        idempotencyKey,
      } = parsed.data

      // IDEMPOTENCY: if this exact submit was already recorded (same client token),
      // return that payment instead of charging again. Prevents double-charge on a
      // double-click / network retry, even across tabs or lost responses.
      //
      // A key BINDS to its payload: the same key with a DIFFERENT amount (or a
      // different invoice) is not a retry — it is a client bug or a reused token,
      // and silently returning the old payment would tell the caller "₹750 paid"
      // while only the original ₹100 was ever recorded. Reject that with a 409
      // instead of hiding the mismatch.
      if (idempotencyKey) {
        const existing = await db.payment.findFirst({
          where: { organizationId: ORGANIZATION_ID, idempotencyKey },
        })
        if (existing) {
          if (Number(existing.amount) !== Number(amount) || existing.invoiceId !== invoiceId) {
            return res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_REUSED', error: 'This payment reference was already used for a different amount or invoice. Use a fresh reference.' })
          }
          return res.status(200).json({ success: true, data: existing, idempotent: true })
        }
      }

      // MONEY = ACID. Everything below runs in ONE transaction:
      //   1. verify the invoice exists AND belongs to this org (no cross-tenant write)
      //   2. draw an atomic receipt number and write the payment
      //   3. recompute the invoice cache from its Payment rows (recalcInvoice)
      //   4. write the audit row INSIDE the tx — if audit fails, the whole
      //      payment rolls back (a hospital's money trail must be provable)
      let payment
      try {
        payment = await db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId: ORGANIZATION_ID },
          select: { id: true, isArchived: true, status: true },
        })
        if (!invoice) {
          const err = new Error('Invoice not found')
          err.status = 404
          throw err
        }
        // A cancelled invoice is void — no money may be recorded against it. The
        // ledger recalc only refused to RE-OPEN a cancelled document's status; it
        // still let the Payment row (and the cash) land. Block it at the source.
        if (invoice.status === 'cancelled') {
          const err = new Error('This invoice is cancelled — no payment can be recorded against it.')
          err.status = 409
          throw err
        }
        // A superseded invoice is frozen; money must be taken against its revision.
        if (invoice.isArchived) {
          const err = new Error('This invoice was revised by an approved refund. Collect against its revised invoice.')
          err.status = 409
          throw err
        }

        const receiptNumber = await nextReceiptNumber(tx, ORGANIZATION_ID)

        const created = await tx.payment.create({
          data: {
            organizationId: ORGANIZATION_ID,
            invoiceId,
            patientId: patientId || null,
            amount,
            paymentMethod,
            paymentReference: paymentReference || null,
            mobileMoneyProvider: mobileMoneyProvider || null,
            bankName: bankName || null,
            chequeNumber: chequeNumber || null,
            notes: notes || null,
            receiptNumber,
            idempotencyKey: idempotencyKey || null,
            paymentDate: new Date(),
            isRefund: false,
          },
        })

        // Derive the invoice cache from the Payment rows we just added to.
        const totals = await recalcInvoice(tx, invoiceId)

        // SECURITY: if this payment pushed the invoice past its total, it exceeded
        // the balance due. Throwing here rolls back the ENTIRE transaction.
        if (totals.amountPaid > totals.totalAmount + 0.005) {
          const err = new Error('Payment exceeds balance due')
          err.status = 400
          throw err
        }
        const paymentStatus = totals.paymentStatus

        await tx.auditLog.create({
          data: {
            organizationId: ORGANIZATION_ID,
            action: 'PAYMENT_RECORDED',
            entityType: 'Invoice',
            entityId: invoiceId,
            metadata: JSON.stringify({
              paymentId: created.id,
              amount,
              paymentMethod,
              receiptNumber,
              newPaymentStatus: paymentStatus,
            }),
            performedAt: new Date(),
          },
        })

        return created
        })
      } catch (e) {
        // Two callers raced with the SAME idempotency key: the pre-check above
        // saw no row yet, both entered the tx, and the unique index on
        // idempotencyKey rejected the loser with P2002. The index did its job —
        // exactly one payment was created and the money is safe. Return that one
        // as an idempotent hit instead of leaking a raw Prisma 500 to the caller.
        if (e?.code === 'P2002' && idempotencyKey) {
          const winner = await db.payment.findFirst({ where: { organizationId: ORGANIZATION_ID, idempotencyKey } })
          if (winner) return res.status(200).json({ success: true, data: winner, idempotent: true })
        }
        throw e
      }

      return res.status(201).json({ success: true, data: payment })
    }

    if (resource === 'refund') {
      const parsed = refundSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.flatten() })
      }
      const { invoiceId, amount, refundReason, paymentMethod, originalPaymentId, notes } = parsed.data

      // MONEY = ACID. A refund is only a REQUEST here — no cash moves and
      // amountPaid is untouched until a finance approver signs it off.
      const refund = await db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId: ORGANIZATION_ID },
          select: { id: true, status: true, isArchived: true },
        })
        if (!invoice) {
          const err = new Error('Invoice not found'); err.status = 404; throw err
        }
        if (invoice.isArchived) {
          const err = new Error('This invoice was already revised by an approved refund. Raise the refund against its revised invoice.')
          err.status = 409; throw err
        }
        if (invoice.status === 'cancelled') {
          const err = new Error('Cannot refund a cancelled invoice'); err.status = 400; throw err
        }

        // Invoice-level cap. Counts refunds that are APPROVED *or* still awaiting
        // approval, so the same money cannot be requested twice: a pending refund
        // no longer decrements amountPaid, so checking against amountPaid alone
        // let an unlimited number of full-value refund requests through.
        // REJECTED refunds are excluded — they release the amount they reserved.
        const refundable = await refundableAmount(tx, invoiceId)
        if (amount > refundable + 0.005) {
          const err = new Error(`Refund (₹${amount}) exceeds the refundable balance (₹${refundable})`)
          err.status = 400; throw err
        }

        // Receipt-level cap: don't over-refund one specific receipt.
        if (originalPaymentId) {
          // Tenant-scoped: without organizationId this read another org's payment.
          const originalPayment = await tx.payment.findFirst({
            where: { id: originalPaymentId, organizationId: ORGANIZATION_ID, isRefund: false },
            select: { amount: true },
          })
          if (!originalPayment) {
            const err = new Error('Original receipt not found'); err.status = 404; throw err
          }

          const existingRefunds = await tx.payment.aggregate({
            where: {
              organizationId: ORGANIZATION_ID,
              originalPaymentId,
              isRefund: true,
              status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
            },
            _sum: { amount: true },
          })

          const refundedSoFar = existingRefunds._sum.amount || 0
          const maxRefundable = originalPayment.amount - refundedSoFar

          if (amount > maxRefundable + 0.005) {
            const err = new Error(`Refund exceeds this receipt's refundable amount (max ₹${maxRefundable})`)
            err.status = 400; throw err
          }
        }

        const receiptNumber = await nextRefundNumber(tx, ORGANIZATION_ID)
        const created = await tx.payment.create({
          data: {
            organizationId: ORGANIZATION_ID,
            invoiceId,
            amount,
            paymentMethod,
            receiptNumber,
            isRefund: true,
            refundReason,
            originalPaymentId: originalPaymentId || null,
            notes: notes || null,
            paymentDate: new Date(),
            status: 'PENDING_APPROVAL', // awaits finance approval
          },
        })

        await tx.auditLog.create({
          data: {
            organizationId: ORGANIZATION_ID,
            action: 'REFUND_REQUESTED',
            entityType: 'Invoice',
            entityId: invoiceId,
            metadata: JSON.stringify({
              refundId: created.id, amount, paymentMethod, refundReason,
              receiptNumber, status: 'PENDING_APPROVAL'
            }),
            performedAt: new Date(),
          },
        })

        // A hospital whose Settings say refundMode 'instant' hands the money back
        // at the counter, so the same refund is approved in this transaction —
        // through applyApprovedRefund, the one path, so an instant refund locks
        // the original invoice and issues its revision exactly as an approved one
        // does. The row is still written as PENDING_APPROVAL first: the audit
        // trail then shows both halves, and nothing can reach 'APPROVED' without
        // having passed the caps checked above it.
        //
        // The setting is read from the organisation, never from the request — a
        // client that sent refundMode:'instant' would otherwise be choosing
        // whether its own refund needs approval.
        const org = await tx.organization.findUnique({
          where: { id: ORGANIZATION_ID },
          select: { settings: true },
        })
        if (isInstantRefund(refundSettings(org))) {
          // The guard above loaded three columns to answer three questions;
          // applyApprovedRefund copies the whole document into its revision, so it
          // needs the row itself. Re-read rather than widen that select: the guard
          // runs on every refund and only this branch needs the rest.
          const fullInvoice = await tx.invoice.findFirst({
            where: { id: invoiceId, organizationId: ORGANIZATION_ID },
          })
          const applied = await applyApprovedRefund(tx, {
            organizationId: ORGANIZATION_ID,
            payment: { ...created, invoice: fullInvoice },
            actor: getActor(req),
          })
          return { ...applied.payment, revisedInvoice: applied.revisedInvoice, instant: true }
        }

        return created
      })

      return res.status(201).json({ success: true, data: refund })
    }

    if (resource === 'approve_refund') {
      const { paymentId, action } = req.body // action: 'APPROVE' or 'REJECT'
      const actor = getActor(req)

      // Approving a refund releases hospital money, so it is role-gated. When auth
      // is enforced there is always a role; when it is off (local demo) there is
      // none and the gate stays open, matching every other endpoint's demo posture.
      const APPROVER_ROLES = ['finance_controller', 'super_admin', 'admin']
      if (actor.role && !APPROVER_ROLES.includes(actor.role)) {
        return res.status(403).json({ success: false, error: 'Unauthorized to approve refunds' })
      }
      if (!actor.role && process.env.AUTH_ENFORCED === 'true') {
        return res.status(401).json({ success: false, error: 'Authentication required' })
      }

      if (!paymentId || !['APPROVE', 'REJECT'].includes(action)) {
        return res.status(400).json({ success: false, error: 'Invalid payload' })
      }

      const result = await db.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({
          where: { id: paymentId, organizationId: ORGANIZATION_ID, isRefund: true },
          include: { invoice: true }
        })

        if (!payment || payment.status !== 'PENDING_APPROVAL') {
          const err = new Error('Invalid or already processed refund request'); err.status = 400; throw err
        }

        if (action === 'REJECT') {
          const updatedPayment = await tx.payment.update({
            where: { id: paymentId, organizationId: ORGANIZATION_ID },
            data: {
              status: 'REJECTED',
              // Was `|| 'SYSTEM'`, which wrote a sentinel string into a user-id
              // column. Leave it null when there is no authenticated approver.
              approvedByUserId: actor.id,
              approvalDate: new Date()
            }
          })

          await tx.auditLog.create({
            data: {
              organizationId: ORGANIZATION_ID,
              action: 'REFUND_REJECTED',
              entityType: 'Payment',
              entityId: paymentId,
              userId: actor.id,
              metadata: JSON.stringify({ rejectedBy: actor.name, rejectedById: actor.id }),
              performedAt: new Date(),
            }
          })
          return updatedPayment
        }

        // The approve path lives in applyApprovedRefund so the instant-refund
        // path runs exactly this code, not a second copy of it.
        return applyApprovedRefund(tx, { organizationId: ORGANIZATION_ID, payment, actor })
      })

      return res.status(200).json({ success: true, data: result })
    }

    if (resource === 'invoiceItem') {
      const parsed = addItemSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.flatten() })
      }
      const { invoiceId, item } = parsed.data

      const updated = await db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId: ORGANIZATION_ID },
        })
        if (!invoice) {
          const err = new Error('Invoice not found'); err.status = 404; throw err
        }
        if (invoice.status === 'cancelled' || invoice.paymentStatus === 'cancelled') {
          const err = new Error('Cannot add items to a cancelled invoice'); err.status = 400; throw err
        }
        // An archived invoice is the frozen audit record of a superseded bill —
        // payment and refund already refuse it; this path did not, so a line
        // item could still be pushed onto it and silently move its total. Block
        // it here too, or the "immutable" audit trail is editable after the fact.
        if (invoice.isArchived) {
          const err = new Error('This invoice was revised and archived — add items to its revised invoice instead.'); err.status = 409; throw err
        }

        let items = []
        try { items = JSON.parse(invoice.items || '[]') } catch { items = [] }
        // Same rule on the add-item path: the new line is priced from the
        // catalogue, not from the request. (This comment used to sit above a
        // call that only recomputed the total from the client's own unitPrice,
        // so an add-on test could be appended at any price the caller chose.)
        // Existing lines are left as stored — they were priced when added.
        const [pricedItem] = await priceInvoiceItems(tx, {
          organizationId: ORGANIZATION_ID,
          items: [item],
        })
        items.push({ ...pricedItem, status: 'ordered' })

        const subtotal = round2(items.reduce((s, i) => s + (i.total || 0), 0))
        const taxAmount = round2(items.reduce((s, i) => s + (i.tax || 0), 0))
        const totalAmount = round2(subtotal - (invoice.discountAmount || 0) + taxAmount)

        await tx.invoice.update({
          where: { id: invoiceId },
          data: { items: JSON.stringify(items), subtotal, taxAmount, totalAmount },
        })
        // Totals moved, so the paid/balance/status cache has to follow.
        await recalcInvoice(tx, invoiceId)
        const inv = await tx.invoice.findUnique({ where: { id: invoiceId } })

        await tx.auditLog.create({
          data: {
            organizationId: ORGANIZATION_ID,
            action: 'INVOICE_ITEM_ADDED',
            entityType: 'Invoice',
            entityId: invoiceId,
            metadata: JSON.stringify({ item, newTotal: totalAmount }),
            performedAt: new Date(),
          },
        })

        return inv
      })

      return res.status(201).json({ success: true, data: updated })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource type' })
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message })
    }
    // Surface the REAL failure instead of a blanket "Internal server error", so a
    // live incident is diagnosable from the client. Prisma errors carry a `code`
    // (e.g. P2003 = FK violation, P2021 = table missing, P2002 = unique) and
    // `meta` (which field/table). Without this, every DB failure looked identical.
    console.error('Billing create error:', error?.code, error?.meta, error?.message)
    return res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error',
      code: error?.code,
      meta: error?.meta,
    })
  }
}

export async function update(req, res) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource } = req.body

    if (resource === 'invoice') {
      const parsed = invoiceUpdateSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.flatten() })
      }

      const { id, updates } = parsed.data
      const updateData = { ...updates }
      if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate)

      const invoice = await db.$transaction(async (tx) => {
        // Tenant guard: only touch an invoice that belongs to this org.
        const existing = await tx.invoice.findFirst({
          where: { id, organizationId: ORGANIZATION_ID },
          select: { id: true, invoiceNumber: true, amountPaid: true, paymentStatus: true },
        })
        if (!existing) {
          const err = new Error('Invoice not found')
          err.status = 404
          throw err
        }

        if (updates.status === 'cancelled') {
          // Never destroy the money trail: an invoice with live payments must be
          // refunded / credit-noted down to zero before it can be cancelled.
          if (existing.amountPaid > 0 && existing.paymentStatus !== 'refunded') {
            const err = new Error('Invoice has payments — issue a refund/credit note before cancelling.')
            err.status = 400
            throw err
          }
          updateData.cancelledAt = new Date()
          updateData.paymentStatus = 'cancelled'

          // Claim the cancellation atomically. The read above is a snapshot: two
          // concurrent cancels (or a double-clicked button) would both pass it and
          // each return the medicine to stock, so the shelf would gain goods that
          // were only ever dispensed once. Only the CAS winner reverses anything.
          const claimed = await tx.invoice.updateMany({
            where: { id, organizationId: ORGANIZATION_ID, status: { not: 'cancelled' } },
            data: updateData,
          })
          if (claimed.count !== 1) {
            const err = new Error('Invoice is already cancelled')
            err.status = 409
            throw err
          }

          // Cancelling the document is only half the job — the stock it consumed
          // and the lab/radiology work it raised have to be undone in the SAME
          // transaction, or a voided bill leaves the shelf short and the lab
          // still processing work nobody will pay for.
          const reversed = await reverseInvoiceFulfillment(tx, {
            organizationId: ORGANIZATION_ID,
            invoice: existing,
            actorId: getActor(req).id,
          })

          await tx.auditLog.create({
            data: {
              organizationId: ORGANIZATION_ID,
              action: 'INVOICE_CANCELLED',
              entityType: 'Invoice',
              entityId: id,
              metadata: JSON.stringify({
                cancelledAt: updateData.cancelledAt,
                reason: updates.cancellationReason || null,
                reversed,
              }),
              performedAt: new Date(),
            },
          })

          return tx.invoice.findUnique({ where: { id } })
        }

        return tx.invoice.update({ where: { id }, data: updateData })
      })

      return res.json({ success: true, data: invoice })
    }

    if (resource === 'service') {
      const parsed = serviceUpdateSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.flatten() })
      }

      const { id, updates } = parsed.data

      // Tenant guard: don't let one org edit another org's service catalogue.
      const existing = await db.billingService.findFirst({
        where: { id, organizationId: ORGANIZATION_ID },
        select: { id: true },
      })
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Service not found' })
      }

      const service = await db.billingService.update({
        where: { id },
        data: updates,
      })

      return res.json({ success: true, data: service })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource type' })
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message })
    }
    console.error('Billing update error:', error)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
}
