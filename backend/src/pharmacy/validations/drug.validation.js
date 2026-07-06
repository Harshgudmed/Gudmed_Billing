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
export const updateDrugSchema = createDrugSchema.partial()
