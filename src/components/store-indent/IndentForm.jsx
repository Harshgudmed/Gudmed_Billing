import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { QuantityInput } from '@/components/ui/quantity-input'
import { Plus, Trash2, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { indentApi } from '@/api/purchaseIndentApi'
import { showApiError } from '@/lib/apiRequest'
import { localYmd } from '@/lib/format'
import { PRIORITY, showNotifyWarning } from '@/components/purchase/requestMeta'
import { unitsOf } from '@/components/purchase/itemPicking'
import LoadFailed from '@/components/purchase/LoadFailed'

// A department asks the store for goods: which items, how many, by when, and
// why. Items come from the store's item list, each marked "in stock" or "not
// in stock" — the store gives what it holds at once; for the rest it raises a
// purchase request. No prices: a ward asks for quantities.
//
// Someone with a department on their record raises for it (the server holds
// them to it); anyone else picks the department.

let nextKey = 1
const blankLine = () => ({ key: nextKey++, itemId: '', itemName: '', item: null, unitId: '', quantity: '', note: '' })
const NOT_IN_STOCK = 'Not available in store — a Purchase Request will be raised automatically'

export default function IndentForm({ open, onOpenChange, onSaved }) {
  const [form, setForm] = useState({ departmentId: '', priority: 'normal', neededBy: '', purpose: '' })
  const [departments, setDepartments] = useState([])
  const [categories, setCategories] = useState([])
  const [categoryId, setCategoryId] = useState('')
  const [myDepartment, setMyDepartment] = useState(null)
  const [lines, setLines] = useState([blankLine()])
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)

  // Item search, one result list per line; `found` turns a picked id back into the item.
  const [itemOptions, setItemOptions] = useState({})
  const [searchingLine, setSearchingLine] = useState(null)
  const found = useRef(new Map())
  const searchItems = useCallback(async (key, q, catId) => {
    setSearchingLine(key)
    try {
      const r = await indentApi.searchItems({ search: q, page: 1, limit: 30, ...(catId ? { categoryId: catId } : {}) })
      const rows = r?.data ?? []
      rows.forEach((it) => found.current.set(it.id, it))
      setItemOptions((o) => ({
        ...o,
        [key]: rows.map((it) => ({
          value: it.id, label: it.name,
          sublabel: `${it.code} · ${it.category?.name || ''} · ${it.inStock ? 'In stock' : 'Not in stock'}`,
        })),
      }))
    } catch (err) {
      // Say so and keep the list as it was: an empty one reads as "no such item".
      showApiError(err, 'Could not search the store\'s items')
    } finally { setSearchingLine((s) => (s === key ? null : s)) }
  }, [])

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setLoadFailed(false)
    setForm({ departmentId: '', priority: 'normal', neededBy: '', purpose: '' })
    setLines([blankLine()])
    setCategoryId('')
    indentApi.getForm()
      .then((r) => {
        if (!alive) return
        setDepartments(r.data?.departments ?? [])
        setCategories(r.data?.categories ?? [])
        setMyDepartment(r.data?.myDepartment ?? null)
        if (r.data?.myDepartment) setForm((f) => ({ ...f, departmentId: r.data.myDepartment.id }))
      })
      .catch((err) => { if (alive) { setLoadFailed(true); showApiError(err, 'Could not open the indent form') } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, attempt])

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const pickItem = (key, itemId) => {
    const item = found.current.get(itemId)
    if (!item) return
    // The store issues in the item's own unit unless a pack is usual for it.
    const units = unitsOf(item)
    const unit = units.find((u) => u.isPurchaseDefault) || units[0]
    setLine(key, { itemId, itemName: item.name, item, unitId: unit.id })
  }

  const filled = lines.filter((l) => l.itemId)
  const needsReason = form.priority !== 'normal' && !form.purpose.trim()
  const ready = form.departmentId && filled.length > 0 && filled.every((l) => Number(l.quantity) > 0) && !needsReason

  const save = async () => {
    setSaving(true)
    try {
      const r = await indentApi.raiseIndent({
        departmentId: form.departmentId, priority: form.priority, neededBy: form.neededBy || null, purpose: form.purpose,
        lines: filled.map((l) => ({ itemId: l.itemId, unitId: l.unitId, quantity: l.quantity, note: l.note })),
      })
      toast.success(`${r.data.number} sent to the store`)
      showNotifyWarning(r)
      onSaved?.(r.data)
      onOpenChange(false)
    } catch (err) {
      showApiError(err, 'Could not send the indent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request Items from Store</DialogTitle>
          <DialogDescription>
            Fill this form to request supplies for your department. Items available in stock will be issued immediately.
            Items not in stock will automatically trigger a Purchase Request.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading…</div>
        ) : loadFailed ? (
          <LoadFailed onRetry={() => setAttempt((n) => n + 1)}>Could not load the departments this form needs.</LoadFailed>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ind-dept">Requesting Department <span className="text-red-500">*</span></Label>
                {myDepartment ? (
                  <p id="ind-dept" className="flex h-9 items-center rounded-md border bg-gray-50 px-3 text-sm">{myDepartment.name}</p>
                ) : (
                  <SearchableSelect
                    className="w-full"
                    options={departments.map((d) => ({ value: d.id, label: d.name }))}
                    value={form.departmentId}
                    onChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
                    placeholder="Select your department…"
                    emptyText="No departments found — ask administrator to add them in Settings"
                  />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="ind-priority">Urgency Level</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                    <SelectTrigger id="ind-priority"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(PRIORITY).map(([v, p]) => <SelectItem key={v} value={v}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ind-by">Required By (Date)</Label>
                  <Input id="ind-by" type="date" min={localYmd()} value={form.neededBy} onChange={(e) => setForm((f) => ({ ...f, neededBy: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ind-purpose">Purpose / Reason for Request{form.priority !== 'normal' && <span className="text-red-500"> *</span>}</Label>
                <Textarea id="ind-purpose" rows={2} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  placeholder="e.g. Monthly ICU consumables restock, OT preparation for surgery on 16-Oct" />
                {needsReason && <p className="text-xs text-red-600">Please mention the reason — required for {PRIORITY[form.priority].label.toLowerCase()} priority requests</p>}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">Items to Request</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Search by item name or code. Filter by category to narrow results.</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])} disabled={lines.length >= 100}>
                  <Plus className="h-4 w-4 mr-1" />Add Another Item
                </Button>
              </div>
              {categories.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500 font-medium">Filter by category:</span>
                  <button
                    type="button"
                    onClick={() => { setCategoryId(''); setItemOptions({}) }}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${!categoryId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}
                  >All</button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setCategoryId(c.id); setItemOptions({}) }}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors ${categoryId === c.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}
                    >{c.name}</button>
                  ))}
                </div>
              )}
              <div className="divide-y rounded-md border">
                {lines.map((l, i) => {
                  const units = unitsOf(l.item)
                  return (
                    <div key={l.key} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-12 sm:items-start">
                      <div className="sm:col-span-6 space-y-1">
                        <SearchableSelect
                          className="w-full"
                          options={itemOptions[l.key] || []}
                          onSearch={(q) => searchItems(l.key, q, categoryId)}
                          minSearchLength={0}
                          loading={searchingLine === l.key}
                          value={l.itemId}
                          selectedLabel={l.itemName}
                          onChange={(v) => pickItem(l.key, v)}
                          placeholder="Search item by name or code…"
                          searchPlaceholder="Type item name, code or category"
                          emptyText="Item not found — contact Purchase team to add it"
                        />
                        {l.item && (l.item.inStock
                          ? <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">In stock</Badge>
                          : <p className="text-xs font-medium text-amber-700">{NOT_IN_STOCK}</p>)}
                        <Input className="h-8 text-xs" aria-label={`Note for line ${i + 1}`} placeholder="Specifications (size, brand, colour…) — optional"
                          value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-[1fr_auto_auto] gap-2 sm:col-span-6 sm:grid-cols-[9.5rem_1fr_auto]">
                        <Select value={l.unitId} onValueChange={(v) => setLine(l.key, { unitId: v })} disabled={!l.item}>
                          <SelectTrigger aria-label={`Unit for line ${i + 1}`}><SelectValue placeholder="Unit" /></SelectTrigger>
                          <SelectContent>
                            {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.code}{u.factor !== 1 ? ` (${u.factor} ${l.item.stockUnit.code})` : ''}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <QuantityInput aria-label={`Quantity for line ${i + 1}`} value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} className="w-32 sm:w-full" />
                        <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`}
                          onClick={() => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((x) => x.key !== l.key)))}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || loadFailed || !ready}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Submit Request to Store
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
