// ── The ONE place that decides what a phone number looks like ────────────────
//
// An Indian mobile number is 10 digits starting 6–9. That is what the front
// desk reads out, what WhatsApp needs, and what fits the printed receipt.
//
// Nothing enforced this. The API accepted `z.string()` — any text at all — and
// the form only checked `min(10)`, which permits anything LONGER. So numbers
// arrived carrying their country code and were stored verbatim:
//
//     "913029320008"   (12) — 91 + the real number
//     "+919876543210"  (13) — +91 + the real number
//     "788775657656"   (12) — junk that no check would have caught
//
// 511 patient rows are in that state, and 7 of them were created recently —
// this is still happening, not a one-off legacy import. A stored country code
// is not cosmetic: it breaks exact-match lookup ("did this patient call?"),
// duplicate detection (the same person as "9876543210" and "919876543210" is
// two people), and prints a 12-digit number on the patient's bill.
//
// Normalising on the way IN is what keeps the column trustworthy. Never patch
// this at the point of display.

/** Digits only — drops spaces, dashes, brackets, the leading +, everything. */
function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * A messy phone number → a bare 10-digit Indian mobile, or null if it cannot
 * be one.
 *
 *   "+91 98765 43210" -> "9876543210"
 *   "919876543210"    -> "9876543210"
 *   "09876543210"     -> "9876543210"
 *   "9876543210"      -> "9876543210"
 *   "788775657656"    -> null   (12 digits, no country code to strip)
 *   "12345"           -> null
 *
 * Returns null rather than throwing so callers choose the outcome: reject at
 * the API boundary, skip during a bulk import, leave blank on an optional field.
 */
export function normalizeIndianMobile(value) {
  let d = digitsOnly(value)
  if (!d) return null

  // Country code, however it was written (+91, 0091, 91).
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 13 && d.startsWith('091')) d = d.slice(3)
  else if (d.length === 14 && d.startsWith('0091')) d = d.slice(4)
  // A single leading 0 is the old STD-dialling habit.
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)

  // Indian mobiles are exactly 10 digits and begin 6-9. Anything else is not a
  // number we can dial, so it must not be stored as though it were.
  return /^[6-9]\d{9}$/.test(d) ? d : null
}

/** True when `value` is already a clean 10-digit mobile. */
export function isValidIndianMobile(value) {
  return normalizeIndianMobile(value) === String(value ?? '')
}

/**
 * A zod-friendly transform for an OPTIONAL phone field: normalises what it can
 * and rejects what it cannot, so a typo surfaces at the API instead of becoming
 * a permanent bad row. Empty/absent stays empty — these fields are optional.
 */
export function optionalMobileSchema(z, label = 'Phone number') {
  const isBlank = (v) => v == null || String(v).trim() === ''
  return z
    .string()
    .optional()
    // Checked on the RAW value, before the transform: afterwards "blank" and
    // "unsalvageable" are both null and can no longer be told apart.
    .refine((v) => isBlank(v) || normalizeIndianMobile(v) !== null, {
      message: `${label} must be a 10-digit Indian mobile number`,
    })
    .transform((v) => (isBlank(v) ? null : normalizeIndianMobile(v)))
}
