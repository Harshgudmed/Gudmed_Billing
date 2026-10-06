import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, CheckCircle2, XCircle, Ban, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { purchasePaymentApi } from '@/api/purchasePaymentApi'
import { showApiError } from '@/lib/apiRequest'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime } from '@/lib/format'
import { gudmedDocument, infoBox, escapeHtml, printViaIframe } from '@/lib/printTemplate'
// Billing's rupees-in-words, so a voucher spells an amount as an invoice does.
import { amountInWords } from '@/components/billing/utils/printBilling'
import { showNotifyWarning } from './requestMeta'
import { PAYMENT_STATUS, modeLabel, PAY_MODES } from './paymentAccess'

// One vendor payment: what was paid, how, against which bill, and where it
// stands. The buttons are the next step for this person:
//   waiting for approval — Finance (not whoever recorded it; an administrator
//                          may) approves, or rejects with the reason
//   posted               — an administrator cancels it, with the reason
//                          (a bounced cheque, a returned transfer)
// Any status prints as a payment voucher. The server decides each again.

const day = (v) => formatDateTime(v, { withTime: false })

function printVoucher(p) {
  const v = p.vendor || {}
  const address = [v.houseNumber, v.street, v.locality, v.city, v.district, v.pincode].filter(Boolean).join(', ')
  const refName = PAY_MODES.find((m) => m.value === p.mode)?.ref || 'Reference'
  const state = p.status === 'posted' ? '' : `<div class="note-bar"><b>${escapeHtml((PAYMENT_STATUS[p.status]?.label || p.status).toUpperCase())}</b>${
    p.status === 'cancelled' ? ` — ${escapeHtml(p.cancelReason || '')}` : p.status === 'rejected' ? ` — ${escapeHtml(p.decisionRemark || '')}` : ' — not yet counted against the bill'}</div>`
  const body = `
${infoBox('Paid to', [
    { label: 'Vendor', value: v.name || p.vendorName },
    { label: 'GSTIN / PAN', value: [v.gstNumber, v.pan].filter(Boolean).join(' / ') || '—' },
    { label: 'Bank', value: [v.bankName, v.bankAccountNumber, v.bankIfsc].filter(Boolean).join(' · ') || '—' },
    { label: 'Address', value: address || '—' },
  ])}
${infoBox('Payment', [
    { label: 'Voucher', value: p.number },
    { label: 'Paid on', value: day(p.paidOn) },
    { label: 'Paid by', value: modeLabel(p.mode) },
    { label: refName, value: p.reference || '—' },
  ])}
${state}
<table>
  <thead><tr><th>Bill</th><th>Vendor invoice</th><th>PO</th><th style="text-align:right">Payable</th><th style="text-align:right">This payment</th></tr></thead>
  <tbody><tr>
    <td>${escapeHtml(p.bill?.number || '')}</td>
    <td>${escapeHtml(p.bill?.vendorInvoiceNumber || '')}${p.bill?.vendorInvoiceDate ? ` · ${day(p.bill.vendorInvoiceDate)}` : ''}</td>
    <td>${escapeHtml(p.bill?.order?.number || '—')}</td>
    <td style="text-align:right">${formatMoney(p.bill?.payable)}</td>
    <td style="text-align:right"><b>${formatMoney(p.amount)}</b></td>
  </tr></tbody>
  <tfoot><tr><td colspan="4" style="text-align:right">Still due on the bill after posted payments${p.bill?.debitNoteTotal > 0 ? ' and debit notes' : ''}</td><td style="text-align:right">${formatMoney(p.bill?.stillDue)}</td></tr></tfoot>
</table>
<div class="note-bar"><b>Amount in words:</b> ${escapeHtml(`${amountInWords(Number(p.amount) || 0)} Rupee(s) Only`)}</div>
${p.notes ? `<div class="note-bar"><b>Note:</b> ${escapeHtml(p.notes)}</div>` : ''}
<div style="display:flex;justify-content:space-between;gap:16px;margin-top:40px;font-size:9.5pt;text-align:center">
  <div>${escapeHtml(p.createdByName || '')}<br>______________________<br>Prepared by</div>
  <div>${escapeHtml(p.decidedByName || '')}<br>______________________<br>Approved by</div>
  <div><br>______________________<br>Receiver's signature</div>
</div>`
  printViaIframe(gudmedDocument({
    orgInfo: { name: p.hospital?.name, address: p.hospital?.address, city: p.hospital?.city },
    title: p.number, banner: 'PAYMENT VOUCHER', subtitle: 'Accounts — vendor payment',
    headerRight: `${escapeHtml(p.number)}<br>${day(p.paidOn)}`,
    body,
  }))
}

