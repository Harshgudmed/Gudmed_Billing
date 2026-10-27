import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, CheckCircle2, XCircle, Pencil, Send, Trash2, RotateCcw, Ban, Printer, Truck, PackageCheck, PackageX, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime } from '@/lib/format'
import { ORDER_STATUS, RECEIPT_STATUS, GST_TYPE_LABEL, useMe, canDecide, ownsOrAdmin, showNotifyWarning } from './requestMeta'
import ApprovalTrail from './ApprovalTrail'
import { printOrder } from './orderPrint'

// One purchase order: the vendor, every line with its price and GST, the
// totals as the vendor charges them, and the approval trail. The buttons are
// the next step for this person and this status — Approve for an approver,
// "Mark as sent" once approved, Print to give the vendor, "Receive goods" when
// it arrives, "Close short" when the rest will not come. The store sees the
// order without its money (the server sends none).

const RECEIVING = ['sent', 'partly_received']

export default function OrderDetail({ id, open, onOpenChange, onEdit, onChanged, onReceive, onOpenReceipt, onMakeBill }) {
  const me = useMe()
  const [po, setPo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(null)
  const [asking, setAsking] = useState(null) // 'approve' | 'reject' | 'cancel' | 'close'
  const [remark, setRemark] = useState('')

  // Held in a ref: the list passes an inline arrow, and a new one on each of
  // its live refreshes must not re-open this dialog (that wiped a remark
  // being typed, and re-read the document).
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try { setPo((await purchaseApi.getOrder(id)).data) } catch (err) { showApiError(err, 'Could not open the order'); close.current(false) } finally { setLoading(false) }
  }, [id])
  useEffect(() => { if (open) { setAsking(null); setRemark(''); load() } }, [open, load])

  const run = async (key, call, message) => {
    setBusy(key)
    try {
      const r = await call()
      toast.success(typeof message === 'function' ? message(r?.data) : message)
      showNotifyWarning(r)
      setAsking(null); setRemark('')
      if (key === 'delete') onOpenChange(false); else setPo(r.data)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not complete that')
      load()
    } finally {
      setBusy(null)
    }
  }

  const owner = po && { requestedById: po.createdById }
  const mine = po && me.canOrder && ownsOrAdmin(me, owner)
  const decide = po && canDecide(me, { ...po, requestedById: po.createdById })
  const received = po?.lines.some((l) => l.receivedQty > 0)
  const status = po && (ORDER_STATUS[po.status] || ORDER_STATUS.draft)
  const needsText = asking === 'reject' || asking === 'close' || (asking === 'cancel' && po?.status !== 'draft')
  const money = me.seesMoney && po?.total !== undefined
  // Once goods can arrive, each line shows how much is in.
  const showReceived = po && ['sent', 'partly_received', 'received', 'closed'].includes(po.status)
  // Goods in that the vendor's bill has not covered yet.
  // The server's own rule for what is still billable (returns included).
  const toBill = po?.lines.some((l) => (l.billable ?? (l.receivedQty || 0) - (l.billedQty || 0)) > 1e-9)
  const missingRates = po?.status === 'draft' && money && po.lines.some((l) => !l.rate)

  const confirmAsked = () => {
    const text = remark.trim()
    if (asking === 'approve') return run('approve', () => purchaseApi.approveOrder(po.id, text), (d) => (d.status === 'approved' ? `${po.number} approved — mark it sent once the vendor has it` : `Level ${po.currentStep.level} approved — sent to the next level`))
    if (asking === 'reject') return run('reject', () => purchaseApi.rejectOrder(po.id, text), `${po.number} rejected`)
    if (asking === 'cancel') return run('cancel', () => purchaseApi.cancelOrder(po.id, text), `${po.number} cancelled — its items are back on the "ready to order" list`)
    if (asking === 'close') return run('close', () => purchaseApi.closeOrder(po.id, text), `${po.number} closed — nothing more is expected from ${po.vendorName}`)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        {loading || !po ? (
          <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{po.number}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
                <Badge variant="outline">{GST_TYPE_LABEL[po.gstType]}</Badge>
                {po.currency && po.currency !== 'INR' && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{po.currency} @ ₹{po.exchangeRate}</Badge>}
              </div>
              <DialogDescription>
                {po.vendorName} · made by {po.createdByName} on {formatDateTime(po.createdAt)}
                {po.expectedDate && <> · needed by {formatDateTime(po.expectedDate, { withTime: false })}</>}
                {po.sentAt && <> · sent {formatDateTime(po.sentAt)}</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {['cancelled', 'closed'].includes(po.status) && po.cancelReason && <p className="rounded-md bg-gray-50 px-3 py-2 text-sm"><span className="text-gray-500">{po.status === 'closed' ? 'Closed short' : 'Cancelled'}: </span>{po.cancelReason}</p>}
              {po.vendor && !po.vendor.gstNumber && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">This vendor is not GST-registered, so the order carries no GST.</p>}

              <div className="overflow-x-auto rounded-md border">
                <table className={`w-full text-sm ${money ? 'min-w-[720px]' : 'min-w-[480px]'}`}>
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Item</th>
                      <th className="text-right font-medium px-3 py-2">Qty</th>
                      {showReceived && <th className="text-right font-medium px-3 py-2">Received</th>}
                      {money && <>
                        <th className="text-right font-medium px-3 py-2">Rate</th>
                        <th className="text-right font-medium px-3 py-2">Disc</th>
                        <th className="text-right font-medium px-3 py-2">GST</th>
                        <th className="text-right font-medium px-3 py-2">Amount</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {po.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.itemName}</div>
                          <div className="text-xs text-gray-500">
                            {l.itemCode}{l.hsnCode && ` · HSN ${l.hsnCode}`}{l.unitFactor !== 1 && ` · 1 ${l.unitCode} = ${l.unitFactor}`}
                            {l.requestLine?.request && <> · from {l.requestLine.request.number}</>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{l.quantity} {l.unitCode}</td>
                        {showReceived && (
                          <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${l.receivedQty >= l.quantity ? 'text-green-700 font-medium' : l.receivedQty > 0 ? 'text-orange-700' : 'text-gray-500'}`}>
                            {l.receivedQty || 0}
                            {l.receivedQty < l.quantity && po.status !== 'closed' && <div className="text-[11px] text-gray-500">{Math.round((l.quantity - l.receivedQty) * 1000) / 1000} due</div>}
                            {money && l.billedQty > 0 && <div className="text-[11px] text-purple-700">{l.billedQty} billed</div>}
                          </td>
                        )}
                        {money && <>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.rate)}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{l.discountPct ? `${l.discountPct}%` : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{po.gstType === 'none' ? '—' : `${l.gstRate}%`}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(l.lineTotal)}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 text-sm">
                  {po.terms && <div><div className="text-xs font-semibold text-gray-500">Terms (printed)</div><p className="whitespace-pre-line">{po.terms}</p></div>}
                  {po.notes && <div><div className="text-xs font-semibold text-gray-500">Internal note</div><p>{po.notes}</p></div>}
                  {po.paymentTermsDays != null && <p className="text-gray-500">Payment: {po.paymentTermsDays} days from the invoice</p>}
                </div>
                {money && <dl className="self-start space-y-1.5 rounded-md bg-gray-50 p-4 text-sm">
                  <div className="flex justify-between"><dt className="text-gray-500">Subtotal</dt><dd className="tabular-nums">{formatMoney(po.subtotal)}</dd></div>
                  {po.gstType === 'intra' && <>
                    <div className="flex justify-between"><dt className="text-gray-500">CGST</dt><dd className="tabular-nums">{formatMoney(po.cgst)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-500">SGST</dt><dd className="tabular-nums">{formatMoney(po.sgst)}</dd></div>
                  </>}
                  {po.gstType === 'inter' && <div className="flex justify-between"><dt className="text-gray-500">IGST</dt><dd className="tabular-nums">{formatMoney(po.igst)}</dd></div>}
                  <div className="flex justify-between border-t pt-2"><dt className="font-semibold">Order total</dt><dd className="text-xl font-bold tabular-nums">{formatMoney(po.total)}</dd></div>
                  {po.currency && po.currency !== 'INR' && po.exchangeRate > 0 && (
                    <div className="flex justify-between text-sm"><dt className="text-gray-500">= quoted in {po.currency}</dt><dd className="tabular-nums text-gray-600">{(po.total / po.exchangeRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
                  )}
                </dl>}
              </div>

              {po.receipts?.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Goods received</h3>
                  <ul className="divide-y rounded-md border">
                    {po.receipts.map((g) => {
                      const s = RECEIPT_STATUS[g.status] || RECEIPT_STATUS.posted
                      return (
                        <li key={g.id}>
                          <button type="button" onClick={() => onOpenReceipt?.(g.id)} disabled={!onOpenReceipt}
                            className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:hover:bg-transparent">
                            <span>
                              <span className="font-mono font-medium text-blue-700">{g.number}</span>
                              <span className="text-gray-500"> · {formatDateTime(g.receivedAt)} · {g.receivedByName}{g.challanNumber && ` · challan ${g.challanNumber}`}</span>
                            </span>
                            <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {missingRates && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
                  <span className="text-lg leading-none mt-0.5">⚠️</span>
                  <div>
                    <p className="font-semibold">Prices missing — order cannot be sent yet</p>
                    <p className="mt-0.5">Click <strong>Edit</strong> to enter the rate for each item. An order must have prices before it goes for approval.</p>
                  </div>
                </div>
              )}

              <ApprovalTrail steps={po.steps} currentStepId={po.currentStep?.id}
                emptyText={po.status === 'draft' ? 'Not sent for approval yet. The levels are worked out from the total when it is sent.'
                  : ['approved', 'sent', 'partly_received', 'received', 'closed'].includes(po.status) ? 'Approved on sending — the total is under every approval limit.' : 'No approval steps.'} />

              {asking && (
                <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3">
                  <Label htmlFor="po-remark">{asking === 'approve' ? 'Remark (optional)' : asking === 'reject' ? 'Why is it rejected? *' : asking === 'close' ? 'Why will the rest not come? *' : `Why is it cancelled?${needsText ? ' *' : ''}`}</Label>
                  <Textarea id="po-remark" rows={2} autoFocus value={remark} onChange={(e) => setRemark(e.target.value)}
                    placeholder={asking === 'reject' ? 'e.g. Rate is higher than the last order' : asking === 'cancel' ? 'e.g. Vendor cannot supply' : asking === 'close' ? 'e.g. Vendor has stopped making this model' : ''} />
                  {asking === 'close' && <p className="text-xs text-gray-600">What has arrived stays in stock. Nothing more can be received on this order.</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAsking(null); setRemark('') }} disabled={!!busy}>Back</Button>
                    <Button size="sm" onClick={confirmAsked} disabled={!!busy || (needsText && remark.trim().length < 3)} variant={asking === 'approve' ? 'default' : 'destructive'}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{asking === 'approve' ? 'Approve' : asking === 'reject' ? 'Reject order' : asking === 'close' ? 'Close order' : 'Cancel order'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {!asking && (
              <DialogFooter className="gap-2 flex-wrap">
                {po.status === 'draft' && mine && (
                  <>
                    <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy}
                      onClick={() => window.confirm(`Delete draft ${po.number}? Its items go back to "ready to order".`) && run('delete', () => purchaseApi.deleteOrder(po.id), `${po.number} deleted`)}>
                      <Trash2 className="h-4 w-4 mr-1" />Delete draft
                    </Button>
                    <Button variant={missingRates ? 'default' : 'outline'} disabled={!!busy} onClick={() => onEdit?.(po)}><Pencil className="h-4 w-4 mr-1" />{missingRates ? 'Edit — add prices' : 'Edit'}</Button>
                    <Button variant={missingRates ? 'outline' : 'default'} disabled={!!busy} onClick={() => run('submit', () => purchaseApi.submitOrder(po.id), (d) => (d.status === 'approved' ? `${po.number} approved — under every approval limit` : `${po.number} sent for approval`))}>
                      {busy === 'submit' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}Send for approval
                    </Button>
                  </>
                )}
                {['submitted', 'approved', 'sent', 'rejected'].includes(po.status) && mine && !received && (
                  <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy} onClick={() => setAsking('cancel')}><Ban className="h-4 w-4 mr-1" />Cancel order</Button>
                )}
                {decide && (
                  <>
                    <Button variant="outline" className="text-red-700 border-red-200" disabled={!!busy} onClick={() => setAsking('reject')}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
                    <Button className="bg-green-600 hover:bg-green-700" disabled={!!busy} onClick={() => setAsking('approve')}><CheckCircle2 className="h-4 w-4 mr-1" />Approve level {po.currentStep.level}</Button>
                  </>
                )}
                {po.status === 'rejected' && mine && (
                  <Button variant="outline" disabled={!!busy} onClick={() => run('reopen', () => purchaseApi.reopenOrder(po.id), `${po.number} is a draft again — change it and send it`)}><RotateCcw className="h-4 w-4 mr-1" />Reopen to correct</Button>
                )}
                {po.status === 'partly_received' && me.canOrder && (
                  <Button variant="ghost" className="text-slate-700 sm:mr-auto" disabled={!!busy} onClick={() => setAsking('close')}><PackageX className="h-4 w-4 mr-1" />Close short</Button>
                )}
                {po.status !== 'draft' && po.status !== 'cancelled' && money && (
                  <Button variant="outline" onClick={() => printOrder(po)}><Printer className="h-4 w-4 mr-1" />Print / PDF</Button>
                )}
                {po.status === 'approved' && me.canOrder && (
                  <Button disabled={!!busy} onClick={() => run('send', () => purchaseApi.sendOrder(po.id), `${po.number} marked as sent to ${po.vendorName}`)}>
                    {busy === 'send' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Truck className="h-4 w-4 mr-1" />}Mark as sent to vendor
                  </Button>
                )}
                {toBill && me.canBill && onMakeBill && (
                  <Button variant="outline" disabled={!!busy} onClick={() => onMakeBill(po)}><Receipt className="h-4 w-4 mr-1" />Enter vendor bill</Button>
                )}
                {RECEIVING.includes(po.status) && me.canReceive && onReceive && (
                  <Button className="bg-green-600 hover:bg-green-700" disabled={!!busy} onClick={() => onReceive(po)}><PackageCheck className="h-4 w-4 mr-1" />Receive goods</Button>
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
