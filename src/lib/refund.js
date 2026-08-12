// Character-for-character the backend's round2 (backend/src/lib/money.js). The
// server recomputes every refund it is sent, so a browser that rounds differently
// would show one figure in the dialog and store another — and the paisa that fell
// between them would be a mystery in the ledger. There is no shared module across
// the two halves of this repo, so the next best thing is one line, identical, with
// a comment saying which line it must stay identical to.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * What a hospital actually pays back when something is cancelled.
 *
 * One function for Billing, Pharmacy, Radiology and Laboratory, because the sum is
 * the same in all four and only the answer to "has the work started?" differs —
 * that answer is each module's own business and arrives here as a boolean.
 *
 * The charge is keyed on WHEN, not on a flat rate, because that is how a hospital
 * really works: a lab test cancelled before the sample is drawn has cost nothing,
 * and the same test cancelled after the tube is filled has already spent the
 * reagent and the technician's time. A hospital that wants one rate puts the same
 * number in both settings.
 *
 * @param {number}  amount        what was billed
 * @param {boolean} workStarted   sample drawn / scan begun / medicine handed over
 * @param {object}  settings      orgInfo — cancelChargeBeforeWorkPct / AfterWorkPct
 * @returns {{ chargePct, charge, refund, workStarted }}
 */
export function calcRefund({ amount, workStarted, settings = {} }) {
  const billed = Math.max(0, Number(amount) || 0)

  // ?? not ||, in both: a hospital that deliberately sets 0% means zero, and `||`
  // would silently replace that with the default instead.
  const chargePct = workStarted
    ? Number(settings.cancelChargeAfterWorkPct ?? 100)
    : Number(settings.cancelChargeBeforeWorkPct ?? 0)

  // A percentage outside 0–100 is a data-entry slip in Settings, not an intent to
  // refund more than was paid or to charge a negative fee. Clamp rather than trust.
  const pct = Math.min(100, Math.max(0, chargePct))

  const charge = round2(billed * pct / 100)
  return { chargePct: pct, charge, refund: round2(billed - charge), workStarted: !!workStarted }
}

/**
 * Does this hospital hand the money back at the counter, or does finance approve
 * it first? Anything other than an explicit 'instant' means approval — the safer
 * reading when a setting is missing or misspelt.
 */
export function isInstantRefund(settings = {}) {
  return settings.refundMode === 'instant'
}
