// Indian tax identifiers — GSTIN, PAN, IFSC — checked once, here, for every
// screen that takes them (vendors today; the hospital's own GSTIN, bills and
// GST filing later).
//
// A GSTIN carries more than a format:
//   27 AAPFU0939F 1 Z V
//   │  │          │ │ └ check character, computed from the first 14
//   │  │          │ └── always Z
//   │  │          └──── registration number for this PAN in this state
//   │  └─────────────── the holder's PAN
//   └────────────────── GST state code (27 = Maharashtra)
// So from one GSTIN the vendor's state (which decides CGST+SGST vs IGST on
// every bill) and PAN (needed for TDS) follow without being typed again, and
// the check character catches a single mistyped digit, which a format check
// alone would let through.

// GST state / UT codes as issued by GSTN.
export const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '28': 'Andhra Pradesh (old)',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh', '97': 'Other Territory',
}

/**
 * The GST state code for a state written by name ("Haryana" → "06"), as the
 * hospital's own state is stored. "&" and "and" are the same; null when the
 * name is not a GST state.
 */
export function stateCodeByName(name) {
  const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim()
  const wanted = norm(name)
  if (!wanted) return null
  const hit = Object.entries(GST_STATES).find(([, n]) => norm(n) === wanted)
  return hit ? hit[0] : null
}

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const IFSC_SHAPE = /^[A-Z]{4}0[A-Z0-9]{6}$/

/** Trim and upper-case — people type these in lower case and with spaces. */
export const cleanId = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase()

/** The GSTIN check character for its first 14 characters (GSTN's mod-36 scheme). */
export function gstinCheckChar(first14) {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHARS[(36 - (sum % 36)) % 36]
}

/**
 * Check a GSTIN and read what it carries.
 * @returns {{ ok: true, gstin, stateCode, stateName, pan } | { ok: false, error }}
 */
export function parseGstin(value) {
  const gstin = cleanId(value)
  if (!GSTIN_SHAPE.test(gstin)) {
    return { ok: false, error: 'GSTIN must be 15 characters, like 27AAPFU0939F1ZV' }
  }
  const stateCode = gstin.slice(0, 2)
  if (!GST_STATES[stateCode]) {
    return { ok: false, error: `GSTIN starts with ${stateCode}, which is not a GST state code` }
  }
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return { ok: false, error: 'This GSTIN has a typing mistake — its last character does not match the rest' }
  }
  return { ok: true, gstin, stateCode, stateName: GST_STATES[stateCode], pan: gstin.slice(2, 12) }
}

export const isValidPan = (value) => PAN_SHAPE.test(cleanId(value))
export const isValidIfsc = (value) => IFSC_SHAPE.test(cleanId(value))
