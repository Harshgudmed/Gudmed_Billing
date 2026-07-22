import { z } from 'zod'

// ── Frontend mirror of backend/src/lib/phone.js normalizeIndianMobile ────────
// Kept as a plain-JS copy (not imported) because this file must stay usable
// in the browser bundle. The backend remains the source of truth — if the
// backend rule changes, update both.
function normalizeIndianMobile(value) {
  let d = String(value ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 13 && d.startsWith('091')) d = d.slice(3)
  else if (d.length === 14 && d.startsWith('0091')) d = d.slice(4)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : null
}

const isBlank = (v) => v == null || String(v).trim() === ''

// ── Reusable field-level schemas ──────────────────────────────────────────
// Small building blocks so both the patient form and any other form that
// collects the same kind of field (name, mobile, email...) can share one
// definition instead of re-typing the rule.

export const requiredNameSchema = (label) =>
  z.string().trim().min(2, `${label} must be at least 2 characters`)

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
  .regex(/^\d{6}$/, 'PIN code must be 6 digits')
  .optional()
  .or(z.literal(''))

export const requiredDateSchema = (label) => z.string().min(1, `${label} is required`)

// ── Register + first-appointment form ─────────────────────────────────────
// Mirrors backend/src/controllers/patientController.js `patientSchema` for the
// patient fields, plus the doctor/date the form additionally requires before
// it will book the first appointment. The backend schema stays authoritative;
// this only stops obviously-bad input before it makes a round trip.
export const patientFormSchema = z.object({
  firstName: requiredNameSchema('First name'),
  middleName: optionalTextSchema,
  lastName: requiredNameSchema('Last name'),
  dateOfBirth: requiredDateSchema('Date of birth'),
  gender: z.enum(['male', 'female', 'other']),
  maritalStatus: optionalTextSchema,
  referredBy: optionalTextSchema,
  mlcNumber: optionalTextSchema,

  phonePrimary: requiredMobileSchema('Primary phone'),
  phoneSecondary: optionalMobileSchema('Secondary phone'),
  email: optionalEmailSchema,

  houseNumber: optionalTextSchema,
  street: optionalTextSchema,
  locality: optionalTextSchema,
  city: optionalTextSchema,
  district: optionalTextSchema,
  state: optionalTextSchema,
  pincode: pincodeSchema,

  emergencyContactName: optionalTextSchema,
  emergencyContactPhone: optionalMobileSchema('Emergency contact phone'),
  emergencyContactRelationship: optionalTextSchema,

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
