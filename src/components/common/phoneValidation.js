// ── Indian mobile number edge cases — one place that decides what's typable ──
//
// This mirrors the cleanup rules in backend/src/lib/phone.js (country-code /
// leading-zero stripping) but adds the UI-facing concerns that function
// doesn't need to care about: filtering keystrokes live, and catching
// obviously-fake patterns (repeated/sequential digits) before submit rather
// than after the backend round-trip.
//
// Kept separate from backend/src/lib/phone.js on purpose — that file is the
// storage/search source of truth used across the whole backend (including
// matching against numbers already in the database), so it must stay lenient
// about what counts as "a real number". Fraud-pattern rejection only belongs
// at the point of fresh data entry, not retroactively against old rows.

const ALL_DIGITS = /^\d*$/

/** Digits only — drops spaces, dashes, brackets, letters, +, everything else. */
export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * Cleans a raw, possibly-in-progress input value, stripping a +91 / 91 / 091 /
 * 0091 country-code prefix or a lone leading 0 once enough digits have been
 * typed (or pasted) to recognise one.
 *
 *   "+91 98765 43210" -> "9876543210"
 *   "919876543210"    -> "9876543210"
 *   "09876543210"     -> "9876543210"
 *   "98765-43210"     -> "9876543210"
 *   "abc98765d43210"  -> "9876543210"
 *
 * Deliberately does NOT truncate a too-long result down to 10 digits — a
 * 12-digit number with no recognisable country code is junk, not a real
 * number missing a prefix, and silently chopping it would store a fabricated
 * 10 digits (see backend/src/lib/phone.js for the real bad data this caused:
 * "788775657656" must be rejected, not trimmed into a fake-looking match).
 * A too-long value is left as-is so validateIndianMobile flags it.
 *
 * Safe to call on every keystroke — partial input (e.g. "987") passes through
 * untouched since none of the prefix lengths match yet.
 */
export function sanitizePhoneInput(raw) {
  let d = digitsOnly(raw)
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 13 && d.startsWith('091')) d = d.slice(3)
  else if (d.length === 14 && d.startsWith('0091')) d = d.slice(4)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return d
}

/**
 * Fraud/junk patterns that are structurally valid (10 digits, starts 6-9) but
 * are not real mobile numbers: all-same-digit filler and keyboard-sequential
 * runs in either direction. Returns a message, or null if the number is fine.
 */
export function detectFraudPattern(digits) {
  if (!digits || digits.length !== 10) return null
  if (/^(\d)\1{9}$/.test(digits)) return 'Enter a real mobile number, not a repeated digit'

  let ascending = true
  let descending = true
  for (let i = 1; i < digits.length; i++) {
    const diff = digits.charCodeAt(i) - digits.charCodeAt(i - 1)
    if (diff !== 1) ascending = false
    if (diff !== -1) descending = false
  }
  if (ascending || descending) return 'Enter a real mobile number, not a sequential pattern'

  return null
}

/**
 * Full validation for a completed (or blurred) phone field. Returns the
 * cleaned digits plus an error message when invalid — the caller decides
 * whether blank is acceptable (required vs. optional field).
 */
export function validateIndianMobile(raw, label = 'Phone number') {
  const clean = sanitizePhoneInput(raw)
  if (!clean) return { clean: '', valid: false, error: null }
  if (clean.length !== 10) return { clean, valid: false, error: `${label} must be exactly 10 digits` }
  if (!/^[6-9]/.test(clean)) return { clean, valid: false, error: `${label} must start with 6, 7, 8, or 9` }

  const fraud = detectFraudPattern(clean)
  if (fraud) return { clean, valid: false, error: fraud }

  return { clean, valid: true, error: null }
}

/** True when `value` is already exactly a clean, non-fraudulent 10-digit mobile. */
export function isValidIndianMobile(value) {
  const d = String(value ?? '')
  return ALL_DIGITS.test(d) && d.length === 10 && validateIndianMobile(d).valid
}
