import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { QuantityInput } from '@/components/ui/quantity-input'
import { Plus, Trash2, Loader2, Send, MailX } from 'lucide-react'
import { toast } from 'sonner'
import { purchaseApi } from '@/api/purchaseApi'
import { rfqApi } from '@/api/purchaseRfqApi'
import { showApiError } from '@/lib/apiRequest'
import { localYmd, formatDateTime } from '@/lib/format'
import LoadFailed from './LoadFailed'
import { ALL, unitsOf, useItemSearch } from './itemPicking'
import { sentText } from './RfqDetail'

// A request for quotation being written: what is being bought (from an approved
// request's items not yet ordered, or picked by hand from the item list), by
// when the quotes are wanted, and which vendors are asked (two or more). The
// server checks everything again; nothing goes to a vendor until it is sent.

let nextKey = 1
const handLine = (categoryId = '') => ({ key: nextKey++, categoryId, itemId: '', itemName: '', item: null, unitId: '', unitCode: '', quantity: '', requestLineId: null })

export default function RfqForm({ open, onOpenChange, rfq, onSaved }) {
  const editing = !!rfq
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [candidates, setCandidates] = useState([]) // approved request lines not yet ordered
  const [form, setForm] = useState({ title: '', dueDate: '', notes: '' })
  const [vendorIds, setVendorIds] = useState([])
  const [vendorSearch, setVendorSearch] = useState('')
  const [requestId, setRequestId] = useState('')
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(null)
  const { itemOptions, searchingLine, searchItems, found, categoryOptions } = useItemSearch(categories)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setLoadFailed(false)
    Promise.all([purchaseApi.getVendors({ status: 'active' }), purchaseApi.getCategories(), purchaseApi.getOrderCandidates({})])
      .then(([v, c, cand]) => {
        if (!alive) return
        setVendors(v?.data ?? []); setCategories(c?.data ?? []); setCandidates(cand?.data ?? [])
        setVendorSearch('')
        if (rfq) {
          setForm({ title: rfq.title, dueDate: rfq.dueDate ? String(rfq.dueDate).slice(0, 10) : '', notes: rfq.notes || '' })
          setVendorIds(rfq.vendors.map((x) => x.vendorId))
          setRequestId(rfq.requestId || '')
          // Lines already on the draft keep their item and unit; only the quantity changes.
          setLines(rfq.lines.map((l) => ({ key: nextKey++, itemId: l.itemId, itemName: l.itemName, unitId: l.unitId, unitCode: l.unitCode, quantity: String(l.quantity), requestLineId: l.requestLineId, requestNumber: rfq.request?.number, fixed: true })))
        } else {
          setForm({ title: '', dueDate: localYmd(new Date(), 3), notes: '' })
          setVendorIds([]); setRequestId(''); setLines([])
        }
      })
      .catch((err) => { if (alive) { setLoadFailed(true); showApiError(err, 'Could not open the RFQ form') } })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [open, rfq, attempt])

  // The approved requests with items still to order, for the "from a request" picker.
  const requests = useMemo(() => {
    const map = new Map()
    for (const c of candidates) {
      if (!map.has(c.request.id)) map.set(c.request.id, { ...c.request, lines: [] })
      map.get(c.request.id).lines.push(c)
    }
    return [...map.values()]
  }, [candidates])
  const requestOptions = requests.map((r) => ({ value: r.id, label: r.number, sublabel: `${r.department?.name || ''} · ${r.lines.length} item${r.lines.length === 1 ? '' : 's'}${r.requiredBy ? ` · needed by ${formatDateTime(r.requiredBy, { withTime: false })}` : ''}` }))

  const pickRequest = (id) => {
    const pr = requests.find((r) => r.id === id)
    setRequestId(id)
    // A request's items replace the previous request's; items added by hand stay.
    setLines((ls) => [
      ...(pr?.lines || []).map((c) => ({ key: nextKey++, itemId: c.itemId, itemName: c.itemName, unitId: c.unitId, unitCode: c.unitCode, quantity: String(c.quantity), requestLineId: c.id, requestNumber: pr.number, fixed: true })),
      ...ls.filter((l) => !l.requestLineId),
    ])
    if (pr && !form.title.trim()) setForm((f) => ({ ...f, title: `Items for ${pr.department?.name || 'the department'} — ${pr.number}` }))
  }

  const removeLine = (key) => {
    const rest = lines.filter((x) => x.key !== key)
    setLines(rest)
    // The last item from the request gone: the RFQ no longer comes from it.
    if (!rest.some((x) => x.requestLineId)) setRequestId('')
  }
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const pickCategory = (line, value) => {
    const categoryId = value === ALL ? '' : value
    if (categoryId === line.categoryId) return
    setLine(line.key, { ...handLine(categoryId), key: line.key })
    searchItems(line.key, '', categoryId)
  }
  const pickItem = (key, itemId) => {
    const item = found.current.get(itemId)
    if (!item) return
    const units = unitsOf(item)
    const unit = units.find((u) => u.isPurchaseDefault) || units[0]
    setLine(key, { itemId, itemName: item.name, item, unitId: unit.id, unitCode: unit.code })
  }

  const term = vendorSearch.trim().toLowerCase()
  const shownVendors = vendors.filter((v) => vendorIds.includes(v.id) || !term || [v.name, v.code, v.city].some((x) => String(x || '').toLowerCase().includes(term)))
  const toggleVendor = (id) => setVendorIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const chosen = lines.filter((l) => l.itemId)
  const problems = [
    form.title.trim().length < 3 && 'a title',
    !form.dueDate && 'the due date',
    vendorIds.length < 2 && 'two or more vendors',
    (!chosen.length || chosen.some((l) => !(Number(l.quantity) > 0))) && 'items with quantities',
  ].filter(Boolean)

  const save = async (andSend) => {
    setSaving(andSend ? 'send' : 'draft')
    const body = {
      title: form.title, dueDate: form.dueDate, notes: form.notes, vendorIds,
      lines: chosen.map((l) => ({ itemId: l.itemId, unitId: l.unitId, quantity: l.quantity, requestLineId: l.requestLineId || undefined })),
    }
    try {
      const saved = (editing ? await rfqApi.save(rfq.id, body) : await rfqApi.create(body)).data
      let result = saved
      if (andSend) {
        try {
          const sent = await rfqApi.send(saved.id)
          result = sent.data
          toast.success(sentText(sent))
        } catch (err) {
          showApiError(err, `${saved.number} is saved as a draft but could not be sent`)
        }
      } else {
        toast.success(`${saved.number} saved as a draft`)
      }
      onOpenChange(false)
      onSaved?.(result)
    } catch (err) {
      showApiError(err, 'Could not save the RFQ')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `RFQ ${rfq.number}` : 'New request for quotation'}</DialogTitle>
          <DialogDescription>Ask two or more vendors for their rates on the same items. You enter and compare their quotes here, and the one you choose becomes the purchase order.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : loadFailed ? (
          <LoadFailed onRetry={() => setAttempt((n) => n + 1)}>Could not load the vendors, items and approved requests this form needs{editing ? ` — ${rfq.number} is unchanged` : ''}.</LoadFailed>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="rfq-title">Title *</Label>
                <Input id="rfq-title" value={form.title} maxLength={150} placeholder="e.g. Surgical gloves for ICU" onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rfq-due">Quotes due by *</Label>
                <Input id="rfq-due" type="date" min={localYmd()} value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-700">Items</h3>
                <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, handLine(ls[ls.length - 1]?.categoryId || '')])}>
                  <Plus className="h-4 w-4 mr-1" />Add item by hand
                </Button>
              </div>
              <div className="space-y-1">
                <Label>From an approved request</Label>
                <SearchableSelect className="w-full md:w-96" options={requestOptions} value={requestId} onChange={pickRequest} minSearchLength={0}
                  placeholder={requests.length ? 'Choose a request (its items not yet ordered)' : 'No approved request is waiting to be ordered'}
                  emptyText="No approved request with items still to order" disabled={!requests.length} />
              </div>
              {lines.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-gray-500">Choose a request above, or add items by hand.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr><th className="px-2 py-2 text-left font-medium">Item</th><th className="w-28 px-2 py-2 text-left font-medium">Unit</th><th className="w-40 px-2 py-2 text-center font-medium">Quantity</th><th className="w-10" /></tr>
                    </thead>
                    <tbody className="divide-y">
                      {lines.map((l, i) => (
                        <tr key={l.key} className="align-top">
                          <td className="px-2 py-2">
                            {l.fixed ? (
                              <div><div className="font-medium">{l.itemName}</div>{l.requestLineId && <div className="text-xs text-gray-500">from {l.requestNumber || 'the request'}</div>}</div>
                            ) : (
                              <div className="grid gap-1">
                                <SearchableSelect className="w-full" options={categoryOptions} value={l.categoryId || ALL} onChange={(v) => pickCategory(l, v)} placeholder="All categories" contentClassName="w-[300px]" />
                                <SearchableSelect className="w-full" options={itemOptions[l.key] || []} onSearch={(q) => searchItems(l.key, q, l.categoryId)}
                                  minSearchLength={0} loading={searchingLine === l.key} value={l.itemId} selectedLabel={l.itemName}
                                  onChange={(v) => pickItem(l.key, v)} placeholder="Choose or search an item…" emptyText="No item found — add it in the Items tab" contentClassName="w-[380px]" />
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {l.fixed ? <div className="pt-2">{l.unitCode}</div> : (
                              <Select value={l.unitId} onValueChange={(v) => setLine(l.key, { unitId: v, unitCode: unitsOf(l.item).find((u) => u.id === v)?.code || '' })} disabled={!l.item}>
                                <SelectTrigger aria-label={`Unit for line ${i + 1}`}><SelectValue placeholder={l.item ? 'Unit' : 'Pick item first'} /></SelectTrigger>
                                <SelectContent>{unitsOf(l.item).map((u) => <SelectItem key={u.id} value={u.id}>{u.code}{u.factor !== 1 ? ` (${u.factor} ${l.item.stockUnit.code})` : ''}</SelectItem>)}</SelectContent>
                              </Select>
                            )}
                          </td>
                          <td className="px-2 py-2"><QuantityInput aria-label={`Quantity for line ${i + 1}`} value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} /></td>
                          <td className="px-1 py-2">
                            <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} title="Remove"
                              onClick={() => removeLine(l.key)}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-700">Vendors to ask * <span className="font-normal text-gray-500">({vendorIds.length} chosen — two or more)</span></h3>
                <Input className="w-full sm:w-64" value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)} placeholder="Find a vendor…" aria-label="Find a vendor" />
              </div>
              {vendors.length === 0 ? (
                <p className="text-sm text-gray-500">No active vendor — add vendors in the Vendors tab first.</p>
              ) : (
                <ul className="grid max-h-60 grid-cols-1 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                  {shownVendors.map((v) => (
                    <li key={v.id}>
                      <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                        <Checkbox checked={vendorIds.includes(v.id)} onCheckedChange={() => toggleVendor(v.id)} className="mt-0.5" aria-label={`Ask ${v.name}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{v.name}</span>
                          <span className="block truncate text-xs text-gray-500">
                            {[v.code, v.city].filter(Boolean).join(' · ')}
                            {v.email ? ` · ${v.email}` : <span className="inline-flex items-center gap-0.5 text-amber-700"> · <MailX className="h-3 w-3" />no e-mail</span>}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                  {shownVendors.length === 0 && <li className="px-2 py-3 text-sm text-gray-500">No vendor matches “{vendorSearch}”.</li>}
                </ul>
              )}
            </section>

            <div className="space-y-1">
              <Label htmlFor="rfq-notes">Note to the vendors <span className="font-normal text-gray-400">(optional)</span></Label>
              <Textarea id="rfq-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g. Quote for delivery to the main store; samples needed" />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {!loading && !loadFailed && problems.length > 0 && <p className="text-xs text-gray-500 sm:mr-auto sm:self-center">Still needed: {problems.join(', ')}.</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!saving}>Close</Button>
          <Button variant="outline" onClick={() => save(false)} disabled={!!saving || loading || loadFailed || problems.length > 0}>
            {saving === 'draft' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save draft
          </Button>
          <Button onClick={() => save(true)} disabled={!!saving || loading || loadFailed || problems.length > 0}>
            {saving === 'send' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Save and send to vendors
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
