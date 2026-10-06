import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { indentApi } from '@/api/purchaseIndentApi'
import { showApiError } from '@/lib/apiRequest'
import { useLiveData } from '@/lib/useLiveData'
import { formatDateTime } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { PRIORITY } from '@/components/purchase/requestMeta'
import LoadFailed from '@/components/purchase/LoadFailed'
import { INDENT_STATUS, ISSUE_STATUS, qtyText } from './indentMeta'

// One indent, as the department sees it: what was asked, what the store has
// given so far (and from which batch, collected by whom), what is still to
// come — and, for a line the store does not hold, that it will be bought.
// Whoever raised it (or an administrator) may cancel it until the store has
// acted on it. No money: the department works in quantities.

export default function DeptIndentDetail({ id, open, onOpenChange, onChanged }) {
  const { user } = useAuth()
  const [indent, setIndent] = useState(null)
  const [failed, setFailed] = useState(false)
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  // A parent's inline callback in a ref: its live refreshes must not re-open this.
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  const load = useCallback(async () => {
    if (!id) return
    try {
      setIndent((await indentApi.getMyIndent(id)).data)
      setFailed(false)
    } catch (err) {
      // Keep what is on screen and say the refresh failed; on first open, close.
      setFailed(true)
      if (err?.status === 404) { showApiError(err, 'Could not open the indent'); close.current(false) }
    }
  }, [id])
  useEffect(() => { if (open) { setIndent(null); setAsking(false); setReason(''); load() } }, [open, load])
  // The store issues from another screen: follow it while this is open.
  useLiveData(open ? ['purchase', 'store-indents'] : null, load)

  const cancel = async () => {
    setBusy(true)
    try {
      const r = await indentApi.cancelIndent(indent.id, reason.trim())
      setIndent((x) => ({ ...x, ...r.data }))
      toast.success(`${indent.number} cancelled`)
      setAsking(false)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not cancel the indent')
    } finally {
      setBusy(false)
    }
  }

  const status = indent && (INDENT_STATUS[indent.status] || INDENT_STATUS.submitted)
  const nothingIssued = indent && indent.lines.every((l) => !(l.issuedQty > 0))
  const isAdmin = !user || ['admin', 'super_admin'].includes(user.role)
  const mine = indent && (isAdmin || indent.requestedById === (user?.id || user?.userId))
  const canCancel = indent && indent.status === 'submitted' && nothingIssued && mine
  const open_ = indent && ['submitted', 'partly_issued'].includes(indent.status)

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        {!indent ? (
          failed
            ? <><DialogTitle>Indent</DialogTitle><LoadFailed onRetry={load}>Could not open this indent.</LoadFailed></>
            : <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{indent.number}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
                {indent.priority !== 'normal' && <Badge variant="outline" className={PRIORITY[indent.priority]?.cls}>{PRIORITY[indent.priority]?.label}</Badge>}
              </div>
              <DialogDescription>
                {indent.department?.name} · raised by {indent.requestedByName} on {formatDateTime(indent.createdAt)}
                {indent.neededBy && <> · needed by {formatDateTime(indent.neededBy, { withTime: false })}</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {failed && <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Could not refresh this indent — showing what was last loaded.</p>}
              {indent.purpose && <p className="text-sm"><span className="text-gray-500">For: </span>{indent.purpose}</p>}
              {indent.status === 'closed' && (
                <p className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-gray-500">Closed by the store ({indent.closedByName}, {formatDateTime(indent.closedAt)}) — the rest will not be issued: </span>{indent.closeReason}
                </p>
              )}
              {indent.status === 'cancelled' && (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">Cancelled {formatDateTime(indent.cancelledAt)}{indent.cancelReason ? `: ${indent.cancelReason}` : ''}</p>
              )}

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Item</th>
                      <th className="text-right font-medium px-3 py-2">Asked</th>
                      <th className="text-right font-medium px-3 py-2">Issued</th>
                      <th className="text-right font-medium px-3 py-2">To come</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {indent.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.itemName}</div>
                          <div className="text-xs text-gray-500">{l.itemCode}{l.note && <> · {l.note}</>}</div>
                          {open_ && l.pending > 0 && !l.inStock && (
                            <div className="text-xs font-medium text-amber-700">Not in stock — the store will raise a purchase request</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{qtyText(l.quantity, l.unitCode)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap font-semibold tabular-nums">{l.issuedQty > 0 ? qtyText(l.issuedQty, l.unitCode) : <span className="font-normal text-gray-400">—</span>}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                          {l.pending > 0 ? (open_ ? qtyText(l.pending, l.unitCode) : <span className="text-gray-400">{qtyText(l.pending, l.unitCode)} not coming</span>) : <span className="text-green-700">Done</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Given by the store</h3>
                {indent.issues.length === 0 ? (
                  <p className="rounded-md border border-dashed py-4 text-center text-sm text-gray-500">Nothing issued yet</p>
                ) : (
                  <ul className="space-y-2">
                    {indent.issues.map((iss) => {
                      const s = ISSUE_STATUS[iss.status] || ISSUE_STATUS.posted
                      return (
                        <li key={iss.id} className="rounded-md border p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-medium">{iss.number}</span>
                            <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                            <span className="text-gray-500">{formatDateTime(iss.issuedAt)} · by {iss.issuedByName} · collected by {iss.receivedByName || '—'}</span>
                          </div>
                          <ul className="mt-1 text-gray-700">
                            {iss.lines.map((x) => (
                              <li key={x.id}>{x.itemName} — {qtyText(x.quantity, x.unitCode)}{x.batchNumber && <span className="text-gray-500"> · batch {x.batchNumber}</span>}{x.expiryDate && <span className="text-gray-500"> · exp {formatDateTime(x.expiryDate, { withTime: false })}</span>}</li>
                            ))}
                          </ul>
                          {iss.status === 'cancelled' && <p className="mt-1 text-xs text-gray-500">Cancelled by {iss.cancelledByName}: {iss.cancelReason} — these goods went back to the store.</p>}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {asking && (
                <div className="space-y-2 rounded-md border border-red-200 bg-red-50/40 p-3">
                  <Label htmlFor="ind-cancel">Why is it cancelled? (optional)</Label>
                  <Textarea id="ind-cancel" rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Raised twice" />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAsking(false); setReason('') }} disabled={busy}>Back</Button>
                    <Button variant="destructive" size="sm" onClick={cancel} disabled={busy}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Cancel indent
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              {canCancel && !asking && (
                <Button variant="outline" className="text-red-600" onClick={() => setAsking(true)}><Ban className="h-4 w-4 mr-2" />Cancel indent</Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
