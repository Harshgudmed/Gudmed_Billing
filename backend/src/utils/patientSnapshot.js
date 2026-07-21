// ── Shared patient snapshot helper (Pharmacy / Lab / Radiology / OPD / …) ──────
// One place that knows how to pull a patient's receipt-facing details out of the
// DB and normalize them. Every module that prints a receipt should use this so
// the patient block (name, MRN/UHID, phone, age, gender, address) is IDENTICAL
// everywhere and there is a single source of truth. Nobody re-types patient info.

import { PATIENT_NAME_SELECT, patientFullName } from '../lib/patientName.js'

// Prisma `select` fragment — spread this into any `patient: { select: {...} }`
// include so every query pulls exactly the fields the snapshot formatter needs.
// The name columns come from PATIENT_NAME_SELECT rather than being re-listed,
// so a receipt can never disagree with the rest of the app about what a
// patient is called.
export const PATIENT_SNAPSHOT_SELECT = {
  ...PATIENT_NAME_SELECT,
  externalId: true,
  dateOfBirth: true,
  gender: true,
  phonePrimary: true,
  phoneSecondary: true,
  email: true,
  houseNumber: true,
  street: true,
  locality: true,
  city: true,
  district: true,
  state: true,
  pincode: true,
  addressDescription: true,
}

// Whole years between dateOfBirth and now. Returns null when DOB is missing.
export function ageFromDob(dob) {
  if (!dob) return null
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age >= 0 ? age : null
}

// Build one human-readable address line. Prefers the structured fields; falls
// back to the legacy free-text `addressDescription` when they're empty.
export function formatPatientAddress(p) {
  if (!p) return ''
  // Narrowest to widest, the way an Indian address is written and read out.
  const parts = [p.houseNumber, p.street, p.locality, p.city, p.district, p.state]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
  const pin = p.pincode ? String(p.pincode).trim() : ''
  // PIN hangs off the end with a dash, not as another comma-separated part:
  // "…, Mumbai Suburban, Maharashtra - 400053"
  if (parts.length) return parts.join(', ') + (pin ? ` - ${pin}` : '')
  if (pin) return pin
  return (p.addressDescription || '').trim()
}

// Turn a raw Patient row (selected via PATIENT_SNAPSHOT_SELECT) into the flat
// shape receipts consume. Safe to call with null/undefined (returns nulls).
export function formatPatientSnapshot(p) {
  if (!p) {
    return {
      patientId: null, patientName: '', firstName: '', lastName: '',
      mrn: null, uhid: null, phone: null, email: null,
      age: null, gender: null, dateOfBirth: null, address: '',
    }
  }
  const fullName = patientFullName(p)
  return {
    patientId: p.id || null,
    patientName: fullName,
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    mrn: p.mrn || null,
    uhid: p.mrn || p.externalId || null, // UHID surfaced as MRN (the org's patient no.)
    phone: p.phonePrimary || p.phoneSecondary || null,
    email: p.email || null,
    age: ageFromDob(p.dateOfBirth),
    gender: p.gender || null,
    dateOfBirth: p.dateOfBirth || null,
    address: formatPatientAddress(p),
  }
}

// Fetch + format a patient in one call. `client` is a Prisma client OR a
// transaction client (tx), so this works inside $transaction blocks too.
// Returns null when no patientId is given or the patient doesn't exist — callers
// should treat that as a walk-in / OTC sale with no linked patient record.
export async function getPatientSnapshot(client, patientId) {
  if (!patientId) return null
  const patient = await client.patient.findUnique({
    where: { id: patientId },
    select: PATIENT_SNAPSHOT_SELECT,
  })
  if (!patient) return null
  return formatPatientSnapshot(patient)
}
