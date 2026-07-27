import { z } from 'zod'

// A real clock time: 00:00–23:59. The old /^\d{2}:\d{2}$/ let "25:00" and
// "99:99" through, which then sorted after every real slot on the board.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// A calendar-VALID date. `new Date('2027-02-29')` does NOT throw — 2027 isn't a
// leap year, so JS silently rolls the impossible day to a real but DIFFERENT one
// (2027-02-28), and the appointment lands on a day the user never picked. The
// parseability check below can't catch that (the rolled date isn't NaN). Take the
// leading YYYY-MM-DD (the browser posts a full ISO instant) and confirm the
// UTC date we build back from those parts still reads the same y/m/d — a
// rolled-over date won't. Non-ISO-shaped strings are left to the parse check.
const isValidCalendarDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
  if (!m) return true
  const y = +m[1], mo = +m[2], d = +m[3]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

// appointmentDate must be a parseable date — a bare z.string() let "not-a-date"
// reach new Date() and throw a 500 deep in the controller instead of a clean 400 —
// AND a calendar-valid one, so an impossible day is rejected rather than rolled.
const dateString = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date')
  .refine(isValidCalendarDate, 'Appointment date is not a valid calendar date')

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
