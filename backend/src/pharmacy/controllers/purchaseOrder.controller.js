import { db } from '../../config/db.js'
import { getOrgId } from "../../lib/reqContext.js";
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  receivePurchaseOrderSchema,
} from '../validations/purchaseOrder.validation.js'
import { getPagination, paginationMeta, handleServiceError, makeError } from '../utils.js'
import { recordStockChange } from '../stockService.js'
import { nextSeriesNumber } from '../../lib/counters.js'

const SORTABLE_FIELDS = ['orderDate', 'status', 'supplierName', 'totalAmount', 'createdAt']

export async function list(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { status, search, sortBy, sortOrder } = req.query
    const { page, limit, skip } = getPagination(req.query)

    const where = { organizationId: ORGANIZATION_ID }
    if (status) where.status = status
    if (search) {
      where.OR = [
        { supplierName: { contains: search, mode: 'insensitive' } },
        { poNumber: { contains: search, mode: 'insensitive' } },
      ]
    }

    const orderBy = SORTABLE_FIELDS.includes(sortBy)
      ? { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' }
      : { createdAt: 'desc' }

    const [data, total] = await Promise.all([
      db.pharmacyPurchaseOrder.findMany({ where, orderBy, skip, take: limit }),
      db.pharmacyPurchaseOrder.count({ where }),
    ])

    res.json({ success: true, data, pagination: paginationMeta(page, limit, total) })
  } catch (err) {
    next(err)
  }
}

export async function getById(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const order = await db.pharmacyPurchaseOrder.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
    })
    if (!order) throw makeError('Purchase order not found', 404, 'PURCHASE_ORDER_NOT_FOUND')
    res.json({ success: true, data: order })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = createPurchaseOrderSchema.parse(req.body)

    // PO numbers come from the atomic counter, not `count() + 1`. Two buyers
    // clicking "create" together both read the same count and both mint the same
    // number — and because poNumber has no unique constraint, nothing stops it:
    // the duplicate is written silently and two different orders answer to one
    // PO number for the rest of their life.
    const data = await db.$transaction(async (tx) => {
      const poNumber = await nextSeriesNumber(tx, ORGANIZATION_ID, 'PURCHASE_ORDER', 'PO')
      return tx.pharmacyPurchaseOrder.create({
        data: {
          organizationId: ORGANIZATION_ID,
          poNumber,
          supplierName: parsed.supplierName,
          supplierContact: parsed.supplierContact ?? null,
          supplierEmail: parsed.supplierEmail ?? null,
          items: JSON.stringify(parsed.items),
          totalAmount: parsed.items.reduce((s, i) => s + (i.totalCost || 0), 0),
          expectedDeliveryDate: parsed.expectedDeliveryDate
            ? new Date(parsed.expectedDeliveryDate)
            : undefined,
          notes: parsed.notes ?? null,
          status: 'draft',
        },
      })
    })

    res.status(201).json({ success: true, data, message: 'Purchase order created successfully' })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = updatePurchaseOrderSchema.parse(req.body)

    const existing = await db.pharmacyPurchaseOrder.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
    })
    if (!existing) throw makeError('Purchase order not found', 404, 'PURCHASE_ORDER_NOT_FOUND')

    const updateData = { ...parsed }
    if (updateData.expectedDeliveryDate) {
      updateData.expectedDeliveryDate = new Date(updateData.expectedDeliveryDate)
    }

    const data = await db.pharmacyPurchaseOrder.update({
      where: { id: req.params.id },
      data: updateData,
    })
    res.json({ success: true, data, message: 'Purchase order updated successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

// PATCH /purchase-orders/:id/receive
// Creates batches and increments stock for each item — wrapped in transaction
export async function receive(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = receivePurchaseOrderSchema.parse(req.body)

    const data = await db.$transaction(async (tx) => {
      const order = await tx.pharmacyPurchaseOrder.findFirst({
        where: { id: req.params.id, organizationId: ORGANIZATION_ID },
      })
      if (!order) throw makeError('Purchase order not found', 404, 'PURCHASE_ORDER_NOT_FOUND')

      // INVENTORY INTEGRITY: receiving is idempotent. An already-received PO must
      // not add its quantities to stock a second time. Guarded inside the same
      // transaction that flips status + increments stock, so a concurrent double
      // call can't slip a second stock add past this check.
      if (order.status === 'received') {
        throw makeError('Purchase order already received', 409, 'PURCHASE_ORDER_ALREADY_RECEIVED')
      }

      for (const item of parsed.items) {
        if (item.batchNumber && item.expiryDate && item.quantityReceived > 0) {
          // The PO itself is org-checked above, but each drugId in the body is
          // caller-supplied: without this, a receive could name ANOTHER
          // hospital's drug and inflate their stock (and attach our batch to it).
          const ownDrug = await tx.pharmacyDrug.findFirst({
            where: { id: item.drugId, organizationId: ORGANIZATION_ID },
            select: { id: true },
          })
          if (!ownDrug) {
            throw makeError(`Drug not found: ${item.drugId}`, 404, 'DRUG_NOT_FOUND')
          }
          const batch = await tx.pharmacyBatch.create({
            data: {
              organizationId: ORGANIZATION_ID,
              drugId: item.drugId,
              batchNumber: item.batchNumber,
              expiryDate: new Date(item.expiryDate),
              manufactureDate: item.manufactureDate ? new Date(item.manufactureDate) : undefined,
              quantityReceived: item.quantityReceived,
              quantityRemaining: item.quantityReceived,
              costPricePerUnit: item.costPricePerUnit ?? item.unitCost ?? undefined,
              supplierName: item.supplierName ?? item.supplier ?? undefined,
              status: 'active',
            },
          })
          // Goods-in goes through recordStockChange, never a bare increment: the
          // raw update moved quantityInStock without appending a StockLedger row,
          // so every later row's balanceAfter was short by this receipt and the
          // shelf count could not be reconciled against the ledger.
          await recordStockChange(tx, {
            organizationId: ORGANIZATION_ID,
            drugId: item.drugId,
            batchId: batch.id,
            changeType: 'purchase',
            quantityDelta: item.quantityReceived,
            reference: order.poNumber,
            note: `PO ${order.poNumber} received — batch ${batch.batchNumber}`,
            createdById: req.user?.userId ?? null,
          })
        }
      }

      return tx.pharmacyPurchaseOrder.update({
        where: { id: req.params.id },
        data: {
          status: 'received',
          receivedDate: new Date(),
          items: JSON.stringify(parsed.items),
        },
      })
    })

    res.json({ success: true, data, message: 'Purchase order received successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}
