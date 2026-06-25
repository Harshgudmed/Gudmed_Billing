import { z } from 'zod'

export const createSaleSchema = z.object({
  patientId: z.string().optional(),
  prescriptionId: z.string().optional(),
  items: z.array(
    z.object({
      drugId: z.string().min(1),
      drugName: z.string().optional(),
      quantity: z.number().int().min(1),
      unitPrice: z.number().min(0),
      total: z.number().optional(),
    })
  ).min(1),
  paymentMethod: z.string().optional(),
  paymentStatus: z.string().optional(),
  discountAmount: z.number().min(0).optional(),
})
