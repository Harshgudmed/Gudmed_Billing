import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldError } from '@/components/common/FieldError'
import { Loader2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { purchasePaymentApi } from '@/api/purchasePaymentApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, localYmd } from '@/lib/format'
import { showNotifyWarning } from './requestMeta'
import { PAY_MODES } from './paymentAccess'

// Paying a vendor ahead of any bill — to confirm an order, before goods have
// arrived. `order` is the already-loaded order (OrderDetail passes it); its
// total, advancePaid and advancePending give `advanceRoom`, so this form
// needs no API call of its own just to open. The server checks the room
// again — the same rule a bill payment follows, just against the order's
// total instead of a bill's payable.

const toPaise = (v) => Math.round((Number(v) || 0) * 100) / 100

export default function AdvancePaymentForm({ open, onOpenChange, order, advanceRoom, recordsPending, onSaved }) {
  const [form, setForm] = useState({})
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const close = useRef(onOpenChange)
  close.current = onOpenChange

  useEffect(() => {
    if (!open) return
    setErrors({})
    // advanceRoom is read once here, when the form opens — not a dependency,
    // so typing in the amount field never resets it.
    setForm({ amount: advanceRoom > 0 ? String(advanceRoom) : '', paidOn: localYmd(), mode: 'neft', reference: '', notes: '' })
  }, [open, order?.id])

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })) }
  const modeInfo = PAY_MODES.find((m) => m.value === form.mode) || PAY_MODES[0]

  const validate = () => {
    const e = {}
    const amount = toPaise(form.amount)
    if (form.amount === '' || !Number.isFinite(amount)) e.amount = 'Enter the amount'
    else if (amount <= 0) e.amount = 'The amount must be more than 0'
    else if (amount > advanceRoom) e.amount = `Only ${formatMoney(advanceRoom)} is left of ${order.number}'s value to advance`
    if (!form.paidOn) e.paidOn = 'Enter the date it was paid'
    else if (form.paidOn > localYmd()) e.paidOn = 'The payment date cannot be in the future'
    if (modeInfo.ref && !form.reference.trim()) e.reference = `Enter the ${modeInfo.ref.toLowerCase()}`
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const save = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const r = await purchasePaymentApi.record({
        orderId: order.id, amount: toPaise(form.amount), mode: form.mode, reference: form.reference.trim() || null,
        paidOn: form.paidOn, notes: form.notes.trim() || null,
      })
      const p = r.data
      toast.success(p.status === 'posted'
        ? `${p.number}: ${formatMoney(p.amount)} advanced to ${p.vendorName}`
        : `${p.number}: ${formatMoney(p.amount)} sent to Finance for approval`)
      showNotifyWarning(r)
      close.current(false)
      onSaved?.(p)
    } catch (err) {
      showApiError(err, 'Could not record the advance')
    } finally {
      setSaving(false)
    }
  }

  if (!order) return null
  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-blue-600" />Record an advance</DialogTitle>
          <DialogDescription>
            {order.vendorName} · order <span className="font-mono">{order.number}</span> — paid before any bill, against the order's value ({formatMoney(order.total)}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="adv-amount">Amount (₹) *</Label>
              <Input id="adv-amount" type="number" inputMode="decimal" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount')(e.target.value)} />
              <FieldError message={errors.amount} />
              <p className="mt-1 text-xs text-gray-500">{formatMoney(advanceRoom)} left of the order's value to advance.</p>
            </div>
            <div>
              <Label htmlFor="adv-date">Paid on *</Label>
              <Input id="adv-date" type="date" max={localYmd()} value={form.paidOn} onChange={(e) => set('paidOn')(e.target.value)} />
              <FieldError message={errors.paidOn} />
            </div>
            <div>
              <Label htmlFor="adv-mode">Paid by *</Label>
              <Select value={form.mode} onValueChange={set('mode')}>
                <SelectTrigger id="adv-mode"><SelectValue /></SelectTrigger>
                <SelectContent>{PAY_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="adv-ref">{modeInfo.ref ? `${modeInfo.ref} *` : 'Reference (optional)'}</Label>
              <Input id="adv-ref" maxLength={60} value={form.reference} onChange={(e) => set('reference')(e.target.value)}
                placeholder={modeInfo.ref === 'UTR number' ? 'e.g. SBIN526271234567' : modeInfo.ref ? '' : 'e.g. cash voucher no.'} />
              <FieldError message={errors.reference} />
            </div>
          </div>
          <div>
            <Label htmlFor="adv-notes">Note (optional)</Label>
            <Textarea id="adv-notes" rows={2} maxLength={500} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
          </div>
          {recordsPending && (
            <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">This advance waits for Finance to approve it; until then it does not count against the order.</p>
          )}
          <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
            When a vendor bill is entered on {order.number}, this advance attaches to it automatically and reduces what is still owed.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
          <Button onClick={save} disabled={saving || advanceRoom <= 0}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{recordsPending ? 'Send for approval' : 'Record advance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
