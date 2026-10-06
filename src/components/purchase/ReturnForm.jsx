import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuantityInput } from '@/components/ui/quantity-input'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldError } from '@/components/common/FieldError'
import { Loader2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseReturnApi } from '@/api/purchaseReturnApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime } from '@/lib/format'
import LoadFailed from './LoadFailed'
import { showNotifyWarning } from './requestMeta'
import { REASON_LABEL } from './ReturnDetail'

// Sending goods back to the vendor: pick the order they came on, then how much
// of each batch goes back. Every batch of that order still on the shelf is
// listed with what can still go back (the shelf, less what other returns are
// waiting to take, and no more than was received on the order). Most returns
// are one or two batches, so every box starts empty.
//
// The checks are the server's (backend/src/lib/purchaseReturns.js), shown as
// you type; the server checks everything again.

const qty = (v) => Math.round((Number(v) || 0) * 1000) / 1000

function lineProblem(line, value) {
  const n = qty(value)
  if (!(n > 0)) return null
  if (!line.allowsFraction && !Number.isInteger(n)) return `${line.unitCode} is counted in whole numbers`
  if (n > line.returnable) return line.returnable > 0 ? `Only ${line.returnable} ${line.unitCode} can go back` : 'Nothing of this batch can go back'
  return null
}

