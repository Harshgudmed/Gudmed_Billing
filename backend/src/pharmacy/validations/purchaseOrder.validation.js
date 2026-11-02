import { z } from 'zod'

export const createPurchaseOrderSchema = z.object({
  supplierName: z.string().min(1),
  supplierContact: z.string().optional(),
  supplierEmail: z.string().email().optional(),
  items: z.array(z.any()).min(1),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
})

// Whitelisted update fields — organizationId, poNumber, createdAt, updatedAt NOT included.
// 'received' is deliberately NOT a valid value here — only /purchase-orders/:id/receive
// may set it, since that is the only path that creates the batches and stock movement
// the status implies. Accepting it here let a plain PATCH mark a PO received with no
// goods ever added to the shelf.
export const updatePurchaseOrderSchema = z.object({
  status: z.enum(['draft', 'submitted', 'approved', 'cancelled']).optional(),
  cancellationNote: z.string().optional(),
  notes: z.string().optional(),
  supplierName: z.string().optional(),
  supplierContact: z.string().optional(),
  supplierEmail: z.string().email().optional(),
  expectedDeliveryDate: z.string().optional(),
})

export const receivePurchaseOrderSchema = z.object({
  items: z.array(
    z.object({
      drugId: z.string().min(1),
      batchNumber: z.string().optional(),
      expiryDate: z.string().optional(),
      manufactureDate: z.string().optional(),
      quantityReceived: z.number().int().min(0),
      costPricePerUnit: z.number().min(0).optional(),
      unitCost: z.number().min(0).optional(),
      supplierName: z.string().optional(),
      supplier: z.string().optional(),
    })
  ).min(1),
})
