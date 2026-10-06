import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Loader2, Truck, AlertTriangle, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime } from '@/lib/format'
import { GST_TYPE_LABEL } from './requestMeta'
import { gstTypeFor, lineAmounts, orderTotals } from './orderMath'

// "Make purchase orders" — approved request lines become draft orders in one
// step. Each line goes to its item's usual vendor, so a request for gloves and
// chairs becomes one order to the gloves supplier and one to the furniture
// supplier without anyone sorting it. The rate starts at the request's
// estimate, else the last price paid; GST follows the vendor. Lines whose item
// has no usual vendor wait in one group until a vendor is chosen for them.
// Nothing is sent anywhere: the drafts open for checking.

const NO_VENDOR = '__none'

export default function MakeOrdersDialog({ open, onOpenChange, requestId, onMade }) {
  const [candidates, setCandidates] = useState([])
  // How many approved lines wait in all — the server sends the oldest 300.
  const [waiting, setWaiting] = useState(0)
  const [hospitalStateCode, setHospitalStateCode] = useState(null)
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(false)
  const [making, setMaking] = useState(false)
  const [picked, setPicked] = useState(new Set()) // request line ids to order
  const [vendorFor, setVendorFor] = useState({})  // group key → chosen vendor id (for the no-vendor group, or a change)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    Promise.all([
      purchaseApi.getOrderCandidates(requestId ? { requestId } : {}),
      purchaseApi.getVendors({ status: 'active' }),
    ]).then(([c, v]) => {
      if (!alive) return
      const rows = c?.data ?? []
      setCandidates(rows)
      setWaiting(c?.meta?.total ?? rows.length)
      setHospitalStateCode(c?.meta?.hospitalStateCode ?? null)
      setVendors(v?.data ?? [])
      setPicked(new Set(rows.map((r) => r.id)))
      setVendorFor({})
    }).catch((err) => showApiError(err, 'Could not load what is ready to order'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [open, requestId])

  const vendorById = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v])), [vendors])
  const vendorOptions = useMemo(() => vendors.map((v) => ({ value: v.id, label: v.name, sublabel: [v.code, v.city, v.gstNumber ? 'GST registered' : 'Not GST registered'].filter(Boolean).join(' · ') })), [vendors])

  // Lines grouped by the vendor they will be ordered from.
  const groups = useMemo(() => {
    const map = new Map()
    for (const c of candidates) {
      const usual = c.item.preferredVendor?.isActive ? c.item.preferredVendor.id : NO_VENDOR
      const key = usual
      if (!map.has(key)) map.set(key, { key, lines: [] })
      map.get(key).lines.push(c)
    }
    return [...map.values()].map((g) => {
      const vendorId = vendorFor[g.key] || (g.key === NO_VENDOR ? '' : g.key)
      const vendor = vendorById[vendorId]
      const gstType = vendor ? gstTypeFor(vendor, hospitalStateCode) : 'intra'
      const chosen = g.lines.filter((l) => picked.has(l.id))
      const priced = chosen.map((l) => lineAmounts({ quantity: l.quantity, rate: rateOf(l), gstRate: l.item.gstRate }, gstType))
      return { ...g, vendorId, vendor, gstType, chosen, totals: orderTotals(priced, gstType), unpriced: chosen.filter((l) => !(rateOf(l) > 0)).length }
    }).sort((a, b) => (a.key === NO_VENDOR) - (b.key === NO_VENDOR))
  }, [candidates, vendorFor, vendorById, picked, hospitalStateCode])

  const toMake = groups.filter((g) => g.chosen.length > 0)
  const blocked = toMake.some((g) => !g.vendorId)

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const make = async () => {
    setMaking(true)
    const made = []
    try {
      for (const g of toMake) {
        // The earliest "needed by" among its requests is when the goods should arrive.
        const dates = g.chosen.map((l) => l.request.requiredBy).filter(Boolean).sort()
        const r = await purchaseApi.createOrder({
          vendorId: g.vendorId,
          expectedDate: dates[0] ? String(dates[0]).slice(0, 10) : null,
          lines: g.chosen.map((l) => ({
            itemId: l.itemId, unitId: l.unitId, quantity: l.quantity,
            rate: rateOf(l) || undefined, requestLineId: l.id,
          })),
        })
        made.push(r.data)
      }
      toast.success(made.length === 1 ? `Draft ${made[0].number} made — check it and send it for approval` : `${made.length} draft orders made — check each and send it for approval`)
      onOpenChange(false)
      onMade?.(made)
    } catch (err) {
      showApiError(err, made.length ? `${made.length} order(s) made, then one failed` : 'Could not make the orders')
      if (made.length) onMade?.(made)
    } finally {
      setMaking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !making && onOpenChange(v)}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Make purchase orders</DialogTitle>
          <DialogDescription>
            Approved items are sorted by their usual vendor — one order per vendor. Untick anything not to order now. The orders are made as drafts for you to check.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-gray-500">
            <PackageCheck className="h-10 w-10 text-green-500" />
            <p className="font-medium text-gray-700">Nothing is waiting to be ordered</p>
            <p className="text-sm">Every approved item is already on an order.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {waiting > candidates.length && (
              <p role="status" className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Showing the oldest {candidates.length} of {waiting} approved items. Make these orders, then open Make Orders again for the rest.
              </p>
            )}
            {groups.map((g) => (
              <section key={g.key} className="rounded-lg border">
                <div className="flex flex-col gap-3 border-b bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <Truck className="h-5 w-5 shrink-0 text-blue-600" />
                    {g.key === NO_VENDOR || vendorFor[g.key] !== undefined ? (
                      <div className="w-full sm:w-72">
                        <SearchableSelect className="w-full" options={vendorOptions} value={g.vendorId}
                          onChange={(v) => setVendorFor((m) => ({ ...m, [g.key]: v }))}
                          placeholder={g.key === NO_VENDOR ? 'Choose a vendor for these items' : 'Choose a vendor'}
                          emptyText="No vendor — add one in the Vendors tab" />
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{g.vendor?.name}</div>
                        <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setVendorFor((m) => ({ ...m, [g.key]: g.key }))}>Change vendor</button>
                      </div>
                    )}
                    {g.vendor && <Badge variant="outline" className="shrink-0">{GST_TYPE_LABEL[g.gstType]}</Badge>}
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-xs text-gray-500">{g.chosen.length} item{g.chosen.length === 1 ? '' : 's'} · approx., GST included</div>
                    <div className="text-lg font-bold tabular-nums">{formatMoney(g.totals.total)}</div>
                  </div>
                </div>
                {g.key === NO_VENDOR && (
                  <p className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" />These items have no usual vendor. Choose one above — tip: set it on the item so next time it is automatic.
                  </p>
                )}
                <ul className="divide-y">
                  {g.lines.map((l) => {
                    const rate = rateOf(l)
                    return (
                      <li key={l.id}>
                        <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-gray-50">
                          <Checkbox checked={picked.has(l.id)} onCheckedChange={() => toggle(l.id)} className="mt-1" aria-label={`Order ${l.itemName}`} />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{l.itemName}</div>
                            <div className="text-xs text-gray-500">
                              {l.request.number} · {l.request.department?.name}
                              {l.request.requiredBy && <> · needed by {formatDateTime(l.request.requiredBy, { withTime: false })}</>}
                              {l.request.priority !== 'normal' && <span className="ml-1 font-semibold uppercase text-red-600">{l.request.priority}</span>}
                            </div>
                          </div>
                          <div className="shrink-0 text-right text-sm">
                            <div className="tabular-nums">{l.quantity} {l.unitCode}</div>
                            <div className="text-xs text-gray-500 tabular-nums">{rate > 0 ? `@ ${formatMoney(rate)}` : <span className="text-amber-700">rate on the order</span>}</div>
                          </div>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={making}>Close</Button>
          {candidates.length > 0 && (
            <Button onClick={make} disabled={making || toMake.length === 0 || blocked} title={blocked ? 'Choose a vendor for every group first' : undefined}>
              {making && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {toMake.length <= 1 ? 'Make draft order' : `Make ${toMake.length} draft orders`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// The request's estimate, else the last price paid for the unit asked in.
function rateOf(line) {
  if (line.estimatedRate > 0) return line.estimatedRate
  const last = line.item.lastPurchasePrice
  return last != null ? Math.round(last * (line.unitFactor || 1) * 100) / 100 : 0
}
