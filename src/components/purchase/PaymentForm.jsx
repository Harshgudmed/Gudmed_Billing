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
import { formatMoney, formatDateTime, localYmd } from '@/lib/format'
import { showNotifyWarning } from './requestMeta'
import { PAY_MODES } from './paymentAccess'
import LoadFailed from './LoadFailed'

// Recording a payment to a vendor against one approved bill. It opens filled
// with what is still due (less anything already waiting for approval), today's
// date and NEFT — the commonest case is one click. The server checks it all
// again: the bill, the amount, the date, and who may record in this mode.

const day = (v) => formatDateTime(`${v}T00:00:00`, { withTime: false })
const toPaise = (v) => Math.round(Number(v) * 100) / 100

export default function PaymentForm({ open, onOpenChange, billId, recordsPending, onSaved }) {
  const [due, setDue] = useState(null) // the bill's payables row; false = nothing due on it
  const [loadError, setLoadError] = useState(null)
  const [form, setForm] = useState({})
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const close = useRef(onOpenChange)
  close.current = onOpenChange

  const load = async () => {
    setDue(null)
    setLoadError(null)
    try {
      const r = await purchasePaymentApi.getBillDue(billId)
      const row = r?.data?.[0] || false
      setDue(row)
      setForm({ amount: row ? String(row.payableNow) : '', paidOn: localYmd(), mode: 'neft', reference: '', notes: '' })
    } catch (err) {
      setLoadError(err?.message || 'Could not read what is due on this bill')
    }
  }
  useEffect(() => { if (open && billId) { setErrors({}); load() } }, [open, billId])

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })) }
  const modeInfo = PAY_MODES.find((m) => m.value === form.mode) || PAY_MODES[0]

  const validate = () => {
    const e = {}
    const amount = toPaise(form.amount)
    if (form.amount === '' || !Number.isFinite(amount)) e.amount = 'Enter the amount paid'
    else if (amount <= 0) e.amount = 'The amount paid must be more than 0'
    else if (due && amount > due.payableNow) e.amount = `Only ${formatMoney(due.payableNow)} is left to pay on this bill`
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
        billId, amount: toPaise(form.amount), mode: form.mode, reference: form.reference.trim() || null,
        paidOn: form.paidOn, notes: form.notes.trim() || null,
      })
      const p = r.data
      toast.success(p.status === 'posted'
        ? `${p.number}: ${formatMoney(p.amount)} paid to ${p.vendorName}`
        : `${p.number}: ${formatMoney(p.amount)} sent to Finance for approval`)
      showNotifyWarning(r)
      close.current(false)
      onSaved?.(p)
    } catch (err) {
      showApiError(err, 'Could not record the payment')
      // What is due may have changed (another payment just went in): read it again.
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-blue-600" />Record payment</DialogTitle>
          <DialogDescription>
            {due ? <>{due.vendorName} · bill <span className="font-mono">{due.number}</span> · invoice {due.vendorInvoiceNumber}</> : 'Payment to the vendor against an approved bill'}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <LoadFailed onRetry={load}>Could not read what is due on this bill: {loadError}.</LoadFailed>
        ) : due === null ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" /></div>
        ) : due === false ? (
          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">Nothing is left to pay on this bill — it is fully paid, or not approved for payment.</p>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-gray-50 p-3 text-sm">
              <dt className="text-gray-500">Payable</dt><dd className="text-right tabular-nums">{formatMoney(due.payable)}</dd>
              {due.debitNoteTotal > 0 && <><dt className="text-gray-500">Debit notes</dt><dd className="text-right tabular-nums">− {formatMoney(due.debitNoteTotal)}</dd></>}
              {due.amountPaid > 0 && <><dt className="text-gray-500">Paid</dt><dd className="text-right tabular-nums">− {formatMoney(due.amountPaid)}</dd></>}
              <dt className="font-semibold">Still due</dt><dd className="text-right font-semibold tabular-nums">{formatMoney(due.due)}</dd>
              {due.pending > 0 && <><dt className="text-amber-700">Waiting for approval</dt><dd className="text-right tabular-nums text-amber-700">{formatMoney(due.pending)}</dd></>}
              <dt className="text-gray-500">Due on</dt>
              <dd className={`text-right ${due.daysOverdue > 0 ? 'font-semibold text-red-700' : ''}`}>{day(due.dueDay)}{due.daysOverdue > 0 && ` · ${due.daysOverdue} days overdue`}</dd>
              {due.msmeFlag && <dd className="col-span-2 text-xs font-medium text-orange-700">MSME vendor: by law paid by {day(due.msmeDeadline)}{due.msmeFlag === 'past' ? ' — already past' : ''}</dd>}
            </dl>

            {due.payableNow <= 0 ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Everything still due is already in payments waiting for Finance's approval.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="pay-amount">Amount (₹) *</Label>
                    <Input id="pay-amount" type="number" inputMode="decimal" step="0.01" min="0" value={form.amount} onChange={(e) => set('amount')(e.target.value)} />
                    <FieldError message={errors.amount} />
                  </div>
                  <div>
                    <Label htmlFor="pay-date">Paid on *</Label>
                    <Input id="pay-date" type="date" max={localYmd()} value={form.paidOn} onChange={(e) => set('paidOn')(e.target.value)} />
                    <FieldError message={errors.paidOn} />
                  </div>
                  <div>
                    <Label htmlFor="pay-mode">Paid by *</Label>
                    <Select value={form.mode} onValueChange={set('mode')}>
                      <SelectTrigger id="pay-mode"><SelectValue /></SelectTrigger>
                      <SelectContent>{PAY_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pay-ref">{modeInfo.ref ? `${modeInfo.ref} *` : 'Reference (optional)'}</Label>
                    <Input id="pay-ref" maxLength={60} value={form.reference} onChange={(e) => set('reference')(e.target.value)}
                      placeholder={modeInfo.ref === 'UTR number' ? 'e.g. SBIN526271234567' : modeInfo.ref ? '' : 'e.g. cash voucher no.'} />
                    <FieldError message={errors.reference} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="pay-notes">Note (optional)</Label>
                  <Textarea id="pay-notes" rows={2} maxLength={500} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
                </div>
                {recordsPending && (
                  <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">This payment waits for Finance to approve it; until then it does not count against the bill.</p>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
          {due && due.payableNow > 0 && (
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{recordsPending ? 'Send for approval' : 'Record payment'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
