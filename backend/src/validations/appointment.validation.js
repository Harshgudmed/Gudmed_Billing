import { z } from 'zod'

export const createAppointmentSchema = z.object({
  patientId: z.string(),
  doctorId: z.string().optional(),
  appointmentDate: z.string(),
  appointmentTime: z.string().regex(/^\d{2}:\d{2}$/),
  appointmentType: z.string().optional(),
  notes: z.string().optional(),
  departmentId: z.string().optional(),
  priority: z.string().optional(),
})

// PATCH /:id — every field is optional since only some fields are sent per edit.
export const updateAppointmentSchema = z.object({
  doctorId: z.string().optional(),
  appointmentDate: z.string().optional(),
  appointmentTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  appointmentType: z.string().optional(),
  chiefComplaint: z.string().optional(),
  notes: z.string().optional(),
  cancellationReason: z.string().optional(),
  consultationFee: z.coerce.number().nonnegative().optional(),
  reminderSent: z.boolean().optional(),
  status: z.enum([
    'scheduled',
    'confirmed',
    'checked_in',
    'in_progress',
    'completed',
    'cancelled',
    'no_show',
    'rescheduled',
  ]).optional(),
})

// PATCH /bulk/status — same status list, applied to many appointments at once.
export const bulkUpdateStatusSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  status: z.enum([
    'scheduled',
    'confirmed',
    'checked_in',
    'in_progress',
    'completed',
    'cancelled',
    'no_show',
    'rescheduled',
  ]),
})
