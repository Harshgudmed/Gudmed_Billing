// Nursing-station helpers: NEWS2 early-warning score computation.
// NEWS2 (Royal College of Physicians) — standard UK acute-illness early-warning score.
// Returns { score, risk } where risk drives escalation (LOW < 5, MEDIUM 5-6 or any single 3, HIGH >= 7).

function rrPoints(rr) {
  if (rr == null) return 0
  if (rr <= 8) return 3
  if (rr <= 11) return 1
  if (rr <= 20) return 0
  if (rr <= 24) return 2
  return 3
}
function spo2Points(s) {
  if (s == null) return 0
  if (s >= 96) return 0
  if (s >= 94) return 1
  if (s >= 92) return 2
  return 3
}
function sbpPoints(sbp) {
  if (sbp == null) return 0
  if (sbp <= 90) return 3
  if (sbp <= 100) return 2
  if (sbp <= 110) return 1
  if (sbp <= 219) return 0
  return 3
}
function hrPoints(hr) {
  if (hr == null) return 0
  if (hr <= 40) return 3
  if (hr <= 50) return 1
  if (hr <= 90) return 0
  if (hr <= 110) return 1
  if (hr <= 130) return 2
  return 3
}
function tempPoints(t) {
  if (t == null) return 0
  if (t <= 35.0) return 3
  if (t <= 36.0) return 1
  if (t <= 38.0) return 0
  if (t <= 39.0) return 1
  return 2
}
function consciousnessPoints(level) {
  if (!level) return 0
  // ALERT = 0; anything else (new confusion / Voice / Pain / Unresponsive) = 3
  return level.toUpperCase() === 'ALERT' ? 0 : 3
}

export function computeNews2({ respiratoryRate, spo2, systolicBp, heartRate, tempC, consciousness } = {}) {
  const parts = [
    rrPoints(respiratoryRate),
    spo2Points(spo2),
    sbpPoints(systolicBp),
    hrPoints(heartRate),
    tempPoints(tempC),
    consciousnessPoints(consciousness),
  ]
  const score = parts.reduce((a, b) => a + b, 0)
  const anyThree = parts.some((p) => p === 3)
  let risk = 'LOW'
  if (score >= 7) risk = 'HIGH'
  else if (score >= 5 || anyThree) risk = 'MEDIUM'
  return { score, risk }
}
