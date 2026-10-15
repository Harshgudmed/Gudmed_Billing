import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { rfqApi } from '@/api/purchaseRfqApi'
import { showApiError } from '@/lib/apiRequest'
import { GST_TYPE_LABEL } from './requestMeta'
import { usePickList } from './usePickList'
import LoadFailed from './LoadFailed'

// One vendor's answer to an RFQ: for each item the rate per unit before GST
// and the GST rate. Delivery days are optional. If a vendor said no to
// everything, "Mark as declined" in the footer records that instead.

const clean = (v) => v.replace(/[^\d.]/g, '')

export default function RfqQuoteDialog({ rfq, rfqVendor, open, onOpenChange, onSaved }) {
  const gstRates = usePickList(purchaseApi.getGstRates, { enabled: open })
  const [declined, setDeclined] = useState(false)
  const [rows, setRows] = useState({}) // rfqLineId → { available, rate, discountPct, gstRate }
  const [deliveryDays, setDeliveryDays] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [saving, setSaving] = useState(false)
  const noGst = rfqVendor?.gstType === 'none'

  useEffect(() => {
    if (!open || !rfq || !rfqVendor) return
    const wasDec = rfqVendor.status === 'declined'
    setDeclined(wasDec)
    setDeliveryDays(rfqVendor.deliveryDays ?? '')
    setDeclineReason(wasDec ? rfqVendor.notes || '' : '')
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
        deliveryDays, validTill: null, notes: declined ? declineReason : '',
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
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {declined ? `${rfqVendor.vendorName} — declined` : `Rates from ${rfqVendor.vendorName}`}
          </DialogTitle>
          <DialogDescription>
            {rfq.number} · {GST_TYPE_LABEL[rfqVendor.gstType]}{noGst ? ' — no GST (unregistered vendor)' : ' · enter rate per unit before GST'}
          </DialogDescription>
        </DialogHeader>

        {declined ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">This vendor will be marked as declined for this RFQ. You can record the reason below (optional).</p>
            <Input maxLength={500} value={declineReason} placeholder="e.g. Out of stock, item not available"
              onChange={(e) => setDeclineReason(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-4">
            {gstRates.failed && <LoadFailed onRetry={gstRates.reload}>Could not load the GST rates.</LoadFailed>}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[500px] text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="w-36 px-3 py-2 text-right font-medium">Rate ₹ / unit</th>
                    {!noGst && <th className="w-28 px-3 py-2 text-right font-medium">GST %</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rfq.lines.map((l, i) => {
                    const row = rows[l.id] || {}
                    return (
                      <tr key={l.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{l.itemName}</div>
                          <div className="text-xs text-gray-500">{l.quantity} {l.unitCode}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Input aria-label={`Rate for ${l.itemName}`} inputMode="decimal"
                            value={row.rate ?? ''} placeholder="Rate"
                            className={`text-right ${!(Number(row.rate) > 0) ? 'border-amber-400' : ''}`}
                            onChange={(e) => setRow(l.id, { rate: clean(e.target.value), available: true })} />
                        </td>
                        {!noGst && (
                          <td className="px-3 py-2">
                            <Select value={row.gstRate} onValueChange={(v) => setRow(l.id, { gstRate: v })}>
                              <SelectTrigger aria-label={`GST for ${l.itemName}`}><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>{gstRates.list.map((g) => <SelectItem key={g} value={String(g)}>{g}%</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-600">Delivery (days) — optional</label>
              <Input className="w-32" inputMode="numeric" value={deliveryDays} placeholder="e.g. 7"
                onChange={(e) => setDeliveryDays(e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
        )}

        {/* Validation above footer so it doesn't crowd the buttons */}
        {missing && <p className="text-sm text-amber-700">⚠ Enter a rate for every item.</p>}
        {nothing && <p className="text-sm text-amber-700">⚠ No items marked as available — enter at least one rate, or mark the vendor as declined.</p>}

        <DialogFooter className="gap-2">
          {!declined
            ? <Button variant="ghost" className="text-red-600 sm:mr-auto" disabled={saving} onClick={() => setDeclined(true)}><Ban className="h-4 w-4 mr-1" />Vendor declined</Button>
            : <Button variant="ghost" className="sm:mr-auto" disabled={saving} onClick={() => setDeclined(false)}>← Back to rates</Button>
          }
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
          <Button onClick={save} disabled={saving || missing || nothing}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {declined ? 'Save — declined' : 'Save quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
