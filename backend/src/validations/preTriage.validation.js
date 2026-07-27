import { z } from 'zod'

// The only status values the controller/DB use. Anything else is junk.
export const PRE_TRIAGE_STATUSES = ['screening', 'routed', 'registered_as_patient']

// An optional numeric vital with sane bounds. An empty form field ('') or null
// means "not measured" and is allowed; a real value must be a number in range,
// so physically-impossible readings (negative BP, SpO2 > 100, …) are rejected
// instead of stored, and a non-numeric string returns a clean 400 (not a 500).
const optionalNum = (min, max, { int = false } = {}) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    (int ? z.number().int() : z.number()).min(min).max(max).optional()
  )

// Shared vitals shape (used by both create and update).
const vitalsShape = {
  temperature: optionalNum(20, 45),               // °C (the form converts °F→°C before sending)
  bloodPressureSystolic: optionalNum(1, 400, { int: true }),
  bloodPressureDiastolic: optionalNum(1, 400, { int: true }),
  pulseRate: optionalNum(1, 400, { int: true }),  // bpm
  respiratoryRate: optionalNum(1, 200, { int: true }), // breaths/min
  spo2: optionalNum(0, 100),                      // oxygen saturation %
  weight: optionalNum(0, 700),                    // kg
  height: optionalNum(0, 300),                    // cm
  bmi: optionalNum(0, 200),
  fbs: optionalNum(0, 2000),                      // mg/dL
  ppbs: optionalNum(0, 2000),
}

const age = optionalNum(0, 150, { int: true })

export const createPreTriageSchema = z.object({
  patientId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  age,
  gender: z.string().optional(),
  phone: z.string().optional(),
  chiefComplaint: z.string().optional(),
  briefHistory: z.string().optional(),
  ...vitalsShape,
  routedTo: z.string().optional(),
})

// PATCH previously sent raw req.body straight to Prisma: a bad number/type threw
// a 500, and any junk status string ('lolwut') was accepted. This validates the
// same vitals bounds plus a constrained status. .passthrough() keeps every OTHER
// editable field the form sends, so nothing is silently dropped in transit.
export const updatePreTriageSchema = z
  .object({
    ...vitalsShape,
    age,
    status: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.enum(PRE_TRIAGE_STATUSES).optional()
    ),
  })
  .passthrough()
