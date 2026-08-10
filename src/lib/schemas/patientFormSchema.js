import { z } from 'zod'
import { sanitizePhoneInput, detectFraudPattern } from '@/components/common/phoneValidation'
import { NAME_PATTERN } from '@/components/common/textFieldUtils'

// Cleans a raw phone value the same way sanitizePhoneInput does (strips
// country code / leading zero / formatting noise), then rejects it if it's
// too short, doesn't start 6-9, or is a repeated/sequential fake pattern —
// same fraud check PhoneInput blocks live, applied again here as the final
// gate before submit. Mirrors backend/src/lib/phone.js normalizeIndianMobile
// for the length/prefix rule; the backend remains the storage-side source of
// truth — if that rule changes, update both.
function normalizeIndianMobile(value) {
  const d = sanitizePhoneInput(value)
  if (!d || d.length !== 10 || !/^[6-9]/.test(d) || detectFraudPattern(d)) return null
  return d
}

const isBlank = (v) => v == null || String(v).trim() === ''

// ── Reusable field-level schemas ──────────────────────────────────────────
// Small building blocks so both the patient form and any other form that
// collects the same kind of field (name, mobile, email...) can share one
// definition instead of re-typing the rule.

// NAME_PATTERN (letters + spaces + ' . -) is the same allow-list the live
// input already enforces via sanitizeNameInput — this is the submit-time
// backstop for values that never went through that input (e.g. browser
// autofill, which bypasses onChange).
export const requiredNameSchema = (label) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .regex(NAME_PATTERN, `${label} can only contain letters`)

export const optionalNameSchema = (label) =>
  z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => isBlank(v) || NAME_PATTERN.test(v), {
      message: `${label} can only contain letters`,
    })

export const optionalTextSchema = z.string().trim().optional().or(z.literal(''))

export const requiredMobileSchema = (label = 'Phone number') =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => normalizeIndianMobile(v) !== null, {
      message: `${label} must be a 10-digit Indian mobile number`,
    })

export const optionalMobileSchema = (label = 'Phone number') =>
  z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => isBlank(v) || normalizeIndianMobile(v) !== null, {
      message: `${label} must be a 10-digit Indian mobile number`,
    })

export const optionalEmailSchema = z
  .string()
  .trim()
  .email('Enter a valid email address')
  .optional()
  .or(z.literal(''))

export const pincodeSchema = z
  .string()
  .trim()
  .min(1, 'PIN code is required')
  .regex(/^\d{6}$/, 'PIN code must be 6 digits')

export const requiredCitySchema = (label = 'City') =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .regex(NAME_PATTERN, `${label} can only contain letters`)

export const requiredStateSchema = (label = 'State') =>
  z.string().trim().min(1, `${label} is required`)

export const requiredDateSchema = (label) => z.string().min(1, `${label} is required`)

// Builds a local Date from a 'YYYY-MM-DD' date and an 'HH:mm' time (time
// defaults to midnight when omitted) — used to compare an appointment
// instant against "now" the same way the backend does.
function toLocalDateTime(dateStr, timeStr) {
  const [y, mo, d] = String(dateStr).split('-').map(Number)
  if (!y || !mo || !d) return null
  const [h, mi] = timeStr ? String(timeStr).split(':').map(Number) : [0, 0]
  const dt = new Date(y, mo - 1, d, h || 0, mi || 0)
  return isNaN(dt.getTime()) ? null : dt
}

// ── Register + first-appointment form ─────────────────────────────────────
// Mirrors backend/src/controllers/patientController.js `patientSchema` for the
// patient fields, plus the doctor/date the form additionally requires before
// it will book the first appointment. The backend schema stays authoritative;
// this only stops obviously-bad input before it makes a round trip.
export const patientFormSchema = z.object({
  firstName: requiredNameSchema('First name'),
  middleName: optionalNameSchema('Middle name'),
  lastName: requiredNameSchema('Last name'),
  dateOfBirth: requiredDateSchema('Date of birth'),
  gender: z.enum(['male', 'female', 'other']),
  maritalStatus: optionalTextSchema,
  referredBy: optionalNameSchema('Referred by'),
  mlcNumber: optionalTextSchema,

  phonePrimary: requiredMobileSchema('Primary phone'),
  phoneSecondary: optionalMobileSchema('Secondary phone'),
  email: optionalEmailSchema,

  houseNumber: optionalTextSchema,
  street: optionalTextSchema,
  locality: optionalNameSchema('Locality'),
  city: requiredCitySchema('City'),
  district: optionalNameSchema('District'),
  state: requiredStateSchema('State'),
  pincode: pincodeSchema,

  emergencyContactName: optionalNameSchema('Emergency contact name'),
  emergencyContactPhone: optionalMobileSchema('Emergency contact phone'),
  emergencyContactRelationship: optionalNameSchema('Relationship'),

  bloodGroup: optionalTextSchema,
  hasInsurance: z.boolean().default(false),
  insuranceProvider: optionalTextSchema,
  insuranceId: optionalTextSchema,

  department: optionalTextSchema,
  doctor: z.string().min(1, 'Please select a doctor'),
  consultationFee: optionalTextSchema,
  appointmentType: optionalTextSchema,
  priority: optionalTextSchema,
  appointmentDate: requiredDateSchema('Appointment date'),
  appointmentTime: optionalTextSchema,
  notes: optionalTextSchema,
}).superRefine((data, ctx) => {
  // Mirrors the backend's past-booking guard (see appointmentController.js
  // `create`) so a doomed submission is caught here instead of after the
  // patient record has already been created.
  if (!data.appointmentDate) return

  const apptDay = toLocalDateTime(data.appointmentDate, '00:00')
  if (!apptDay) return // malformed date — requiredDateSchema/backend already flags this

  const now = new Date()
  const today = toLocalDateTime(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    '00:00'
  )

  if (apptDay.getTime() < today.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Appointment date cannot be in the past',
      path: ['appointmentDate'],
    })
    return
  }

  if (apptDay.getTime() === today.getTime() && data.appointmentTime) {
    const apptInstant = toLocalDateTime(data.appointmentDate, data.appointmentTime)
    if (apptInstant && apptInstant.getTime() < now.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Appointment time cannot be in the past',
        path: ['appointmentTime'],
      })
    }
  }
})

// ── Error mapping ──────────────────────────────────────────────────────────
// Both a client-side ZodError (`error.issues`) and the backend's serialized
// Zod issues (`err.details`, see backend/src/middleware/errorHandler.js) are
// arrays of `{ path, message }`. One mapper turns either into the same
// { fieldName: message } shape so a single <FieldError> renderer can display
// whichever source caught the problem.
export function issuesToFieldErrors(issues) {
  const fieldErrors = {}
  if (!Array.isArray(issues)) return fieldErrors
  for (const issue of issues) {
    const field = Array.isArray(issue?.path) ? issue.path[0] : issue?.path
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message
  }
  return fieldErrors
}
