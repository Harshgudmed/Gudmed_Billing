import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, CheckCircle2, XCircle, Ban, Printer, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseReturnApi } from '@/api/purchaseReturnApi'
import { showApiError } from '@/lib/apiRequest'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime } from '@/lib/format'
import { gudmedDocument, infoBox, escapeHtml, printViaIframe } from '@/lib/printTemplate'
// Billing's rupees-in-words, so a debit note spells an amount as an invoice does.
import { amountInWords } from '@/components/billing/utils/printBilling'
import { useMe, showNotifyWarning } from './requestMeta'

// One return to a vendor: what goes back, from which batch, why, and — for
// those who see money — what it is worth and where its debit note went.
//
// The buttons are the next step for this person and this status:
//   waiting  — the purchase officer (or an administrator) approves it, or
//              rejects it with a reason; never a return they raised themselves
//              (an administrator may)
//   posted   — an administrator can cancel it (the goods go back on the shelf,
//              the debit note comes off); anyone can print it
// The server decides each again; these only choose what to show.

export const RETURN_STATUS = {
  pending_approval: { label: 'Waiting for approval', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  posted:           { label: 'Posted',               cls: 'border-green-200 bg-green-50 text-green-700' },
  rejected:         { label: 'Rejected',             cls: 'border-red-200 bg-red-50 text-red-700' },
  cancelled:        { label: 'Cancelled',            cls: 'border-gray-200 bg-white text-gray-500 line-through' },
}
// Mirrors backend/src/lib/purchaseReturns.js REASON_LABEL.
export const REASON_LABEL = {
  damaged: 'Damaged', wrong_item: 'Wrong item', expired: 'Expired', near_expiry: 'Near expiry', quality: 'Quality problem', other: 'Other',
}

const day = (v) => (v ? formatDateTime(v, { withTime: false }) : '—')

/**
 * The printed debit note — or, for a store login (the server sent it no
 * money), the goods return note that travels with the goods.
 */
export function printReturn(ret) {
  const money = ret.total !== undefined
  const v = ret.vendor || {}
  const vendorAddress = [v.houseNumber, v.street, v.locality, v.city, v.district, v.pincode].filter(Boolean).join(', ')
  const rows = ret.lines.map((l, i) => `<tr>
    <td>${i + 1}</td>
    <td>${escapeHtml(l.itemName)}<br><span style="color:#666;font-size:8pt">${escapeHtml(l.itemCode)}</span></td>
    <td>${escapeHtml(l.batchNumber || '—')}</td>
    <td>${day(l.expiryDate)}</td>
    <td style="text-align:right">${l.quantity} ${escapeHtml(l.unitCode)}</td>
    ${money ? `<td style="text-align:right">${formatMoney(l.rate)}</td><td style="text-align:right">${ret.order?.gstType === 'none' ? '—' : `${l.gstRate}%`}</td><td style="text-align:right">${formatMoney(l.lineTotal)}</td>` : ''}
  </tr>`).join('')
  const span = 7
  const foot = money ? `<tfoot>
    <tr><td colspan="${span}" style="text-align:right">Value before GST</td><td style="text-align:right">${formatMoney(ret.subtotal)}</td></tr>
    <tr><td colspan="${span}" style="text-align:right">GST</td><td style="text-align:right">${formatMoney(ret.gstAmount)}</td></tr>
    <tr><td colspan="${span}" style="text-align:right">Debit note total</td><td style="text-align:right">${formatMoney(ret.total)}</td></tr>
  </tfoot>` : ''
  const docNo = ret.debitNoteNumber || ret.number
  const body = `
${infoBox('Vendor', [
    { label: 'Name', value: v.name || ret.vendorName },
    { label: 'GSTIN', value: v.gstNumber || 'Not registered' },
    { label: 'Contact', value: [v.contactPerson, v.phone].filter(Boolean).join(' · ') || '—' },
    { label: 'Address', value: vendorAddress || '—' },
  ])}
${infoBox(money ? 'Debit note' : 'Return', [
    { label: money ? 'Debit note no.' : 'Return no.', value: docNo },
    { label: 'Return no.', value: ret.number },
    { label: 'Against order', value: ret.order?.number || '—' },
    { label: money ? 'Against bill' : 'Goods receipt', value: money ? (ret.bill ? `${ret.bill.number} (inv ${ret.bill.vendorInvoiceNumber})` : 'Not billed yet') : (ret.receipt?.number || '—') },
  ])}
${ret.status === 'cancelled' ? `<div class="note-bar"><b>CANCELLED</b>: ${escapeHtml(ret.cancelReason || '')}</div>` : ''}
${ret.status === 'pending_approval' ? '<div class="note-bar"><b>Pending approval</b> — goods have not left stock.</div>' : ''}
<div class="note-bar"><b>Reason:</b> ${escapeHtml(REASON_LABEL[ret.reason] || ret.reason)}${ret.notes ? ` — ${escapeHtml(ret.notes)}` : ''}</div>
<table>
  <thead><tr><th>#</th><th>Item</th><th>Batch</th><th>Expiry</th><th style="text-align:right">Qty</th>${money ? '<th style="text-align:right">Rate</th><th style="text-align:right">GST</th><th style="text-align:right">Amount</th>' : ''}</tr></thead>
  <tbody>${rows}</tbody>
  ${foot}
</table>
${money ? `<div class="note-bar"><b>Amount in words:</b> ${escapeHtml(`${amountInWords(Number(ret.total) || 0)} Rupee(s) Only`)}</div>` : ''}
<div class="signature-grid">
  <div class="signature-cell">Sent by (store)</div>
  <div class="signature-cell">Received by (vendor)</div>
  <div class="signature-cell">Authorised signatory</div>
</div>`

  printViaIframe(gudmedDocument({
    orgInfo: { name: ret.hospital?.name, address: ret.hospital?.address, city: ret.hospital?.city },
    title: docNo, banner: money ? 'DEBIT NOTE' : 'GOODS RETURN NOTE', subtitle: money ? 'Finance — supplier return' : 'Stores — supplier return',
    headerRight: `${escapeHtml(docNo)}<br>${day(ret.postedAt || ret.createdAt)}`,
    body, variant: 'purchase',
  }))
}

export default function ReturnDetail({ id, open, onOpenChange, onChanged }) {
  const me = useMe()
  const [loaded, setLoaded] = useState(null)
  const [busy, setBusy] = useState(null)
  const [asking, setAsking] = useState(null) // 'approve' | 'reject' | 'cancel'
  const [remark, setRemark] = useState('')
  const ret = loaded && loaded.id === id ? loaded : null

  // Held in a ref: the list passes an inline arrow, and a new one on each of
  // its refreshes must not re-open this dialog (that would wipe a remark).
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  const load = useCallback(async () => {
    if (!id) return
    try { setLoaded((await purchaseReturnApi.getReturn(id)).data) } catch (err) { showApiError(err, 'Could not open the return'); close.current(false) }
  }, [id])
  useEffect(() => { if (open) { setAsking(null); setRemark(''); load() } }, [open, load])
  useLiveData(open ? 'purchase' : null, load)

  const run = async (key, call, message) => {
    setBusy(key)
    try {
      const r = await call()
      toast.success(message(r.data))
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

  const money = !!ret && ret.total !== undefined
  const status = ret && (RETURN_STATUS[ret.status] || RETURN_STATUS.pending_approval)
  const raisedIt = !!ret && !!me.id && me.id === ret.createdById
  const decide = ret?.status === 'pending_approval' && me.canDecideReturn && (me.isAdmin || !raisedIt)
  const canCancel = ret?.status === 'posted' && me.isAdmin
  const needsText = asking === 'reject' || asking === 'cancel'

  const confirmAsked = () => {
    const text = remark.trim()
    if (asking === 'approve') return run('approve', () => purchaseReturnApi.approveReturn(ret.id, text), (d) => `${d.number} approved — debit note ${d.debitNoteNumber}`)
    if (asking === 'reject') return run('reject', () => purchaseReturnApi.rejectReturn(ret.id, text), (d) => `${d.number} rejected — the goods stay in stock`)
    if (asking === 'cancel') return run('cancel', () => purchaseReturnApi.cancelReturn(ret.id, text), (d) => `${d.number} cancelled — the goods are back in stock`)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        {!ret ? (
          <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{ret.number}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
                <Badge variant="outline">{REASON_LABEL[ret.reason] || ret.reason}</Badge>
                {ret.debitNoteNumber && <Badge variant="outline" className="font-mono">{ret.debitNoteNumber}</Badge>}
              </div>
              <DialogDescription>
                Back to {ret.vendorName} · order <span className="font-mono">{ret.order?.number}</span>
                {ret.receipt && <> · receipt <span className="font-mono">{ret.receipt.number}</span></>}
                {' '}· raised by {ret.createdByName} on {formatDateTime(ret.createdAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {ret.notes && <p className="rounded-md bg-gray-50 px-3 py-2 text-sm"><span className="text-gray-500">Note: </span>{ret.notes}</p>}

              {ret.status === 'pending_approval' && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Waiting for the purchase officer. The goods have not left stock yet.
                  {me.canDecideReturn && raisedIt && !me.isAdmin && ' You raised it, so someone else decides it.'}
                </p>
              )}
              {ret.status === 'rejected' && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <span className="font-semibold">Rejected{ret.decidedByName && ` by ${ret.decidedByName}`}{ret.decidedAt && ` on ${formatDateTime(ret.decidedAt)}`}: </span>{ret.decisionRemark || 'no reason given'}. The goods stay in stock.
                </p>
              )}
              {ret.status === 'posted' && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                  <p className="font-semibold">
                    Posted {formatDateTime(ret.postedAt)}{ret.decidedByName ? ` — approved by ${ret.decidedByName}` : ' — posted as raised (the hospital posts returns directly)'}
                  </p>
                  {ret.decisionRemark && <p className="text-xs">{ret.decisionRemark}</p>}
                  <p className="text-xs">The goods are out of stock. Hand them over with debit note {ret.debitNoteNumber}.</p>
                </div>
              )}
              {ret.status === 'cancelled' && (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm"><span className="text-gray-500">Cancelled{ret.cancelledAt && ` on ${formatDateTime(ret.cancelledAt)}`}: </span>{ret.cancelReason}. Its goods were put back in stock.</p>
              )}

              {/* Where the money went — only for those who see money. */}
              {money && ret.status === 'posted' && (ret.bill ? (
                <div className={`rounded-md border px-3 py-2 text-sm ${ret.vendorOwes > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
                  <p>Set against bill <span className="font-mono font-medium">{ret.bill.number}</span> (vendor invoice {ret.bill.vendorInvoiceNumber}): {formatMoney(ret.total)} less to pay.</p>
                  {ret.vendorOwes > 0
                    ? <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" />The vendor owes the hospital {formatMoney(ret.vendorOwes)} on this bill — more was paid than is now due.</p>
                    : <p className="text-xs">Still to pay on the bill: {formatMoney(ret.stillToPay)}</p>}
                </div>
              ) : (
                <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">These goods were not billed yet — the vendor can no longer bill the order for them.</p>
              ))}

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Item</th>
                      <th className="text-left font-medium px-3 py-2">Batch · expiry</th>
                      <th className="text-right font-medium px-3 py-2">Quantity</th>
                      {money && <th className="text-right font-medium px-3 py-2">Rate</th>}
                      {money && <th className="text-right font-medium px-3 py-2">Amount</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {ret.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2"><div className="font-medium">{l.itemName}</div><div className="text-xs text-gray-500">{l.itemCode}</div></td>
                        <td className="px-3 py-2 whitespace-nowrap">{l.batchNumber || '—'}<div className="text-xs text-gray-500">{l.expiryDate ? `exp ${day(l.expiryDate)}` : 'no expiry'}</div></td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{l.quantity} {l.unitCode}{l.unitFactor !== 1 && <div className="text-[11px] text-gray-500">{l.stockQty} in stock units</div>}</td>
                        {money && <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatMoney(l.rate)}{ret.order?.gstType !== 'none' && <div className="text-[11px] text-gray-500">+ {l.gstRate}% GST</div>}</td>}
                        {money && <td className="px-3 py-2 text-right whitespace-nowrap font-medium tabular-nums">{formatMoney(l.lineTotal)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {money && (
                <dl className="ml-auto max-w-xs space-y-1 rounded-md bg-gray-50 p-3 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Value before GST</dt><dd className="tabular-nums">{formatMoney(ret.subtotal)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">GST</dt><dd className="tabular-nums">{formatMoney(ret.gstAmount)}</dd></div>
                  <div className="flex justify-between gap-4 border-t pt-1"><dt className="font-semibold">Debit note</dt><dd className="font-bold tabular-nums">{formatMoney(ret.total)}</dd></div>
                </dl>
              )}

              {asking && (
                <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3">
                  <Label htmlFor="ret-remark">{asking === 'approve' ? 'Remark (optional)' : asking === 'reject' ? 'Why is it rejected? *' : 'Why is it cancelled? *'}</Label>
                  <Textarea id="ret-remark" rows={2} autoFocus value={remark} onChange={(e) => setRemark(e.target.value)}
                    placeholder={asking === 'approve' ? 'e.g. Vendor agreed to take them back' : asking === 'reject' ? 'e.g. The damage is only on the outer box — use them' : 'e.g. The vendor refused the goods; they are back on the shelf'} />
                  {asking === 'approve' && <p className="text-xs text-gray-600">Approving takes the goods out of stock now and makes the debit note.</p>}
                  {asking === 'cancel' && <p className="text-xs text-gray-600">The goods go back on their batch and the debit note stops counting{money && ret.bill ? ` — ${formatMoney(ret.total)} is due again on ${ret.bill.number}` : ''}.</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAsking(null); setRemark('') }} disabled={!!busy}>Back</Button>
                    <Button size="sm" onClick={confirmAsked} disabled={!!busy || (needsText && remark.trim().length < 3)}
                      variant={asking === 'approve' ? 'default' : 'destructive'} className={asking === 'approve' ? 'bg-green-600 hover:bg-green-700' : undefined}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{asking === 'approve' ? 'Approve return' : asking === 'reject' ? 'Reject return' : 'Cancel return'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {!asking && (
              <DialogFooter className="gap-2 flex-wrap">
                {canCancel && <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy} onClick={() => setAsking('cancel')}><Ban className="h-4 w-4 mr-1" />Cancel return</Button>}
                {['posted', 'pending_approval'].includes(ret.status) && (
                  <Button variant="outline" onClick={() => printReturn(ret)}><Printer className="h-4 w-4 mr-1" />{ret.status === 'posted' && money ? 'Print debit note' : 'Print return note'}</Button>
                )}
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
