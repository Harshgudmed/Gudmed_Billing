import { useState, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { QuantityInput } from '@/components/ui/quantity-input'
import { FieldError } from '@/components/common/FieldError'
import { Loader2, ReceiptText, CheckCircle2, AlertTriangle, RotateCcw, PackageCheck, Info } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime, localYmd } from '@/lib/format'
import { GST_TYPE_LABEL, showNotifyWarning } from './requestMeta'
import { lineAmounts, orderTotals, billLineDifferences, tdsAmountFor, dueDateFor, billOutcomeText } from './orderMath'

// Entering a vendor's bill against a purchase order — the third leg of the
// 3-way match: the rate the order agreed, the goods the store received, and
// what the vendor's invoice now charges.
//
// Almost nothing is typed. Pick the order (or arrive with it already chosen)
// and every line opens filled from it: the quantity received and not billed
// yet, the order's rate, discount and GST; the TDS section and rate from the
// vendor; the due date from the payment terms. The person types the vendor's
// invoice number and date, and changes a line only where the invoice says
// something different — which shows as a difference at once. A line the
// vendor has not billed is unticked; it stays to be billed later.
//
// The checks are the server's (it works everything out again on save), shown
// as you type so Submit can say what will happen: every line agrees → the bill
// is approved for payment by itself; any difference → on hold for Finance.

const NONE = 'none' // "No TDS" in the section picker — a Select item cannot be ''
const NO_QTY = 'Enter how many the vendor billed'
const NO_RATE = 'Enter the rate the vendor billed'
const NO_INVOICE = 'Type the invoice number printed on the vendor\'s bill'
const NO_DATE = 'Enter the invoice date'
// A box left empty is pointed out only once saving is tried — someone clearing
// a box to retype it is not shouted at mid-word.
const EMPTY = new Set([NO_QTY, NO_RATE, NO_INVOICE, NO_DATE])
const PICK_LIST = 8 // orders shown as one-click rows under the picker; the rest are found by search

const qty = (v) => Math.round((Number(v) || 0) * 1000) / 1000
const isNum = (v) => v !== '' && v != null && Number.isFinite(Number(v))
const dayText = (ymd) => formatDateTime(`${ymd}T00:00:00`, { withTime: false })
const decimal = (v) => v.replace(/[^\d.]/g, '')
const blankHead = () => ({ vendorInvoiceNumber: '', vendorInvoiceDate: localYmd(), invoiceTotal: '', notes: '' })

// A line as the order has it: what is left to bill, at the order's terms.
const fromOrder = (line) => ({
  quantity: line.billable > 0 ? String(qty(line.billable)) : '',
  rate: line.rate != null ? String(line.rate) : '',
  discountPct: Number(line.discountPct) ? String(line.discountPct) : '',
  gstRate: String(Number(line.gstRate) || 0),
})
const fromBill = (b) => ({
  quantity: String(b.quantity), rate: String(b.rate),
  discountPct: Number(b.discountPct) ? String(b.discountPct) : '', gstRate: String(Number(b.gstRate) || 0),
})

// One row per order line. A new bill ticks everything still to bill; a draft
// being corrected ticks what it had and leaves the rest unticked.
function rowsFor(lines, draft) {
  const onDraft = new Map((draft?.lines ?? []).map((l) => [l.orderLineId, l]))
  const rows = lines.map((line) => {
    const b = onDraft.get(line.orderLineId)
    return b ? { line, on: true, ...fromBill(b) } : { line, on: !draft && line.billable > 0, ...fromOrder(line) }
  })
  // A draft line whose order line did not come back still shows, from what the draft saved.
  for (const b of draft?.lines ?? []) {
    if (lines.some((l) => l.orderLineId === b.orderLineId)) continue
    rows.push({
      line: { orderLineId: b.orderLineId, itemCode: b.itemCode, itemName: b.itemName, hsnCode: b.hsnCode, unitCode: b.unitCode, billable: b.billableQty, netRate: b.orderRate, rate: b.orderRate },
      on: true, ...fromBill(b),
    })
  }
  return rows
}

