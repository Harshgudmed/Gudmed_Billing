/**
 * What this hospital refunds on a cancellation, and whether finance sees it first.
 *
 * The browser shows the same figures (src/lib/refund.js) so the person cancelling
 * knows what will happen before they confirm — but the number stored is always the
 * one computed here. A refund amount arriving in a request body is a number the
 * client chose, and this is money leaving the hospital.
 *
 * The two halves must agree to the paisa or the dialog and the ledger tell
 * different stories, so the rounding, the ?? defaults and the 0-100 clamp below
 * are deliberately identical to the frontend copy. There is no module shared
 * across the two halves of this repo; the next best thing is one small file on
 * each side, each naming the other.
 */
import { round2 } from './money.js'

/** Defaults when a hospital has never opened the Cancellation settings. */
export const REFUND_DEFAULTS = {
  refundMode: 'approval',
  refundSelfApproval: false,
  cancelChargeBeforeWorkPct: 0,
  cancelChargeAfterWorkPct: 100,
}

/** The refund settings for one organisation, whatever its stored blob holds. */
export function refundSettings(organization) {
  let stored = {}
  try {
    stored = typeof organization?.settings === 'string'
      ? JSON.parse(organization.settings)
      : (organization?.settings || {})
  } catch { stored = {} }

  return {
    // Anything but an explicit 'instant' means approval — the safer reading when
    // the setting is missing, misspelt, or was never saved.
    refundMode: stored.refundMode === 'instant' ? 'instant' : 'approval',
    // Maker-checker unless the hospital explicitly allows it (Settings).
    refundSelfApproval: stored.refundSelfApproval === true,
    // ?? not ||: a hospital that deliberately sets 0% means zero, and || would
    // silently replace that with the default.
    cancelChargeBeforeWorkPct: Number(stored.cancelChargeBeforeWorkPct ?? REFUND_DEFAULTS.cancelChargeBeforeWorkPct),
    cancelChargeAfterWorkPct: Number(stored.cancelChargeAfterWorkPct ?? REFUND_DEFAULTS.cancelChargeAfterWorkPct),
  }
}

/**
 * @param {number}  amount       what was billed
 * @param {boolean} workStarted  sample drawn / scan begun / medicine handed over
 * @param {object}  settings     from refundSettings()
 */
export function calcRefund({ amount, workStarted, settings }) {
  const billed = Math.max(0, Number(amount) || 0)
  const raw = workStarted ? settings.cancelChargeAfterWorkPct : settings.cancelChargeBeforeWorkPct

  // A percentage outside 0-100 is a data-entry slip in Settings, not an intent to
  // refund more than was paid or to charge a negative fee. Clamp rather than trust.
  const pct = Math.min(100, Math.max(0, Number(raw) || 0))

  const charge = round2(billed * pct / 100)
  return { chargePct: pct, charge, refund: round2(billed - charge) }
}

export const isInstantRefund = (settings) => settings?.refundMode === 'instant'

/**
 * Why this person may not approve this refund, or null. Whoever raised a refund
 * approves it only where the hospital allows that (refundSelfApproval) — an
 * administrator included, since this is money leaving the hospital.
 */
export function selfApprovalProblem(settings, requestedById, actorId) {
  if (settings?.refundSelfApproval || !requestedById || requestedById !== actorId) return null
  return 'You raised this refund, so someone else must approve it (Settings → Cancellation & Refund can allow this)'
}
