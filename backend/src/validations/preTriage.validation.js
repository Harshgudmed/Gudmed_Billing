import { z } from 'zod'

export const createPreTriageSchema = z.object({
  patientId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  age: z.number().int().optional().nullable(),
  gender: z.string().optional(),
  phone: z.string().optional(),
  chiefComplaint: z.string().optional(),
  briefHistory: z.string().optional(),
  temperature: z.number().optional().nullable(),
  bloodPressureSystolic: z.number().int().optional().nullable(),
  bloodPressureDiastolic: z.number().int().optional().nullable(),
  pulseRate: z.number().int().optional().nullable(),
  respiratoryRate: z.number().int().optional().nullable(),
  spo2: z.number().optional().nullable(),
  weight: z.number().optional().nullable(),
  height: z.number().optional().nullable(),
  bmi: z.number().optional().nullable(),
  fbs: z.number().optional().nullable(),
  ppbs: z.number().optional().nullable(),
  routedTo: z.string().optional(),
})