// What would make the server turn the line away. A difference from the order
// is not a problem — it is what Finance looks at.
function lineProblem({ on, line, quantity, rate, discountPct, gstRate }) {
  if (!on) return null
  if (quantity === '') return NO_QTY
  const q = Number(quantity)
  if (!Number.isFinite(q)) return 'The quantity is not a number'
  if (!(q > 0)) return 'The quantity must be more than 0'
  if (line.allowsFraction === false && !Number.isInteger(q)) return `${line.unitCode} is counted in whole numbers`
  if (rate === '') return NO_RATE
  if (!isNum(rate)) return 'The rate is not a number'
  if (discountPct !== '' && !(isNum(discountPct) && Number(discountPct) <= 100)) return 'Discount is 0 to 100%'
  if (gstRate !== '' && !(isNum(gstRate) && Number(gstRate) <= 100)) return 'GST is 0 to 100%'
  return null
}

const tdsFrom = (section, rate) => (section ? { section, rate: rate != null ? String(rate) : '' } : { section: NONE, rate: '' })

/**
 * `bill` — a draft to correct (as getBill returns it); leave it out for a new bill.
 * `orderId` — open a new bill on this order, skipping the picker.
 * `onSaved(bill)` — after it is saved or submitted.
 */
export default function BillForm({ open, onOpenChange, bill, orderId, onSaved }) {
  const editing = !!bill
  const today = localYmd()
  const [candidates, setCandidates] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [picked, setPicked] = useState('')
  const [info, setInfo] = useState(null)        // bill-candidates for the picked order
  const [sections, setSections] = useState([])  // the TDS sections the hospital deducts under
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [rows, setRows] = useState([])
  const [head, setHead] = useState(blankHead)
  const [tds, setTds] = useState({ section: NONE, rate: '' })
  const [saving, setSaving] = useState(null) // 'draft' | 'submit'
  const [tried, setTried] = useState(false)
  // The order asked for last: an answer that arrives for an earlier pick is dropped.
  const latest = useRef(null)

  const loadOrder = async (id, draft = null) => {
    latest.current = id || null
    setPicked(id || '')
    setInfo(null)
    setRows([])
    if (!id) { setLoadingOrder(false); return }
    setLoadingOrder(true)
    let r = null, failed = null
    try { r = await purchaseApi.getBillCandidates({ orderId: id }) } catch (err) { failed = err }
    if (latest.current !== id) return
    setLoadingOrder(false)
    if (failed) {
      showApiError(failed, 'Could not open that order for billing')
      if (draft) onOpenChange(false)
      else { latest.current = null; setPicked('') }
      return
    }
    const data = r?.data ?? {}
    setInfo(data)
    setSections(r?.meta?.tdsSections ?? [])
    setRows(rowsFor(data.lines ?? [], draft))
    setTds(draft ? tdsFrom(draft.tdsSection, draft.tdsRate) : tdsFrom(data.tds?.section, data.tds?.rate))
  }

  useEffect(() => {
    if (!open) return
    let alive = true
    setTried(false)
    setSaving(null)
    setHead(bill ? {
      vendorInvoiceNumber: bill.vendorInvoiceNumber || '',
      vendorInvoiceDate: bill.vendorInvoiceDate ? String(bill.vendorInvoiceDate).slice(0, 10) : localYmd(),
      invoiceTotal: bill.invoiceTotal != null ? String(bill.invoiceTotal) : '',
      notes: bill.notes || '',
    } : blankHead())
    // A draft stays on its order; a new bill can still change its order, so it needs the list.
    if (!bill) {
      setLoadingList(true)
      purchaseApi.getBillCandidates()
        .then((r) => { if (alive) setCandidates(Array.isArray(r?.data) ? r.data : []) })
        .catch((err) => { if (alive) showApiError(err, 'Could not load the orders waiting for a bill') })
        .finally(() => { if (alive) setLoadingList(false) })
    }
    loadOrder(bill?.orderId || orderId || '', bill || null)
    return () => { alive = false; latest.current = null }
  }, [open, bill, orderId])

  const candidateOptions = useMemo(() => candidates.map((c) => ({
    value: c.orderId, label: c.number,
    sublabel: `${c.vendorName} · ${c.unbilledLines} line${c.unbilledLines === 1 ? '' : 's'} · ${formatMoney(c.unbilledValue)} to bill`,
  })), [candidates])

  const sectionOptions = useMemo(() => {
    const list = sections.map((s) => ({ value: s.section, label: s.label || s.section }))
    if (tds.section !== NONE && !list.some((o) => o.value === tds.section)) list.push({ value: tds.section, label: tds.section })
    return list
  }, [sections, tds.section])

  const set = (i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  // Ticking a line back on fills it with what is left to bill, if it was empty.
  const tick = (i, on) => setRows((rs) => rs.map((r, k) => (k !== i ? r
    : { ...r, on, ...(on && r.quantity === '' && r.line.billable > 0 ? { quantity: String(qty(r.line.billable)) } : {}) })))
  const pickSection = (v) => {
    if (v === NONE) { setTds({ section: NONE, rate: '' }); return }
    // The vendor's own section comes with the rate the server worked out for
    // them (higher without a PAN); any other takes that section's usual rate.
    const rate = v === info?.tds?.section ? info.tds.rate : sections.find((s) => s.section === v)?.rate
    setTds(tdsFrom(v, rate))
  }

  const order = info?.order
  const vendor = order?.vendor || {}
  const gstType = order?.gstType || 'intra'
  const problems = rows.map(lineProblem)
  const diffs = rows.map((r, i) => (r.on && !problems[i]
    ? billLineDifferences(r, { billable: r.line.billable, netRate: r.line.netRate, gstRate: r.line.gstRate, unitCode: r.line.unitCode })
    : []))
  const amounts = rows.map((r) => (r.on ? lineAmounts(r, gstType) : null))
  const totals = orderTotals(amounts.filter(Boolean), gstType)
  const tdsRate = tds.section === NONE ? 0 : Number(tds.rate) || 0
  const tdsAmount = tdsAmountFor(totals.subtotal, tdsRate)
  const payable = Math.round((totals.total - tdsAmount) * 100) / 100
  const due = dueDateFor(head.vendorInvoiceDate, info?.dueDays)
  const billing = rows.filter((r) => r.on)
  const differing = diffs.filter((d) => d.length > 0).length
  const nothingLeft = !editing && !!info && rows.length > 0 && rows.every((r) => !(r.line.billable > 0))

  // The bill's own boxes. The printed total is checked against ours: within ₹1
  // (the vendor's round-off) it agrees; beyond that the bill differs — a line
  // typed wrong, or a charge the order never had (freight) — and, as the server
  // does, it goes on hold for Finance rather than being refused here.
  const invoiceNoProblem = head.vendorInvoiceNumber.trim() ? null : NO_INVOICE
  const dateProblem = !head.vendorInvoiceDate ? NO_DATE : head.vendorInvoiceDate > today ? 'The invoice cannot be dated in the future' : null
  // An invoice dated before its order was raised (the date the order is
  // printed with) is allowed — the order may have been typed in after the
  // vendor billed — but it is usually a wrong date, so it is pointed out.
  // Compared as calendar days, as the date box holds them.
  const invoiceBeforeOrder = !dateProblem && !!order?.orderDate && head.vendorInvoiceDate < localYmd(new Date(order.orderDate))
  const totalGap = isNum(head.invoiceTotal) ? Math.round((Number(head.invoiceTotal) - totals.total) * 100) / 100 : null
  const totalProblem = head.invoiceTotal !== '' && !isNum(head.invoiceTotal) ? 'The total is not a number' : null
  const totalOff = !totalProblem && totalGap != null && billing.length > 0 && Math.abs(totalGap) > 1
  const totalNote = totalOff ? `Our total is ${formatMoney(totals.total)} — ${formatMoney(Math.abs(totalGap))} ${totalGap > 0 ? 'less' : 'more'} than the invoice. Check each line; if it stands, Finance decides.` : null
  const matches = differing === 0 && !totalOff
  const holdWhy = [differing && `${differing} line${differing === 1 ? ' differs' : 's differ'}`, totalOff && 'total differs'].filter(Boolean).join(', ')
  const tdsProblem = tds.section !== NONE && !(isNum(tds.rate) && Number(tds.rate) <= 100) ? 'TDS rate is 0 to 100%' : null
  const blocking = !billing.length || [invoiceNoProblem, dateProblem, totalProblem, tdsProblem, ...problems].some(Boolean)
  const shown = (p) => (p && (tried || !EMPTY.has(p)) ? p : null)

  const body = () => ({
    orderId: picked,
    vendorInvoiceNumber: head.vendorInvoiceNumber.trim(),
    vendorInvoiceDate: head.vendorInvoiceDate,
    invoiceTotal: head.invoiceTotal === '' ? null : Number(head.invoiceTotal),
    tdsSection: tds.section === NONE ? null : tds.section,
    tdsRate: tdsRate,
    notes: head.notes.trim(),
    lines: billing.map((r) => ({
      orderLineId: r.line.orderLineId, quantity: qty(r.quantity), rate: Number(r.rate),
      discountPct: Number(r.discountPct) || 0, gstRate: Number(r.gstRate) || 0,
    })),
  })

  const save = async (submit) => {
    setTried(true)
    if (!billing.length) { toast.error('Tick at least one line the vendor billed'); return }
    if (blocking) { toast.error('Fix what is marked in red'); return }
    setSaving(submit ? 'submit' : 'draft')
    try {
      let saved
      let answer // the last response — it may carry a notification warning
      if (editing) {
        saved = (await purchaseApi.saveBill(bill.id, body())).data
        if (submit) {
          try {
            answer = await purchaseApi.submitBill(saved.id)
            saved = { ...saved, ...answer.data }
          } catch (err) {
            showApiError(err, `${saved.number} is saved as a draft but could not be submitted`)
            onOpenChange(false)
            onSaved?.(saved)
            return
          }
        }
      } else {
        answer = await purchaseApi.createBill({ ...body(), ...(submit ? { submit: true } : {}) })
        saved = answer.data
      }
      toast.success(billOutcomeText(saved))
      showNotifyWarning(answer)
      onOpenChange(false)
      onSaved?.(saved)
    } catch (err) {
      showApiError(err, 'Could not save the bill')
    } finally {
      setSaving(null)
    }
  }

  const loading = loadingOrder || (!picked && loadingList)
  const ready = !!info && !loadingOrder

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-7xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <ReceiptText className="h-5 w-5 shrink-0 text-blue-600" />
            {editing ? <span>Bill <span className="font-mono">{bill.number}</span></span> : 'Enter vendor bill'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Correct the draft against the vendor\'s invoice, then submit it.'
              : 'Pick the order, then type the vendor\'s invoice number and date. Everything else comes from the order and the goods received.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : !picked ? (
          // ── Which order is this bill for? ──
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Purchase order *</Label>
              <SearchableSelect className="w-full" options={candidateOptions} value={picked} onChange={(v) => loadOrder(v)}
                placeholder="Which order is this bill for?" searchPlaceholder="PO number or vendor"
                emptyText="No order is waiting for a bill" />
            </div>
            {candidates.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Waiting for a bill — goods received, not billed yet</h3>
                <ul className="divide-y rounded-md border">
                  {candidates.slice(0, PICK_LIST).map((c) => (
                    <li key={c.orderId}>
                      <button type="button" onClick={() => loadOrder(c.orderId)}
                        className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-left text-sm hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none">
                        <span className="min-w-0">
                          <span className="font-mono font-medium text-blue-700">{c.number}</span>
                          <span className="font-medium text-gray-800"> · {c.vendorName}</span>
                        </span>
                        <span className="text-gray-500">
                          {c.unbilledLines} line{c.unbilledLines === 1 ? '' : 's'} · <b className="tabular-nums text-gray-800">{formatMoney(c.unbilledValue)}</b>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {candidates.length > PICK_LIST && <p className="mt-1 text-xs text-gray-500">{candidates.length - PICK_LIST} more — search for them above.</p>}
              </section>
            ) : (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-gray-500">
                <PackageCheck className="h-10 w-10 text-green-500" />
                <p className="font-medium text-gray-700">Nothing is waiting for a bill</p>
                <p className="max-w-md text-sm">A bill is entered against goods received. Once the store receives an order's goods, it appears here.</p>
              </div>
            )}
          </div>
        ) : ready && (
          <div className="space-y-5">
            {/* ── The order, and who the vendor is for tax ── */}
            <div className="flex flex-col gap-3 rounded-lg border bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium text-blue-700">{order?.number}</span>
                  <span className="font-semibold">{order?.vendorName}</span>
                  <Badge variant="outline">{GST_TYPE_LABEL[gstType] || gstType}</Badge>
                  {info.msme && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">MSME</Badge>}
                </div>
                <p className="text-xs text-gray-500">
                  {vendor.gstNumber ? <>GSTIN <span className="font-mono">{vendor.gstNumber}</span></> : 'Not GST-registered'}
                  {' · '}{vendor.pan ? <>PAN <span className="font-mono">{vendor.pan}</span></> : <span className="text-amber-700">No PAN on record</span>}
                  {info.dueDays != null && <> · pays in {info.dueDays} days</>}
                </p>
              </div>
              {!editing && (
                <Button type="button" variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" disabled={!!saving} onClick={() => loadOrder('')}>
                  Change order
                </Button>
              )}
            </div>

            {/* ── What the vendor's invoice says ── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="bill-no">Vendor's invoice no. *</Label>
                <Input id="bill-no" autoFocus value={head.vendorInvoiceNumber} maxLength={60} placeholder="As printed on the bill"
                  className={shown(invoiceNoProblem) ? 'border-red-400' : ''}
                  onChange={(e) => setHead((h) => ({ ...h, vendorInvoiceNumber: e.target.value }))} />
                <FieldError message={shown(invoiceNoProblem)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bill-date">Invoice date *</Label>
                <Input id="bill-date" type="date" max={today} value={head.vendorInvoiceDate}
                  className={shown(dateProblem) ? 'border-red-400' : ''}
                  onChange={(e) => setHead((h) => ({ ...h, vendorInvoiceDate: e.target.value }))} />
                <FieldError message={shown(dateProblem)} />
                {invoiceBeforeOrder && (
                  <p role="status" className="mt-1 flex items-start gap-1 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Invoice dated before {order.number} was raised on {formatDateTime(order.orderDate, { withTime: false })} — check the date
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="bill-total">Invoice total <span className="font-normal text-gray-400">(as printed, optional)</span></Label>
                <Input id="bill-total" inputMode="decimal" className={`text-right ${totalProblem ? 'border-red-400' : ''}`} placeholder="Checks the lines add up"
                  value={head.invoiceTotal} onChange={(e) => setHead((h) => ({ ...h, invoiceTotal: decimal(e.target.value) }))} />
                {totalProblem
                  ? <FieldError message={totalProblem} />
                  : totalOff
                    ? <p className="mt-1 flex items-start gap-1 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{totalNote}</p>
                    : totalGap != null && billing.length > 0 && <p className="mt-1 flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />Agrees with our total</p>}
              </div>
            </div>

            {/* ── The lines ── */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-600">Filled from the order and the goods received. Change only what the invoice says differently.</p>
                <Button type="button" variant="outline" size="sm" disabled={!!saving} onClick={() => setRows(rowsFor(info.lines ?? [], null))}>
                  <RotateCcw className="h-4 w-4 mr-1" />Fill from the order again
                </Button>
              </div>
              {nothingLeft && (
                <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Everything received on {order?.number} is billed already. Tick a line only if the vendor has billed it again.
                </p>
              )}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="w-10 px-2 py-2"><span className="sr-only">On this bill</span></th>
                      <th className="text-left font-medium px-2 py-2 min-w-[200px]">Item</th>
                      <th className="text-right font-medium px-2 py-2">Received</th>
                      <th className="text-right font-medium px-2 py-2">Billed before</th>
                      <th className="text-right font-medium px-2 py-2">Billable</th>
                      <th className="text-center font-medium px-2 py-2 w-36">Bill qty</th>
                      <th className="text-right font-medium px-2 py-2">Order rate</th>
                      <th className="text-right font-medium px-2 py-2 w-28">Bill rate ₹</th>
                      <th className="text-right font-medium px-2 py-2 w-20">Disc %</th>
                      <th className="text-right font-medium px-2 py-2 w-20">GST %</th>
                      <th className="text-right font-medium px-2 py-2">Amount</th>
                      <th className="text-left font-medium px-2 py-2 w-48">Match</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r, i) => {
                      const l = r.line
                      const problem = shown(problems[i])
                      const d = diffs[i]
                      const off = (kind) => d.some((x) => x.kind === kind)
                      const a = amounts[i]
                      return (
                        <tr key={l.orderLineId} className={!r.on ? 'bg-gray-50/70' : problem ? 'bg-red-50/40' : undefined}>
                          <td className="px-2 pt-4 pb-2 align-top">
                            <Checkbox checked={r.on} onCheckedChange={(v) => tick(i, !!v)} aria-label={`${l.itemName} is on this bill`} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div className={r.on ? 'font-medium' : 'font-medium text-gray-500'}>{l.itemName}</div>
                            <div className="text-xs text-gray-500">
                              {l.itemCode}{l.hsnCode && ` · HSN ${l.hsnCode}`}{l.ordered != null && ` · ordered ${qty(l.ordered)} ${l.unitCode}`}
                            </div>
                            <FieldError message={problem} />
                          </td>
                          <td className="px-2 pt-4 pb-2 align-top text-right whitespace-nowrap tabular-nums">{l.received != null ? `${qty(l.received)} ${l.unitCode}` : '—'}</td>
                          <td className="px-2 pt-4 pb-2 align-top text-right whitespace-nowrap tabular-nums text-gray-500">{l.billed > 0 ? qty(l.billed) : '—'}</td>
                          <td className={`px-2 pt-4 pb-2 align-top text-right whitespace-nowrap tabular-nums font-semibold ${l.billable > 0 ? 'text-green-700' : 'text-gray-400'}`}>{qty(l.billable)}</td>
                          <td className="px-2 py-2 align-top">
                            <QuantityInput aria-label={`${l.itemName} quantity billed`} value={r.quantity} disabled={!r.on}
                              className={r.on && off('qty') ? 'border-amber-400' : undefined} onChange={(v) => set(i, { quantity: v })} />
                          </td>
                          <td className="px-2 pt-4 pb-2 align-top text-right whitespace-nowrap tabular-nums">
                            {l.rate != null ? formatMoney(l.rate) : '—'}
                            {Number(l.discountPct) > 0 && <div className="text-[11px] text-gray-500">less {l.discountPct}% = {formatMoney(l.netRate)}</div>}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <Input aria-label={`${l.itemName} rate billed`} inputMode="decimal" disabled={!r.on} value={r.rate} placeholder="Rate"
                              className={`text-right ${r.on && off('rate') ? 'border-amber-400' : ''}`} onChange={(e) => set(i, { rate: decimal(e.target.value) })} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <Input aria-label={`${l.itemName} discount %`} inputMode="decimal" disabled={!r.on} value={r.discountPct} placeholder="0"
                              className={`text-right ${r.on && off('rate') ? 'border-amber-400' : ''}`} onChange={(e) => set(i, { discountPct: decimal(e.target.value) })} />
                          </td>
                          <td className="px-2 py-2 align-top">
                            {gstType === 'none' ? (
                              <div className="pt-2 text-right text-gray-400">—</div>
                            ) : (
                              <Input aria-label={`${l.itemName} GST %`} inputMode="decimal" disabled={!r.on} value={r.gstRate} placeholder="0"
                                className={`text-right ${r.on && off('gst') ? 'border-amber-400' : ''}`} onChange={(e) => set(i, { gstRate: decimal(e.target.value) })} />
                            )}
                          </td>
                          <td className="px-2 pt-4 pb-2 align-top text-right whitespace-nowrap font-medium tabular-nums">{a ? formatMoney(a.lineTotal) : '—'}</td>
                          <td className="px-2 py-2 align-top text-xs">
                            {!r.on ? <span className="inline-block pt-2.5 text-gray-400">Not on this bill</span>
                              : problems[i] ? <span className="inline-block pt-2.5 text-gray-400">—</span>
                              : d.length === 0 ? <span className="inline-flex items-center gap-1 pt-2.5 font-medium text-green-700"><CheckCircle2 className="h-4 w-4" />Matches</span>
                              : (
                                <ul className="space-y-0.5 pt-1 text-amber-800">
                                  {d.map((x) => <li key={x.kind} className="flex items-start gap-1"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />{x.text}</li>)}
                                </ul>
                              )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="flex items-start gap-1 text-xs text-gray-500">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" />Untick a line the vendor has not billed — it stays to be billed later. Billing less than received is fine; more than received, or another rate or GST, goes to Finance.
              </p>
              {tried && !billing.length && <FieldError message="Tick at least one line the vendor billed" />}
            </div>

            {/* ── TDS and the note | the totals ── */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="bill-tds">TDS</Label>
                  <div className="flex gap-2">
                    <Select value={tds.section} onValueChange={pickSection}>
                      <SelectTrigger id="bill-tds" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No TDS</SelectItem>
                        {sectionOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {tds.section !== NONE && (
                      <div className="relative w-24 shrink-0">
                        <Input aria-label="TDS rate %" inputMode="decimal" className={`pr-7 text-right ${tdsProblem ? 'border-red-400' : ''}`} value={tds.rate}
                          onChange={(e) => setTds((t) => ({ ...t, rate: decimal(e.target.value) }))} />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
                      </div>
                    )}
                  </div>
                  <FieldError message={tdsProblem} />
                  {info.tds?.note && <p className="text-xs text-gray-500">{info.tds.note}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bill-notes">Note <span className="font-normal text-gray-400">(optional)</span></Label>
                  <Input id="bill-notes" value={head.notes} maxLength={500} placeholder="e.g. Vendor added freight; credit note promised"
                    onChange={(e) => setHead((h) => ({ ...h, notes: e.target.value }))} />
                </div>
              </div>

              <dl className="self-start space-y-1.5 rounded-md bg-gray-50 p-4 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-gray-500">Subtotal (before GST)</dt><dd className="tabular-nums">{formatMoney(totals.subtotal)}</dd></div>
                {gstType === 'intra' && <>
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">CGST</dt><dd className="tabular-nums">{formatMoney(totals.cgst)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">SGST</dt><dd className="tabular-nums">{formatMoney(totals.sgst)}</dd></div>
                </>}
                {gstType === 'inter' && <div className="flex justify-between gap-4"><dt className="text-gray-500">IGST</dt><dd className="tabular-nums">{formatMoney(totals.igst)}</dd></div>}
                {gstType === 'none' && <div className="flex justify-between gap-4"><dt className="text-gray-500">GST</dt><dd className="text-right text-gray-500">No GST — vendor not registered</dd></div>}
                <div className="flex justify-between gap-4 border-t pt-2"><dt className="font-semibold">Bill total</dt><dd className="font-bold tabular-nums">{formatMoney(totals.total)}</dd></div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">{tdsRate > 0 ? `TDS ${tds.section} @ ${tdsRate}% (on ${formatMoney(totals.subtotal)})` : 'TDS'}</dt>
                  <dd className={`tabular-nums ${tdsAmount > 0 ? 'text-red-700' : 'text-gray-500'}`}>{tdsAmount > 0 ? `− ${formatMoney(tdsAmount)}` : 'None'}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t pt-2"><dt className="font-semibold">Payable to vendor</dt><dd className="text-xl font-bold tabular-nums">{formatMoney(payable)}</dd></div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Due</dt>
                  <dd className="text-right">
                    {due ? <>{dayText(due)}<span className="block text-xs text-gray-500">{info.dueDays} days from the invoice date</span></> : <span className="text-gray-500">No payment terms on the order</span>}
                  </dd>
                </div>
                {info.msme && <p className="text-xs font-medium text-blue-700">MSME: payable within 45 days</p>}
              </dl>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:items-center">
          {ready && billing.length > 0 && (
            <p className="text-sm text-gray-600 sm:mr-auto">
              {matches
                ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-4 w-4" />Every line agrees with the order and the goods received</span>
                : <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle className="h-4 w-4" />{holdWhy} — Finance will decide</span>}
            </p>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!saving}>Close</Button>
          {ready && (
            <>
              {/* Not disabled for an empty or wrong form: a click says what is missing. */}
              <Button variant="outline" onClick={() => save(false)} disabled={!!saving}>
                {saving === 'draft' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save draft
              </Button>
              {/* The label says what submitting will do, so nobody is surprised by "on hold". */}
              <Button onClick={() => save(true)} disabled={!!saving}
                className={`h-auto min-h-9 whitespace-normal ${matches ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                {saving === 'submit' ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : matches ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                {!billing.length ? 'Submit' : matches ? 'Submit — matches, will be approved' : `Submit — goes on hold for Finance (${holdWhy})`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
