import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, CheckCircle2, XCircle, Pencil, Trash2, RotateCcw, Ban, AlertTriangle, PauseCircle, Wallet, FileText, ExternalLink, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { purchasePaymentApi } from '@/api/purchasePaymentApi'
import { paymentAccess, usePaymentMode, billStillDue, billOwedByVendor, PAYMENT_STATUS, modeLabel } from './paymentAccess'
import PaymentForm from './PaymentForm'
import LoadFailed from './LoadFailed'
import { showApiError } from '@/lib/apiRequest'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime } from '@/lib/format'
import { BILL_STATUS, GST_TYPE_LABEL, useMe, ownsOrAdmin, showNotifyWarning } from './requestMeta'
import { billLineDifferences, netRateOf, billOutcomeText, billOverdue, dueDateFor } from './orderMath'

// One vendor bill, beside its order and the goods received: every line shows
// what was billed, what was left to bill, the order's rate, and whether it
// agrees — and if not, why, in words. The totals end in what the vendor is
// paid (after TDS) and by when.
//
// The buttons are the next step for this person and this status:
//   draft     — its maker corrects it, submits it, or deletes it
//   on hold   — Finance approves it anyway (a remark is optional) or rejects
//               it back (a reason is needed); not a bill they entered
//               themselves, unless they are an administrator
//   rejected  — its maker reopens it to correct
//   approved  — Finance can cancel it while nothing has been paid on it; whoever
//               records payments in this hospital (Settings → Purchase) pays it
//               ("Pay", the payment form), and its payments are listed under it
// The server decides each again; these only choose what to show.

const day = (v) => formatDateTime(v, { withTime: false })

// The kinds of file that can hang off a bill — the vendor's own invoice, any
// paper that supports it (delivery challan, e-way bill), or anything else.
const BILL_DOC_TYPE = { invoice: "Vendor's invoice", supporting: 'Supporting document', other: 'Other' }

// Why a saved line was held. The server's flags decide ✔ or ⚠; the words come
// from the same comparison the form made. A saved line does not keep the
// order's GST rate, so a rate that agrees but is still flagged means its GST differs.
function heldBecause(l) {
  const d = billLineDifferences(l, { billable: l.billableQty, netRate: l.orderRate, unitCode: l.unitCode })
  const out = []
  if (l.qtyOk === false) out.push(d.find((x) => x.kind === 'qty')?.text || 'More than received')
  if (l.rateOk === false) out.push(d.find((x) => x.kind === 'rate')?.text || 'GST rate differs from the order')
  return out
}

