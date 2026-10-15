import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Pencil, Send, Trash2, Ban, Printer, Mail, MailX, MailCheck, Award, ClipboardEdit, AlertTriangle, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { rfqApi } from '@/api/purchaseRfqApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime } from '@/lib/format'
import { GST_TYPE_LABEL, ORDER_STATUS, useMe, showNotifyWarning } from './requestMeta'
import RfqQuoteDialog from './RfqQuoteDialog'
import { printRfq } from './rfqPrint'

// One request for quotation: what is asked, of whom, what each vendor answered,
// and the comparison — every item side by side at its landed cost per unit
// (rate less discount plus GST), the lowest marked, each vendor's total for the
// items it can supply and its delivery time. The award is made from the
// comparison; it makes the purchase order. The server works out the comparison
// and refuses the same things the buttons hide.

export const RFQ_STATUS = {
  draft:     { label: 'Draft',            cls: 'border-gray-200 bg-gray-50 text-gray-700' },
  open:      { label: 'Out with vendors', cls: 'border-blue-200 bg-blue-50 text-blue-700' },
  awarded:   { label: 'Awarded',          cls: 'border-green-200 bg-green-50 text-green-700' },
  cancelled: { label: 'Cancelled',        cls: 'border-gray-200 bg-white text-gray-500' },
}
const VENDOR_STATUS = {
  invited:  { label: 'Waiting for quote', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  quoted:   { label: 'Quoted',            cls: 'border-green-200 bg-green-50 text-green-700' },
  declined: { label: 'Declined',          cls: 'border-gray-200 bg-white text-gray-500' },
}
const day = (v) => formatDateTime(v, { withTime: false })

/** What sending did, for the toast: sent, and who was (not) e-mailed. */
export function sentText(r) {
  const rfq = r?.data
  if (!rfq) return 'Sent'
  const base = `${rfq.number} is out with ${rfq.vendors.length} vendors`
  if (!rfq.email?.on) return `${base}. E-mailing vendors is off — print it or send it yourself.`
  if (!r.emailed) return base
  return r.emailed.failed ? `${base}. E-mailed ${r.emailed.sent}; ${r.emailed.failed} not e-mailed — see why on the RFQ.` : `${base}. E-mailed to all ${r.emailed.sent}.`
}

export default function RfqDetail({ id, open, onOpenChange, onEdit, onChanged, onAwardDone }) {
  const me = useMe()
  const [rfq, setRfq] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(null)
  const [asking, setAsking] = useState(null) // 'cancel' | { award: rfqVendorId }
  const [text, setText] = useState('')
  const [quoting, setQuoting] = useState(null) // the RfqVendor whose quote is being entered

  // The list passes an inline arrow; a live refresh must not re-open this (see OrderDetail).
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try { setRfq((await rfqApi.get(id)).data) } catch (err) { showApiError(err, 'Could not open the RFQ'); close.current(false) } finally { setLoading(false) }
  }, [id])
  useEffect(() => { if (open) { setAsking(null); setText(''); setRfq(null); load() } }, [open, load])

  const run = async (key, call, message) => {
    setBusy(key)
    try {
      const r = await call()
      toast.success(typeof message === 'function' ? message(r) : message)
      showNotifyWarning(r)
      setAsking(null); setText('')
      if (key === 'delete') onOpenChange(false); else setRfq(r.data)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not complete that')
      load()
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null
  const mine = rfq && me.canRfq && (me.isAdmin || (!!me.id && me.id === rfq.createdById))
  const isOpen = rfq?.status === 'open'
  const st = rfq && (RFQ_STATUS[rfq.status] || RFQ_STATUS.draft)
  const quoted = rfq ? rfq.vendors.filter((v) => v.status === 'quoted') : []
  const cmp = rfq?.comparison
  const awardTo = asking?.award && rfq.vendors.find((v) => v.id === asking.award)
  const cheaper = awardTo ? rfq.cheaper[awardTo.id] || [] : []
  const needsReason = asking === 'cancel' ? isOpen : cheaper.length > 0
  const nameOf = (rfqVendorId) => rfq.vendors.find((v) => v.id === rfqVendorId)?.vendorName

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        {loading || !rfq ? (
          <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{rfq.number}</DialogTitle>
                <Badge variant="outline" className={st.cls}>{st.label}</Badge>
              </div>
              <DialogDescription>
                <span className="font-medium text-gray-800">{rfq.title}</span> · made by {rfq.createdByName} on {day(rfq.createdAt)}
                {rfq.dueDate && <> · quotes due {day(rfq.dueDate)}</>}
                {rfq.sentAt && <> · sent {formatDateTime(rfq.sentAt)}</>}
                {rfq.request && <> · from {rfq.request.number} ({rfq.request.department?.name})</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {rfq.status === 'cancelled' && rfq.cancelReason && <p className="rounded-md bg-gray-50 px-3 py-2 text-sm"><span className="text-gray-500">Cancelled: </span>{rfq.cancelReason}</p>}
              {rfq.status === 'awarded' && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
                  <Trophy className="mr-1 inline h-4 w-4" />Awarded to <b>{rfq.vendors.find((v) => v.vendorId === rfq.awardedVendorId)?.vendorName}</b> on {formatDateTime(rfq.awardedAt)}
                  {rfq.order && <> — purchase order <b className="font-mono">{rfq.order.number}</b> ({(ORDER_STATUS[rfq.order.status] || ORDER_STATUS.draft).label}{rfq.order.status === 'draft' ? ': open it on the Orders tab, check it and send it for approval' : ''})</>}
                  {rfq.awardNote && <div className="mt-1"><span className="text-green-700">Why this vendor: </span>{rfq.awardNote}</div>}
                </div>
              )}
              {isOpen && (rfq.email.on
                ? rfq.email.problem && <p role="status" className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{rfq.email.problem}. Vendors were not e-mailed — print the RFQ or send it yourself.</p>
                : <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">E-mailing RFQs to vendors is off for this hospital (Settings → Purchase). Print it or send it yourself, then enter each vendor's rates here.</p>)}

              <section>
                <h3 className="mb-2 text-sm font-semibold">Vendors asked</h3>
                <ul className="divide-y rounded-md border">
                  {rfq.vendors.map((v) => {
                    const vs = VENDOR_STATUS[v.status] || VENDOR_STATUS.invited
                    return (
                      <li key={v.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{v.vendorName}</span>
                            <Badge variant="outline" className={vs.cls}>{vs.label}</Badge>
                            <Badge variant="outline">{GST_TYPE_LABEL[v.gstType]}</Badge>
                          </div>
                          <div className="text-xs text-gray-500">
                            {v.vendor?.email || 'no e-mail address'}{v.vendor?.phone && ` · ${v.vendor.phone}`}
                            {v.status === 'quoted' && <> · delivery {v.deliveryDays != null ? `${v.deliveryDays} day${v.deliveryDays === 1 ? '' : 's'}` : 'not given'}{v.validTill && ` · valid till ${day(v.validTill)}`}</>}
                            {v.notes && ` · ${v.notes}`}
                          </div>
                          {rfq.status !== 'draft' && (v.emailedAt || v.emailError) && (
                            <div className={`mt-0.5 flex items-start gap-1 text-xs ${v.emailError ? 'text-red-700' : 'text-green-700'}`}>
                              {v.emailError ? <MailX className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <MailCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                              <span>{v.emailedAt && `E-mailed ${formatDateTime(v.emailedAt)}`}{v.emailedAt && v.emailError && ' · last re-send failed: '}{v.emailError && (v.emailedAt ? v.emailError : `Not e-mailed: ${v.emailError}`)}</span>
                            </div>
                          )}
                        </div>
                        {isOpen && me.canRfq && (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            {rfq.email.on && v.status !== 'declined' && v.vendor?.email && (
                              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(`mail-${v.id}`, () => rfqApi.email(rfq.id, v.id), (r) => (r.emailed?.sent ? `E-mailed ${v.vendorName}` : `${v.vendorName} was not e-mailed — see why under its name`))}>
                                {busy === `mail-${v.id}` ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Mail className="h-4 w-4 mr-1" />}{v.emailedAt ? 'Re-send e-mail' : 'Send e-mail'}
                              </Button>
                            )}
                            <Button size="sm" variant={v.status === 'invited' ? 'default' : 'outline'} disabled={!!busy} onClick={() => setQuoting(v)}>
                              <ClipboardEdit className="h-4 w-4 mr-1" />{v.status === 'invited' ? 'Enter quote' : 'Change quote'}
                            </Button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>

              {quoted.length === 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Items asked</h3>
                  <ul className="divide-y rounded-md border text-sm">
                    {rfq.lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-2 px-3 py-2">
                        <span><span className="font-medium">{l.itemName}</span> <span className="text-xs text-gray-500">{l.itemCode}</span></span>
                        <span className="whitespace-nowrap tabular-nums">{l.quantity} {l.unitCode}</span>
                      </li>
                    ))}
                  </ul>
                  {isOpen && <p className="mt-2 text-sm text-gray-500">The comparison appears here as soon as a vendor's quote is entered.</p>}
                </section>
              ) : (
                <section>
                  <h3 className="mb-1 text-sm font-semibold">Comparison</h3>
                  <p className="mb-2 text-xs text-gray-500">Landed cost per unit = rate − discount + GST. The lowest for each item is marked green. Totals are for the items each vendor can supply, GST included.</p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm" style={{ minWidth: 260 + quoted.length * 170 }}>
                      <thead className="bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left font-medium">Item</th>
                          {quoted.map((v) => (
                            <th key={v.id} className="px-3 py-2 text-right font-medium">
                              <div className="text-sm text-gray-800">{v.vendorName}</div>
                              <div>{GST_TYPE_LABEL[v.gstType]}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {rfq.lines.map((l) => (
                          <tr key={l.id}>
                            <td className="sticky left-0 bg-white px-3 py-2">
                              <div className="font-medium">{l.itemName}</div>
                              <div className="text-xs text-gray-500">{l.quantity} {l.unitCode}</div>
                              {l.orderedOn?.length > 0 && <div className="text-xs font-medium text-red-700">Already ordered{l.orderedOn[0].number ? ` on ${l.orderedOn[0].number}` : ''} — an award would be refused</div>}
                            </td>
                            {quoted.map((v) => {
                              const q = v.quotes.find((x) => x.rfqLineId === l.id)
                              const landed = cmp.lines[l.id]?.landed[v.id]
                              const lowest = cmp.lines[l.id]?.lowestVendorIds.includes(v.id)
                              return (
                                <td key={v.id} className={`px-3 py-2 text-right tabular-nums ${lowest ? 'bg-green-50' : ''}`}>
                                  {landed == null ? <span className="text-gray-400">{q && !q.available ? 'Cannot supply' : '—'}</span> : (
                                    <>
                                      <div className={`font-semibold ${lowest ? 'text-green-700' : ''}`}>{formatMoney(landed)}{lowest && <span className="sr-only"> (lowest)</span>}</div>
                                      <div className="text-[11px] text-gray-500">{formatMoney(q.rate)}{q.discountPct ? ` −${q.discountPct}%` : ''}{v.gstType !== 'none' ? ` +${q.gstRate}%` : ''}</div>
                                    </>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 bg-gray-50">
                        <tr>
                          <td className="sticky left-0 bg-gray-50 px-3 py-2 font-semibold">Total</td>
                          {quoted.map((v) => {
                            const t = cmp.vendors[v.id]
                            const best = cmp.cheapestCompleteVendorId === v.id
                            return (
                              <td key={v.id} className="px-3 py-2 text-right">
                                <div className={`text-base font-bold tabular-nums ${best ? 'text-green-700' : ''}`}>{formatMoney(t?.total ?? 0)}</div>
                                <div className="text-[11px] text-gray-500">{t?.lineIds.length ?? 0} of {rfq.lines.length} items{best && ' · cheapest for all'}</div>
                                <div className="text-[11px] text-gray-500">{v.deliveryDays != null ? `${v.deliveryDays} days` : 'delivery —'}</div>
                                {isOpen && me.canRfq && t?.lineIds.length > 0 && (
                                  <Button size="sm" className="mt-1.5" variant={best ? 'default' : 'outline'} disabled={!!busy} onClick={() => { setText(''); setAsking({ award: v.id }) }}>
                                    <Award className="h-4 w-4 mr-1" />Award
                                  </Button>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              )}

              {asking && (
                <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3">
                  {awardTo && (
                    <div className="space-y-1 text-sm">
                      <p>Award to <b>{awardTo.vendorName}</b>: {cmp.vendors[awardTo.id].lineIds.length} of {rfq.lines.length} items, <b>{formatMoney(cmp.vendors[awardTo.id].total)}</b> with GST. A draft purchase order is made at these rates for you to check and send for approval.</p>
                      {cmp.vendors[awardTo.id].lineIds.length < rfq.lines.length && (
                        <p className="text-amber-800">Items it did not quote stay on the request, to be ordered separately.</p>
                      )}
                      {cheaper.length > 0 && (
                        <p className="flex items-start gap-1 font-medium text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          Not the cheapest: {nameOf(cheaper[0].vendorId)} quoted {formatMoney(cheaper[0].total)} for the same items ({formatMoney(cheaper[0].saving)} less). Say why {awardTo.vendorName} is chosen.
                        </p>
                      )}
                    </div>
                  )}
                  <Label htmlFor="rfq-reason">{asking === 'cancel' ? `Why is it cancelled?${needsReason ? ' *' : ''}` : `Why this vendor?${needsReason ? ' *' : ' (optional)'}`}</Label>
                  <Textarea id="rfq-reason" rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={500}
                    placeholder={asking === 'cancel' ? 'e.g. Requirement dropped' : 'e.g. Delivers in 2 days; the cheaper vendor needs 3 weeks'} />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAsking(null); setText('') }} disabled={!!busy}>Back</Button>
                    {asking === 'cancel' ? (
                      <Button size="sm" variant="destructive" disabled={!!busy || (needsReason && text.trim().length < 3)}
                        onClick={() => run('cancel', () => rfqApi.cancel(rfq.id, text.trim()), `${rfq.number} cancelled`)}>
                        {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Cancel RFQ
                      </Button>
                    ) : (
                      <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={!!busy || (needsReason && text.trim().length < 3)}
                        onClick={() => run('award', () => rfqApi.award(rfq.id, awardTo.id, text.trim()), (r) => {
                          if (r.data.order?.id) onAwardDone?.(r.data.order.id)
                          return `Awarded to ${awardTo.vendorName} — purchase order ${r.data.order?.number} is ready.`
                        })}>
                        {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Award and make the order
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {!asking && (
              <DialogFooter className="gap-2 flex-wrap">
                {rfq.status === 'draft' && mine && (
                  <>
                    <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy}
                      onClick={() => window.confirm(`Delete draft ${rfq.number}?`) && run('delete', () => rfqApi.remove(rfq.id), `${rfq.number} deleted`)}>
                      <Trash2 className="h-4 w-4 mr-1" />Delete draft
                    </Button>
                    <Button variant="outline" disabled={!!busy} onClick={() => onEdit?.(rfq)}><Pencil className="h-4 w-4 mr-1" />Edit</Button>
                    <Button disabled={!!busy} onClick={() => run('send', () => rfqApi.send(rfq.id), sentText)}>
                      {busy === 'send' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}Send to vendors
                    </Button>
                  </>
                )}
                {isOpen && mine && (
                  <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy} onClick={() => { setText(''); setAsking('cancel') }}><Ban className="h-4 w-4 mr-1" />Cancel RFQ</Button>
                )}
                {rfq.status !== 'cancelled' && <Button variant="outline" onClick={() => printRfq(rfq)}><Printer className="h-4 w-4 mr-1" />Print RFQ</Button>}
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>Close</Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
      <RfqQuoteDialog rfq={rfq} rfqVendor={quoting} open={!!quoting} onOpenChange={(v) => { if (!v) setQuoting(null) }}
        onSaved={(data) => { setRfq(data); setQuoting(null); onChanged?.() }} />
    </Dialog>
  )
}
