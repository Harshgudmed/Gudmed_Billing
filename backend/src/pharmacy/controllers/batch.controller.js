import { db } from '../../config/db.js'
import { getOrgId } from "../../lib/reqContext.js";
import { createBatchSchema, updateBatchSchema } from '../validations/batch.validation.js'
import { getPagination, paginationMeta, handleServiceError, makeError } from '../utils.js'
import { recordStockChange } from '../stockService.js'

const SORTABLE_FIELDS = ['batchNumber', 'expiryDate', 'quantityRemaining', 'status', 'createdAt']

export async function list(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { drugId, status, search, sortBy, sortOrder } = req.query
    const { page, limit, skip } = getPagination(req.query)

    const where = { organizationId: ORGANIZATION_ID }
    if (drugId) where.drugId = drugId
    if (status) where.status = status
    if (search) {
      where.OR = [
        { batchNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
      ]
    }

    const orderBy = SORTABLE_FIELDS.includes(sortBy)
      ? { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' }
      : { expiryDate: 'asc' }

    const [data, total] = await Promise.all([
      db.pharmacyBatch.findMany({
        where,
        include: {
          drug: { select: { id: true, drugName: true, strength: true, dosageForm: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      db.pharmacyBatch.count({ where }),
    ])

    res.json({ success: true, data, pagination: paginationMeta(page, limit, total) })
  } catch (err) {
    next(err)
  }
}

export async function getById(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const batch = await db.pharmacyBatch.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
      include: {
        drug: { select: { id: true, drugName: true, strength: true, dosageForm: true } },
      },
    })
    if (!batch) throw makeError('Batch not found', 404, 'BATCH_NOT_FOUND')
    res.json({ success: true, data: batch })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = createBatchSchema.parse(req.body)

    const data = await db.$transaction(async (tx) => {
      const drug = await tx.pharmacyDrug.findFirst({
        where: { id: parsed.drugId, organizationId: ORGANIZATION_ID },
      })
      if (!drug) throw makeError('Drug not found', 404, 'DRUG_NOT_FOUND')

      const batch = await tx.pharmacyBatch.create({
        data: {
          organizationId: ORGANIZATION_ID,
          drugId: parsed.drugId,
          batchNumber: parsed.batchNumber,
          expiryDate: new Date(parsed.expiryDate),
          manufactureDate: parsed.manufactureDate ? new Date(parsed.manufactureDate) : undefined,
          quantityReceived: parsed.quantityReceived,
          quantityRemaining: parsed.quantityRemaining ?? parsed.quantityReceived,
          costPricePerUnit: parsed.costPricePerUnit,
          totalCost: parsed.totalCost,
          supplierName: parsed.supplierName,
          supplierInvoice: parsed.supplierInvoice,
          purchaseOrderNumber: parsed.purchaseOrderNumber,
          purchaseDate: parsed.purchaseDate ? new Date(parsed.purchaseDate) : undefined,
          status: parsed.status ?? 'active',
        },
      })

      await recordStockChange(tx, {
        organizationId: ORGANIZATION_ID,
        drugId: parsed.drugId,
        batchId: batch.id,
        changeType: 'purchase',
        quantityDelta: parsed.quantityReceived,
        reference: parsed.purchaseOrderNumber || batch.batchNumber,
        note: `Batch ${batch.batchNumber} received`,
        createdById: req.user?.userId ?? null,
      })

      return batch
    })

    res.status(201).json({ success: true, data, message: 'Batch created successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = updateBatchSchema.parse(req.body)

    const existing = await db.pharmacyBatch.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
    })
    if (!existing) throw makeError('Batch not found', 404, 'BATCH_NOT_FOUND')

    const updateData = { ...parsed }
    if (updateData.expiryDate) updateData.expiryDate = new Date(updateData.expiryDate)
    if (updateData.manufactureDate) updateData.manufactureDate = new Date(updateData.manufactureDate)
    if (updateData.purchaseDate) updateData.purchaseDate = new Date(updateData.purchaseDate)

    const data = await db.pharmacyBatch.update({ where: { id: req.params.id }, data: updateData })
    res.json({ success: true, data, message: 'Batch updated successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

// Soft delete: sets status to 'recalled' and decrements drug stock — wrapped in transaction
export async function remove(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const data = await db.$transaction(async (tx) => {
      const batch = await tx.pharmacyBatch.findFirst({
        where: { id: req.params.id, organizationId: ORGANIZATION_ID },
      })
      if (!batch) throw makeError('Batch not found', 404, 'BATCH_NOT_FOUND')

      await tx.pharmacyBatch.update({
        where: { id: req.params.id },
        data: { status: 'recalled' },
      })

      await recordStockChange(tx, {
        organizationId: ORGANIZATION_ID,
        drugId: batch.drugId,
        batchId: batch.id,
        changeType: 'recall',
        quantityDelta: -batch.quantityRemaining,
        reference: batch.batchNumber,
        note: `Batch ${batch.batchNumber} recalled`,
        createdById: req.user?.userId ?? null,
      })

      return { id: req.params.id }
    })

    res.json({ success: true, data, message: 'Batch recalled successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}
