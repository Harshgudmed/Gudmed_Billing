// TDS (tax deducted at source) on a vendor bill — pure, so it is tested on its
// own and the bill form and the server can never disagree about a deduction.
//
// The hospital keeps back part of what it owes the vendor and pays it to the
// Income Tax department in the vendor's name. Which part depends on what was
// bought (the section) and who the vendor is (the PAN):
//
//   194C contractor          1% an individual or HUF, 2% anyone else
//   194J professional        10%
//   194I rent                10%
//   194H commission          2%
//   194Q purchase of goods   0.1%
//   no PAN on file           20% (section 206AA); 5% under 194Q
//
// These are the rates as the owner approved them. They change with the budget
// (194H fell from 5% to 2% in October 2024), and some sections have a lower
// rate for part of what they cover (194J technical services, 194I machinery at
// 2%) — the hospital's CA must confirm them every budget. A bill may always
// override the rate, for that and for a lower-deduction certificate (section 197).
//
// 194Q applies only above ₹50 lakh bought from one vendor in a year; that
// running total is not tracked here, so a vendor is given 194Q only when the
// hospital is already past it.
//
// TDS is on the value before GST, in whole rupees, as the TDS return files it.
import { isValidPan, cleanId } from './gst.js'
import { round2 } from './money.js'

// The same labels the vendor form shows (src/components/purchase/VendorsMaster.jsx).
// `rate` is the section's rate for a vendor with a PAN that is not an
// individual's — the rate a list shows; tdsRateFor() gives the one for a
// particular vendor.
export const TDS_SECTIONS = [
  { section: '194C', label: '194C — Contractor', rate: 2 },
  { section: '194J', label: '194J — Professional / technical', rate: 10 },
  { section: '194I', label: '194I — Rent', rate: 10 },
  { section: '194H', label: '194H — Commission', rate: 2 },
  { section: '194Q', label: '194Q — Purchase of goods', rate: 0.1 },
]
export const TDS_SECTION_CODES = TDS_SECTIONS.map((s) => s.section)
export const MAX_TDS_RATE = 30

const NO_PAN_RATE = 20
const NO_PAN_RATE_194Q = 5
// The 4th letter of a PAN says who holds it: P a person, H a Hindu Undivided Family.
const INDIVIDUAL = new Set(['P', 'H'])

const byCode = new Map(TDS_SECTIONS.map((s) => [s.section, s]))
export const isTdsSection = (section) => byCode.has(section)

/** The PAN in capitals when it is a real one, otherwise null. */
const panOf = (pan) => (pan && isValidPan(pan) ? cleanId(pan) : null)

/**
 * The rate a section deducts from this vendor, in %. No section → 0.
 * A PAN that is missing or not a valid PAN counts as no PAN: deducting the
 * higher rate is the safe side — deducting too little leaves the hospital
 * owing the difference, with interest.
 */
export function tdsRateFor(section, pan) {
  const s = byCode.get(section)
  if (!s) return 0
  const p = panOf(pan)
  if (!p) return section === '194Q' ? NO_PAN_RATE_194Q : NO_PAN_RATE
  if (section === '194C') return INDIVIDUAL.has(p[3]) ? 1 : 2
  return s.rate
}

/** Every section with its rate for this vendor — what the bill form offers. */
export const tdsSectionsFor = (pan) => TDS_SECTIONS.map((s) => ({ ...s, rate: tdsRateFor(s.section, pan) }))

/**
 * The TDS a bill starts with: the vendor's default section at its rate for
 * the vendor's PAN, with a line saying why. No default section → no TDS.
 */
export function tdsDefault({ defaultTdsSection, pan } = {}) {
  if (!isTdsSection(defaultTdsSection)) return { section: null, rate: 0, note: 'No TDS section is set for this vendor' }
  const s = byCode.get(defaultTdsSection)
  const rate = tdsRateFor(s.section, pan)
  const p = panOf(pan)
  const who = !p ? 'no PAN on file, so the higher rate (section 206AA)'
    : s.section === '194C' ? `PAN ${p} is ${INDIVIDUAL.has(p[3]) ? 'an individual or HUF' : 'not an individual'}`
      : `PAN ${p}`
  return { section: s.section, rate, note: `${s.label} at ${rate}% — ${who}` }
}

/**
 * The bill's section and rate from what was typed:
 *   section undefined → the vendor's default; null or '' → no TDS
 *   rate undefined    → the section's rate for this vendor's PAN
 * No section means no TDS whatever rate was sent with it — choosing "No TDS"
 * on the form must not leave a stale rate behind.
 */
export function resolveTds({ section, rate }, vendor = {}) {
  const chosen = section === undefined ? tdsDefault(vendor).section : (section || null)
  if (!chosen) return { tdsSection: null, tdsRate: 0 }
  return { tdsSection: chosen, tdsRate: rate ?? tdsRateFor(chosen, vendor.pan) }
}

/**
 * TDS in whole rupees on the value before GST. To the paisa first, so
 * floating-point dust (24.4999999) cannot turn a half rupee down.
 */
export const tdsAmountOf = (subtotal, rate) => Math.round(round2(((Number(subtotal) || 0) * (Number(rate) || 0)) / 100))
