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

const invoiceUpdateSchema = z.object({
  id: z.string().min(1),
  updates: z.record(z.any()),
})

const serviceUpdateSchema = z.object({
  id: z.string().min(1),
  updates: z.record(z.any()),
})

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
      const invoiceNumber = 'INV' + Date.now()

      const invoice = await db.invoice.create({
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

      const payment = await db.payment.create({
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

      const invoice = await db.invoice.findUnique({
        where: { id: invoiceId },
        select: { totalAmount: true, amountPaid: true },
      })

      const newAmountPaid = (invoice.amountPaid || 0) + amount
      const paymentStatus =
        newAmountPaid >= invoice.totalAmount ? 'paid' : 'partially_paid'

      await db.invoice.update({
        where: { id: invoiceId },
        data: {
          amountPaid: newAmountPaid,
          balanceDue: invoice.totalAmount - newAmountPaid,
          paymentStatus,
          status: paymentStatus === 'paid' ? 'paid' : 'active',
        },
      })

      try {
        await db.auditLog.create({
          data: {
            organizationId: ORGANIZATION_ID,
            action: 'PAYMENT_RECORDED',
            entityType: 'Invoice',
            entityId: invoiceId,
            details: JSON.stringify({
              paymentId: payment.id,
              amount,
              paymentMethod,
              receiptNumber,
              newPaymentStatus: paymentStatus,
            }),
            createdAt: new Date(),
          },
        })
      } catch (auditError) {
        console.warn('Audit log creation failed (non-fatal):', auditError)
      }

      return res.status(201).json({ success: true, data: payment })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource type' })
  } catch (error) {
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

      if (updates.status === 'cancelled') {
        updateData.cancelledAt = new Date()

        try {
          await db.auditLog.create({
            data: {
              organizationId: ORGANIZATION_ID,
              action: 'INVOICE_CANCELLED',
              entityType: 'Invoice',
              entityId: id,
              details: JSON.stringify({ cancelledAt: updateData.cancelledAt }),
              createdAt: new Date(),
            },
          })
        } catch (auditError) {
          console.warn('Audit log creation failed (non-fatal):', auditError)
        }
      }

      const invoice = await db.invoice.update({
        where: { id },
        data: updateData,
      })

      return res.json({ success: true, data: invoice })
    }

    if (resource === 'service') {
      const parsed = serviceUpdateSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.flatten() })
      }

      const { id, updates } = parsed.data

      const service = await db.billingService.update({
        where: { id },
        data: updates,
      })

      return res.json({ success: true, data: service })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource type' })
  } catch (error) {
    console.error('Billing update error:', error)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
}
