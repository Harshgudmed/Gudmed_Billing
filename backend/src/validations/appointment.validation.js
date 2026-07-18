import { z } from 'zod'

// A real clock time: 00:00–23:59. The old /^\d{2}:\d{2}$/ let "25:00" and
// "99:99" through, which then sorted after every real slot on the board.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// appointmentDate must be a parseable date — a bare z.string() let "not-a-date"
// reach new Date() and throw a 500 deep in the controller instead of a clean 400.
const dateString = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date')

export const createAppointmentSchema = z.object({
  patientId: z.string(),
  doctorId: z.string().optional(),
  appointmentDate: dateString,
  appointmentTime: z.string().regex(HHMM, 'Time must be HH:mm between 00:00 and 23:59'),
  appointmentType: z.enum(['new_patient', 'follow_up', 'emergency']).optional(),
  notes: z.string().optional(),
  departmentId: z.string().optional(),
  priority: z.string().optional(),
})

// PATCH /:id — every field is optional since only some fields are sent per edit.
export const updateAppointmentSchema = z.object({
  doctorId: z.string().optional(),
  appointmentDate: dateString.optional(),
  appointmentTime: z.string().regex(HHMM, 'Time must be HH:mm between 00:00 and 23:59').optional(),
  appointmentType: z.enum(['new_patient', 'follow_up', 'emergency']).optional(),
  chiefComplaint: z.string().optional(),
  notes: z.string().optional(),
  cancellationReason: z.string().optional(),
  // consultationFee is intentionally NOT accepted here. The fee is derived from
  // the doctor's slabs at create() time and drives the linked Invoice + Doctor
  // Commission; letting a PATCH set it on the appointment alone left those three
  // in a three-way disagreement. Fee changes must go through a re-price flow, not
  // a raw appointment edit.
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
