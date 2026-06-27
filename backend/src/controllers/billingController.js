import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
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
})

const invoiceSchema = z.object({
  patientId: z.string().min(1),
  consultationId: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1),
  discountAmount: z.number().nonnegative().default(0),
  discountPercentage: z.number().nonnegative().default(0),
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

// Indian financial year (Apr 1 – Mar 31), e.g. "2026-27".
function financialYear(d = new Date()) {
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 3 ? y : y - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

// Atomic, gap-free, per-org invoice number. The upsert+increment runs inside the
// caller's transaction so two concurrent invoices can never collide on the
// @unique invoiceNumber column. Format: INV-2026-27-000123
async function nextInvoiceNumber(tx, organizationId) {
  const year = financialYear()
  const counter = await tx.billCounter.upsert({
    where: { organizationId_series_year: { organizationId, series: 'INV', year } },
    create: { organizationId, series: 'INV', year, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `INV-${year}-${String(counter.value).padStart(6, '0')}`
}

export async function getAll(req, res) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource, category, status, patientId, invoiceId } = req.query
    const limit = parseInt(req.query.limit || '10')
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
      if (status) where.paymentStatus = status
      if (patientId) where.patientId = patientId

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

      const [payments, total] = await Promise.all([
        db.payment.findMany({
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
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayEnd = new Date()
      todayEnd.setHours(23, 59, 59, 999)

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

      const { patientId, consultationId, items, discountAmount, discountPercentage, notes } =
        parsed.data

      const subtotal = items.reduce((sum, item) => sum + item.total, 0)
      const taxAmount = items.reduce((sum, item) => sum + (item.tax || 0), 0)
      const totalAmount = subtotal - discountAmount + taxAmount

      // Transaction: the invoice number is drawn from a per-org counter inside
      // the same tx, so concurrent creates cannot collide on the @unique column.
      const invoice = await db.$transaction(async (tx) => {
        const invoiceNumber = await nextInvoiceNumber(tx, ORGANIZATION_ID)
        return tx.invoice.create({
          data: {
            organizationId: ORGANIZATION_ID,
            invoiceNumber,
            patientId,
            consultationId: consultationId || null,
            items: JSON.stringify(items),
            subtotal,
            taxAmount,
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
      } = parsed.data

      const receiptNumber = 'RCP' + Date.now()

      // MONEY = ACID. Everything below runs in ONE transaction:
      //   1. verify the invoice exists AND belongs to this org (no cross-tenant write)
      //   2. write the payment
      //   3. atomically INCREMENT amountPaid in the DB (no read-modify-write in JS,
      //      so two concurrent cashiers can never lose an update)
      //   4. recompute balance/status from the post-increment value
      //   5. write the audit row INSIDE the tx — if audit fails, the whole
      //      payment rolls back (a hospital's money trail must be provable)
      const payment = await db.$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId: ORGANIZATION_ID },
          select: { id: true },
        })
        if (!invoice) {
          const err = new Error('Invoice not found')
          err.status = 404
          throw err
        }

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
            paymentDate: new Date(),
            isRefund: false,
          },
        })

        // Atomic increment — the database performs the addition.
        const updated = await tx.invoice.update({
          where: { id: invoiceId },
          data: { amountPaid: { increment: amount } },
          select: { totalAmount: true, amountPaid: true },
        })

        const paymentStatus =
          updated.amountPaid >= updated.totalAmount ? 'paid' : 'partially_paid'

        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            balanceDue: updated.totalAmount - updated.amountPaid,
            paymentStatus,
            // Valid schema statuses: draft|sent|overdue|paid|cancelled.
            // (Previously set the phantom value 'active'.)
            status: paymentStatus === 'paid' ? 'paid' : 'sent',
          },
        })

        await tx.auditLog.create({
          data: {
            organizationId: ORGANIZATION_ID,
            action: 'PAYMENT_RECORDED',
            entityType: 'Invoice',
            entityId: invoiceId,
            details: JSON.stringify({
              paymentId: created.id,
              amount,
              paymentMethod,
              receiptNumber,
              newPaymentStatus: paymentStatus,
            }),
            createdAt: new Date(),
          },
        })

        return created
      })

      return res.status(201).json({ success: true, data: payment })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource type' })
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message })
    }
    console.error('Billing create error:', error)
    return res.status(500).json({ success: false, error: 'Internal server error' })
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
          select: { id: true },
        })
        if (!existing) {
          const err = new Error('Invoice not found')
          err.status = 404
          throw err
        }

        if (updates.status === 'cancelled') {
          updateData.cancelledAt = new Date()
          await tx.auditLog.create({
            data: {
              organizationId: ORGANIZATION_ID,
              action: 'INVOICE_CANCELLED',
              entityType: 'Invoice',
              entityId: id,
              details: JSON.stringify({
                cancelledAt: updateData.cancelledAt,
                reason: updates.cancellationReason || null,
              }),
              createdAt: new Date(),
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
