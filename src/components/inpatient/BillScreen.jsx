import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Loader2, Plus, IndianRupee, FileText, CheckCircle2, Printer, RefreshCw, Ban, Wallet, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import client from '@/api/client'
import { useAuth } from '@/lib/auth'

const SERVICE_GROUPS = ['PROCEDURE', 'LAB', 'RADIOLOGY', 'PHARMACY', 'CONSUMABLE', 'DOCTOR_VISIT', 'NURSING', 'OTHER']
const PAY_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE']
import { formatMoney as inr } from '@/lib/format'
const statusStyle = { DRAFT: 'bg-amber-100 text-amber-800', FINAL: 'bg-green-100 text-green-800', CANCELLED: 'bg-gray-200 text-gray-600' }
const payStatusStyle = { UNPAID: 'bg-red-100 text-red-800', PARTIAL: 'bg-amber-100 text-amber-800', PAID: 'bg-green-100 text-green-800', REFUNDED: 'bg-purple-100 text-purple-800' }
const ledgerTypeStyle = { ADVANCE: 'bg-blue-100 text-blue-800', PAYMENT: 'bg-green-100 text-green-800', REFUND: 'bg-purple-100 text-purple-800' }

// Desktop IPD Bill Screen — Phase 1. Uses only Bill / BillCounter / IpdCharge:
//   GET  ?resource=bill          (persisted bill header + history)
//   GET  ?resource=running-bill  (live line items for the open draft)
//   POST  bill-generate / bill-finalize / post-charge
export default function BillScreen({ admission, orgInfo = {} }) {
  const admissionId = admission?.id
  const { user } = useAuth()
  const role = user?.role
  // Demo (no user) allows all; otherwise gate by role.
  const canCollect = !user || ['receptionist', 'billing', 'admin', 'super_admin'].includes(role)
  const canRefund = !user || ['billing', 'admin', 'super_admin'].includes(role)

  const [bill, setBill] = useState(null)
  const [history, setHistory] = useState([])
  const [live, setLive] = useState(null)
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ description: '', serviceGroup: 'PROCEDURE', base: '', quantity: 1 })
  const [preview, setPreview] = useState(null)
  const [showPay, setShowPay] = useState(false)
  const [showRefund, setShowRefund] = useState(false)
  const [payForm, setPayForm] = useState({ amount: '', method: 'CASH', reference: '', note: '' })
  const [refundForm, setRefundForm] = useState({ amount: '', method: 'CASH', reason: '' })

  const load = useCallback(async () => {
    if (!admissionId) return
    setLoading(true)
    try {
      const [b, rb] = await Promise.all([
        client.get(`/inpatient?resource=bill&admissionId=${admissionId}`),
        client.get(`/inpatient?resource=running-bill&admissionId=${admissionId}`),
      ])
      setBill(b.data || null); setHistory(b.history || []); setLive(rb.data || null)
      // Payment ledger is admission-scoped (covers carried-forward + cancelled-bill receipts).
      const pl = await client.get(`/inpatient?resource=payments&admissionId=${admissionId}`)
      setPayments(pl.data || [])
    } catch { toast.error('Failed to load bill') }
    setLoading(false)
  }, [admissionId])

  useEffect(() => { load() }, [load])

  // Live tariff preview while typing a manual service charge.
  useEffect(() => {
    const base = Number(form.base)
    if (!base || !admissionId) { setPreview(null); return }
    const t = setTimeout(async () => {
      try {
        const res = await client.get(`/inpatient?resource=tariff-preview&admissionId=${admissionId}&base=${base}&serviceGroup=${form.serviceGroup}`)
        setPreview(res.data)
      } catch { setPreview(null) }
    }, 350)
    return () => clearTimeout(t)
  }, [form.base, form.serviceGroup, admissionId])

  const isFinal = bill?.status === 'FINAL'
  const isDraft = !bill || bill.status === 'DRAFT'

  const generate = async () => {
    setBusy(true)
    try {
      const res = await client.post('/inpatient', { resource: 'bill-generate', admissionId })
      if (res.success) { toast.success('Draft bill refreshed'); load() } else toast.error(res.error || 'Failed')
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to generate') }
    setBusy(false)
  }

  const finalize = async (billType = 'FINAL') => {
    setBusy(true)
    try {
      const res = await client.post('/inpatient', { resource: 'bill-finalize', admissionId, billType })
      if (res.success) { toast.success(`Bill finalized — ${res.data.billNumber}`); load() } else toast.error(res.error || 'Failed')
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to finalize') }
    setBusy(false)
  }

  const addCharge = async () => {
    if (!form.description.trim() || !Number(form.base)) { toast.error('Description and base price required'); return }
    setBusy(true)
    try {
      const res = await client.post('/inpatient', { resource: 'post-charge', admissionId, description: form.description, serviceGroup: form.serviceGroup, base: Number(form.base), quantity: Number(form.quantity) || 1 })
      if (res.success) { toast.success(`Charge added at ${inr(res.data.unitPrice)}`); setForm({ description: '', serviceGroup: 'PROCEDURE', base: '', quantity: 1 }); setPreview(null); await generate() }
      else toast.error(res.error || 'Failed')
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to add charge') }
    setBusy(false)
  }

  // Print uses ONLY the persisted Bill snapshot (frozen Bill totals + its IpdCharge
  // rows) — never the live running-bill — so a reprint always matches what was billed.
  const printBill = () => {
    const b = bill
    if (!b || b.status !== 'FINAL') { toast.error('Finalize the bill before printing'); return }
    const lines = (b.charges || [])
    const rows = lines.map((c) =>
      `<tr><td>${c.description}</td><td>${c.serviceGroup}</td><td>${c.quantity}</td><td>${inr(c.unitPrice)}</td><td>${inr(c.lineTotal ?? (c.unitPrice * c.quantity))}</td></tr>`
    ).join('')
    const html = `<!DOCTYPE html><html><head><title>IPD Bill ${b.billNumber || ''}</title>
<style>body{font-family:Arial;font-size:13px;padding:24px;color:#222}h2{text-align:center;margin:0}.sub{text-align:center;color:#666;font-size:11px;margin-bottom:14px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f5f5f5}.tot{font-weight:bold;background:#e8f5e9}.r{text-align:right}</style></head><body>
<h2>${orgInfo.name || 'Hospital'} — IPD Bill</h2>
<div class="sub">${b.billNumber} · ${b.status} · ${b.billType} · Finalized ${b.finalizedAt ? format(new Date(b.finalizedAt), 'dd MMM yyyy, hh:mm a') : ''}</div>
<table><tr><td><b>Patient</b></td><td>${admission?.patient?.firstName || ''} ${admission?.patient?.lastName || ''}</td><td><b>UHID</b></td><td>${admission?.patient?.mrn || '—'}</td></tr></table>
<table><tr><th>Item</th><th>Group</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
${rows || '<tr><td colspan="5" style="text-align:center;color:#999">No service line items</td></tr>'}
<tr class="tot"><td colspan="4" class="r">Bed Charges</td><td>${inr(b.bedTotal)}</td></tr>
<tr><td colspan="4" class="r">Service Charges</td><td>${inr(b.serviceTotal)}</td></tr>
<tr><td colspan="4" class="r">Tax (GST)</td><td>${inr(b.taxTotal)}</td></tr>
<tr><td colspan="4" class="r">Discount</td><td>- ${inr(b.discountTotal)}</td></tr>
<tr><td colspan="4" class="r">Subtotal</td><td>${inr(b.subtotal)}</td></tr>
<tr><td colspan="4" class="r">Deposit</td><td>- ${inr(b.depositTotal)}</td></tr>
<tr class="tot"><td colspan="4" class="r">Payable</td><td>${inr(b.payableTotal)}</td></tr>
</table><p style="text-align:center;color:#aaa;font-size:10px">Computer-generated bill · snapshot frozen at finalization.</p></body></html>`
    const w = window.open('', '_blank', 'width=820,height=900')
    if (!w) { toast.error('Allow pop-ups to print'); return }
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
  }

  const collectPayment = async () => {
    if (!bill?.id) { toast.error('Generate the bill first'); return }
    if (!Number(payForm.amount)) { toast.error('Enter an amount'); return }
    setBusy(true)
    try {
      const res = await client.post('/inpatient', { resource: 'payment', billId: bill.id, amount: Number(payForm.amount), method: payForm.method, reference: payForm.reference || undefined, note: payForm.note || undefined, idempotencyKey: `pay-${bill.id}-${Date.now()}` })
      if (res.success) { toast.success(`Payment received — ${res.data.receiptNumber}`); setShowPay(false); setPayForm({ amount: '', method: 'CASH', reference: '', note: '' }); load() }
      else toast.error(res.error || 'Failed')
    } catch (e) { toast.error(e?.response?.data?.error || 'Payment failed') }
    setBusy(false)
  }

  const doRefund = async () => {
    if (!bill?.id || !Number(refundForm.amount)) { toast.error('Enter a refund amount'); return }
    setBusy(true)
    try {
      const res = await client.post('/inpatient', { resource: 'refund', billId: bill.id, amount: Number(refundForm.amount), method: refundForm.method, reason: refundForm.reason || undefined })
      if (res.success) { toast.success(`Refund recorded — ${res.data.receiptNumber}`); setShowRefund(false); setRefundForm({ amount: '', method: 'CASH', reason: '' }); load() }
      else toast.error(res.error || 'Failed')
    } catch (e) { toast.error(e?.response?.data?.error || 'Refund failed') }
    setBusy(false)
  }

  const voidPaymentRow = async (p) => {
    if (!window.confirm(`Void receipt ${p.receiptNumber}? This cannot be undone.`)) return
    setBusy(true)
    try {
      const res = await client.post('/inpatient', { resource: 'void-payment', paymentId: p.id, reason: 'Voided from bill screen' })
      if (res.success) { toast.success('Payment voided'); load() } else toast.error(res.error || 'Failed')
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed to void') }
    setBusy(false)
  }

  const printReceipt = (p) => {
    const html = `<!DOCTYPE html><html><head><title>Receipt ${p.receiptNumber}</title>
<style>body{font-family:Arial;font-size:13px;padding:24px;color:#222;max-width:420px;margin:auto}h2{text-align:center;margin:0}.sub{text-align:center;color:#666;font-size:11px;margin-bottom:14px}table{width:100%;border-collapse:collapse}td{padding:5px 6px;border-bottom:1px solid #eee}.r{text-align:right}.big{font-size:18px;font-weight:bold}</style></head><body>
<h2>${orgInfo.name || 'Hospital'}</h2><div class="sub">Payment Receipt</div>
<table>
<tr><td>Receipt No</td><td class="r"><b>${p.receiptNumber}</b></td></tr>
<tr><td>Date</td><td class="r">${p.paidAt ? format(new Date(p.paidAt), 'dd MMM yyyy, hh:mm a') : ''}</td></tr>
<tr><td>Patient</td><td class="r">${admission?.patient?.firstName || ''} ${admission?.patient?.lastName || ''}</td></tr>
<tr><td>UHID</td><td class="r">${admission?.patient?.mrn || '—'}</td></tr>
<tr><td>Bill</td><td class="r">${bill?.billNumber || '—'}</td></tr>
<tr><td>Type</td><td class="r">${p.type}</td></tr>
<tr><td>Method</td><td class="r">${p.method}${p.reference ? ` (${p.reference})` : ''}</td></tr>
<tr><td>Cashier</td><td class="r">${p.receivedByName || '—'}</td></tr>
<tr><td class="big">${p.amount < 0 ? 'Refunded' : 'Received'}</td><td class="r big">${inr(Math.abs(p.amount))}</td></tr>
</table><p style="text-align:center;color:#aaa;font-size:10px;margin-top:16px">Computer-generated receipt.</p></body></html>`
    const w = window.open('', '_blank', 'width=480,height=640')
    if (!w) { toast.error('Allow pop-ups to print'); return }
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
  }

  if (loading && !bill && !live) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-[#2E4168] mx-auto" /></div>

  // Totals: persisted bill if present, else live preview.
  const T = bill || { bedTotal: live?.bedCharges?.total, serviceTotal: live?.serviceCharges?.total, subtotal: live?.subtotal, taxTotal: live?.taxTotal, discountTotal: 0, depositTotal: 0, payableTotal: live?.grandTotal }
  const segLines = live?.bedCharges?.lines || []
  const svcLines = live?.serviceCharges?.lines || []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 border-b pb-3">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-blue-600" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{bill?.billNumber || 'Draft Bill'}</span>
              <Badge className={(statusStyle[bill?.status] || statusStyle.DRAFT) + ' text-xs'}>{bill?.status || 'DRAFT'}</Badge>
              {bill?.billType && bill.billType !== 'FINAL' && <Badge variant="outline" className="text-xs">{bill.billType}</Badge>}
            </div>
            {bill?.finalizedAt && <span className="text-xs text-gray-400">Finalized {format(new Date(bill.finalizedAt), 'dd MMM yyyy, hh:mm a')}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {isDraft && <Button variant="outline" size="sm" onClick={generate} disabled={busy}><RefreshCw className="h-4 w-4 mr-1" />{busy ? '…' : 'Generate / Refresh'}</Button>}
          {isDraft && <Button size="sm" onClick={() => finalize('FINAL')} disabled={busy}><CheckCircle2 className="h-4 w-4 mr-1" />Finalize</Button>}
          {isFinal && <Button variant="outline" size="sm" onClick={printBill}><Printer className="h-4 w-4 mr-1" />Print Bill</Button>}
          {isFinal && <Button size="sm" onClick={generate} disabled={busy} title="Start a new draft for post-discharge charges">New Supplementary</Button>}
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Bed Charges', T.bedTotal], ['Service Charges', T.serviceTotal], ['Tax (GST)', T.taxTotal], ['Discount', T.discountTotal]].map(([l, v]) => (
          <div key={l} className="border rounded-lg p-3 text-center"><p className="text-xs text-gray-500">{l}</p><p className="text-base font-bold">{inr(v)}</p></div>
        ))}
        <div className="border rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Subtotal</p><p className="text-base font-bold">{inr(T.subtotal)}</p></div>
        <div className="border rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Deposit</p><p className="text-base font-bold text-amber-600">- {inr(T.depositTotal)}</p></div>
        <div className="border rounded-lg p-3 text-center bg-green-50 col-span-2"><p className="text-xs text-gray-500">Payable</p><p className="text-lg font-bold text-green-700">{inr(T.payableTotal)}</p></div>
      </div>

      {/* Bed segments */}
      {segLines.length > 0 && (
        <div>
          <p className="font-semibold text-sm mb-1">Bed Charges (by stay segment)</p>
          <Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>From → To</TableHead><TableHead>Days</TableHead><TableHead>Rate/day</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{segLines.map((l, i) => (
              <TableRow key={i}><TableCell className="text-sm font-medium">{l.bedCategory}</TableCell><TableCell className="text-xs text-gray-500">{format(new Date(l.from), 'dd MMM')} → {format(new Date(l.to), 'dd MMM')}</TableCell><TableCell className="text-sm">{l.days}</TableCell><TableCell className="text-sm">{inr(l.dailyRate)}</TableCell><TableCell className="text-sm text-right font-medium">{inr(l.amount)}</TableCell></TableRow>
            ))}</TableBody></Table>
        </div>
      )}

      {/* Service line items (IpdCharge) */}
      <div>
        <p className="font-semibold text-sm mb-1">Service Charges Details</p>
        {svcLines.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center border rounded">No service charges yet</p> : (
          <div className="space-y-4">
            {Object.entries(
              svcLines.reduce((acc, c) => {
                const group = c.serviceGroup || 'OTHER';
                if (!acc[group]) acc[group] = [];
                acc[group].push(c);
                return acc;
              }, {})
            ).map(([groupName, lines]) => (
              <div key={groupName} className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b flex justify-between items-center">
                  <span className="font-semibold text-sm text-gray-700 capitalize">
                    {groupName.replace(/_/g, ' ').toLowerCase()} Charges
                  </span>
                  <span className="text-xs font-bold text-gray-500">
                    {inr(lines.reduce((sum, l) => sum + (l.lineTotal ?? l.amount ?? 0), 0))}
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-white hover:bg-white">
                      <TableHead className="w-[40%]">Item Description</TableHead>
                      <TableHead>Unit Rate</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Tax</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium">{c.description}</TableCell>
                        <TableCell className="text-sm text-gray-600">{inr(c.unitPrice)}</TableCell>
                        <TableCell className="text-sm text-gray-600">{c.quantity}</TableCell>
                        <TableCell className="text-xs text-gray-400">{c.taxPct ? `${c.taxPct}%` : '—'}</TableCell>
                        <TableCell className="text-sm text-right font-semibold">{inr(c.lineTotal ?? c.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add charge — only while editable */}
      {isDraft && (
        <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
          <p className="font-semibold text-sm flex items-center gap-2"><IndianRupee className="h-4 w-4 text-blue-600" />Add Service Charge <span className="text-xs font-normal text-gray-400">(auto-priced by room tariff)</span></p>
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-4"><Label className="text-[11px] text-gray-500">Description</Label><Input className="h-9 mt-0.5" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></div>
            <div className="col-span-3"><Label className="text-[11px] text-gray-500">Group</Label>
              <Select value={form.serviceGroup} onValueChange={(v) => setForm((p) => ({ ...p, serviceGroup: v }))}><SelectTrigger className="h-9 mt-0.5"><SelectValue /></SelectTrigger><SelectContent>{SERVICE_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select></div>
            <div className="col-span-2"><Label className="text-[11px] text-gray-500">Base ₹</Label><Input className="h-9 mt-0.5" type="number" value={form.base} onChange={(e) => setForm((p) => ({ ...p, base: e.target.value }))} /></div>
            <div className="col-span-1"><Label className="text-[11px] text-gray-500">Qty</Label><Input className="h-9 mt-0.5" type="number" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} /></div>
            <div className="col-span-2"><Button onClick={addCharge} disabled={busy} className="w-full"><Plus className="h-4 w-4 mr-1" />Add</Button></div>
          </div>
          {preview && <p className="text-xs text-gray-600">Tariff: base {inr(preview.base)} → <span className="font-semibold text-green-700">{inr(preview.price)}</span> {preview.rule && <Badge variant="outline" className="ml-1 text-[10px]">{preview.rule.type} {preview.rule.value}{preview.rule.type === 'PERCENT' ? '%' : ''}</Badge>}</p>}
        </div>
      )}

      {live?.warnings?.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠ {live.warnings.join(' · ')}</div>
      )}

      {/* ── Payments ── */}
      {bill && (
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="font-semibold text-sm flex items-center gap-2"><Wallet className="h-4 w-4 text-blue-600" />Payments</p>
            <div className="flex gap-2">
              {canCollect && bill.status !== 'CANCELLED' && <Button size="sm" onClick={() => setShowPay(true)}><Plus className="h-4 w-4 mr-1" />Collect Payment</Button>}
              {canRefund && (bill.paidTotal || 0) > 0 && <Button size="sm" variant="outline" className="text-purple-700 border-purple-300" onClick={() => setShowRefund(true)}><Undo2 className="h-4 w-4 mr-1" />Refund</Button>}
            </div>
          </div>

          {/* Paid / Balance / Status */}
          <div className="grid grid-cols-3 gap-3">
            <div className="border rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Payable</p><p className="text-base font-bold">{inr(bill.payableTotal)}</p></div>
            <div className="border rounded-lg p-3 text-center"><p className="text-xs text-gray-500">Paid</p><p className="text-base font-bold text-green-700">{inr(bill.paidTotal)}</p></div>
            <div className={'border rounded-lg p-3 text-center ' + ((bill.balanceDue || 0) > 0 ? 'bg-red-50' : (bill.balanceDue || 0) < 0 ? 'bg-purple-50' : 'bg-green-50')}>
              <p className="text-xs text-gray-500">{(bill.balanceDue || 0) < 0 ? 'Refund Due' : 'Balance Due'}</p>
              <p className="text-base font-bold">{inr(Math.abs(bill.balanceDue || 0))}</p>
            </div>
          </div>
          <div className="text-center"><Badge className={(payStatusStyle[bill.paymentStatus] || '') + ' text-xs'}>{bill.paymentStatus || 'UNPAID'}</Badge></div>

          {/* Payment ledger */}
          {payments.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center border rounded">No payments recorded</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date/Time</TableHead><TableHead>Type</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Cashier</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>{payments.map((p) => (
                <TableRow key={p.id} className={p.status === 'VOID' ? 'opacity-50 line-through' : ''}>
                  <TableCell className="text-xs font-mono">{p.receiptNumber || '—'}</TableCell>
                  <TableCell className="text-xs text-gray-500">{p.paidAt ? format(new Date(p.paidAt), 'dd MMM, hh:mm a') : ''}</TableCell>
                  <TableCell><Badge className={(ledgerTypeStyle[p.type] || '') + ' text-[10px]'}>{p.type}</Badge></TableCell>
                  <TableCell className="text-xs">{p.method}{p.reference ? <span className="text-gray-400"> · {p.reference}</span> : ''}</TableCell>
                  <TableCell className={'text-sm text-right font-medium ' + (p.amount < 0 ? 'text-purple-700' : '')}>{p.amount < 0 ? '- ' : ''}{inr(Math.abs(p.amount))}</TableCell>
                  <TableCell className="text-xs text-gray-500">{p.receivedByName || '—'}</TableCell>
                  <TableCell>{p.status === 'VOID' ? <Badge className="bg-gray-200 text-gray-600 text-[10px]">VOID</Badge> : <Badge className="bg-green-100 text-green-800 text-[10px]">OK</Badge>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {p.status === 'SUCCESS' && <Button size="icon" variant="ghost" className="h-7 w-7" title="Print receipt" onClick={() => printReceipt(p)}><Printer className="h-3.5 w-3.5" /></Button>}
                    {p.status === 'SUCCESS' && canRefund && p.type !== 'REFUND' && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" title="Void" onClick={() => voidPaymentRow(p)}><Ban className="h-3.5 w-3.5" /></Button>}
                  </TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </div>
      )}

      {/* Bill history */}
      {history.length > 0 && (
        <div>
          <p className="font-semibold text-sm mb-1">Bill History</p>
          <Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Payable</TableHead></TableRow></TableHeader>
            <TableBody>{history.map((h) => (
              <TableRow key={h.id}><TableCell className="text-sm font-mono">{h.billNumber || '—'}</TableCell><TableCell className="text-xs">{h.billType}</TableCell><TableCell><Badge className={(statusStyle[h.status] || '') + ' text-xs'}>{h.status === 'CANCELLED' && <Ban className="h-3 w-3 mr-1 inline" />}{h.status}</Badge></TableCell><TableCell className="text-xs text-gray-500">{format(new Date(h.finalizedAt || h.createdAt), 'dd MMM yyyy')}</TableCell><TableCell className="text-sm text-right">{inr(h.payableTotal)}</TableCell></TableRow>
            ))}</TableBody></Table>
        </div>
      )}

      {/* Collect Payment dialog */}
      <Dialog open={showPay} onOpenChange={setShowPay}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Collect Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {bill && <p className="text-xs text-gray-500">Balance due: <span className="font-semibold text-gray-700">{inr(Math.max(0, bill.balanceDue || 0))}</span> · {bill.billNumber || 'draft'}</p>}
            <div><Label>Amount (₹) *</Label><Input type="number" min={1} value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} autoFocus /></div>
            <div><Label>Method *</Label>
              <Select value={payForm.method} onValueChange={(v) => setPayForm((p) => ({ ...p, method: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace('_', ' ')}</SelectItem>)}</SelectContent></Select></div>
            {payForm.method !== 'CASH' && <div><Label>Reference No.</Label><Input value={payForm.reference} onChange={(e) => setPayForm((p) => ({ ...p, reference: e.target.value }))} placeholder="UPI txn / card auth / UTR / cheque no" /></div>}
            <div><Label>Note</Label><Input value={payForm.note} onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))} /></div>
            {bill && <div className="flex gap-2">{[bill.balanceDue, 500, 1000, 5000].filter((v) => v > 0).map((v) => <Button key={v} size="sm" variant="outline" className="text-xs" onClick={() => setPayForm((p) => ({ ...p, amount: String(Math.round(v)) }))}>{v === bill.balanceDue ? 'Full' : inr(v)}</Button>)}</div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowPay(false)}>Cancel</Button><Button onClick={collectPayment} disabled={busy}>{busy ? 'Saving…' : 'Receive Payment'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund dialog (billing role) */}
      <Dialog open={showRefund} onOpenChange={setShowRefund}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record Refund</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {bill && <p className="text-xs text-gray-500">Paid: {inr(bill.paidTotal)} · {(bill.balanceDue || 0) < 0 ? <span className="text-purple-700 font-semibold">Overpaid {inr(Math.abs(bill.balanceDue))}</span> : 'no overpayment'}</p>}
            <div><Label>Refund Amount (₹) *</Label><Input type="number" min={1} value={refundForm.amount} onChange={(e) => setRefundForm((p) => ({ ...p, amount: e.target.value }))} autoFocus /></div>
            <div><Label>Method</Label>
              <Select value={refundForm.method} onValueChange={(v) => setRefundForm((p) => ({ ...p, method: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace('_', ' ')}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Reason</Label><Input value={refundForm.reason} onChange={(e) => setRefundForm((p) => ({ ...p, reason: e.target.value }))} placeholder="e.g. unused deposit / overpayment" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowRefund(false)}>Cancel</Button><Button className="bg-purple-600 hover:bg-purple-700" onClick={doRefund} disabled={busy}>{busy ? 'Saving…' : 'Record Refund'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
