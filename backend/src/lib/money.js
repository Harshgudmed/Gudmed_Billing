// Shared money + fiscal helpers. Single source of truth so rounding and the
// financial-year rule can never drift between billing, IPD, pharmacy, etc.
// (Previously `round2`/`r2` was copy-pasted in 6 files and `financialYear` in 2.)

// Round a value to 2 decimal places (paisa). Coerces null/undefined/strings safely
// → 0, so it never produces NaN. Behaviourally identical to the copies it replaces.
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Indian financial year for a date: Apr 1 → Mar 31, e.g. "2026-27".
export function financialYear(d = new Date()) {
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 3 ? y : y - 1 // month 3 = April (0-indexed)
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

// Format a value as ₹ with the Indian digit grouping and 2 decimals, for display
// in WhatsApp messages / notifications. (Was copy-pasted as `rupee()` in two files.)
export function formatRupee(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}
