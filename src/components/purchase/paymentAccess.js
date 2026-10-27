import { useState, useEffect, useCallback } from 'react'
import { purchasePaymentApi } from '@/api/purchasePaymentApi'

// Who records and who approves vendor payments — mirrors the server's
// backend/src/lib/vendorPayments.js paymentRules, which decides every action
// again. The hospital chooses the mode in Settings → Purchase.

const ADMINS = ['admin', 'super_admin']
const RULES = {
  finance: { recorders: ['finance_controller', ...ADMINS], pending: false, deciders: ['finance_controller', ...ADMINS] },
  officer_finance: { recorders: ['purchase_officer', ...ADMINS], pending: true, deciders: ['finance_controller', ...ADMINS] },
  admin: { recorders: ADMINS, pending: false, deciders: ADMINS },
}

export const MODE_TEXT = {
  finance: 'Finance records vendor payments; they count against the bill at once.',
  officer_finance: 'The purchase officer records vendor payments; each counts once Finance approves it.',
  admin: 'Only an administrator records vendor payments.',
}

export const PAY_MODES = [
  { value: 'neft', label: 'NEFT', ref: 'UTR number' },
  { value: 'rtgs', label: 'RTGS', ref: 'UTR number' },
  { value: 'imps', label: 'IMPS', ref: 'IMPS reference' },
  { value: 'upi', label: 'UPI', ref: 'UPI reference' },
  { value: 'cheque', label: 'Cheque', ref: 'Cheque number' },
  { value: 'dd', label: 'Demand draft', ref: 'Demand draft number' },
  { value: 'cash', label: 'Cash', ref: null },
]
export const modeLabel = (m) => PAY_MODES.find((x) => x.value === m)?.label || m

export const PAYMENT_STATUS = {
  pending_approval: { label: 'Waiting for approval', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  posted:           { label: 'Posted',               cls: 'border-green-200 bg-green-50 text-green-700' },
  rejected:         { label: 'Rejected',             cls: 'border-red-200 bg-red-50 text-red-700' },
  cancelled:        { label: 'Cancelled',            cls: 'border-gray-200 bg-white text-gray-500 line-through' },
}

/** What a bill still owes: payable − debit notes − posted payments, never below 0. */
const rawDue = (b) => Math.round(((Number(b?.payable) || 0) - (Number(b?.debitNoteTotal) || 0) - (Number(b?.amountPaid) || 0)) * 100) / 100
/** What the vendor owes the hospital when debit notes are more than was left to pay (0 otherwise). */
export const billOwedByVendor = (b) => Math.max(0, -rawDue(b))
export const billStillDue = (b) => Math.max(0, rawDue(b))

/**
 * `me` from useMe(), `mode` the hospital's paymentMode (null while unknown:
 * no buttons until it is known). With login switched off there is no role and
 * everything is allowed, as on the server.
 */
export function paymentAccess(me, mode) {
  const rules = mode && (RULES[mode] || RULES.finance)
  const may = (roles) => !!rules && (!me.role ? me.isAdmin : roles.includes(me.role))
  return {
    canRecord: may(rules?.recorders || []),
    recordsPending: !!rules?.pending,
    canDecideAny: may(rules?.deciders || []),
    // A payment's recorder does not approve it too; an administrator may.
    canDecide: (p) => p?.status === 'pending_approval' && may(rules?.deciders || []) && (me.isAdmin || !me.id || me.id !== p.createdById),
    canCancel: (p) => p?.status === 'posted' && me.isAdmin,
  }
}

/**
 * The hospital's payment mode, read from the server. A failed read is not
 * kept: `retry` reads again, and until it works no payment button shows.
 */
export function usePaymentMode(enabled = true) {
  const [mode, setMode] = useState(null)
  const [requireInvoice, setRequireInvoice] = useState(false)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await purchasePaymentApi.getSettings()
      setMode(r?.data?.paymentMode || 'finance')
      setRequireInvoice(r?.data?.requireBillInvoice === true)
    } catch (err) {
      setError(err?.message || 'Could not read who pays vendors')
    }
  }, [])
  useEffect(() => { if (enabled && !mode) load() }, [enabled, mode, load])
  return { mode, requireInvoice, error, retry: load }
}
