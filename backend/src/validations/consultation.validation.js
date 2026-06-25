import { z } from 'zod'

export const createConsultationSchema = z.object({
  patientId: z.string(),
  doctorId: z.string(),
  appointmentId: z.string().optional(),
  visitType: z.string().optional(),
  temperature: z.number().optional(),
  bloodPressureSystolic: z.number().optional(),
  bloodPressureDiastolic: z.number().optional(),
  pulseRate: z.number().optional(),
  respiratoryRate: z.number().optional(),
  weight: z.number().optional(),
  height: z.number().optional(),
  oxygenSaturation: z.number().optional(),
  chiefComplaint: z.string().optional(),
  historyOfPresentIllness: z.string().optional(),
  physicalExamination: z.string().optional(),
  diagnosis: z.string().optional(),
  icd10Codes: z.array(z.string()).optional(),
  treatmentPlan: z.string().optional(),
  followUpInstructions: z.string().optional(),
  followUpDate: z.string().optional(),
  referredTo: z.string().optional(),
  referralReason: z.string().optional(),
  notes: z.string().optional(),
  prescriptionItems: z.array(z.object({
    drugId: z.string(),
    drugName: z.string(),
    genericName: z.string().nullable().optional(),
    dosage: z.string(),
    frequency: z.string(),
    duration: z.string(),
    quantity: z.number(),
    instructions: z.string().optional(),
  })).optional(),
  labTests: z.array(z.object({
    testId: z.string().optional(),
    testName: z.string(),
    testCode: z.string().optional(),
    urgency: z.string().optional().default('routine'),
  })).optional(),
  radiologyExams: z.array(z.object({
    examId: z.string(),
    examName: z.string().optional(),
  })).optional(),
})

export const updateConsultationSchema = createConsultationSchema.partial()
