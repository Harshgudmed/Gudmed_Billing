import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Ban, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { indentApi } from '@/api/purchaseIndentApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime } from '@/lib/format'
import { gudmedDocument, infoBox, escapeHtml, printViaIframe } from '@/lib/printTemplate'
import { ISSUE_STATUS, qtyText } from '@/components/store-indent/indentMeta'
import { useMe, showNotifyWarning } from './requestMeta'

// One store issue: what left the store for which department, batch by batch
// (oldest expiry first), and who collected it. The slip prints on the
// hospital's letterhead. An administrator may cancel it: the goods go back to
// the batches they came from and are due on the indent again. The cost is
// shown to those who see money — the server sends the store none.

/** The printed issue slip — signed by whoever handed the goods over and whoever took them. */
export function printIssue(iss) {
  const money = iss.totalValue !== undefined
  const date = (d) => (d ? formatDateTime(d, { withTime: false }) : '—')
  const rows = iss.lines.map((l, i) => `<tr>
    <td>${i + 1}</td>
    <td>${escapeHtml(l.itemName)}<br><span style="color:#666;font-size:8pt">${escapeHtml(l.itemCode)}</span></td>
    <td>${escapeHtml(l.batchNumber || '—')}</td>
    <td>${date(l.expiryDate)}</td>
    <td style="text-align:right"><b>${escapeHtml(qtyText(l.quantity, l.unitCode))}</b></td>
    ${money ? `<td style="text-align:right">${formatMoney(l.stockQty * l.unitCost)}</td>` : ''}
  </tr>`).join('')
  const body = `
${infoBox('Issued to', [
    { label: 'Department', value: iss.department?.name || '—' },
    { label: 'Against indent', value: iss.indent?.number || '—' },
    { label: 'Indent raised by', value: iss.indent?.requestedByName || '—' },
    { label: 'Collected by', value: iss.receivedByName || '—' },
    ...(iss.assignedToName ? [{ label: 'Assigned to', value: iss.assignedToName }] : []),
  ])}
${infoBox('Issue', [
    { label: 'Issue number', value: iss.number },
    { label: 'Issued on', value: formatDateTime(iss.issuedAt) },
    { label: 'Issued by', value: iss.issuedByName },
    { label: 'Status', value: (ISSUE_STATUS[iss.status] || ISSUE_STATUS.posted).label },
  ])}
${iss.status === 'cancelled' ? `<div class="note-bar"><b>CANCELLED</b> by ${escapeHtml(iss.cancelledByName || '')}: ${escapeHtml(iss.cancelReason || '')}</div>` : ''}
<table>
  <thead><tr><th>#</th><th>Item</th><th>Batch</th><th>Expiry</th><th style="text-align:right">Quantity</th>${money ? '<th style="text-align:right">Cost</th>' : ''}</tr></thead>
  <tbody>${rows}</tbody>
  ${money ? `<tfoot><tr><td colspan="5" style="text-align:right">Cost of goods issued (before GST)</td><td style="text-align:right">${formatMoney(iss.totalValue)}</td></tr></tfoot>` : ''}
</table>
${iss.notes ? `<div class="note-bar"><b>Note:</b> ${escapeHtml(iss.notes)}</div>` : ''}
  <div class="signature-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
    <div class="signature-cell">Issued by (store)</div>
    <div class="signature-cell">Received by (${escapeHtml(iss.department?.name || 'department')})</div>
</div>`
  printViaIframe(gudmedDocument({
    orgInfo: { name: iss.hospital?.name, address: iss.hospital?.address, city: iss.hospital?.city },
    title: iss.number, banner: 'STORE ISSUE SLIP', subtitle: 'Stores',
    headerRight: `${escapeHtml(iss.number)}<br>${formatDateTime(iss.issuedAt, { withTime: false })}`,
    body, variant: 'purchase',
  }))
}

