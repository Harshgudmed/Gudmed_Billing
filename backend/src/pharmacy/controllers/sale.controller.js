import { db } from '../../config/db.js'
import { getOrgId } from "../../lib/reqContext.js";
import { createSaleSchema } from '../validations/sale.validation.js'
import { getPagination, paginationMeta, handleServiceError, makeError } from '../utils.js'
import { recordStockChange, consumeFromBatches } from '../stockService.js'

const SORTABLE_FIELDS = ['saleDate', 'totalAmount', 'paymentStatus', 'createdAt']

export async function list(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { startDate, endDate, patientId, paymentStatus, sortBy, sortOrder } = req.query
    const { page, limit, skip } = getPagination(req.query)

    const where = { organizationId: ORGANIZATION_ID }
    if (patientId) where.patientId = patientId
    if (paymentStatus) where.paymentStatus = paymentStatus
    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt.gte = new Date(startDate)
      if (endDate) {
        // Include the full end day through 23:59:59.999
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        where.createdAt.lte = end
      }
    }

    const orderBy = SORTABLE_FIELDS.includes(sortBy)
      ? { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' }
      : { createdAt: 'desc' }

    const [data, total, sumAgg] = await Promise.all([
      db.pharmacySale.findMany({
        where,
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      db.pharmacySale.count({ where }),
      // Sum across the WHOLE filtered set (not just this page) so the UI can show
      // the period's true revenue even though it only loads one page of rows.
      db.pharmacySale.aggregate({ where, _sum: { totalAmount: true } }),
    ])

    res.json({
      success: true,
      data,
      pagination: paginationMeta(page, limit, total),
      summary: { totalAmount: sumAgg._sum.totalAmount ?? 0, totalCount: total },
    })
  } catch (err) {
    next(err)
  }
}

export async function getById(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const sale = await db.pharmacySale.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
      },
    })
    if (!sale) throw makeError('Sale not found', 404, 'SALE_NOT_FOUND')
    res.json({ success: true, data: sale })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = createSaleSchema.parse(req.body)

    const data = await db.$transaction(async (tx) => {
      // Validate stock for every item before any write
      const drugsById = new Map()
      for (const item of parsed.items) {
        const drug = await tx.pharmacyDrug.findFirst({
          where: { id: item.drugId, organizationId: ORGANIZATION_ID },
          select: { id: true, drugName: true, quantityInStock: true, hsnCode: true, gstRate: true },
        })
        if (!drug) {
          throw makeError(`Drug not found: ${item.drugId}`, 404, 'DRUG_NOT_FOUND')
        }
        if (drug.quantityInStock < item.quantity) {
          throw makeError(
            `Insufficient stock for "${drug.drugName}": requested ${item.quantity}, available ${drug.quantityInStock}`,
            422,
            'INSUFFICIENT_STOCK',
            { drugName: drug.drugName, requested: item.quantity, available: drug.quantityInStock }
          )
        }
        drugsById.set(item.drugId, drug)
      }

      // Decrement stock for each item — batches FIFO + ledger row (single source of
      // truth) — BEFORE building the stored item list, so we can snapshot which
      // batch/expiry each line actually drew from onto the receipt (a GST invoice
      // must show the batch/expiry that was true at sale time, not looked up later).
      const enrichedItems = []
      for (const item of parsed.items) {
        const drug = drugsById.get(item.drugId)
        const { consumed } = await consumeFromBatches(tx, { drugId: item.drugId, quantity: item.quantity })
        enrichedItems.push({
          ...item,
          hsnCode: drug.hsnCode || '',
          gstRate: drug.gstRate || 0,
          batchNumber: consumed.map((c) => c.batchNumber).join('/') || '',
          expiryDate: consumed[0]?.expiryDate || null,
        })
      }

      const subtotal = parsed.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      const discountAmount = parsed.discountAmount ?? 0
      const totalAmount = subtotal - discountAmount

      const sale = await tx.pharmacySale.create({
        data: {
          organizationId: ORGANIZATION_ID,
          patientId: parsed.patientId ?? null,
          prescriptionId: parsed.prescriptionId ?? null,
          items: JSON.stringify(enrichedItems),
          subtotal,
          discountAmount,
          totalAmount,
          paymentMethod: parsed.paymentMethod ?? 'cash',
          paymentStatus: parsed.paymentStatus ?? 'paid',
          amountPaid: totalAmount,
          receiptNumber: `RCP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        },
      })

      for (const item of parsed.items) {
        await recordStockChange(tx, {
          organizationId: ORGANIZATION_ID,
          drugId: item.drugId,
          changeType: 'sale',
          quantityDelta: -item.quantity,
          reference: sale.id,
          note: `Sale ${sale.receiptNumber}`,
          createdById: req.user?.userId ?? null,
        })
      }

      // Mark linked prescription as fully dispensed
      if (parsed.prescriptionId) {
        await tx.prescription.update({
          where: { id: parsed.prescriptionId },
          data: { status: 'fully_dispensed' },
        })
      }

      return sale
    })

    res.status(201).json({ success: true, data, message: 'Sale created successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}
