import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Ban, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime } from '@/lib/format'
import { RECEIPT_STATUS, useMe, showNotifyWarning } from './requestMeta'
import { printReceipt } from './orderPrint'

// One goods receipt (GRN): what came against which order, what was accepted
// into stock and what was turned back. An administrator can cancel it — the
// goods come back out of stock and are due on the order again — as long as
// none of them has left the store.

export default function ReceiptDetail({ id, open, onOpenChange, onChanged, onOpenOrder }) {
  const me = useMe()
  const [grn, setGrn] = useState(null)
  const [loading, setLoading] = useState(false)
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  // Held in a ref: the list passes an inline arrow, and a new one on each of
  // its live refreshes must not re-open this dialog (that wiped a remark
  // being typed, and re-read the document).
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try { setGrn((await purchaseApi.getReceipt(id)).data) } catch (err) { showApiError(err, 'Could not open the receipt'); close.current(false) } finally { setLoading(false) }
  }, [id])
  useEffect(() => { if (open) { setAsking(false); setReason(''); load() } }, [open, load])

  const cancel = async () => {
    setBusy(true)
    try {
      const r = await purchaseApi.cancelReceipt(grn.id, reason.trim())
      setGrn((g) => ({ ...g, ...r.data }))
      toast.success(`${grn.number} cancelled — its goods are out of stock and due on ${grn.order?.number} again`)
      showNotifyWarning(r)
      setAsking(false)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not cancel the receipt')
    } finally {
      setBusy(false)
    }
  }

  const status = grn && (RECEIPT_STATUS[grn.status] || RECEIPT_STATUS.posted)
  const money = grn && grn.totalValue !== undefined

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        {loading || !grn ? (
          <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{grn.number}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
              </div>
              <DialogDescription>
                {grn.vendorName} · against{' '}
                {onOpenOrder
                  ? <button type="button" className="font-mono text-blue-700 hover:underline" onClick={() => onOpenOrder(grn.order.id)}>{grn.order?.number}</button>
                  : <span className="font-mono">{grn.order?.number}</span>}
                {' '}· received {formatDateTime(grn.receivedAt)} by {grn.receivedByName}
                {grn.challanNumber && <> · challan {grn.challanNumber}{grn.challanDate && ` of ${formatDateTime(grn.challanDate, { withTime: false })}`}</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {grn.status === 'cancelled' && (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm">
                  <span className="text-gray-500">Cancelled by {grn.cancelledByName} on {formatDateTime(grn.cancelledAt)}: </span>{grn.cancelReason}
                </p>
              )}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Item</th>
                      <th className="text-right font-medium px-3 py-2">Arrived</th>
                      <th className="text-right font-medium px-3 py-2">Rejected</th>
                      <th className="text-right font-medium px-3 py-2">Accepted</th>
                      <th className="text-left font-medium px-3 py-2">Batch · expiry</th>
                      {money && <th className="text-right font-medium px-3 py-2">Value</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {grn.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.itemName}</div>
                          <div className="text-xs text-gray-500">{l.itemCode}{l.stockQty > 0 && l.unitFactor !== 1 && <> · {l.stockQty} into stock</>}</div>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{l.receivedQty} {l.unitCode}</td>
                        <td className="px-3 py-2 text-right">
                          {l.rejectedQty ? <><span className="tabular-nums text-red-700">{l.rejectedQty}</span><div className="text-xs text-gray-500">{l.rejectReason}</div></> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{l.acceptedQty}</td>
                        <td className="px-3 py-2 text-sm">
                          {l.batchNumber || <span className="text-gray-400">No batch</span>}
                          {l.expiryDate && <div className="text-xs text-gray-500">Exp {formatDateTime(l.expiryDate, { withTime: false })}</div>}
                        </td>
                        {money && <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.acceptedQty * l.rate)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {money && (
                <div className="flex justify-end text-sm">
                  <span className="text-gray-500 mr-3">Value accepted, before GST</span><span className="font-bold tabular-nums">{formatMoney(grn.totalValue)}</span>
                </div>
              )}
              {grn.notes && <p className="text-sm"><span className="text-gray-500">Note: </span>{grn.notes}</p>}

              {asking && (
                <div className="space-y-2 rounded-md border border-red-200 bg-red-50/40 p-3">
                  <Label htmlFor="grn-reason">Why is it cancelled? *</Label>
                  <Textarea id="grn-reason" rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice, wrong order chosen" />
                  <p className="text-xs text-gray-600">Its accepted goods come out of stock and are due on {grn.order?.number} again.</p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAsking(false); setReason('') }} disabled={busy}>Back</Button>
                    <Button variant="destructive" size="sm" onClick={cancel} disabled={busy || reason.trim().length < 3}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Cancel receipt
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {!asking && (
              <DialogFooter className="gap-2 flex-wrap">
                {me.isAdmin && grn.status === 'posted' && (
                  <Button variant="ghost" className="text-red-600 sm:mr-auto" onClick={() => setAsking(true)}><Ban className="h-4 w-4 mr-1" />Cancel receipt</Button>
                )}
                <Button variant="outline" onClick={() => printReceipt(grn)}><Printer className="h-4 w-4 mr-1" />Print GRN</Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
