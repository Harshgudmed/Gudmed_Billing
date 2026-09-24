import { db } from '../../config/db.js'
import { getOrgId } from "../../lib/reqContext.js";
import { createBatchSchema, updateBatchSchema } from '../validations/batch.validation.js'
import { getPagination, paginationMeta, handleServiceError, makeError } from '../utils.js'
import { recordStockChange } from '../stockService.js'
import { dayRange } from '../../lib/dates.js'

const SORTABLE_FIELDS = ['batchNumber', 'expiryDate', 'quantityRemaining', 'status', 'createdAt']

export async function list(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { drugId, status, search, startDate, endDate, sortBy, sortOrder } = req.query
    const { page, limit, skip } = getPagination(req.query)

    const where = { organizationId: ORGANIZATION_ID }
    if (drugId) where.drugId = drugId
    if (status) where.status = status
    if (search) {
      where.OR = [
        { batchNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
        // The medicine itself — the first thing anyone types. Batch number and
        // supplier alone meant "paracetamol" found nothing on the Batches tab.
        { drug: { drugName: { contains: search, mode: 'insensitive' } } },
        { drug: { genericName: { contains: search, mode: 'insensitive' } } },
      ]
    }
    // The Batches tab's date filter is on EXPIRY — "what expires this month" —
    // as whole days in the hospital's timezone (the shared dayRange).
    if (startDate || endDate) where.expiryDate = dayRange(startDate, endDate)

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
    if (parsed.quantityRemaining != null && parsed.quantityRemaining > parsed.quantityReceived) {
      throw makeError('A batch cannot have more left than it received', 400, 'BATCH_QUANTITY_INVALID')
    }

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
        // What is actually on the shelf. A batch recorded with fewer remaining
        // than received (part already used) added the full received quantity to
        // the medicine's total, so the two tabs disagreed from the start.
        quantityDelta: batch.quantityRemaining,
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

    const { quantityReceived, quantityRemaining, ...updateData } = parsed

    // The edit form sends '' for a date left blank. '' is not a date: it reached
    // Prisma, so saving ANY batch without a manufacture date failed ("Invalid
    // request data"). Blank clears an optional date; expiry is required, so a
    // blank expiry leaves the stored one as it is.
    for (const field of ['manufactureDate', 'purchaseDate']) {
      if (updateData[field] === '') updateData[field] = null
      else if (updateData[field]) updateData[field] = new Date(updateData[field])
    }
    if (updateData.expiryDate) updateData.expiryDate = new Date(updateData.expiryDate)
    else delete updateData.expiryDate

    // Taking stock out is what Remove does — it books the loss. Marking a batch
    // "recalled" through an edit would drop it from sale with the medicine's
    // total still counting it.
    if (updateData.status === 'recalled' && existing.status !== 'recalled') {
      throw makeError('To take a batch out of stock, use Remove', 409, 'USE_REMOVE_TO_RECALL')
    }

    // Quantities are stock, so they move through the ledger like every other
    // stock change (stockService.js) — never written straight onto the row. The
    // edit form's quantity used to be silently dropped: "Batch updated", and
    // nothing changed.
    let newReceived = existing.quantityReceived
    let newRemaining = existing.quantityRemaining
    const used = existing.quantityReceived - existing.quantityRemaining
    if (quantityReceived !== undefined && quantityReceived !== existing.quantityReceived) {
      if (quantityReceived < used) {
        throw makeError(`${used} from this batch have already been sold or dispensed, so it cannot have received fewer than ${used}`, 409, 'BATCH_QUANTITY_BELOW_USED')
      }
      newReceived = quantityReceived
      // Two rows in the live data hold MORE left than received (written before
      // create checked it), which makes "used" negative. Correcting such a row
      // must not invent stock, so what is left never exceeds what came in.
      newRemaining = Math.min(quantityReceived, quantityReceived - used)
    }
    if (quantityRemaining !== undefined) {
      if (quantityRemaining > newReceived) {
        throw makeError('A batch cannot have more left than it received', 400, 'BATCH_QUANTITY_INVALID')
      }
      newRemaining = quantityRemaining
    }
    const delta = newRemaining - existing.quantityRemaining
    if (delta !== 0 && existing.status === 'recalled') {
      throw makeError('This batch was removed, so its quantity cannot be changed', 409, 'BATCH_REMOVED')
    }
    if (delta !== 0 && !updateData.status) {
      if (newRemaining === 0 && existing.status === 'active') updateData.status = 'depleted'
      if (newRemaining > 0 && existing.status === 'depleted') updateData.status = 'active'
    }

    const data = await db.$transaction(async (tx) => {
      // Compare-and-set: a sale drawing from this batch between the read above
      // and this write would otherwise be overwritten by the old count.
      const { count } = await tx.pharmacyBatch.updateMany({
        where: { id: existing.id, organizationId: ORGANIZATION_ID, quantityRemaining: existing.quantityRemaining, status: existing.status },
        data: { ...updateData, quantityReceived: newReceived, quantityRemaining: newRemaining },
      })
      if (count === 0) {
        throw makeError('This batch changed while you were editing it (a sale or another edit). Reload and try again.', 409, 'BATCH_CHANGED')
      }
      if (delta !== 0) {
        await recordStockChange(tx, {
          organizationId: ORGANIZATION_ID,
          drugId: existing.drugId,
          batchId: existing.id,
          changeType: 'adjustment',
          quantityDelta: delta,
          reference: existing.batchNumber,
          note: `Batch ${existing.batchNumber} corrected: received ${existing.quantityReceived} → ${newReceived}, left ${existing.quantityRemaining} → ${newRemaining}`,
          createdById: req.user?.userId ?? null,
        })
      }
      return tx.pharmacyBatch.findUnique({ where: { id: existing.id } })
    })
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
      // Removing twice took the same stock off the medicine twice.
      if (batch.status === 'recalled') throw makeError('This batch was already removed', 409, 'BATCH_ALREADY_REMOVED')

      // Nothing is left on the shelf once it is removed — the batch used to keep
      // its old "remaining" and stayed on the Batches tab looking sellable while
      // the medicine's total had already dropped. The ledger row below keeps how
      // much was taken out. Compare-and-set, so a sale landing in between is not
      // silently written over.
      const { count } = await tx.pharmacyBatch.updateMany({
        where: { id: batch.id, status: batch.status, quantityRemaining: batch.quantityRemaining },
        data: { status: 'recalled', quantityRemaining: 0 },
      })
      if (count === 0) throw makeError('This batch changed while you were removing it. Reload and try again.', 409, 'BATCH_CHANGED')

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
