import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, CalendarClock, IndianRupee } from 'lucide-react'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { calcRefund, isInstantRefund } from '@/lib/refund'
import { formatMoney } from '@/lib/format'

// One cancel dialog for Billing, Pharmacy, Radiology and Laboratory.
//
// The four differ in exactly two ways — whether the thing can be rescheduled at
// all, and what "the work has started" means for it — so those are the only two
// things this table holds. Everything else (the reason, the refund sum, the
// instant-vs-approval wording) is identical in all four and lives below, once.
//
// "Reschedule" does not mean the same thing in all four, so each says what it
// means and whether a time is part of it. A scan moves to a new slot; a bill is a
// document and cannot move, but the date the patient must pay by can.
export const CANCEL_MODULES = {
  billing: {
    label: 'Invoice',
    reschedule: true,
    rescheduleVerb: 'Reschedule',
    rescheduleHint: 'Moves the payment due date. The bill itself is unchanged.',
    // A draft has been raised but nothing was fulfilled from it yet. Guarded on
    // the status being PRESENT: `undefined !== 'draft'` is true, so a record that
    // forgot to carry its status would silently be charged the after-work rate.
    workStarted: (r) => !!r?.status && r.status !== 'draft',
  },
  pharmacy: {
    label: 'Sale',
    reschedule: false,
    // A sale row exists only once the medicine left the shelf, so the work is
    // always done by the time anyone can cancel it.
    workStarted: () => true,
  },
  radiology: {
    label: 'Scan',
    reschedule: true,
    rescheduleVerb: 'Reschedule',
    rescheduleHint: 'Moves the scan to a new date.',
    workStarted: (r) => r?.status === 'in_progress' || r?.status === 'completed' || !!r?.examPerformedAt,
  },
  laboratory: {
    label: 'Lab Order',
    reschedule: true,
    rescheduleVerb: 'Reschedule',
    rescheduleHint: 'Moves the sample collection to a new date.',
    // Anything past 'pending' means the tube was drawn — the reagent is spent.
    workStarted: (r) => r?.status !== 'pending',
  },
}

export default function CancelActionDialog({
  open,
  onOpenChange,
  module,
  record,
  amount = 0,
  title,
  subtitle,
  onConfirm,
  isSubmitting = false,
}) {
  const cfg = CANCEL_MODULES[module] ?? CANCEL_MODULES.billing
  const { orgInfo } = useOrgSettings()

  const [action, setAction] = useState('refund')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState('')

  // Everything the user typed is cleared when the dialog closes. Without this the
  // next record opens carrying the previous one's reason and date — and the
  // reason is written onto the record, so it would be attributed to the wrong one.
  useEffect(() => {
    if (open) {
      setAction(cfg.reschedule ? 'reschedule' : 'refund')
      setReason('')
      setDate('')
    }
  }, [open, cfg.reschedule])

  const workStarted = cfg.workStarted(record)
  const { charge, refund, chargePct } = calcRefund({ amount, workStarted, settings: orgInfo })
  const instant = isInstantRefund(orgInfo)

  const canConfirm = reason.trim().length > 0
    && (action !== 'reschedule' || !!date)
    && !isSubmitting

  const submit = () => {
    if (!canConfirm) return
    onConfirm(action === 'reschedule'
      ? { action: 'reschedule', reason: reason.trim(), date }
      : { action: 'refund', reason: reason.trim(), amount, charge, refund, chargePct, instant })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {cfg.label}</DialogTitle>
          <DialogDescription>
            {cfg.reschedule
              ? 'Move this to a new date, or cancel it and settle the money.'
              : 'This cannot be rescheduled — cancelling settles the money.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {(title || subtitle) && (
            <div className="bg-gray-50 p-3 rounded-lg">
              {title && <div className="font-medium font-mono text-sm">{title}</div>}
              {subtitle && <div className="text-sm text-gray-500">{subtitle}</div>}
            </div>
          )}

          {cfg.reschedule && (
            <div className="flex gap-2">
              {[
                { key: 'reschedule', Icon: CalendarClock, text: cfg.rescheduleVerb ?? 'Reschedule' },
                { key: 'refund', Icon: IndianRupee, text: 'Cancel & refund' },
              ].map(({ key, Icon, text }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAction(key)}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-md border p-2 text-sm transition ${
                    action === key ? 'border-blue-500 bg-blue-50 font-medium' : 'hover:bg-gray-50'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {text}
                </button>
              ))}
            </div>
          )}

          {action === 'reschedule' ? (
            <div className="space-y-2">
              <div>
                <Label>New date *</Label>
                {/* Today is the floor: nothing can be moved into the past. */}
                <Input
                  type="date"
                  value={date}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              {cfg.rescheduleHint && (
                <p className="text-xs text-gray-500">{cfg.rescheduleHint}</p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Billed</span>
                <span>{formatMoney(amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">
                  Cancellation charge {chargePct}%
                  <span className="block text-xs text-gray-400">
                    {workStarted ? 'work already started' : 'work not started'}
                  </span>
                </span>
                <span>− {formatMoney(charge)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-semibold">
                <span>Refund</span>
                <span>{formatMoney(refund)}</span>
              </div>
              <p className="text-xs text-gray-500 pt-1">
                {instant
                  ? 'This hospital refunds at the counter — the money goes back immediately.'
                  : 'This refund goes to finance for approval before any money moves.'}
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="cancel-reason">Reason *</Label>
            <Textarea
              id="cancel-reason"
              rows={2}
              placeholder="Why is this being cancelled?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {/* Shown from the start, not only after a failed submit: a required
                field the user learns about by pressing a dead button is worse
                than one that says so while there is still nothing to lose. */}
            {!reason.trim() && (
              <p className="text-xs text-gray-500 mt-1">A reason is required.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Keep {cfg.label}
          </Button>
          <Button
            variant={action === 'reschedule' ? 'default' : 'destructive'}
            onClick={submit}
            disabled={!canConfirm}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {action === 'reschedule' ? (cfg.rescheduleVerb ?? 'Reschedule') : `Cancel & refund ${formatMoney(refund)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
