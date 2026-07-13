import { db } from '../config/db.js'
import { getOrgId, getActor } from "../lib/reqContext.js";
import { todayRange } from '../lib/dates.js'
import { nextSeriesNumber, invoiceProbe } from "../lib/counters.js";
import { recalcInvoice, refundableAmount } from "../lib/invoiceLedger.js";
import { fulfillInvoiceItems } from "../lib/invoiceFulfillment.js";
import { z } from 'zod'

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
})

const invoiceSchema = z.object({
  patientId: z.string().min(1),
  consultationId: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1),
  discountAmount: z.number().nonnegative().default(0),
  discountPercentage: z.number().nonnegative().default(0),
  taxPercentage: z.number().nonnegative().default(0),
  notes: z.string().optional(),
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


export async function getAll(req, res) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource, category, status, patientId, invoiceId, search } = req.query
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 1000) // hard cap → no unbounded query DoS
    const offset = parseInt(req.query.offset || '0')

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
      if (search) {
        const term = search.trim()
        where.OR = [
          { invoiceNumber: { contains: term, mode: 'insensitive' } },
          { patient: { firstName: { contains: term, mode: 'insensitive' } } },
          { patient: { lastName: { contains: term, mode: 'insensitive' } } },
          { patient: { phonePrimary: { contains: term } } },
        ]
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
                id: true,
                mrn: true,
                firstName: true,
                lastName: true,
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
              select: { id: true, mrn: true, firstName: true, lastName: true },
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
                  select: { id: true, mrn: true, firstName: true, lastName: true },
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

      const { patientId, consultationId, items, discountAmount, discountPercentage, taxPercentage, notes } =
        parsed.data

      const subtotal = items.reduce((sum, item) => sum + item.total, 0)
      const taxAmount = items.reduce((sum, item) => sum + (item.tax || 0), 0)
      
      if (discountAmount > subtotal + taxAmount) {
        return res.status(400).json({ success: false, error: 'Discount cannot exceed the total value of the items' })
      }

      const totalAmount = subtotal - discountAmount + taxAmount

      // Transaction: the invoice number is drawn from a per-org counter inside
      // the same tx, so concurrent creates cannot collide on the @unique column.
      const invoice = await db.$transaction(async (tx) => {
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
          },
          include: {
            patient: {
              select: {
                id: true,
                mrn: true,
                firstName: true,
                lastName: true,
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
      if (idempotencyKey) {
        const existing = await db.payment.findFirst({
          where: { organizationId: ORGANIZATION_ID, idempotencyKey },
        })
        if (existing) return res.status(200).json({ success: true, data: existing, idempotent: true })
      }

      // MONEY = ACID. Everything below runs in ONE transaction:
      //   1. verify the invoice exists AND belongs to this org (no cross-tenant write)
      //   2. draw an atomic receipt number and write the payment
      //   3. recompute the invoice cache from its Payment rows (recalcInvoice)
      //   4. write the audit row INSIDE the tx — if audit fails, the whole
      //      payment rolls back (a hospital's money trail must be provable)
      const payment = await db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId: ORGANIZATION_ID },
          select: { id: true, isArchived: true },
        })
        if (!invoice) {
          const err = new Error('Invoice not found')
          err.status = 404
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
            where: { id: paymentId },
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

        // APPROVE LOGIC: Lock old invoice, generate new revised invoice
        const oldInvoice = payment.invoice
        const refundedAmount = payment.amount

        // An invoice can only be revised ONCE. Without this, two refunds left
        // pending on the same invoice could both be approved, and each would
        // derive its revised invoice from the SAME (already superseded) totals —
        // refunding the money twice. The second request must be re-raised against
        // the revised invoice instead.
        if (oldInvoice.isArchived) {
          const err = new Error('This invoice has already been revised by an approved refund. Re-raise this request against the revised invoice.')
          err.status = 409; throw err
        }

        // 1. Update Payment
        const approvedPayment = await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: 'APPROVED',
            approvedByUserId: actor.id,
            approvalDate: new Date()
          }
        })

        // 2. Lock Old Invoice (immutable — kept exactly as-is for the audit trail)
        await tx.invoice.update({
          where: { id: oldInvoice.id },
          data: {
            paymentStatus: 'refunded',
            isArchived: true,
          }
        })

        // 3. Generate Revised Invoice
        let parsedItems = []
        try { parsedItems = JSON.parse(oldInvoice.items) } catch (e) { parsedItems = [] }

        const newTotalAmount = oldInvoice.totalAmount - refundedAmount
        const newAmountPaid = oldInvoice.amountPaid - refundedAmount
        const newBalanceDue = newTotalAmount - newAmountPaid
        const newPaymentStatus = newAmountPaid >= newTotalAmount ? 'paid' : (newAmountPaid > 0 ? 'partially_paid' : 'unpaid')

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
        const baseNumber = oldInvoice.invoiceNumber.replace(/-R\d+$/, '')
        const revCount = await tx.invoice.count({ where: { organizationId: ORGANIZATION_ID, parentInvoiceId: oldInvoice.id } })
        const revisedNumber = `${baseNumber}-R${revCount + 1}`

        const revisedInvoice = await tx.invoice.create({
          data: {
            organizationId: ORGANIZATION_ID,
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
            amountPaid: newAmountPaid,
            balanceDue: newBalanceDue,
            paymentStatus: newPaymentStatus,
            insuranceClaimAmount: oldInvoice.insuranceClaimAmount,
            patientCopayAmount: oldInvoice.patientCopayAmount,
            notes: 'Revised Invoice due to Refund ' + payment.receiptNumber,
          }
        })

        await tx.auditLog.create({
          data: {
            organizationId: ORGANIZATION_ID,
            action: 'REFUND_APPROVED',
            entityType: 'Invoice',
            entityId: oldInvoice.id,
            metadata: JSON.stringify({
              refundId: paymentId,
              revisedInvoiceId: revisedInvoice.id
            }),
            performedAt: new Date(),
          }
        })

        return { payment: approvedPayment, revisedInvoice }
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

        let items = []
        try { items = JSON.parse(invoice.items || '[]') } catch { items = [] }
        items.push({ ...item, status: 'ordered' })

        const subtotal = items.reduce((s, i) => s + (i.total || 0), 0)
        const taxAmount = items.reduce((s, i) => s + (i.tax || 0), 0)
        const totalAmount = subtotal - (invoice.discountAmount || 0) + taxAmount

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
          select: { id: true, amountPaid: true, paymentStatus: true },
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
          await tx.auditLog.create({
            data: {
              organizationId: ORGANIZATION_ID,
              action: 'INVOICE_CANCELLED',
              entityType: 'Invoice',
              entityId: id,
              metadata: JSON.stringify({
                cancelledAt: updateData.cancelledAt,
                reason: updates.cancellationReason || null,
              }),
              performedAt: new Date(),
            },
          })
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