// `returnMode` is the hospital's setting: 'approval' or 'direct'.
export default function ReturnForm({ open, onOpenChange, returnMode, onSaved }) {
  const [orders, setOrders] = useState([])
  const [searching, setSearching] = useState(false)
  const [orderId, setOrderId] = useState('')
  const [batches, setBatches] = useState(null) // { order, lines } once an order is chosen
  const [loadFailed, setLoadFailed] = useState(false)
  const [amounts, setAmounts] = useState({}) // receiptLineId → typed quantity
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!open) return
    setOrderId(''); setBatches(null); setAmounts({}); setReason(''); setNotes(''); setTried(false); setLoadFailed(false)
  }, [open])

  const searchOrders = async (term) => {
    setSearching(true)
    try {
      const r = await purchaseReturnApi.getReturnableOrders(term)
      setOrders(r.data.map((o) => ({ value: o.id, label: `${o.number} · ${o.vendorName}`, sublabel: `Ordered ${formatDateTime(o.orderDate, { withTime: false })}` })))
    } catch (err) {
      showApiError(err, 'Could not load the orders')
    } finally {
      setSearching(false)
    }
  }

  const loadBatches = async (id) => {
    setBatches(null); setLoadFailed(false); setAmounts({})
    if (!id) return
    try {
      setBatches((await purchaseReturnApi.getReturnables(id)).data)
    } catch (err) {
      setLoadFailed(true)
      showApiError(err, 'Could not load the order\'s batches')
    }
  }
  const chooseOrder = (id) => { setOrderId(id); loadBatches(id) }

  const lines = batches?.lines ?? []
  const money = lines.length > 0 && lines[0].rate !== undefined
  const taking = lines.filter((l) => qty(amounts[l.receiptLineId]) > 0)
  const problems = Object.fromEntries(lines.map((l) => [l.receiptLineId, lineProblem(l, amounts[l.receiptLineId])]))
  const reasonProblem = !reason ? 'Choose why the goods go back' : reason === 'other' && notes.trim().length < 3 ? 'Say what is wrong when the reason is "Other"' : null
  // At the order's net rate plus GST, as the server prices it.
  const value = taking.reduce((s, l) => s + qty(amounts[l.receiptLineId]) * (l.rate || 0) * (1 + (l.gstRate || 0) / 100), 0)
  const direct = returnMode === 'direct'

  const submit = async () => {
    setTried(true)
    if (!taking.length) { toast.error('Enter how much goes back on at least one batch'); return }
    if (taking.some((l) => problems[l.receiptLineId]) || reasonProblem) { toast.error('Fix what is marked in red'); return }
    setSaving(true)
    try {
      const r = await purchaseReturnApi.createReturn({
        orderId, reason, notes,
        lines: taking.map((l) => ({ receiptLineId: l.receiptLineId, quantity: qty(amounts[l.receiptLineId]) })),
      })
      toast.success(r.data.status === 'posted'
        ? `${r.data.number} posted — debit note ${r.data.debitNoteNumber}. The goods are out of stock.`
        : `${r.data.number} sent to the purchase officer for approval`)
      showNotifyWarning(r)
      onSaved?.(r.data)
      onOpenChange(false)
    } catch (err) {
      showApiError(err, 'Could not save the return')
      loadBatches(orderId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Undo2 className="h-5 w-5 text-orange-600" />Return goods to the vendor</DialogTitle>
          <DialogDescription>
            {direct
              ? 'This hospital posts returns at once: the goods come off the shelf and a debit note is made when you save.'
              : 'The return goes to the purchase officer for approval. Nothing leaves stock until it is approved.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Order the goods came on *</Label>
              {open && (
                <SearchableSelect options={orders} value={orderId} onChange={chooseOrder} onSearch={searchOrders} minSearchLength={0} loading={searching}
                  placeholder="Choose an order…" searchPlaceholder="PO, GRN, vendor or item…" emptyText="No order with goods still on the shelf"
                  selectedLabel={batches?.order ? `${batches.order.number} · ${batches.order.vendorName}` : undefined} className="w-full" />
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ret-reason">Why do they go back? *</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="ret-reason" aria-label="Reason"><SelectValue placeholder="Choose a reason" /></SelectTrigger>
                <SelectContent>{Object.entries(REASON_LABEL).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent>
              </Select>
              {tried && reasonProblem && <FieldError message={reasonProblem} />}
            </div>
          </div>

          {loadFailed && <LoadFailed onRetry={() => loadBatches(orderId)}>The order&apos;s batches did not load.</LoadFailed>}
          {orderId && !batches && !loadFailed && <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}
          {batches && !lines.length && <p className="rounded-md bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">Nothing from this order is left on the shelf to send back.</p>}

          {lines.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Item · batch</th>
                    <th className="text-left font-medium px-3 py-2">Receipt</th>
                    <th className="text-right font-medium px-3 py-2">On the shelf</th>
                    <th className="text-right font-medium px-3 py-2">Can go back</th>
                    <th className="text-left font-medium px-3 py-2 w-40">Send back</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l) => {
                    const problem = problems[l.receiptLineId]
                    return (
                      <tr key={l.receiptLineId} className={problem ? 'bg-red-50/40' : undefined}>
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium">{l.itemName}</div>
                          <div className="text-xs text-gray-500">
                            Batch {l.batchNumber || '—'}{l.expiryDate && ` · exp ${formatDateTime(l.expiryDate, { withTime: false })}`}
                            {money && ` · ${formatMoney(l.rate)} / ${l.unitCode}`}
                          </div>
                          {problem && <FieldError message={problem} />}
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap font-mono text-xs">{l.receiptNumber}<div className="font-sans text-gray-500">{formatDateTime(l.receivedAt, { withTime: false })}</div></td>
                        <td className="px-3 py-2 align-top text-right whitespace-nowrap tabular-nums">{l.onShelf} {l.unitCode}{l.waiting > 0 && <div className="text-[11px] text-amber-700">{l.waiting} waiting on another return</div>}</td>
                        <td className="px-3 py-2 align-top text-right whitespace-nowrap font-medium tabular-nums">{l.returnable} {l.unitCode}</td>
                        <td className="px-3 py-2 align-top">
                          <QuantityInput aria-label={`${l.itemName} batch ${l.batchNumber || ''} to send back`} value={amounts[l.receiptLineId] ?? ''}
                            disabled={!(l.returnable > 0)} onChange={(v) => setAmounts((a) => ({ ...a, [l.receiptLineId]: v }))} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <Label htmlFor="ret-notes">Note {reason === 'other' ? '*' : '(optional)'}</Label>
            <Input id="ret-notes" value={notes} maxLength={500} placeholder="e.g. 3 boxes crushed in transit; vendor's rep informed"
              onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:items-center">
          <p className="text-sm text-gray-600 sm:mr-auto">
            {taking.length
              ? <>Sending back <b>{taking.length}</b> batch{taking.length === 1 ? '' : 'es'}{money && <> · about <b>{formatMoney(value)}</b> with GST</>}</>
              : 'Nothing entered yet'}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="bg-orange-600 hover:bg-orange-700" onClick={submit} disabled={saving || !taking.length}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Undo2 className="h-4 w-4 mr-1" />}{direct ? 'Return goods' : 'Send for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
