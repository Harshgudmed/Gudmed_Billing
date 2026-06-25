import { z } from 'zod'

export const createPrescriptionSchema = z.object({
  patientId: z.string().min(1),
  doctorId: z.string().min(1),
  items: z.array(z.any()).min(1),
  consultationId: z.string().optional(),
  notes: z.string().optional(),
})

// Whitelisted update fields — patientId, doctorId, organizationId, createdAt, updatedAt NOT included
export const updatePrescriptionSchema = z.object({
  status: z.string().optional(),
  dispensedById: z.string().optional(),
  dispensedAt: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.any()).optional(),
  isRefill: z.boolean().optional(),
  refillsAllowed: z.number().int().min(0).optional(),
  refillsRemaining: z.number().int().min(0).optional(),
})
