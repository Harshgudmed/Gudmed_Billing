import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuantityInput } from '@/components/ui/quantity-input'
import { Loader2, PackageMinus, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { indentApi } from '@/api/purchaseIndentApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime } from '@/lib/format'
import { INDENT_STATUS, ISSUE_STATUS, qtyText } from '@/components/store-indent/indentMeta'
import { PRIORITY, useMe, showNotifyWarning } from './requestMeta'

// One department indent, as the store works it: per line what was asked, what
// has been given, what is still to give and what the shelf holds (expired
// stock is shown but never issued). The store keeper gives all or part of it
// now — no approval step — and the server takes it from the batches with the
// soonest expiry. What the store will not give is closed with a reason the
// department reads. Each issue opens its slip (onOpenIssue).

const EPS = 1e-9
/** What to give by default: everything still to come, as far as the shelf goes (whole units whole). */
const giveDefault = (l) => {
  const cap = Math.min(l.pending, l.availableInUnit)
  const n = l.wholeOnly ? Math.floor(cap + EPS) : cap
  return n > 0 ? String(Math.round(n * 1000) / 1000) : ''
}

export default function IndentDetail({ id, open, onOpenChange, onChanged, onOpenIssue }) {
  const me = useMe()
  const [indent, setIndent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [give, setGive] = useState({}) // indent line id → quantity typed
  const [receivedByName, setReceivedByName] = useState('')
  const [assignedToName, setAssignedToName] = useState('')
  const [notes, setNotes] = useState('')
  const [closing, setClosing] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(null) // 'issue' | 'close'

  const close = useRef(onOpenChange)
  close.current = onOpenChange
  const load = useCallback(async ({ fresh = false } = {}) => {
    if (!id) return
    setLoading(true)
    try {
      const data = (await indentApi.getIndent(id)).data
      setIndent(data)
      if (fresh) {
        setGive(Object.fromEntries(data.lines.map((l) => [l.id, giveDefault(l)])))
        // Usually the person who raised the indent collects it. Prefill that
        // name to save typing, but let the store record a different collector.
        setReceivedByName(data.requestedByName || '')
      }
    } catch (err) {
      showApiError(err, 'Could not open the indent')
      close.current(false)
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => {
    if (!open) return
    setReceivedByName(''); setAssignedToName(''); setNotes(''); setClosing(false); setReason('')
    load({ fresh: true })
  }, [open, load])

  const status = indent && (INDENT_STATUS[indent.status] || INDENT_STATUS.submitted)
  const workable = indent && ['submitted', 'partly_issued'].includes(indent.status)
  const canWork = me.canIssue && workable
  const money = me.seesMoney
  const typed = indent ? indent.lines.filter((l) => Number(give[l.id]) > 0) : []
  const tooMuch = indent ? indent.lines.filter((l) => Number(give[l.id]) > Math.min(l.pending, l.availableInUnit) + EPS) : []
  const canPost = canWork && typed.length > 0 && tooMuch.length === 0 && receivedByName.trim().length >= 2

  const issue = async () => {
    setBusy('issue')
    try {
      const r = await indentApi.issue({
        indentId: indent.id, receivedByName: receivedByName.trim(), assignedToName: assignedToName.trim() || null, notes,
        lines: typed.map((l) => ({ indentLineId: l.id, quantity: give[l.id] })),
      })
      toast.success(`${r.data.number} issued to ${indent.department?.name}`)
      showNotifyWarning(r)
      onChanged?.()
      setReceivedByName(''); setAssignedToName(''); setNotes('')
      await load({ fresh: true })
      onOpenIssue?.(r.data.id)
    } catch (err) {
      showApiError(err, 'Could not issue the goods')
      // The shelf may have changed under us: show the latest figures, keep what was typed.
      load()
    } finally {
      setBusy(null)
    }
  }

  const closeRest = async () => {
    setBusy('close')
    try {
      const r = await indentApi.closeIndent(indent.id, reason.trim())
      toast.success(`${indent.number} closed — ${indent.department?.name} has been told`)
      showNotifyWarning(r)
      setClosing(false)
      onChanged?.()
      await load()
    } catch (err) {
      showApiError(err, 'Could not close the indent')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        {!indent ? (
          <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{indent.number}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
                {indent.priority !== 'normal' && <Badge variant="outline" className={PRIORITY[indent.priority]?.cls}>{PRIORITY[indent.priority]?.label}</Badge>}
                {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" aria-label="Refreshing" />}
              </div>
              <DialogDescription>
                {indent.department?.name} · raised by {indent.requestedByName} on {formatDateTime(indent.createdAt)}
                {indent.neededBy && <> · needed by {formatDateTime(indent.neededBy, { withTime: false })}</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {indent.purpose && <p className="text-sm"><span className="text-gray-500">For: </span>{indent.purpose}</p>}
              {indent.status === 'closed' && (
                <p className="rounded-md bg-slate-50 px-3 py-2 text-sm"><span className="text-gray-500">Closed by {indent.closedByName} on {formatDateTime(indent.closedAt)}: </span>{indent.closeReason}</p>
              )}
              {indent.status === 'cancelled' && (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">Cancelled by the department {formatDateTime(indent.cancelledAt)}{indent.cancelReason ? `: ${indent.cancelReason}` : ''}</p>
              )}

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Item</th>
                      <th className="text-right font-medium px-3 py-2">Asked</th>
                      <th className="text-right font-medium px-3 py-2">Given</th>
                      <th className="text-right font-medium px-3 py-2">To give</th>
                      <th className="text-right font-medium px-3 py-2">In stock</th>
                      {canWork && <th className="text-center font-medium px-3 py-2 w-40">Give now</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {indent.lines.map((l, i) => {
                      const max = Math.min(l.pending, l.availableInUnit)
                      const over = Number(give[l.id]) > max + EPS
                      return (
                        <tr key={l.id} className="align-top">
                          <td className="px-3 py-2">
                            <div className="font-medium">{l.itemName}</div>
                            <div className="text-xs text-gray-500">{l.itemCode}{l.note && <> · {l.note}</>}</div>
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{qtyText(l.quantity, l.unitCode)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{l.issuedQty > 0 ? qtyText(l.issuedQty, l.unitCode) : <span className="text-gray-400">—</span>}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap font-semibold tabular-nums">{l.pending > 0 ? qtyText(l.pending, l.unitCode) : <span className="font-normal text-green-700">Done</span>}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                            {l.available > 0
                              ? <>{qtyText(l.availableInUnit, l.unitCode)}{l.unitFactor !== 1 && <div className="text-xs text-gray-500">{l.available} loose</div>}</>
                              : <span className="font-medium text-red-700">Not in stock</span>}
                            {l.expired > 0 && <div className="text-xs text-amber-700">+{l.expired} expired, not issued</div>}
                          </td>
                          {canWork && (
                            <td className="px-3 py-2">
                              {l.pending > 0 && max > 0 ? (
                                <>
                                  <QuantityInput aria-label={`Give now, line ${i + 1}`} value={give[l.id] ?? ''} onChange={(v) => setGive((g) => ({ ...g, [l.id]: v }))} />
                                  {over && <p className="mt-1 text-xs text-red-600">At most {qtyText(max, l.unitCode)}</p>}
                                </>
                              ) : l.pending > 0 ? (
                                <p className="text-xs text-amber-700">No available stock — create a purchase request.</p>
                              ) : null}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {canWork && !closing && (
                <div className="grid grid-cols-1 gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="iss-by">Collected by (requester prefilled) *</Label>
                    <Input id="iss-by" autoComplete="name" value={receivedByName} onChange={(e) => setReceivedByName(e.target.value)} placeholder="Name of the person taking the goods" />
                    <p className="text-xs text-gray-500">Change this if someone else collects the goods.</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="iss-assigned">Assigned to <span className="font-normal text-gray-400">(optional — a person an asset is given to)</span></Label>
                    <Input id="iss-assigned" value={assignedToName} onChange={(e) => setAssignedToName(e.target.value)} placeholder="e.g. Dr. Rao — leave blank for a department issue" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="iss-notes">Note (optional)</Label>
                    <Input id="iss-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Rest next week" />
                  </div>
                  <p className="text-xs text-gray-500 sm:col-span-2">Stock leaves the batches with the soonest expiry first. The issue slip opens after posting, ready to print.</p>
                </div>
              )}

              {closing && (
                <div className="space-y-2 rounded-md border border-slate-300 bg-slate-50 p-3">
                  <Label htmlFor="ind-close">Why will the rest not be issued? *</Label>
                  <Textarea id="ind-close" rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not stocked — a purchase request has been raised" />
                  <p className="text-xs text-gray-600">{indent.department?.name} is told, with this reason. Nothing more can be issued on {indent.number}.</p>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setClosing(false); setReason('') }} disabled={!!busy}>Back</Button>
                    <Button size="sm" onClick={closeRest} disabled={!!busy || reason.trim().length < 3}>
                      {busy === 'close' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Close the rest
                    </Button>
                  </div>
                </div>
              )}

              <section>
                <h3 className="mb-2 text-sm font-semibold">Issues on this indent</h3>
                {indent.issues.length === 0 ? (
                  <p className="rounded-md border border-dashed py-4 text-center text-sm text-gray-500">Nothing issued yet</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {indent.issues.map((iss) => {
                      const s = ISSUE_STATUS[iss.status] || ISSUE_STATUS.posted
                      return (
                        <li key={iss.id}>
                          <button type="button" onClick={() => onOpenIssue?.(iss.id)}
                            className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                            <span className="font-mono font-medium text-blue-700">{iss.number}</span>
                            <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                            <span className="text-gray-500">{formatDateTime(iss.issuedAt)} · {iss.lines.length} batch line{iss.lines.length === 1 ? '' : 's'} · collected by {iss.receivedByName || '—'}{iss.assignedToName && ` · assigned to ${iss.assignedToName}`}</span>
                            {money && iss.totalValue !== undefined && <span className="ml-auto tabular-nums">{formatMoney(iss.totalValue)}</span>}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>

            <DialogFooter className="gap-2">
              {canWork && !closing && (
                <Button variant="outline" onClick={() => setClosing(true)} disabled={!!busy}><Lock className="h-4 w-4 mr-2" />Close the rest</Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>Close</Button>
              {canWork && !closing && (
                <Button onClick={issue} disabled={!!busy || !canPost} title={receivedByName.trim().length < 2 ? 'Say who collected the goods' : undefined}>
                  {busy === 'issue' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PackageMinus className="h-4 w-4 mr-2" />}Issue goods
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
