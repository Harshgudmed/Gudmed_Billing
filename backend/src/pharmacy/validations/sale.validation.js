import { z } from 'zod'

export const createSaleSchema = z.object({
  patientId: z.string().optional(),
  prescriptionId: z.string().optional(),
  customerName: z.string().trim().max(120).optional(),
  phone: z.string().trim().optional(),
  uhid: z.string().trim().optional(),
  referenceDoctor: z.string().trim().optional(),
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
  // Multi-payment split: a bill settled across several methods (Cash + UPI, etc.)
  payments: z.array(
    z.object({
      amount: z.number().min(0),
      paymentMethod: z.string().min(1),
      reference: z.string().optional(),
    })
  ).optional(),
})
