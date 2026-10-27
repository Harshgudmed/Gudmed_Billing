import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { QuantityInput } from '@/components/ui/quantity-input'
import { Plus, Trash2, Loader2, Send, Info } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, localYmd } from '@/lib/format'
import { GST_TYPE_LABEL, showNotifyWarning } from './requestMeta'
import LoadFailed from './LoadFailed'
import { ALL, unitsOf, suggestedRate, useItemSearch } from './itemPicking'
import { gstTypeFor, lineAmounts, orderTotals } from './orderMath'

// A purchase order being checked or written: vendor, when the goods are due,
// and each line's price. This is where the price and GST are settled, so the
// totals (CGST + SGST, or IGST, or none) follow every keystroke; the server
// works them out again on save. Lines that came from a request keep it, and
// can be changed or removed; more items can be added like on a request.

let nextKey = 1
const blankLine = (categoryId = '') => ({ key: nextKey++, categoryId, itemId: '', itemName: '', item: null, unitId: '', unitCode: '', quantity: '', rate: '', discountPct: '', gstRate: '', requestLineId: null, requestNumber: null, note: '' })

// Currencies a vendor may quote in. Rates are entered in this currency and
// converted to INR (× the exchange rate) before saving — the order is stored in
// INR, so GST, stock and payment are unchanged; the document shows both.
const CURRENCIES = [
  { code: 'INR', symbol: '₹', label: '₹ Indian Rupee' },
  { code: 'USD', symbol: '$', label: '$ US Dollar' },
  { code: 'EUR', symbol: '€', label: '€ Euro' },
  { code: 'GBP', symbol: '£', label: '£ British Pound' },
  { code: 'AED', symbol: 'AED ', label: 'AED UAE Dirham' },
]
const curOf = (code) => CURRENCIES.find((c) => c.code === code) || CURRENCIES[0]
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
// Amount in a non-INR currency, e.g. "$1,000.00".
const fmtCur = (v, sym) => `${sym}${(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function OrderForm({ open, onOpenChange, order, onSaved }) {
  const editing = !!order
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [gstRates, setGstRates] = useState([])
  const [hospitalStateCode, setHospitalStateCode] = useState(null)
  const [form, setForm] = useState({ vendorId: '', expectedDate: '', terms: '', notes: '', currency: 'INR', exchangeRate: '1' })
  const [lines, setLines] = useState([blankLine()])
  const [loading, setLoading] = useState(false)
  // The form could not be filled (a list or a draft line's item did not load):
  // it says so with a retry, and cannot be saved over the draft half-loaded.
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(null)
  const { itemOptions, searchingLine, searchItems, found, categoryOptions } = useItemSearch(categories)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setLoadFailed(false)
    ;(async () => {
      try {
        const [v, c, g] = await Promise.all([purchaseApi.getVendors({ status: 'active' }), purchaseApi.getCategories(), purchaseApi.getGstRates()])
        if (!alive) return
        setVendors(v?.data ?? []); setCategories(c?.data ?? []); setGstRates(g?.data ?? [])
        setHospitalStateCode(g?.meta?.hospitalStateCode ?? null)
        if (order) {
          // The units picker needs each item's units. A failed read fails the
          // form: a line without its item lost its category and unit choices.
          const items = await Promise.all([...new Set(order.lines.map((l) => l.itemId))].map((id) => purchaseApi.getItem(id).then((x) => x.data)))
          if (!alive) return
          const byId = new Map(items.map((it) => [it.id, it]))
          const er = order.exchangeRate || 1
          const foreign = (order.currency || 'INR') !== 'INR'
          setForm({
            vendorId: order.vendorId, expectedDate: order.expectedDate ? String(order.expectedDate).slice(0, 10) : '',
            terms: order.terms || '', notes: order.notes || '',
            currency: order.currency || 'INR', exchangeRate: order.exchangeRate ? String(order.exchangeRate) : '1',
          })
          setLines(order.lines.map((l) => ({
            key: nextKey++, categoryId: byId.get(l.itemId)?.categoryId || '', itemId: l.itemId, itemName: l.itemName, item: byId.get(l.itemId) || null,
            unitId: l.unitId, unitCode: l.unitCode, quantity: String(l.quantity),
            // Stored rates are INR; show them back in the order's currency (÷ rate).
            rate: String(foreign ? round2(l.rate / er) : l.rate), discountPct: l.discountPct ? String(l.discountPct) : '',
            gstRate: String(l.gstRate), requestLineId: l.requestLineId, requestNumber: l.requestLine?.request?.number || null, note: l.note || '',
          })))
        } else {
          setForm({ vendorId: '', expectedDate: '', terms: '', notes: '', currency: 'INR', exchangeRate: '1' })
          setLines([blankLine()])
        }
      } catch (err) {
        if (!alive) return
        setLoadFailed(true)
        showApiError(err, 'Could not open the order form')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [open, order, attempt])

  const vendor = vendors.find((v) => v.id === form.vendorId) || (order && order.vendorId === form.vendorId ? order.vendor : null)
  const gstType = vendor ? gstTypeFor(vendor, hospitalStateCode) : 'intra'
  // Currency the order is quoted in. Line rates are in this currency; INR =
  // that × exchangeRate. INR orders (rate 1) behave exactly as before.
  const cur = curOf(form.currency)
  const foreign = form.currency !== 'INR'
  const exRate = Number(form.exchangeRate) > 0 ? Number(form.exchangeRate) : 1
  // Amounts in the quoted currency on screen; `inr` gives the rupee equivalent.
  const money = (v) => (foreign ? fmtCur(v, cur.symbol) : formatMoney(v))
  const inr = (v) => formatMoney(round2((Number(v) || 0) * exRate))
  const vendorOptions = useMemo(() => vendors.map((v) => ({ value: v.id, label: v.name, sublabel: [v.code, v.city, v.gstNumber ? 'GST registered' : 'Not GST registered'].filter(Boolean).join(' · ') })), [vendors])

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const pickCategory = (line, value) => {
    const categoryId = value === ALL ? '' : value
    if (categoryId === line.categoryId) return
    setLine(line.key, { ...blankLine(categoryId), key: line.key })
    searchItems(line.key, '', categoryId)
  }
  const pickItem = (key, itemId) => {
    const item = found.current.get(itemId)
    if (!item) return
    const units = unitsOf(item)
    const unit = units.find((u) => u.isPurchaseDefault) || units[0]
    setLine(key, { itemId, itemName: item.name, item, unitId: unit.id, unitCode: unit.code, rate: suggestedRate(item, unit.factor), gstRate: String(item.gstRate), requestLineId: null, requestNumber: null })
  }
  const pickUnit = (line, unitId) => {
    const unit = unitsOf(line.item).find((u) => u.id === unitId)
    setLine(line.key, { unitId, unitCode: unit?.code || line.unitCode })
  }

  const amounts = (l) => lineAmounts({ quantity: l.quantity, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate }, gstType)
  const totals = orderTotals(lines.filter((l) => l.itemId).map(amounts), gstType)

  const body = () => ({
    vendorId: form.vendorId, expectedDate: form.expectedDate || null, terms: form.terms, notes: form.notes,
    currency: form.currency, exchangeRate: exRate,
    lines: lines.filter((l) => l.itemId).map((l) => ({
      // Rates are entered in the order's currency; send INR (× exchangeRate) so the
      // server stores, GST-taxes and pays in rupees exactly as before.
      itemId: l.itemId, unitId: l.unitId, quantity: l.quantity, rate: l.rate === '' ? undefined : String(round2(Number(l.rate) * exRate)),
      discountPct: l.discountPct === '' ? undefined : l.discountPct, gstRate: l.gstRate === '' ? undefined : l.gstRate,
      requestLineId: l.requestLineId || undefined, note: l.note,
    })),
  })

  const save = async (send) => {
    setSaving(send ? 'send' : 'draft')
    try {
      const saved = editing ? await purchaseApi.saveOrder(order.id, body()) : await purchaseApi.createOrder(body())
      let po = saved.data
      if (send) {
        try {
          const sent = await purchaseApi.submitOrder(po.id)
          po = sent.data
          toast.success(po.status === 'approved' ? `${po.number} approved — under every approval limit. Send it to the vendor.` : `${po.number} sent for approval`)
          showNotifyWarning(sent)
        } catch (err) {
          showApiError(err, `${po.number} is saved as a draft but could not be sent for approval`)
        }
      } else {
        toast.success(`${po.number} saved`)
      }
      onOpenChange(false)
      onSaved?.(po)
    } catch (err) {
      showApiError(err, 'Could not save the order')
    } finally {
      setSaving(null)
    }
  }

  const ready = form.vendorId && lines.some((l) => l.itemId) && (!foreign || exRate > 0)

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Purchase order ${order.number}` : 'New purchase order'}</DialogTitle>
          <DialogDescription>Check the vendor and each price. GST follows the vendor; the totals update as you type.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : loadFailed ? (
          <LoadFailed onRetry={() => setAttempt((n) => n + 1)}>
            Could not load the vendors, items and rates this form needs{editing ? ` — ${order.number} is unchanged` : ''}.
          </LoadFailed>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1 md:col-span-2">
                <Label>Vendor *</Label>
                <SearchableSelect className="w-full" options={vendorOptions} value={form.vendorId}
                  selectedLabel={order?.vendorName} onChange={(v) => setForm((f) => ({ ...f, vendorId: v }))}
                  placeholder="Who will supply it?" emptyText="No vendor — add one in the Vendors tab" />
                {vendor && (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <Badge variant="outline">{GST_TYPE_LABEL[gstType]}</Badge>
                    {gstType === 'none' ? 'This vendor is not GST-registered, so no GST is charged.' : gstType === 'inter' ? 'Vendor is in another state.' : 'Vendor is in the hospital\'s state.'}
                    {vendor.paymentTermsDays != null && <span>· pays in {vendor.paymentTermsDays} days</span>}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="po-date">Goods needed by</Label>
                <Input id="po-date" type="date" min={localYmd()} value={form.expectedDate} onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="po-currency">Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v, exchangeRate: v === 'INR' ? '1' : f.exchangeRate }))}>
                  <SelectTrigger id="po-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {foreign && (
                <div className="space-y-1">
                  <Label htmlFor="po-exrate">Exchange rate <span className="font-normal text-gray-400">(1 {cur.code} = ₹)</span></Label>
                  <Input id="po-exrate" inputMode="decimal" value={form.exchangeRate} placeholder="e.g. 83"
                    className={foreign && !(exRate > 0) ? 'border-amber-400' : ''}
                    onChange={(e) => setForm((f) => ({ ...f, exchangeRate: e.target.value.replace(/[^\d.]/g, '') }))} />
                </div>
              )}
              {foreign && (
                <p className="self-end pb-2 text-xs text-gray-500">Rates below are entered in {cur.code}; the order is stored in ₹ at this rate.</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Items</h3>
                <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine(ls[ls.length - 1]?.categoryId || '')])}>
                  <Plus className="h-4 w-4 mr-1" />Add item
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-2 py-2 min-w-[260px]">Item</th>
                      <th className="text-left font-medium px-2 py-2 w-28">Unit</th>
                      <th className="text-center font-medium px-2 py-2 w-36">Qty</th>
                      <th className="text-right font-medium px-2 py-2 w-28">Rate {cur.symbol.trim() || cur.code}</th>
                      <th className="text-right font-medium px-2 py-2 w-20">Disc %</th>
                      <th className="text-right font-medium px-2 py-2 w-24">GST</th>
                      <th className="text-right font-medium px-2 py-2 w-32">Amount</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((l, i) => {
                      const a = amounts(l)
                      return (
                        <tr key={l.key} className="align-top">
                          <td className="px-2 py-2">
                            {l.requestLineId ? (
                              <div>
                                <div className="font-medium">{l.itemName}</div>
                                <div className="text-xs text-gray-500">from {l.requestNumber}</div>
                              </div>
                            ) : (
                              <div className="grid gap-1">
                                <SearchableSelect className="w-full" options={categoryOptions} value={l.categoryId || ALL}
                                  onChange={(v) => pickCategory(l, v)} placeholder="All categories" searchPlaceholder="Furniture, Linen…" contentClassName="w-[300px]" />
                                <SearchableSelect className="w-full" options={itemOptions[l.key] || []} onSearch={(q) => searchItems(l.key, q, l.categoryId)}
                                  minSearchLength={0} loading={searchingLine === l.key} value={l.itemId} selectedLabel={l.itemName}
                                  onChange={(v) => pickItem(l.key, v)} placeholder="Choose or search an item…" searchPlaceholder="Item name, code or other name"
                                  emptyText="No item found — add it in the Items tab" contentClassName="w-[420px]" />
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Select value={l.unitId} onValueChange={(v) => pickUnit(l, v)} disabled={!l.item}>
                              <SelectTrigger aria-label={`Unit for line ${i + 1}`}><SelectValue placeholder={l.item ? 'Unit' : (l.unitCode || 'Pick item first')} /></SelectTrigger>
                              <SelectContent>
                                {unitsOf(l.item).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}{u.factor !== 1 ? ` (${u.factor} ${l.item.stockUnit.code})` : ''}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-2">
                            <QuantityInput aria-label={`Quantity for line ${i + 1}`} value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} />
                          </td>
                          <td className="px-2 py-2">
                            <Input aria-label={`Rate for line ${i + 1}`} className={`text-right ${l.itemId && !(Number(l.rate) > 0) ? 'border-amber-400' : ''}`}
                              inputMode="decimal" value={l.rate} placeholder="Price" onChange={(e) => setLine(l.key, { rate: e.target.value.replace(/[^\d.]/g, '') })} />
                          </td>
                          <td className="px-2 py-2">
                            <Input aria-label={`Discount for line ${i + 1}`} className="text-right" inputMode="decimal" value={l.discountPct} placeholder="0"
                              onChange={(e) => setLine(l.key, { discountPct: e.target.value.replace(/[^\d.]/g, '') })} />
                          </td>
                          <td className="px-2 py-2">
                            {gstType === 'none' ? (
                              <div className="pt-2 text-right text-gray-400">—</div>
                            ) : (
                              <Select value={l.gstRate} onValueChange={(v) => setLine(l.key, { gstRate: v })} disabled={!l.itemId}>
                                <SelectTrigger aria-label={`GST for line ${i + 1}`}><SelectValue placeholder="—" /></SelectTrigger>
                                <SelectContent>{gstRates.map((g) => <SelectItem key={g} value={String(g)}>{g}%</SelectItem>)}</SelectContent>
                              </Select>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right font-medium tabular-nums pt-4">{l.itemId ? money(a.lineTotal) : '—'}</td>
                          <td className="px-1 py-2">
                            <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} title="Remove"
                              onClick={() => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((x) => x.key !== l.key)))}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {lines.some((l) => l.requestLineId) && (
                <p className="flex items-center gap-1 text-xs text-gray-500"><Info className="h-3.5 w-3.5" />Removing a line that came from a request puts it back on the "ready to order" list.</p>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="po-terms">Terms printed on the order</Label>
                  <Textarea id="po-terms" rows={4} value={form.terms} onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))}
                    placeholder="Left empty: delivery to the hospital stores, PO number on the invoice, inspection on receipt." />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="po-notes">Internal note <span className="font-normal text-gray-400">(not printed)</span></Label>
                  <Input id="po-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <dl className="self-start space-y-1.5 rounded-md bg-gray-50 p-4 text-sm">
                {foreign && <div className="flex justify-between text-xs"><dt className="text-gray-500">Currency</dt><dd className="font-medium">{cur.code} · 1 {cur.code} = ₹{exRate}</dd></div>}
                <div className="flex justify-between"><dt className="text-gray-500">Subtotal (after discount)</dt><dd className="tabular-nums">{money(totals.subtotal)}</dd></div>
                {gstType === 'intra' && <>
                  <div className="flex justify-between"><dt className="text-gray-500">CGST</dt><dd className="tabular-nums">{money(totals.cgst)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">SGST</dt><dd className="tabular-nums">{money(totals.sgst)}</dd></div>
                </>}
                {gstType === 'inter' && <div className="flex justify-between"><dt className="text-gray-500">IGST</dt><dd className="tabular-nums">{money(totals.igst)}</dd></div>}
                {gstType === 'none' && <div className="flex justify-between"><dt className="text-gray-500">GST</dt><dd className="text-gray-500">none — vendor not registered</dd></div>}
                <div className="flex justify-between border-t pt-2"><dt className="font-semibold">Order total</dt><dd className="text-xl font-bold tabular-nums">{money(totals.total)}</dd></div>
                {foreign && <div className="flex justify-between text-sm"><dt className="text-gray-500">= in rupees</dt><dd className="font-semibold tabular-nums text-gray-700">{inr(totals.total)}</dd></div>}
              </dl>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!saving}>Close</Button>
          <Button variant="outline" onClick={() => save(false)} disabled={!!saving || loading || loadFailed || !ready}>
            {saving === 'draft' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save draft
          </Button>
          <Button onClick={() => save(true)} disabled={!!saving || loading || loadFailed || !ready}>
            {saving === 'send' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Send for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