export default function PaymentDetail({ id, open, onOpenChange, access, onChanged }) {
  const [loaded, setLoaded] = useState(null)
  const [busy, setBusy] = useState(null)
  const [asking, setAsking] = useState(null) // 'approve' | 'reject' | 'cancel'
  const [remark, setRemark] = useState('')
  const p = loaded && loaded.id === id ? loaded : null

  // A parent's inline callback in a ref: a list refresh must not re-run the load
  // (that wiped a reason being typed).
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  const load = useCallback(async () => {
    if (!id) return
    try { setLoaded((await purchasePaymentApi.getPayment(id)).data) } catch (err) { showApiError(err, 'Could not open the payment'); close.current(false) }
  }, [id])
  useEffect(() => { if (open) { setAsking(null); setRemark(''); load() } }, [open, load])
  useLiveData(open ? 'purchase' : null, load)

  const run = async () => {
    const key = asking
    const text = remark.trim()
    setBusy(key)
    try {
      const call = key === 'approve' ? purchasePaymentApi.approve : key === 'reject' ? purchasePaymentApi.reject : purchasePaymentApi.cancel
      const r = await call(p.id, text)
      toast.success(key === 'approve' ? `${p.number} approved — ${formatMoney(p.amount)} counted against ${p.bill?.number}`
        : key === 'reject' ? `${p.number} rejected — ${p.createdByName} has been told why`
          : `${p.number} cancelled — the bill shows it unpaid again`)
      showNotifyWarning(r)
      setAsking(null)
      setRemark('')
      setLoaded(r.data)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not complete that')
      load()
    } finally {
      setBusy(null)
    }
  }

  const status = p && (PAYMENT_STATUS[p.status] || PAYMENT_STATUS.posted)
  const decide = !!p && access.canDecide(p)
  const recordedIt = !!p && p.status === 'pending_approval' && access.canDecideAny && !decide
  const needsText = asking === 'reject' || asking === 'cancel'

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        {!p ? (
          <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{p.number}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
              </div>
              <DialogDescription>
                {p.vendorName} · bill <span className="font-mono">{p.bill?.number}</span> (invoice {p.bill?.vendorInvoiceNumber}) · recorded by {p.createdByName} on {formatDateTime(p.createdAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              {p.status === 'pending_approval' && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  {decide ? 'Approve it once the money has left the bank; reject it if the amount or reference is wrong.'
                    : recordedIt ? 'You recorded this payment, so someone else in Finance approves it.'
                      : 'Waiting for Finance to approve it. Until then it does not count against the bill.'}
                </p>
              )}
              {p.status === 'rejected' && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  <span className="font-semibold">Rejected by {p.decidedByName}{p.decidedAt && ` on ${formatDateTime(p.decidedAt)}`}: </span>{p.decisionRemark}
                </p>
              )}
              {p.status === 'cancelled' && (
                <p className="rounded-md bg-gray-50 px-3 py-2"><span className="text-gray-500">Cancelled{p.cancelledAt && ` on ${formatDateTime(p.cancelledAt)}`}: </span>{p.cancelReason}</p>
              )}
              {p.status === 'posted' && p.decidedByName && (
                <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-green-800">
                  Approved by {p.decidedByName}{p.decidedAt && ` on ${formatDateTime(p.decidedAt)}`}{p.decisionRemark && `: ${p.decisionRemark}`}
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Amount</dt><dd className="text-lg font-bold tabular-nums">{formatMoney(p.amount)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Paid on</dt><dd>{day(p.paidOn)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Paid by</dt><dd>{modeLabel(p.mode)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Reference</dt><dd className="break-all text-right font-mono">{p.reference || '—'}</dd></div>
                  {p.vendor?.bankAccountNumber && <div className="flex justify-between gap-4"><dt className="text-gray-500">Vendor account</dt><dd className="text-right">{[p.vendor.bankName, p.vendor.bankAccountNumber, p.vendor.bankIfsc].filter(Boolean).join(' · ')}</dd></div>}
                  {p.notes && <div><dt className="text-gray-500">Note</dt><dd>{p.notes}</dd></div>}
                </dl>
                <dl className="space-y-1.5 self-start rounded-md bg-gray-50 p-3">
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Bill payable</dt><dd className="tabular-nums">{formatMoney(p.bill?.payable)}</dd></div>
                  {p.bill?.debitNoteTotal > 0 && <div className="flex justify-between gap-4"><dt className="text-gray-500">Debit notes</dt><dd className="tabular-nums">− {formatMoney(p.bill.debitNoteTotal)}</dd></div>}
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Paid (posted)</dt><dd className="tabular-nums">− {formatMoney(p.bill?.amountPaid)}</dd></div>
                  <div className="flex justify-between gap-4 border-t pt-1.5"><dt className="font-semibold">Still due</dt><dd className="font-bold tabular-nums">{formatMoney(p.bill?.stillDue)}</dd></div>
                </dl>
              </div>

              {asking && (
                <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3">
                  <Label htmlFor="payment-remark">{asking === 'approve' ? 'Remark (optional)' : asking === 'reject' ? 'Why is it rejected? *' : 'Why is it cancelled? *'}</Label>
                  <Textarea id="payment-remark" rows={2} autoFocus value={remark} onChange={(e) => setRemark(e.target.value)}
                    placeholder={asking === 'approve' ? 'e.g. Checked against the bank statement' : asking === 'reject' ? 'e.g. The UTR does not match the bank statement' : 'e.g. Cheque bounced'} />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAsking(null); setRemark('') }} disabled={!!busy}>Back</Button>
                    <Button size="sm" onClick={run} disabled={!!busy || (needsText && remark.trim().length < 3)}
                      variant={asking === 'approve' ? 'default' : 'destructive'} className={asking === 'approve' ? 'bg-green-600 hover:bg-green-700' : undefined}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{asking === 'approve' ? 'Approve payment' : asking === 'reject' ? 'Reject payment' : 'Cancel payment'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {!asking && (
              <DialogFooter className="gap-2 flex-wrap">
                {access.canCancel(p) && (
                  <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy} onClick={() => setAsking('cancel')}><Ban className="h-4 w-4 mr-1" />Cancel payment</Button>
                )}
                <Button variant="outline" onClick={() => printVoucher(p)}><Printer className="h-4 w-4 mr-1" />Print voucher</Button>
                {decide && (
                  <>
                    <Button variant="outline" className="text-red-700 border-red-200" disabled={!!busy} onClick={() => setAsking('reject')}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
                    <Button className="bg-green-600 hover:bg-green-700" disabled={!!busy} onClick={() => setAsking('approve')}><CheckCircle2 className="h-4 w-4 mr-1" />Approve</Button>
                  </>
                )}
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>Close</Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
