// Comparing vendors' answers to a request for quotation (RFQ) — pure, so it is
// tested on its own (__tests__/rfqCompare.test.js) and the comparison the
// screen shows is the one the award is checked against.
//
// Every amount uses the purchase-order arithmetic (lib/purchaseOrders.js), so a
// vendor's total here is exactly the order the award would make.
import { round2 } from './money.js'
import { lineAmounts, orderTotals } from './purchaseOrders.js'

/**
 * What one unit costs once it arrives: the rate, less the discount, plus the
 * GST this vendor charges (none when it is not GST-registered).
 */
export function landedUnitCost({ rate, discountPct = 0, gstRate = 0 }, gstType = 'intra') {
  const net = (Number(rate) || 0) * (1 - (Number(discountPct) || 0) / 100)
  const gst = gstType === 'none' ? 0 : (Number(gstRate) || 0)
  return round2(net * (1 + gst / 100))
}

/** A quote that can be ordered: the vendor has the item and gave a price. */
export const isQuotable = (q) => !!q && q.available !== false && Number(q.rate) > 0

/**
 * The comparison, side by side.
 *   lines   [{ id, quantity }]
 *   vendors [{ id, status, gstType }] — only those who quoted ('quoted') take part
 *   quotes  [{ vendorId, lineId, rate, discountPct, gstRate, available }]
 * Returns
 *   lines[lineId]     { landed: { vendorId: cost per unit }, lowest, lowestVendorIds }
 *   vendors[vendorId] { lineIds, amounts: { lineId: { taxable, gstAmount, lineTotal } },
 *                       subtotal, cgst, sgst, igst, total, complete }  — for the lines it can supply
 *   cheapestCompleteVendorId  the lowest total among vendors who can supply every line, or null
 */
export function compareQuotes({ lines, vendors, quotes }) {
  const quoting = vendors.filter((v) => v.status === 'quoted')
  const byVendor = new Map(quoting.map((v) => [v.id, v]))
  const out = { lines: {}, vendors: {}, cheapestCompleteVendorId: null }
  for (const l of lines) out.lines[l.id] = { landed: {}, lowest: null, lowestVendorIds: [] }
  for (const v of quoting) out.vendors[v.id] = { lineIds: [], amounts: {} }

  for (const q of quotes) {
    const v = byVendor.get(q.vendorId)
    const line = lines.find((l) => l.id === q.lineId)
    if (!v || !line || !isQuotable(q)) continue
    out.lines[line.id].landed[v.id] = landedUnitCost(q, v.gstType)
    out.vendors[v.id].lineIds.push(line.id)
    out.vendors[v.id].amounts[line.id] = lineAmounts({ quantity: line.quantity, rate: q.rate, discountPct: q.discountPct, gstRate: q.gstRate }, v.gstType)
  }

  for (const l of lines) {
    const entry = out.lines[l.id]
    const costs = Object.entries(entry.landed)
    if (!costs.length) continue
    entry.lowest = Math.min(...costs.map(([, c]) => c))
    // A paisa either way is a tie: both are the lowest.
    entry.lowestVendorIds = costs.filter(([, c]) => c - entry.lowest < 0.005).map(([id]) => id)
  }

  let best = null
  for (const v of quoting) {
    const row = out.vendors[v.id]
    // In the RFQ's line order, whatever order the quotes came in.
    row.lineIds = lines.map((l) => l.id).filter((id) => row.amounts[id])
    Object.assign(row, orderTotals(row.lineIds.map((id) => row.amounts[id]), v.gstType))
    row.complete = lines.length > 0 && row.lineIds.length === lines.length
    if (row.complete && (!best || row.total < out.vendors[best].total - 0.005)) best = v.id
  }
  out.cheapestCompleteVendorId = best
  return out
}

/**
 * The vendors who would supply the same lines as `vendorId` for less: every
 * other vendor that quoted each of those lines, with its total for them.
 * Empty when `vendorId` is the cheapest for what it quoted — the award then
 * needs no reason. Cheapest first.
 */
export function cheaperThan(comparison, vendors, vendorId) {
  const mine = comparison.vendors[vendorId]
  if (!mine || !mine.lineIds.length) return []
  const out = []
  for (const v of vendors) {
    const row = comparison.vendors[v.id]
    if (v.id === vendorId || !row) continue
    if (!mine.lineIds.every((id) => row.amounts[id])) continue
    const { total } = orderTotals(mine.lineIds.map((id) => row.amounts[id]), v.gstType)
    if (total < mine.total - 0.005) out.push({ vendorId: v.id, total, saving: round2(mine.total - total) })
  }
  return out.sort((a, b) => a.total - b.total)
}
