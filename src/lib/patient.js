// Shared, dependency-free patient display helpers — the single source of truth
// for turning a patient record into an age / name / initials for the UI.
//
// These were copy-pasted (identically, month-aware) in at least three places:
// patients/utils/patientUtils.js, opd/OpdModule.jsx and billing/BillingModule.jsx.

/**
 * Whole-year age from a date of birth, correct across the birthday boundary
 * (not a 365.25-day approximation). Returns '' for a missing/unparseable dob so
 * callers can drop it straight into JSX.
 */
export function calcAge(dob) {
  if (!dob) return ''
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return ''
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

/**
 * "Harsh Mohan Bansal" — every part that exists, in order, single-spaced.
 *
 * The frontend twin of the backend's lib/patientName.js#patientFullName; the
 * two must always agree, so change them together. A name is built HERE and
 * nowhere else: the inline `${p.firstName} ${p.lastName}` pattern this
 * replaces was written at ~110 call sites and silently dropped every
 * patient's middle name.
 *
 * Note this can only render what the API actually sent. If a name comes out
 * missing its middle part, the query behind it is missing `middleName` —
 * spread PATIENT_NAME_SELECT into that select rather than patching it here.
 *
 * Blank/whitespace parts are dropped, so a patient with no middle name reads
 * "Priya Sharma", never "Priya  Sharma".
 */
export function getFullName(p) {
  if (!p) return ''
  return [p.firstName, p.middleName, p.lastName]
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' ')
}

/**
 * Name for display, falling back to 'Unknown' when a patient has no name parts
 * (the pattern that was hand-written as `${firstName} ${lastName}` all over).
 */
export function patientDisplayName(p) {
  return getFullName(p) || 'Unknown'
}

/** Up-to-two-letter initials from a full name, for avatars. */
export function initials(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}
