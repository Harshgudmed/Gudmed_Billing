// Purchase-order arithmetic — pure, so it is tested on its own and the screen
// and the server can never disagree about a total.
import { round2 } from './money.js'

/**
 * Which GST the vendor charges:
 *   none  — the vendor has no GSTIN: an unregistered supplier cannot charge GST
 *   intra — vendor and hospital in the same state: CGST + SGST, half each
 *   inter — different states: IGST
 * An unknown state on either side is treated as the same state, the common
 * case for a hospital's suppliers.
 */
export function gstTypeFor({ gstNumber, stateCode } = {}, hospitalStateCode) {
  if (!gstNumber) return 'none'
  if (stateCode && hospitalStateCode && stateCode !== hospitalStateCode) return 'inter'
  return 'intra'
}

/** One line: quantity × rate, less the discount, plus GST (none → no GST). */
export function lineAmounts({ quantity, rate, discountPct = 0, gstRate = 0 }, gstType = 'intra') {
  const gross = (Number(quantity) || 0) * (Number(rate) || 0)
  const taxable = round2(gross * (1 - (Number(discountPct) || 0) / 100))
  const gstAmount = gstType === 'none' ? 0 : round2(taxable * (Number(gstRate) || 0) / 100)
  return { taxable, gstAmount, lineTotal: round2(taxable + gstAmount) }
}

/**
 * The order's totals from its lines. Intra-state GST splits into CGST and SGST
 * — SGST takes the odd paisa, so the two always add up to the GST exactly.
 */
export function orderTotals(lines, gstType = 'intra') {
  const subtotal = round2(lines.reduce((s, l) => s + (l.taxable || 0), 0))
  const gst = round2(lines.reduce((s, l) => s + (l.gstAmount || 0), 0))
  let cgst = 0, sgst = 0, igst = 0
  if (gstType === 'intra') { cgst = round2(gst / 2); sgst = round2(gst - cgst) }
  else if (gstType === 'inter') igst = gst
  return { subtotal, cgst, sgst, igst, total: round2(subtotal + gst) }
}

// Every GST rate in use — the one list items, orders and vendor bills check
// against. GST 2.0 (22 Sep 2025) moved most goods to 5 / 18 / 40, but 12 and 28
// still apply to some, and 0.25 / 3 to stones and metals. An item's rate is its
// own — a category only suggests one.
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40]

export const GST_TYPE_LABEL = { intra: 'CGST + SGST', inter: 'IGST', none: 'No GST (vendor not registered)' }
