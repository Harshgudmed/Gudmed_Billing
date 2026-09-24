import { z } from 'zod'

export const createDrugSchema = z.object({
  drugName: z.string().min(1),
  genericName: z.string().optional(),
  brandName: z.string().optional(),
  drugCode: z.string().optional(),
  barcode: z.string().optional(),
  manufacturer: z.string().optional(),
  drugCategory: z.string().optional(),
  dosageForm: z.string().optional(),
  strength: z.string().optional(),
  unitOfMeasure: z.string().optional(),
  reorderLevel: z.number().int().min(0).optional(),
  maximumStockLevel: z.number().int().min(0).optional(),
  quantityInStock: z.number().int().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  costPrice: z.number().min(0).optional(),
  purchasePrice: z.number().min(0).optional(),
  mrp: z.number().min(0).optional(),
  gstRate: z.number().min(0).optional(),
  markupPercentage: z.number().min(0).optional(),
  requiresPrescription: z.boolean().optional(),
  storageLocation: z.string().optional(),
  supplierName: z.string().optional(),
  supplierContact: z.string().optional(),
  description: z.string().optional(),
  sideEffects: z.string().optional(),
  contraindications: z.string().optional(),
})

// Whitelisted fields for PATCH — organizationId, isActive, createdAt, updatedAt are NOT here
// quantityInStock is NOT editable through an update. Writing it straight onto
// the drug moved the medicine's total with no ledger row and no batch touched,
// so the Drug Inventory and Batches tabs disagreed. Stock now moves only through
// POST /drugs/:id/adjust (take out, FIFO from batches) or a new batch (put in);
// if anything still sends the field here, zod drops it.
export const updateDrugSchema = createDrugSchema.omit({ quantityInStock: true }).partial()

export const adjustStockSchema = z.object({
  quantity: z.number().int().min(1, 'Enter how many to take out'),
  reason: z.string().trim().max(200).optional(),
})
