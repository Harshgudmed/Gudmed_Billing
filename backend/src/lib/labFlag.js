// The flag on a lab result typed in by hand.
//
// The screen sent whatever the technician ticked, and "Abnormal" always went
// out as 'H': a haemoglobin of 18.2 against 12–16 was saved Normal when the box
// was left unticked, and a LOW value ticked abnormal printed HIGH. A number
// with a range is now judged against the test's own range here, on the server,
// so no screen can save it the wrong way; a value the range cannot judge
// ("Positive", "<0.1") keeps the technician's ticks. A tick is never undone:
// a value inside the range that the technician marked abnormal stays abnormal
// ('A' — abnormal, direction not known).
//
// Analyser results (integration/queueProcessor.js) carry the machine's own
// flags and do not come through here.

const asNumber = (value) => {
  const text = String(value ?? '').trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/**
 * @param value  the result as entered (string or number)
 * @param test   the LabTest: referenceMin, referenceMax, criticalLow, criticalHigh
 * @param marked what the technician ticked: { isAbnormal, isCritical }
 * @returns { flag: 'L' | 'H' | 'A' | 'N', isAbnormal, isCritical }
 */
export function resultFlag(value, test = {}, marked = {}) {
  const v = asNumber(value)
  const { referenceMin, referenceMax, criticalLow, criticalHigh } = test || {}
  const low = v != null && referenceMin != null && v < referenceMin
  const high = v != null && referenceMax != null && v > referenceMax
  const critical = v != null && ((criticalLow != null && v < criticalLow) || (criticalHigh != null && v > criticalHigh))
  const isCritical = critical || !!marked.isCritical
  const isAbnormal = low || high || isCritical || !!marked.isAbnormal
  const flag = low ? 'L' : high ? 'H' : isAbnormal ? 'A' : 'N'
  return { flag, isAbnormal, isCritical }
}
