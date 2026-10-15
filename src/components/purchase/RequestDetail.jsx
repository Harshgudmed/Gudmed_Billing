import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, CheckCircle2, XCircle, Pencil, Send, Trash2, RotateCcw, Ban, PackagePlus, MailQuestion } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime } from '@/lib/format'
import { STATUS, PRIORITY, ORDER_STATUS, useMe, canDecide, ownsOrAdmin, showNotifyWarning } from './requestMeta'
import ApprovalTrail from './ApprovalTrail'

// One purchase request: what was asked for, and the approval trail — each
// level, who acted, when, and what they said. The buttons at the bottom are
// only the ones this person may use on this request right now.

// Where a line went: the order it is on, how that order stands, and how much
// of the line has come. A request stays "Ordered" when its order is closed
// short, so this is where the shortfall is told. The server sends quantities
// only, and no number for someone else's draft order.
function LineOrder({ o }) {
  if (!o.number) return <div className="mt-1 text-xs text-gray-500">On an order being prepared</div>
  const s = ORDER_STATUS[o.status] || ORDER_STATUS.draft
  const counted = o.status === 'partly_received' || o.status === 'closed'
  const notComing = o.status === 'closed' && o.receivedQty < o.quantity
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-600">
      <span>On <span className="font-mono">{o.number}</span></span>
      <Badge variant="outline" className={`px-1.5 py-0 text-[11px] font-normal ${s.cls}`}>{s.label}</Badge>
      {counted && <span>{o.receivedQty} of {o.quantity} {o.unitCode} received</span>}
      {notComing && <span className="font-medium text-amber-800">— the rest is not coming</span>}
    </div>
  )
}

