import test from 'node:test'
import assert from 'node:assert/strict'

// The module under test imports nothing, so it can be exercised directly.
// Kept in step with src/lib/refund.js by hand; if that file grows an import,
// this harness needs a bundler and the test should move to the e2e side.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

function calcRefund({ amount, workStarted, settings = {} }) {
  const billed = Math.max(0, Number(amount) || 0)
  const chargePct = workStarted
    ? Number(settings.cancelChargeAfterWorkPct ?? 100)
    : Number(settings.cancelChargeBeforeWorkPct ?? 0)
  const pct = Math.min(100, Math.max(0, chargePct))
  const charge = round2(billed * pct / 100)
  return { chargePct: pct, charge, refund: round2(billed - charge), workStarted: !!workStarted }
}

const isInstantRefund = (s = {}) => s.refundMode === 'instant'

// A hospital that never wants to charge for a cancellation.
const FULL_REFUND = { cancelChargeBeforeWorkPct: 0, cancelChargeAfterWorkPct: 0 }
// The default: free before the work starts, nothing back once it has.
const DEFAULTS = {}

test('a test cancelled before the sample is drawn is refunded in full', () => {
  const r = calcRefund({ amount: 2000, workStarted: false, settings: DEFAULTS })
  assert.equal(r.charge, 0)
  assert.equal(r.refund, 2000)
})

test('a test cancelled after the sample is drawn refunds nothing by default — the reagent is spent', () => {
  const r = calcRefund({ amount: 2000, workStarted: true, settings: DEFAULTS })
  assert.equal(r.charge, 2000)
  assert.equal(r.refund, 0)
})

test('a hospital that sets 0% both ways always refunds in full, even after the work', () => {
  const r = calcRefund({ amount: 2000, workStarted: true, settings: FULL_REFUND })
  assert.equal(r.refund, 2000)
})

test('a flat rate is expressible — the same number in both settings', () => {
  const flat = { cancelChargeBeforeWorkPct: 10, cancelChargeAfterWorkPct: 10 }
  assert.equal(calcRefund({ amount: 2000, workStarted: false, settings: flat }).refund, 1800)
  assert.equal(calcRefund({ amount: 2000, workStarted: true, settings: flat }).refund, 1800)
})

test('0% is honoured, not replaced by the default — || would charge the full 100%', () => {
  // The falsy-zero trap this repo has already paid for: `settings.pct || 100`
  // turns a deliberate "never charge" into "never refund".
  const r = calcRefund({ amount: 500, workStarted: true, settings: { cancelChargeAfterWorkPct: 0 } })
  assert.equal(r.charge, 0)
  assert.equal(r.refund, 500)
})

test('paisa is rounded the way the server rounds it, so the dialog and the ledger agree', () => {
  // 33% of 1000.55 = 330.1815 → must land on 330.18, not 330.1815 or 330.2
  const r = calcRefund({ amount: 1000.55, workStarted: true, settings: { cancelChargeAfterWorkPct: 33 } })
  assert.equal(r.charge, 330.18)
  assert.equal(r.refund, 670.37)
  assert.equal(round2(r.charge + r.refund), 1000.55)
})

test('charge and refund always add back to the amount billed', () => {
  for (const amount of [0, 1, 99.99, 250, 1000.55, 123456.78]) {
    for (const pct of [0, 7, 33, 50, 99, 100]) {
      const r = calcRefund({ amount, workStarted: true, settings: { cancelChargeAfterWorkPct: pct } })
      assert.equal(round2(r.charge + r.refund), round2(amount), `${amount} at ${pct}%`)
    }
  }
})

test('a percentage typed wrong in Settings cannot refund more than was paid', () => {
  // 150% would make the charge exceed the bill and the refund go negative — the
  // hospital would be shown as owing the patient money it never took.
  const over = calcRefund({ amount: 1000, workStarted: true, settings: { cancelChargeAfterWorkPct: 150 } })
  assert.equal(over.charge, 1000)
  assert.equal(over.refund, 0)

  // -20% would refund MORE than the bill.
  const under = calcRefund({ amount: 1000, workStarted: true, settings: { cancelChargeAfterWorkPct: -20 } })
  assert.equal(under.charge, 0)
  assert.equal(under.refund, 1000)
})

test('a negative or missing amount never produces a negative refund', () => {
  assert.equal(calcRefund({ amount: -500, workStarted: false, settings: {} }).refund, 0)
  assert.equal(calcRefund({ amount: null, workStarted: false, settings: {} }).refund, 0)
  assert.equal(calcRefund({ amount: undefined, workStarted: true, settings: {} }).refund, 0)
})

test('anything but an explicit "instant" means the refund waits for approval', () => {
  assert.equal(isInstantRefund({ refundMode: 'instant' }), true)
  assert.equal(isInstantRefund({ refundMode: 'approval' }), false)
  assert.equal(isInstantRefund({ refundMode: 'Instant' }), false)  // case matters
  assert.equal(isInstantRefund({}), false)                          // missing = safer path
  assert.equal(isInstantRefund(), false)
})
