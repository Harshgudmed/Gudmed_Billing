import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { rfqApi } from '@/api/purchaseRfqApi'
import { showApiError } from '@/lib/apiRequest'
import { localYmd } from '@/lib/format'
import { GST_TYPE_LABEL } from './requestMeta'
import { usePickList } from './usePickList'
import LoadFailed from './LoadFailed'

// One vendor's answer to an RFQ, typed in from their e-mail, letter or call:
// for each item the rate per unit before GST, a discount, the GST, or "cannot
// supply"; then delivery days and how long the rates hold. Or: the vendor
// declined. Entering it again replaces what was there.

const clean = (v) => v.replace(/[^\d.]/g, '')

export default function RfqQuoteDialog({ rfq, rfqVendor, open, onOpenChange, onSaved }) {
  const gstRates = usePickList(purchaseApi.getGstRates, { enabled: open })
  const [declined, setDeclined] = useState(false)
  const [rows, setRows] = useState({}) // rfqLineId → { available, rate, discountPct, gstRate }
  const [head, setHead] = useState({ deliveryDays: '', validTill: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const noGst = rfqVendor?.gstType === 'none'

  useEffect(() => {
    if (!open || !rfq || !rfqVendor) return
    setDeclined(rfqVendor.status === 'declined')
    setHead({ deliveryDays: rfqVendor.deliveryDays ?? '', validTill: rfqVendor.validTill ? String(rfqVendor.validTill).slice(0, 10) : '', notes: rfqVendor.notes || '' })
    setRows(Object.fromEntries(rfq.lines.map((l) => {
      const q = rfqVendor.quotes.find((x) => x.rfqLineId === l.id)
      return [l.id, q
        ? { available: q.available, rate: q.available ? String(q.rate) : '', discountPct: q.discountPct ? String(q.discountPct) : '', gstRate: String(q.gstRate) }
        : { available: true, rate: '', discountPct: '', gstRate: String(l.item?.gstRate ?? 0) }]
    })))
  }, [open, rfq, rfqVendor])

  if (!rfq || !rfqVendor) return null
  const setRow = (lineId, patch) => setRows((r) => ({ ...r, [lineId]: { ...r[lineId], ...patch } }))
  const missing = !declined && rfq.lines.some((l) => rows[l.id]?.available && !(Number(rows[l.id]?.rate) > 0))
  const nothing = !declined && !rfq.lines.some((l) => rows[l.id]?.available)

  const save = async () => {
    setSaving(true)
    try {
      const r = await rfqApi.quote(rfq.id, {
        rfqVendorId: rfqVendor.id, declined,
        deliveryDays: head.deliveryDays, validTill: head.validTill || null, notes: head.notes,
        quotes: declined ? [] : rfq.lines.map((l) => ({
          rfqLineId: l.id, available: rows[l.id].available,
          rate: rows[l.id].available ? rows[l.id].rate : undefined,
          discountPct: rows[l.id].discountPct, gstRate: noGst ? undefined : rows[l.id].gstRate,
        })),
      })
      toast.success(declined ? `${rfqVendor.vendorName} marked as declined` : `${rfqVendor.vendorName}'s quote saved`)
      onSaved?.(r.data)
    } catch (err) {
      showApiError(err, 'Could not save the quote')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quote from {rfqVendor.vendorName}</DialogTitle>
          <DialogDescription>{rfq.number} · rates per unit before GST · {GST_TYPE_LABEL[rfqVendor.gstType]}{noGst ? ' — this vendor is not GST-registered, so no GST is added' : ''}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex items-center gap-3 rounded-md border px-3 py-2">
            <Switch checked={declined} onCheckedChange={setDeclined} aria-label="The vendor declined" />
            <span className="text-sm">The vendor declined to quote</span>
          </label>

          {!declined && (
            <>
              {gstRates.failed && <LoadFailed onRetry={gstRates.reload}>Could not load the GST rates.</LoadFailed>}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium">Item</th>
                      <th className="w-24 px-2 py-2 text-center font-medium">Can supply</th>
                      <th className="w-32 px-2 py-2 text-right font-medium">Rate ₹ / unit</th>
                      <th className="w-24 px-2 py-2 text-right font-medium">Disc %</th>
                      <th className="w-28 px-2 py-2 text-right font-medium">GST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rfq.lines.map((l, i) => {
                      const row = rows[l.id] || {}
                      return (
                        <tr key={l.id}>
                          <td className="px-2 py-2"><div className="font-medium">{l.itemName}</div><div className="text-xs text-gray-500">{l.quantity} {l.unitCode}</div></td>
                          <td className="px-2 py-2 text-center">
                            <Checkbox checked={!!row.available} onCheckedChange={(v) => setRow(l.id, { available: !!v })} aria-label={`${l.itemName}: can supply`} />
                          </td>
                          <td className="px-2 py-2">
                            <Input aria-label={`Rate for line ${i + 1}`} inputMode="decimal" disabled={!row.available} value={row.available ? row.rate ?? '' : ''}
                              placeholder={row.available ? 'Rate' : '—'} className={`text-right ${row.available && !(Number(row.rate) > 0) ? 'border-amber-400' : ''}`}
                              onChange={(e) => setRow(l.id, { rate: clean(e.target.value) })} />
                          </td>
                          <td className="px-2 py-2">
                            <Input aria-label={`Discount for line ${i + 1}`} inputMode="decimal" disabled={!row.available} value={row.discountPct ?? ''} placeholder="0" className="text-right"
                              onChange={(e) => setRow(l.id, { discountPct: clean(e.target.value) })} />
                          </td>
                          <td className="px-2 py-2">
                            {noGst ? <div className="pt-2 text-right text-gray-400">—</div> : (
                              <Select value={row.gstRate} onValueChange={(v) => setRow(l.id, { gstRate: v })} disabled={!row.available}>
                                <SelectTrigger aria-label={`GST for line ${i + 1}`}><SelectValue placeholder="—" /></SelectTrigger>
                                <SelectContent>{gstRates.list.map((g) => <SelectItem key={g} value={String(g)}>{g}%</SelectItem>)}</SelectContent>
                              </Select>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="q-days">Delivery (days from the order)</Label>
                  <Input id="q-days" inputMode="numeric" value={head.deliveryDays} placeholder="e.g. 7" onChange={(e) => setHead((h) => ({ ...h, deliveryDays: e.target.value.replace(/\D/g, '') }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="q-valid">Rates valid till</Label>
                  <Input id="q-valid" type="date" min={localYmd()} value={head.validTill} onChange={(e) => setHead((h) => ({ ...h, validTill: e.target.value }))} />
                </div>
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="q-notes">{declined ? 'Why (optional)' : 'Note (optional)'}</Label>
            <Input id="q-notes" maxLength={500} value={head.notes} onChange={(e) => setHead((h) => ({ ...h, notes: e.target.value }))} placeholder={declined ? 'e.g. Out of stock' : 'e.g. Free delivery above ₹10,000'} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {(missing || nothing) && <p className="text-xs text-amber-700 sm:mr-auto sm:self-center">{nothing ? 'Tick at least one item it can supply, or mark the vendor declined.' : 'Enter a rate for every item it can supply.'}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
          <Button onClick={save} disabled={saving || missing || nothing}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{declined ? 'Save — declined' : 'Save quote'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