export default function BillDetail({ id, open, onOpenChange, onEdit, onChanged, onOpenOrder }) {
  const me = useMe()
  const [loaded, setLoaded] = useState(null)
  const [busy, setBusy] = useState(null)
  const [asking, setAsking] = useState(null) // 'approve' | 'reject' | 'cancel'
  const [remark, setRemark] = useState('')
  // Only the bill asked for is shown — the last one opened never flashes up
  // while this one loads.
  const bill = loaded && loaded.id === id ? loaded : null

  // Held in a ref: the list passes an inline arrow, and a new one on each of
  // its refreshes must not re-open this dialog (that would wipe a remark
  // being typed).
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  // The payments made on the bill: for those who see payments, once it is approved.
  const [payments, setPayments] = useState(null)
  const [paymentsFailed, setPaymentsFailed] = useState(false)
  const [paying, setPaying] = useState(false)
  // Attaching the vendor's invoice / supporting files to this bill.
  const [docType, setDocType] = useState('invoice')
  const [docLabel, setDocLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)
  const settings = usePaymentMode(open && me.canSeePayments)
  const pay = paymentAccess(me, settings.mode)
  const load = useCallback(async () => {
    if (!id) return
    let next
    try { next = (await purchaseApi.getBill(id)).data; setLoaded(next) } catch (err) { showApiError(err, 'Could not open the bill'); close.current(false); return }
    if (!me.canSeePayments || next.status !== 'approved') { setPayments(null); return }
    try {
      setPayments((await purchasePaymentApi.getPayments({ billId: id })).data || [])
      setPaymentsFailed(false)
    } catch {
      // The bill itself loaded; the line under it says the payments did not.
      setPaymentsFailed(true)
    }
  }, [id, me.canSeePayments])
  useEffect(() => { if (open) { setAsking(null); setRemark(''); load() } }, [open, load])
  // Finance deciding it on another screen shows here without reopening it.
  useLiveData(open ? 'purchase' : null, load)

  // `after(bill)` runs once it worked — reopening goes straight on to the correction.
  const run = async (key, call, message, after) => {
    setBusy(key)
    try {
      const r = await call()
      const next = { ...bill, ...(r?.data || {}) }
      toast.success(typeof message === 'function' ? message(next) : message)
      showNotifyWarning(r)
      setAsking(null)
      setRemark('')
      if (key === 'delete') onOpenChange(false); else setLoaded(next)
      onChanged?.()
      after?.(next)
    } catch (err) {
      showApiError(err, 'Could not complete that')
      load()
    } finally {
      setBusy(null)
    }
  }

  // Attach one file, then reload the bill so its documents list refreshes.
  const uploadDoc = async (file) => {
    if (!bill || !file) return
    setUploading(true)
    try {
      await purchaseApi.uploadBillDoc(bill.id, docType, docLabel.trim() || null, file)
      toast.success('Document attached')
      setDocLabel('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await load()
    } catch (err) {
      showApiError(err, 'Could not attach the document')
    } finally {
      setUploading(false)
    }
  }

  const deleteDoc = async (doc) => {
    if (!window.confirm(`Remove "${doc.label || doc.fileName}"?`)) return
    try {
      await purchaseApi.deleteBillDoc(doc.id)
      toast.success('Document removed')
      await load()
    } catch (err) {
      showApiError(err, 'Could not remove the document')
    }
  }

  const lines = bill?.lines ?? []
  const status = bill && (BILL_STATUS[bill.status] || BILL_STATUS.draft)
  const mine = !!bill && me.canBill && ownsOrAdmin(me, { requestedById: bill.createdById })
  // Whether it agrees with the order and the goods: a submitted bill says so
  // (matched); a draft is only checked when it is sent, so its saved preview —
  // the per-line flags and the difference text — tells what will happen.
  const agrees = !!bill && (bill.status === 'draft'
    ? !bill.mismatch && (bill.lines || []).every((l) => l.qtyOk !== false && l.rateOk !== false)
    : bill.matched)
  const enteredIt = !!bill && !!me.id && me.id === bill.createdById
  const decide = bill?.status === 'on_hold' && me.canDecideBill && (me.isAdmin || !enteredIt)
  // The server refuses to cancel a bill with payments (posted or waiting for
  // approval) or posted returns on it, naming them; the button is not offered.
  const hasPayments = Number(bill?.amountPaid) > 0 || !!payments?.some((p) => p.status === 'posted' || p.status === 'pending_approval')
  const canCancel = bill?.status === 'approved' && me.canDecideBill && !hasPayments && !(Number(bill.debitNoteTotal) > 0)
  const held = lines.map(heldBecause)
  const differing = held.filter((h) => h.length > 0).length
  const overdue = !!bill && billOverdue(bill)
  // A draft may not carry its due date yet; it is the invoice date plus the terms, as the form showed it.
  const dueYmd = bill && !bill.dueDate && bill.vendorInvoiceDate ? dueDateFor(String(bill.vendorInvoiceDate).slice(0, 10), bill.paymentTermsDays) : null
  const dueText = bill?.dueDate ? day(bill.dueDate) : dueYmd ? day(`${dueYmd}T00:00:00`) : null
  // Still due: payable, less debit notes (goods returned), less posted payments.
  const balance = billStillDue(bill)
  // Returns worth more than was left to pay: the vendor owes the hospital.
  const vendorOwes = billOwedByVendor(bill)
  // This hospital may require the vendor's invoice file attached before paying.
  const hasInvoiceDoc = (bill?.documents ?? []).some((d) => d.docType === 'invoice')
  const invoiceRequiredMissing = settings.requireInvoice && !hasInvoiceDoc
  const canPay = bill?.status === 'approved' && balance > 0 && pay.canRecord && !invoiceRequiredMissing
  const needsText = asking === 'reject' || asking === 'cancel'
  // Who may attach / remove a bill's files — the same roles the server allows
  // (purchase officer, Finance, admin). Everyone who can open the bill sees them.
  const canManageDocs = !!bill && (me.canBill || me.canDecideBill || me.isAdmin)
  const docs = bill?.documents ?? []

  const confirmAsked = () => {
    const text = remark.trim()
    if (asking === 'approve') return run('approve', () => purchaseApi.approveBill(bill.id, text), `${bill.number} approved for payment`)
    if (asking === 'reject') return run('reject', () => purchaseApi.rejectBill(bill.id, text), `${bill.number} rejected — sent back to ${bill.createdByName || 'its maker'} to correct`)
    if (asking === 'cancel') return run('cancel', () => purchaseApi.cancelBill(bill.id, text), `${bill.number} cancelled`)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        {!bill ? (
          <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle className="font-mono">{bill.number}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
                {/* On hold already says "mismatch". */}
                {bill.status !== 'on_hold' && (agrees
                  ? <Badge variant="outline" className="gap-1 border-green-200 bg-green-50 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />Matches</Badge>
                  : <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />Mismatch</Badge>)}
                {bill.gstType && <Badge variant="outline">{GST_TYPE_LABEL[bill.gstType] || bill.gstType}</Badge>}
                {bill.currency && bill.currency !== 'INR' && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{bill.currency} @ ₹{bill.exchangeRate}</Badge>}
              </div>
              <DialogDescription>
                {bill.vendorName} · invoice <span className="font-medium text-gray-700">{bill.vendorInvoiceNumber}</span>
                {bill.vendorInvoiceDate && <> of {day(bill.vendorInvoiceDate)}</>}
                {' '}· against{' '}
                {onOpenOrder && bill.order?.id
                  ? <button type="button" className="font-mono text-blue-700 hover:underline" onClick={() => onOpenOrder(bill.order.id)}>{bill.order.number}</button>
                  : <span className="font-mono">{bill.order?.number}</span>}
                {' '}· entered by {bill.createdByName} on {formatDateTime(bill.createdAt)}
                {bill.submittedAt && <> · submitted {formatDateTime(bill.submittedAt)}</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {/* ── Where it stands, and why ── */}
              {bill.status === 'on_hold' && (
                <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="flex items-center gap-1.5 font-semibold"><PauseCircle className="h-4 w-4 shrink-0" />On hold — it does not agree with the order or the goods received</p>
                  {bill.mismatch && <p className="whitespace-pre-line">{bill.mismatch}</p>}
                  <p className="text-xs text-amber-800">
                    {decide ? 'Approve it if the difference is agreed with the vendor; reject it to have it corrected.'
                      : me.canDecideBill && enteredIt ? 'You entered this bill, so another Finance person decides it.'
                      : 'Finance will approve it, or reject it back to be corrected.'}
                  </p>
                </div>
              )}
              {bill.status === 'draft' && !agrees && bill.mismatch && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-semibold">Differences — on submitting, this bill goes on hold for Finance</p>
                  <p className="whitespace-pre-line">{bill.mismatch}</p>
                </div>
              )}
              {bill.status === 'rejected' && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <p><span className="font-semibold">Rejected{bill.decidedByName && ` by ${bill.decidedByName}`}{bill.decidedAt && ` on ${formatDateTime(bill.decidedAt)}`}: </span>{bill.decisionRemark || 'no reason given'}</p>
                  {bill.mismatch && <p className="mt-1 whitespace-pre-line text-xs">What differed: {bill.mismatch}</p>}
                  {mine && <p className="mt-1 text-xs">Reopen it to correct it against the vendor's invoice and submit it again.</p>}
                </div>
              )}
              {['approved', 'partly_paid', 'paid'].includes(bill.status) && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                  {bill.decidedByName
                    ? <p><span className="font-semibold">Approved by {bill.decidedByName}{bill.decidedAt && ` on ${formatDateTime(bill.decidedAt)}`}</span>{bill.decisionRemark && <>: {bill.decisionRemark}</>}</p>
                    : <p className="font-semibold">Approved on submitting — every line agreed with the order and the goods received.</p>}
                  {bill.mismatch && <p className="mt-1 whitespace-pre-line text-xs">Differences accepted: {bill.mismatch}</p>}
                </div>
              )}
              {bill.status === 'cancelled' && (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm">
                  <span className="text-gray-500">Cancelled{bill.cancelledAt && ` on ${formatDateTime(bill.cancelledAt)}`}: </span>{bill.cancelReason}
                </p>
              )}

              {/* ── The lines: billed vs the order vs received ── */}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Item</th>
                      <th className="text-right font-medium px-3 py-2">Billed</th>
                      <th className="text-right font-medium px-3 py-2" title="Received and not billed before, when this bill was entered">Billable</th>
                      <th className="text-right font-medium px-3 py-2">Order rate</th>
                      <th className="text-right font-medium px-3 py-2">Billed rate</th>
                      <th className="text-right font-medium px-3 py-2">GST</th>
                      <th className="text-right font-medium px-3 py-2">Amount</th>
                      <th className="text-left font-medium px-3 py-2 w-52">Match</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((l, i) => {
                      const why = held[i]
                      const net = netRateOf(l.rate, l.discountPct)
                      return (
                        <tr key={l.id} className={why.length ? 'bg-amber-50/40' : undefined}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{l.itemName}</div>
                            <div className="text-xs text-gray-500">{l.itemCode}{l.hsnCode && ` · HSN ${l.hsnCode}`}</div>
                          </td>
                          <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${l.qtyOk === false ? 'font-semibold text-amber-800' : ''}`}>{l.quantity} {l.unitCode}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-gray-600">{l.billableQty ?? '—'}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatMoney(l.orderRate)}</td>
                          <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${l.rateOk === false ? 'font-semibold text-amber-800' : ''}`}>
                            {formatMoney(l.rate)}
                            {Number(l.discountPct) > 0 && <div className="text-[11px] font-normal text-gray-500">less {l.discountPct}% = {formatMoney(net)}</div>}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-500">{bill.gstType === 'none' ? '—' : `${l.gstRate}%`}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(l.lineTotal)}</td>
                          <td className="px-3 py-2 text-xs">
                            {why.length === 0
                              ? <span className="inline-flex items-center gap-1 font-medium text-green-700"><CheckCircle2 className="h-4 w-4" />Matches</span>
                              : (
                                <ul className="space-y-0.5 text-amber-800">
                                  {why.map((t) => <li key={t} className="flex items-start gap-1"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />{t}</li>)}
                                </ul>
                              )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── The vendor | the money ── */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <div>
                    <div className="text-xs font-semibold text-gray-500">Vendor</div>
                    <p className="font-medium">{bill.vendor?.name || bill.vendorName}</p>
                    <p className="text-xs text-gray-500">
                      {bill.vendor?.gstNumber ? <>GSTIN <span className="font-mono">{bill.vendor.gstNumber}</span></> : 'Not GST-registered'}
                      {' · '}{bill.vendor?.pan ? <>PAN <span className="font-mono">{bill.vendor.pan}</span></> : 'No PAN on record'}
                      {bill.vendor?.msmeNumber && <> · MSME {bill.vendor.msmeNumber}</>}
                    </p>
                  </div>
                  {bill.notes && <div><div className="text-xs font-semibold text-gray-500">Note</div><p>{bill.notes}</p></div>}
                  {differing > 0 && bill.status !== 'on_hold' && (
                    <p className="text-xs text-amber-800">{differing} line{differing === 1 ? ' differs' : 's differ'} from the order or the goods received.</p>
                  )}
                </div>

                <dl className="self-start space-y-1.5 rounded-md bg-gray-50 p-4 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-gray-500">Subtotal (before GST)</dt><dd className="tabular-nums">{formatMoney(bill.subtotal)}</dd></div>
                  {bill.gstType === 'intra' && <>
                    <div className="flex justify-between gap-4"><dt className="text-gray-500">CGST</dt><dd className="tabular-nums">{formatMoney(bill.cgst)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-gray-500">SGST</dt><dd className="tabular-nums">{formatMoney(bill.sgst)}</dd></div>
                  </>}
                  {bill.gstType === 'inter' && <div className="flex justify-between gap-4"><dt className="text-gray-500">IGST</dt><dd className="tabular-nums">{formatMoney(bill.igst)}</dd></div>}
                  {bill.gstType === 'none' && <div className="flex justify-between gap-4"><dt className="text-gray-500">GST</dt><dd className="text-right text-gray-500">No GST — vendor not registered</dd></div>}
                  <div className="flex justify-between gap-4 border-t pt-2"><dt className="font-semibold">Bill total</dt><dd className="font-bold tabular-nums">{formatMoney(bill.total)}</dd></div>
                  {bill.currency && bill.currency !== 'INR' && bill.exchangeRate > 0 && (
                    <div className="flex justify-between gap-4 text-sm"><dt className="text-gray-500">= billed in {bill.currency}</dt><dd className="tabular-nums text-gray-600">{(bill.total / bill.exchangeRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
                  )}
                  {bill.invoiceTotal != null && (
                    <div className="flex justify-between gap-4"><dt className="text-gray-500">Vendor's invoice says</dt><dd className="tabular-nums text-gray-600">{formatMoney(bill.invoiceTotal)}</dd></div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">{bill.tdsSection ? `TDS ${bill.tdsSection} @ ${bill.tdsRate}%` : 'TDS'}</dt>
                    <dd className={`tabular-nums ${bill.tdsAmount > 0 ? 'text-red-700' : 'text-gray-500'}`}>{bill.tdsAmount > 0 ? `− ${formatMoney(bill.tdsAmount)}` : 'None'}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t pt-2"><dt className="font-semibold">Payable to vendor</dt><dd className="text-xl font-bold tabular-nums">{formatMoney(bill.payable)}</dd></div>
                  {Number(bill.debitNoteTotal) > 0 && (
                    <div className="flex justify-between gap-4"><dt className="text-gray-500">Debit notes (returns)</dt><dd className="tabular-nums text-red-700">− {formatMoney(bill.debitNoteTotal)}</dd></div>
                  )}
                  {Number(bill.amountPaid) > 0 && (
                    <div className="flex justify-between gap-4"><dt className="text-gray-500">Paid</dt><dd className="tabular-nums text-red-700">− {formatMoney(bill.amountPaid)}</dd></div>
                  )}
                  {bill.status === 'approved' && (
                    <div className="flex justify-between gap-4"><dt className="font-semibold">Still due</dt><dd className={`font-bold tabular-nums ${balance > 0 ? '' : vendorOwes > 0 ? 'text-red-700' : 'text-green-700'}`}>{balance > 0 ? formatMoney(balance) : vendorOwes > 0 ? `Vendor owes ${formatMoney(vendorOwes)}` : 'Fully paid'}</dd></div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Due</dt>
                    <dd className={`text-right ${overdue && balance > 0 ? 'font-semibold text-red-700' : ''}`}>
                      {dueText || '—'}{overdue && balance > 0 && ' · overdue'}
                      {dueText && bill.paymentTermsDays != null && <span className="block text-xs font-normal text-gray-500">{bill.paymentTermsDays} days from the invoice date</span>}
                    </dd>
                  </div>
                  {bill.vendor?.msmeNumber && <p className="text-xs font-medium text-blue-700">MSME: payable within 45 days</p>}
                </dl>
              </div>

              {/* ── Payments made on it ── */}
              {paymentsFailed && <LoadFailed onRetry={load}>Could not load the payments made on this bill.</LoadFailed>}
              {bill.status === 'approved' && balance > 0 && settings.error && (
                <LoadFailed onRetry={settings.retry}>Could not read who pays vendors in this hospital, so the Pay button is not shown.</LoadFailed>
              )}
              {bill.status === 'approved' && balance > 0 && invoiceRequiredMissing && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  This hospital requires the vendor's invoice to be attached before a bill can be paid. Attach it under “Invoice &amp; documents” below, then the Pay button appears.
                </p>
              )}
              {payments?.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[560px] text-sm">
                    <caption className="px-3 pt-2 text-left text-xs font-semibold text-gray-500">Payments on this bill</caption>
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="text-left font-medium px-3 py-2">Payment</th>
                        <th className="text-left font-medium px-3 py-2">Paid on</th>
                        <th className="text-left font-medium px-3 py-2">By</th>
                        <th className="text-right font-medium px-3 py-2">Amount</th>
                        <th className="text-left font-medium px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {payments.map((p) => {
                        const st = PAYMENT_STATUS[p.status] || PAYMENT_STATUS.posted
                        return (
                          <tr key={p.id}>
                            <td className="px-3 py-2 font-mono">{p.number}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{day(p.paidOn)}</td>
                            <td className="px-3 py-2">{modeLabel(p.mode)}{p.reference && <span className="ml-1 font-mono text-xs text-gray-500">{p.reference}</span>}
                              {p.paymentType && p.paymentType !== 'full' && <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] capitalize text-gray-600">{p.paymentType}</span>}
                              {p.isRecurring && <span className="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">recurring</span>}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.amount)}</td>
                            <td className="px-3 py-2"><Badge variant="outline" className={`whitespace-nowrap ${st.cls}`}>{st.label}</Badge></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Invoice & supporting files attached to this bill ── */}
              {(docs.length > 0 || canManageDocs) && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-gray-500">Invoice &amp; documents
                    {settings.requireInvoice && (hasInvoiceDoc
                      ? <span className="ml-2 font-normal text-green-600">✓ invoice attached</span>
                      : <span className="ml-2 font-normal text-amber-700">⚠ invoice pending</span>)}
                  </h3>
                  {docs.length === 0 ? (
                    <p className="text-xs italic text-gray-400">No files attached yet.</p>
                  ) : (
                    <div className="divide-y rounded-md border">
                      {docs.map((d) => (
                        <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{d.label || d.fileName}</p>
                              <p className="text-xs text-gray-500">{BILL_DOC_TYPE[d.docType] || d.docType} · {d.fileName} · {day(d.uploadedAt)}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {/* The file endpoint lives under /api (the only path the dev proxy forwards). */}
                            <a href={`/api${d.fileUrl}`} target="_blank" rel="noreferrer">
                              <Button type="button" size="icon" variant="ghost" title="Open file" aria-label="Open file">
                                <ExternalLink className="h-4 w-4 text-blue-600" />
                              </Button>
                            </a>
                            {canManageDocs && (
                              <Button type="button" size="icon" variant="ghost" title="Remove" aria-label="Remove file" onClick={() => deleteDoc(d)}>
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {canManageDocs && (
                    <div className="space-y-2 rounded-md border border-dashed p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-gray-500">File type</Label>
                          <Select value={docType} onValueChange={setDocType}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(BILL_DOC_TYPE).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-gray-500">Label <span className="font-normal text-gray-400">(optional, e.g. "Invoice INV-204")</span></Label>
                          <Input value={docLabel} onChange={(e) => setDocLabel(e.target.value)} placeholder="Leave blank to use the file name" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" className="hidden" id="bill-doc-upload"
                          onChange={(e) => uploadDoc(e.target.files?.[0])} />
                        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                          {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                          {uploading ? 'Uploading…' : 'Browse & upload'}
                        </Button>
                        <span className="text-xs text-gray-400">PDF, Word, JPG or PNG · max 10 MB</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {asking && (
                <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3">
                  <Label htmlFor="bill-remark">{asking === 'approve' ? 'Remark (optional)' : asking === 'reject' ? 'Why is it rejected? *' : 'Why is it cancelled? *'}</Label>
                  <Textarea id="bill-remark" rows={2} autoFocus value={remark} onChange={(e) => setRemark(e.target.value)}
                    placeholder={asking === 'approve' ? 'e.g. Rate increase agreed with the vendor by phone' : asking === 'reject' ? 'e.g. Bill at the order rate, or send a credit note' : 'e.g. Vendor sent a corrected invoice'} />
                  {asking === 'approve' && bill.mismatch && <p className="text-xs text-gray-600">It will be paid as billed: {formatMoney(bill.payable)}.</p>}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setAsking(null); setRemark('') }} disabled={!!busy}>Back</Button>
                    <Button size="sm" onClick={confirmAsked} disabled={!!busy || (needsText && remark.trim().length < 3)}
                      variant={asking === 'approve' ? 'default' : 'destructive'} className={asking === 'approve' ? 'bg-green-600 hover:bg-green-700' : undefined}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{asking === 'approve' ? 'Approve for payment' : asking === 'reject' ? 'Reject bill' : 'Cancel bill'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {!asking && (
              <DialogFooter className="gap-2 flex-wrap">
                {bill.status === 'draft' && mine && (
                  <>
                    <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy}
                      onClick={() => window.confirm(`Delete draft ${bill.number}?`) && run('delete', () => purchaseApi.deleteBill(bill.id), `${bill.number} deleted`)}>
                      <Trash2 className="h-4 w-4 mr-1" />Delete draft
                    </Button>
                    <Button variant="outline" disabled={!!busy} onClick={() => onEdit?.(bill)}><Pencil className="h-4 w-4 mr-1" />Edit</Button>
                    <Button disabled={!!busy} className={`h-auto min-h-9 whitespace-normal ${agrees ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                      onClick={() => run('submit', () => purchaseApi.submitBill(bill.id), billOutcomeText)}>
                      {busy === 'submit' ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : agrees ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                      {agrees ? 'Submit — matches, will be approved'
                        : `Submit — goes on hold for Finance${differing ? ` (${differing} line${differing === 1 ? ' differs' : 's differ'})` : ''}`}
                    </Button>
                  </>
                )}
                {canCancel && (
                  <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={!!busy} onClick={() => setAsking('cancel')}><Ban className="h-4 w-4 mr-1" />Cancel bill</Button>
                )}
                {decide && (
                  <>
                    <Button variant="outline" className="text-red-700 border-red-200" disabled={!!busy} onClick={() => setAsking('reject')}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
                    <Button className="bg-green-600 hover:bg-green-700" disabled={!!busy} onClick={() => setAsking('approve')}><CheckCircle2 className="h-4 w-4 mr-1" />Approve for payment</Button>
                  </>
                )}
                {bill.status === 'rejected' && mine && (
                  <Button variant="outline" disabled={!!busy}
                    onClick={() => run('reopen', () => purchaseApi.reopenBill(bill.id), `${bill.number} is a draft again — correct it and submit`, onEdit)}>
                    {busy === 'reopen' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}Reopen to correct
                  </Button>
                )}
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>Close</Button>
                {canPay && (
                  <Button disabled={!!busy} onClick={() => setPaying(true)}><Wallet className="h-4 w-4 mr-1" />Pay {formatMoney(balance)}</Button>
                )}
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
      {canPay && (
        <PaymentForm open={paying} onOpenChange={setPaying} billId={bill.id} recordsPending={pay.recordsPending}
          onSaved={() => { load(); onChanged?.() }} />
      )}
    </Dialog>
  )
}
