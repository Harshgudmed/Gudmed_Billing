import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Loader2, RefreshCw, Wallet, Printer } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import client from '@/api/client'

import { formatMoney as inr } from '@/lib/format'
const METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE']
const today = () => new Date().toISOString().slice(0, 10)

// Cashier daily/shift collection report — reads GET ?resource=collections.
export default function CollectionsReport({ orgInfo = {} }) {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [cashierId, setCashierId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ resource: 'collections', from, to })
      if (cashierId) q.set('cashierId', cashierId)
      const res = await client.get(`/inpatient?${q.toString()}`)
      setData(res.data || null)
    } catch { toast.error('Failed to load collections') }
    setLoading(false)
  }, [from, to, cashierId])

  useEffect(() => { load() }, [load])

  const printReport = () => {
    if (!data) return
    const methodRows = METHODS.map((m) => `<tr><td>${m.replace('_', ' ')}</td><td class="r">${inr(data.byMethod?.[m] || 0)}</td></tr>`).join('')
    const cashierRows = (data.byCashier || []).map((c) => `<tr><td>${c.name || c.receivedById || '—'}</td><td class="r">${c.count}</td><td class="r">${inr(c.total)}</td></tr>`).join('')
    const html = `<!DOCTYPE html><html><head><title>Collections ${from}_${to}</title>
<style>body{font-family:Arial;font-size:13px;padding:24px;color:#222}h2{text-align:center;margin:0}.sub{text-align:center;color:#666;font-size:11px;margin-bottom:14px}h3{font-size:13px;margin:14px 0 4px}table{width:100%;border-collapse:collapse;margin-bottom:10px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f5f5f5}.r{text-align:right}.tot{font-weight:bold;background:#e8f5e9}</style></head><body>
<h2>${orgInfo.name || 'Hospital'} — IPD Collections</h2>
<div class="sub">${from} → ${to}${cashierId ? ' · Cashier ' + cashierId : ''} · Generated ${format(new Date(), 'dd MMM yyyy, hh:mm a')}</div>
<h3>By Payment Method</h3><table><tr><th>Method</th><th class="r">Amount</th></tr>${methodRows}<tr class="tot"><td>Net Collected</td><td class="r">${inr(data.net)}</td></tr></table>
<h3>By Cashier</h3><table><tr><th>Cashier</th><th class="r">Txns</th><th class="r">Total</th></tr>${cashierRows || '<tr><td colspan="3" style="text-align:center;color:#999">—</td></tr>'}</table>
<p style="font-size:11px;color:#666">Payments: ${data.payments} · Advances: ${data.advances} · Refunds: ${data.refunds} · Total entries: ${data.count}</p>
</body></html>`
    const w = window.open('', '_blank', 'width=720,height=900')
    if (!w) { toast.error('Allow pop-ups to print'); return }
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
  }

  const quick = (days, label) => { const d = new Date(); d.setDate(d.getDate() - days); const s = d.toISOString().slice(0, 10); setFrom(s); setTo(today()) ; return label }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Wallet className="h-4 w-4 text-blue-600" />IPD Collections Report</h2>
          <p className="text-xs text-gray-500">Cashier / shift reconciliation by date, method and cashier</p>
        </div>
        <Button variant="outline" size="sm" onClick={printReport} disabled={!data}><Printer className="h-3.5 w-3.5 mr-1" />Print</Button>
      </div>

      {/* Filters */}
      <Card><CardContent className="pt-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div><Label className="text-xs">From</Label><Input type="date" className="mt-1 h-9" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" className="mt-1 h-9" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div><Label className="text-xs">Cashier ID (optional)</Label><Input className="mt-1 h-9" value={cashierId} onChange={(e) => setCashierId(e.target.value)} placeholder="filter by cashier" /></div>
          <Button size="sm" variant="outline" onClick={() => { setFrom(today()); setTo(today()) }}>Today</Button>
          <Button size="sm" variant="outline" onClick={() => quick(7)}>7 days</Button>
          <Button size="sm" onClick={load} disabled={loading}><RefreshCw className="h-3.5 w-3.5 mr-1" />{loading ? '…' : 'Run'}</Button>
        </div>
      </CardContent></Card>

      {loading && !data ? <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-[#2E4168] mx-auto" /></div> : data && (
        <>
          {/* By method */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {METHODS.map((m) => (
              <div key={m} className="border rounded-lg p-3 text-center"><p className="text-[11px] text-gray-500">{m.replace('_', ' ')}</p><p className="text-sm font-bold">{inr(data.byMethod?.[m] || 0)}</p></div>
            ))}
            <div className="border rounded-lg p-3 text-center bg-green-50"><p className="text-[11px] text-gray-500">Net</p><p className="text-sm font-bold text-green-700">{inr(data.net)}</p></div>
          </div>
          <p className="text-xs text-gray-500">{data.payments} payments · {data.advances} advances · {data.refunds} refunds · {data.count} entries</p>

          {/* By cashier */}
          <div>
            <p className="font-semibold text-sm mb-1">By Cashier</p>
            {(data.byCashier || []).length === 0 ? <p className="text-sm text-gray-400 py-3 text-center border rounded">No collections in this range</p> : (
              <Card><CardContent className="p-0"><Table>
                <TableHeader><TableRow><TableHead>Cashier</TableHead><TableHead className="text-right">Transactions</TableHead><TableHead className="text-right">Total Collected</TableHead></TableRow></TableHeader>
                <TableBody>{data.byCashier.map((c, i) => (
                  <TableRow key={i}><TableCell className="text-sm">{c.name || c.receivedById || '—'}</TableCell><TableCell className="text-sm text-right">{c.count}</TableCell><TableCell className="text-sm text-right font-medium">{inr(c.total)}</TableCell></TableRow>
                ))}</TableBody>
              </Table></CardContent></Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}
