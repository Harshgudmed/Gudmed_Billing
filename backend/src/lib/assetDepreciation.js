// An asset's current book value — straight-line depreciation, computed on
// every read and never stored, so it can never drift out of sync with its
// purchaseCost/usefulLifeYears/residualValue (the same reason this codebase
// computes rate-contract "expired" and stock "expiring soon" on read instead
// of writing a stale flag).
import { round2 } from './money.js'

/**
 * @param asset { purchaseCost, purchaseDate, usefulLifeYears, residualValue }
 * @returns { bookValue, accumulatedDepreciation } in rupees, or null when the
 *   asset has nothing to depreciate (no cost, date or useful life recorded).
 */
export function depreciationFor(asset, today = new Date()) {
  const { purchaseCost, purchaseDate, usefulLifeYears, residualValue = 0 } = asset
  if (!purchaseCost || !purchaseDate || !usefulLifeYears) return null

  const depreciableAmount = Math.max(0, purchaseCost - residualValue)
  const ageYears = Math.max(0, (today - new Date(purchaseDate)) / (365.25 * 24 * 60 * 60 * 1000))
  const annualDepreciation = depreciableAmount / usefulLifeYears
  const accumulatedDepreciation = Math.min(depreciableAmount, annualDepreciation * ageYears)

  return {
    accumulatedDepreciation: round2(accumulatedDepreciation),
    bookValue: round2(purchaseCost - accumulatedDepreciation),
  }
}