export default function IssueDetail({ id, open, onOpenChange, onChanged }) {
  const me = useMe()
  const [iss, setIss] = useState(null)
  const [loading, setLoading] = useState(false)
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  // Held in a ref: a parent's live refresh passes a new arrow and must not re-open this.
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try { setIss((await indentApi.getIssue(id)).data) } catch (err) { showApiError(err, 'Could not open the issue'); close.current(false) } finally { setLoading(false) }
  }, [id])
  useEffect(() => { if (open) { setAsking(false); setReason(''); load() } }, [open, load])

  const cancel = async () => {
    setBusy(true)
    try {
      const r = await indentApi.cancelIssue(iss.id, reason.trim())
      setIss((x) => ({ ...x, ...r.data }))
      toast.success(`${iss.number} cancelled — its goods are back in the store${iss.indent ? ` and due on ${iss.indent.number} again` : ''}`)
      showNotifyWarning(r)
      setAsking(false)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not cancel the issue')
    } finally {
      setBusy(false)
    }
  }

  const status = iss && (ISSUE_STATUS[iss.status] || ISSUE_STATUS.posted)
  const money = iss && iss.totalValue !== undefined

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        {loading || !iss ? (
          <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{iss.number}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
              </div>
              <DialogDescription>
                To {iss.department?.name}{iss.indent && <> · against <span className="font-mono">{iss.indent.number}</span></>} · {formatDateTime(iss.issuedAt)} by {iss.issuedByName} · collected by {iss.receivedByName || '—'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {iss.status === 'cancelled' && (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm">
                  <span className="text-gray-500">Cancelled by {iss.cancelledByName} on {formatDateTime(iss.cancelledAt)}: </span>{iss.cancelReason}
                </p>
              )}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[540px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Item</th>
                      <th className="text-left font-medium px-3 py-2">Batch · expiry</th>
                      <th className="text-right font-medium px-3 py-2">Given</th>
                      {money && <th className="text-right font-medium px-3 py-2">Cost</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {iss.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2"><div className="font-medium">{l.itemName}</div><div className="text-xs text-gray-500">{l.itemCode}</div></td>
                        <td className="px-3 py-2">
                          {l.batchNumber || <span className="text-gray-400">No batch no.</span>}
                          {l.expiryDate && <div className="text-xs text-gray-500">Exp {formatDateTime(l.expiryDate, { withTime: false })}</div>}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap font-semibold tabular-nums">
                          {qtyText(l.quantity, l.unitCode)}
                          {l.unitFactor !== 1 && <div className="text-xs font-normal text-gray-500">{l.stockQty} out of stock</div>}
                        </td>
                        {money && <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.stockQty * l.unitCost)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {money && (
                <div className="flex justify-end text-sm"><span className="text-gray-500 mr-3">Cost of goods issued, before GST</span><span className="font-bold tabular-nums">{formatMoney(iss.totalValue)}</span></div>
              )}
              {iss.notes && <p className="text-sm"><span className="text-gray-500">Note: </span>{iss.notes}</p>}

              {asking && (
                <div className="space-y-2 rounded-md border border-red-200 bg-red-50/40 p-3">
                  <Label htmlFor="iss-reason">Why is it cancelled? *</Label>
                  <Textarea id="iss-reason" rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered against the wrong indent; goods came back unused" />
                  <p className="text-xs text-gray-600">The goods go back to the batches they came from{iss.indent ? ` and are due on ${iss.indent.number} again` : ''}.</p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAsking(false); setReason('') }} disabled={busy}>Back</Button>
                    <Button variant="destructive" size="sm" onClick={cancel} disabled={busy || reason.trim().length < 3}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Cancel issue
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              {me.isAdmin && iss.status === 'posted' && !asking && (
                <Button variant="outline" className="text-red-600" onClick={() => setAsking(true)}><Ban className="h-4 w-4 mr-2" />Cancel issue</Button>
              )}
              <Button variant="outline" onClick={() => printIssue(iss)}><Printer className="h-4 w-4 mr-2" />Print slip</Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
