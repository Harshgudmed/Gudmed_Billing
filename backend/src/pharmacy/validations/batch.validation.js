import { z } from 'zod'
import { round2 } from '../../lib/money.js'

// Money is kept to the paisa: a cost of ₹4.375 was stored as typed, and every
// stock value built on it carried the third decimal.
const rupees = z.number().min(0).transform(round2)

export const createBatchSchema = z.object({
  drugId: z.string().min(1),
  batchNumber: z.string().min(1),
  expiryDate: z.string().min(1),
  manufactureDate: z.string().optional(),
  quantityReceived: z.number().int().min(1),
  quantityRemaining: z.number().int().min(0).optional(),
  costPricePerUnit: rupees.optional(),
  totalCost: rupees.optional(),
  supplierName: z.string().optional(),
  supplierInvoice: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
  purchaseDate: z.string().optional(),
  status: z.string().optional(),
})

// drugId and quantityReceived not allowed in updates — whitelisted fields only
export const updateBatchSchema = z.object({
  batchNumber: z.string().optional(),
  manufactureDate: z.string().optional(),
  expiryDate: z.string().optional(),
  // The Batches tab's Edit form sends this; without it here zod dropped it and
  // the quantity change vanished. The controller books the difference as stock.
  quantityReceived: z.number().int().min(1).optional(),
  quantityRemaining: z.number().int().min(0).optional(),
  costPricePerUnit: rupees.optional(),
  totalCost: rupees.optional(),
  supplierName: z.string().optional(),
  supplierInvoice: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
  purchaseDate: z.string().optional(),
  status: z.string().optional(),
})
