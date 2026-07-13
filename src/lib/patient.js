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

/** Full name from first/middle/last, skipping blank parts. */
export function getFullName(p) {
  if (!p) return ''
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')
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
