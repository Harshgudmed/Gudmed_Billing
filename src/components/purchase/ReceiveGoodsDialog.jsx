import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuantityInput } from '@/components/ui/quantity-input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldError } from '@/components/common/FieldError'
import { Loader2, PackageCheck, CheckCheck, Eraser, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { localYmd, formatDateTime } from '@/lib/format'
import { showNotifyWarning } from './requestMeta'

// Receiving goods against a purchase order (a GRN).
//
// Most deliveries are the whole order, so every line opens filled with what is
// still due: a full delivery is one click on "Receive into stock". Anything
// different is a change to one box — fewer arrived, some turned back (then,
// and only then, a reason is asked), a batch number and expiry for what has
// one. Lines already fully received are left off.
//
// The checks below are the server's (backend/src/lib/purchaseReceipts.js),
// shown as you type so nothing is a surprise on saving; the server checks
// everything again.

const qty = (v) => Math.round((Number(v) || 0) * 1000) / 1000
const dueOf = (l) => Math.max(0, qty(l.quantity - (l.receivedQty || 0)))

function lineProblem(row, today) {
  const { line } = row
  const arrived = qty(row.arrived), rejected = qty(row.rejected)
  if (!(arrived > 0) && !(rejected > 0)) return null
  const whole = line.unit && line.unit.allowsFraction === false
  if (whole && (!Number.isInteger(arrived) || !Number.isInteger(rejected))) return `${line.unitCode} is counted in whole numbers`
  if (!(arrived > 0)) return 'Enter how many arrived'
  if (rejected > arrived) return 'Rejected cannot be more than arrived'
  const accepted = qty(arrived - rejected)
  if (accepted > dueOf(line)) return `Only ${dueOf(line)} ${line.unitCode} are due — reject the extra ${qty(accepted - dueOf(line))}`
  if (rejected > 0 && row.reason.trim().length < 3) return 'Say why it was rejected'
  if (accepted > 0 && row.expiryDate && row.expiryDate < today) return 'This batch has expired — reject it instead'
  return null
}

export default function ReceiveGoodsDialog({ order, open, onOpenChange, onReceived }) {
  const today = localYmd()
  const [rows, setRows] = useState([])
  const [head, setHead] = useState({ challanNumber: '', challanDate: '', receivedOn: today, notes: '' })
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!open || !order) return
    setRows(order.lines.filter((l) => dueOf(l) > 0).map((line) => ({ line, arrived: String(dueOf(line)), rejected: '', reason: '', batchNumber: '', expiryDate: '' })))
    setHead({ challanNumber: '', challanDate: '', receivedOn: localYmd(), notes: '' })
    setTried(false)
  }, [open, order])

  const set = (i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const problems = rows.map((r) => lineProblem(r, today))
  const doneLines = order ? order.lines.length - rows.length : 0
  const taking = rows.filter((r) => qty(r.arrived) > 0)
  const accepting = useMemo(() => rows.map((r) => ({ r, accepted: Math.max(0, qty(qty(r.arrived) - qty(r.rejected))) })).filter((x) => x.accepted > 0), [rows])
  const headProblem = head.receivedOn > today ? 'Cannot be in the future'
    : head.challanDate && head.challanDate > head.receivedOn ? 'The challan cannot be dated after the goods arrived' : null
  // Goods, or a challan, dated before the order was raised (the date it is
  // printed with) are allowed — an order is sometimes typed in after the goods
  // came — but more often the date picker slipped, so it is pointed out, not
  // refused. Compared as calendar days, as the date boxes hold them.
  const orderOn = order ? order.orderDate || order.createdAt : null
  const orderYmd = orderOn ? localYmd(new Date(orderOn)) : null
  const raised = order && `${order.number} was raised on ${formatDateTime(orderOn, { withTime: false })}`
  const dateWarnings = orderYmd ? [
    head.receivedOn && head.receivedOn < orderYmd && `Received before ${raised} — check the date`,
    head.challanDate && head.challanDate < orderYmd && `Challan dated before ${raised} — check the date`,
  ].filter(Boolean) : []

  const submit = async () => {
    setTried(true)
    if (!taking.length) { toast.error('Enter how much arrived on at least one line'); return }
    if (problems.some(Boolean) || headProblem) { toast.error('Fix the lines marked in red'); return }
    setSaving(true)
    try {
      const r = await purchaseApi.createReceipt({
        orderId: order.id,
        // Today keeps the actual time of arrival; an earlier day is that day.
        receivedAt: head.receivedOn === today ? null : head.receivedOn,
        challanNumber: head.challanNumber, challanDate: head.challanDate || null, notes: head.notes,
        lines: taking.map((x) => ({
          orderLineId: x.line.id, receivedQty: qty(x.arrived), rejectedQty: qty(x.rejected),
          rejectReason: x.reason, batchNumber: x.batchNumber, expiryDate: x.expiryDate || null,
        })),
      })
      const into = r.data.lines.filter((l) => l.stockQty > 0).length
      toast.success(`${r.data.number} saved — ${into} item${into === 1 ? '' : 's'} added to stock`)
      showNotifyWarning(r)
      onReceived?.(r.data)
      onOpenChange(false)
    } catch (err) {
      showApiError(err, 'Could not save the receipt')
    } finally {
      setSaving(false)
    }
  }

  if (!order) return null
  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-green-600" />Receive goods</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{order.number}</span> · {order.vendorName}. What you accept goes into stock; what you turn back stays due on the order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="grn-challan">Challan / invoice no.</Label>
              <Input id="grn-challan" value={head.challanNumber} maxLength={60} placeholder="As printed on the vendor's slip"
                onChange={(e) => setHead((h) => ({ ...h, challanNumber: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="grn-cdate">Challan date</Label>
              <Input id="grn-cdate" type="date" max={head.receivedOn || today} value={head.challanDate}
                onChange={(e) => setHead((h) => ({ ...h, challanDate: e.target.value }))} />
              {head.challanDate && head.challanDate > head.receivedOn && <FieldError message="The challan cannot be dated after the goods arrived" />}
            </div>
            <div>
              <Label htmlFor="grn-on">Received on</Label>
              <Input id="grn-on" type="date" max={today} value={head.receivedOn}
                onChange={(e) => setHead((h) => ({ ...h, receivedOn: e.target.value || today }))} />
              {head.receivedOn > today && <FieldError message="Cannot be in the future" />}
            </div>
          </div>
          {dateWarnings.map((w) => (
            <p key={w} role="status" className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}
            </p>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-600">
              Filled with everything still due. Change only what is different.
              {doneLines > 0 && <span className="text-gray-400"> {doneLines} line{doneLines === 1 ? ' is' : 's are'} already fully received.</span>}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, arrived: String(dueOf(r.line)), rejected: '', reason: '' })))}>
                <CheckCheck className="h-4 w-4 mr-1" />Everything arrived
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, arrived: '', rejected: '', reason: '' })))}>
                <Eraser className="h-4 w-4 mr-1" />Clear all
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Item</th>
                  <th className="text-right font-medium px-3 py-2">Due</th>
                  <th className="text-left font-medium px-3 py-2 w-36">Arrived</th>
                  <th className="text-left font-medium px-3 py-2 w-36">Rejected</th>
                  <th className="text-left font-medium px-3 py-2 w-36">Batch no.</th>
                  <th className="text-left font-medium px-3 py-2 w-40">Expiry</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => {
                  const l = r.line
                  const accepted = Math.max(0, qty(qty(r.arrived) - qty(r.rejected)))
                  const stockUnit = l.item?.stockUnit?.code
                  const problem = problems[i]
                  const showProblem = problem && (tried || problem !== 'Say why it was rejected')
                  return (
                    <tr key={l.id} className={problem && tried ? 'bg-red-50/40' : undefined}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{l.itemName}</div>
                        <div className="text-xs text-gray-500">
                          {l.itemCode} · ordered {l.quantity} {l.unitCode}{l.receivedQty > 0 && <>, {l.receivedQty} in</>}
                          {l.unitFactor !== 1 && stockUnit && <> · 1 {l.unitCode} = {l.unitFactor} {stockUnit}</>}
                        </div>
                        {qty(r.rejected) > 0 && (
                          <div className="mt-2 max-w-xs">
                            <Input aria-label={`Why ${l.itemName} was rejected`} value={r.reason} maxLength={200} autoFocus={!r.reason}
                              placeholder="Why rejected? e.g. Damaged, short expiry" onChange={(e) => set(i, { reason: e.target.value })}
                              className={tried && r.reason.trim().length < 3 ? 'border-red-400' : ''} />
                          </div>
                        )}
                        {showProblem && <FieldError message={problem} />}
                      </td>
                      <td className="px-3 py-2 align-top text-right whitespace-nowrap tabular-nums font-medium">{dueOf(l)} {l.unitCode}</td>
                      <td className="px-3 py-2 align-top">
                        <QuantityInput aria-label={`${l.itemName} arrived`} value={r.arrived} onChange={(v) => set(i, { arrived: v })} />
                        {accepted > 0 && l.unitFactor !== 1 && stockUnit && <div className="mt-1 text-[11px] text-green-700">= {qty(accepted * l.unitFactor)} {stockUnit} to stock</div>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <QuantityInput aria-label={`${l.itemName} rejected`} value={r.rejected} onChange={(v) => set(i, { rejected: v })} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Input aria-label={`${l.itemName} batch number`} value={r.batchNumber} maxLength={40} placeholder="Optional"
                          onChange={(e) => set(i, { batchNumber: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Input aria-label={`${l.itemName} expiry date`} type="date" min={today} value={r.expiryDate}
                          onChange={(e) => set(i, { expiryDate: e.target.value })} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div>
            <Label htmlFor="grn-notes">Note (optional)</Label>
            <Input id="grn-notes" value={head.notes} maxLength={500} placeholder="e.g. Delivered by hand, two boxes opened for checking"
              onChange={(e) => setHead((h) => ({ ...h, notes: e.target.value }))} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:items-center">
          <p className="text-sm text-gray-600 sm:mr-auto">
            {accepting.length
              ? <>Adding <b>{accepting.length}</b> item{accepting.length === 1 ? '' : 's'} to stock</>
              : taking.length ? 'Everything entered is rejected — nothing goes into stock' : 'Nothing entered yet'}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button className="bg-green-600 hover:bg-green-700" onClick={submit} disabled={saving || !taking.length}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PackageCheck className="h-4 w-4 mr-1" />}Receive into stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