export default function RequestDetail({ id, open, onOpenChange, onEdit, onChanged, onMakeOrder, onMakeRfq }) {
  const me = useMe()
  // The store reads its requests in quantities: the server sends it no prices.
  const money = me.seesMoney
  const [pr, setPr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(null)
  // 'approve' | 'reject' | 'cancel' — the action waiting for its remark
  const [asking, setAsking] = useState(null)
  const [remark, setRemark] = useState('')

  // Held in a ref: the list passes an inline arrow, and a new one on each of
  // its live refreshes must not re-open this dialog (that wiped a remark
  // being typed, and re-read the document).
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      setPr((await purchaseApi.getRequest(id)).data)
    } catch (err) {
      showApiError(err, 'Could not open the request')
      close.current(false)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { if (open) { setAsking(null); setRemark(''); load() } }, [open, load])

  const run = async (key, call, message) => {
    setBusy(key)
    try {
      const r = await call()
      toast.success(typeof message === 'function' ? message(r?.data) : message)
      showNotifyWarning(r)
      setAsking(null)
      setRemark('')
      if (key === 'delete') { onOpenChange(false) } else { setPr(r.data) }
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not complete that')
      load() // someone else may have acted first — show what is true now
    } finally {
      setBusy(null)
    }
  }

  const status = pr && (STATUS[pr.status] || STATUS.draft)
  const mine = pr && ownsOrAdmin(me, pr)
  const decide = pr && canDecide(me, pr)

  const confirmAsked = () => {
    const text = remark.trim()
    if (asking === 'approve') return run('approve', () => purchaseApi.approveRequest(pr.id, text),
      (d) => (d.status === 'approved' ? `${pr.number} approved` : `Level ${pr.currentStep.level} approved — sent to the next level`))
    if (asking === 'reject') return run('reject', () => purchaseApi.rejectRequest(pr.id, text), `${pr.number} rejected`)
    if (asking === 'cancel') return run('cancel', () => purchaseApi.cancelRequest(pr.id, text), `${pr.number} cancelled`)
  }
  // A reason is required to reject, and to cancel something approvers already see.
  const needsText = asking === 'reject' || (asking === 'cancel' && pr?.status === 'submitted')

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        {loading || !pr ? (
          <div className="flex items-center justify-center py-16 text-gray-500"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading…</div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{pr.number}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
                {pr.priority !== 'normal' && <Badge variant="outline" className={PRIORITY[pr.priority]?.cls}>{PRIORITY[pr.priority]?.label}</Badge>}
              </div>
              <DialogDescription>
                {pr.department?.name} · raised by {pr.requestedByName} on {formatDateTime(pr.createdAt)}
                {pr.requiredBy && <> · needed by {formatDateTime(pr.requiredBy, { withTime: false })}</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {pr.purpose && <p className="rounded-md bg-gray-50 px-3 py-2 text-sm"><span className="text-gray-500">Why: </span>{pr.purpose}</p>}
              {pr.status === 'cancelled' && pr.cancelReason && (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm"><span className="text-gray-500">Cancelled: </span>{pr.cancelReason}</p>
              )}

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Item</th>
                      <th className="text-right font-medium px-3 py-2">Qty</th>
                      {money && <th className="text-right font-medium px-3 py-2">Est. rate</th>}
                      <th className="text-right font-medium px-3 py-2">GST</th>
                      {money && <th className="text-right font-medium px-3 py-2">Amount</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pr.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.itemName}</div>
                          <div className="text-xs text-gray-500">
                            {l.itemCode}{l.unitFactor !== 1 && ` · 1 ${l.unitCode} = ${l.unitFactor}`}{l.note && ` · ${l.note}`}
                          </div>
                          {l.orders?.map((o, k) => <LineOrder key={o.number || `draft-${k}`} o={o} />)}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{l.quantity} {l.unitCode}</td>
                        {money && <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.estimatedRate)}</td>}
                        <td className="px-3 py-2 text-right text-gray-500">{l.gstRate}%</td>
                        {money && <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(l.lineTotal)}</td>}
                      </tr>
                    ))}
                    {pr.lines.length === 0 && <tr><td colSpan={money ? 5 : 3} className="px-3 py-6 text-center text-gray-400">No items yet</td></tr>}
                  </tbody>
                  {money && (
                    <tfoot>
                      <tr className="border-t bg-gray-50">
                        <td colSpan={4} className="px-3 py-2 text-right text-gray-500">Estimated total, with GST</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">{formatMoney(pr.estimatedTotal)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              <ApprovalTrail steps={pr.steps} currentStepId={pr.currentStep?.id}
                emptyText={pr.status === 'draft' ? 'Not sent yet. The levels needed are worked out when it is sent.'
                  : pr.status === 'approved' ? 'Approved on sending — the amount is under every approval limit.' : 'No approval steps.'} />

              {asking && (
                <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3">
                  <Label htmlFor="pr-remark">
                    {asking === 'approve' ? 'Remark (optional)' : asking === 'reject' ? 'Why is it rejected? *' : `Why is it cancelled?${needsText ? ' *' : ''}`}
                  </Label>
                  <Textarea id="pr-remark" rows={2} autoFocus value={remark} onChange={(e) => setRemark(e.target.value)}
                    placeholder={asking === 'reject' ? 'e.g. Stock is enough for this month' : ''} />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAsking(null); setRemark('') }} disabled={!!busy}>Back</Button>
                    <Button size="sm" onClick={confirmAsked} disabled={!!busy || (needsText && remark.trim().length < 3)}
                      variant={asking === 'approve' ? 'default' : 'destructive'}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {asking === 'approve' ? 'Approve' : asking === 'reject' ? 'Reject request' : 'Cancel request'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {!asking && (
              <DialogFooter className="gap-2 flex-wrap">
                {pr.status === 'draft' && mine && (
                  <>
                    <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy}
                      onClick={() => window.confirm(`Delete draft ${pr.number}?`) && run('delete', () => purchaseApi.deleteRequest(pr.id), `${pr.number} deleted`)}>
                      <Trash2 className="h-4 w-4 mr-1" />Delete draft
                    </Button>
                    <Button variant="outline" disabled={!!busy} onClick={() => onEdit?.(pr)}><Pencil className="h-4 w-4 mr-1" />Edit</Button>
                    <Button disabled={!!busy} onClick={() => run('submit', () => purchaseApi.submitRequest(pr.id),
                      (d) => (d.status === 'approved' ? `${pr.number} approved — under every approval limit` : `${pr.number} sent for approval`))}>
                      {busy === 'submit' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}Send for approval
                    </Button>
                  </>
                )}
                {pr.status === 'submitted' && mine && (
                  <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy} onClick={() => setAsking('cancel')}>
                    <Ban className="h-4 w-4 mr-1" />Cancel request
                  </Button>
                )}
                {decide && (
                  <>
                    <Button variant="outline" className="text-red-700 border-red-200" disabled={!!busy} onClick={() => setAsking('reject')}>
                      <XCircle className="h-4 w-4 mr-1" />Reject
                    </Button>
                    <Button className="bg-green-600 hover:bg-green-700" disabled={!!busy} onClick={() => setAsking('approve')}>
                      <CheckCircle2 className="h-4 w-4 mr-1" />Approve level {pr.currentStep.level}
                    </Button>
                  </>
                )}
                {/* Approved: ask vendors for price first. Once RFQ is awarded the PO is made automatically. */}
                {pr.status === 'approved' && me.canRfq && onMakeRfq && (
                  <Button onClick={() => onMakeRfq(pr)}><MailQuestion className="h-4 w-4 mr-1" />Ask vendors for price (RFQ)</Button>
                )}
                {pr.status === 'rejected' && mine && (
                  <Button variant="outline" disabled={!!busy} onClick={() => run('reopen', () => purchaseApi.reopenRequest(pr.id), `${pr.number} is a draft again — change it and send it`)}>
                    <RotateCcw className="h-4 w-4 mr-1" />Reopen to correct
                  </Button>
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
