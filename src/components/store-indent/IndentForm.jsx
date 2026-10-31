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
import { Plus, Loader2, Send, ClipboardList, X } from 'lucide-react'
import { toast } from 'sonner'
import { indentApi } from '@/api/purchaseIndentApi'
import { showApiError } from '@/lib/apiRequest'
import { localYmd } from '@/lib/format'
import { PRIORITY, PURPOSE_SUGGESTIONS, showNotifyWarning } from '@/components/purchase/requestMeta'
import { unitsOf } from '@/components/purchase/itemPicking'
import LoadFailed from '@/components/purchase/LoadFailed'

// A department asks the store for goods: which items, how many, by when, and
// why. Submitting an indent records the request; stock changes only when the
// store posts an issue. No prices: a department asks for quantities.
//
// Someone with a department on their record raises for it (the server holds
// them to it); anyone else picks the department.

let nextKey = 1
const blankLine = (categoryId = '') => ({ key: nextKey++, categoryId, itemId: '', itemName: '', item: null, unitId: '', quantity: '', note: '' })
const NOT_IN_STOCK = 'Out of stock'

export default function IndentForm({ open, onOpenChange, onSaved }) {
  const [form, setForm] = useState({ departmentId: '', priority: 'normal', neededBy: '', purpose: '' })
  const [departments, setDepartments] = useState([])
  const [categories, setCategories] = useState([])
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
          sublabel: `${it.code} · ${it.category?.name || ''} · ${it.inStock ? 'Stock available' : 'Out of stock'}`,
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
  const pickCategory = (line, categoryId) => {
    if (categoryId === line.categoryId) return
    const next = blankLine(categoryId)
    setLine(line.key, { ...next, key: line.key })
    searchItems(line.key, '', categoryId)
  }
  const pickItem = (key, itemId) => {
    const item = found.current.get(itemId)
    if (!item) return
    // The store issues in the item's own unit unless a pack is usual for it.
    const units = unitsOf(item)
    const unit = units.find((u) => u.isPurchaseDefault) || units[0]
    setLine(key, { itemId, itemName: item.name, item, unitId: unit.id })
  }

  const filled = lines.filter((l) => l.itemId)
  const categoryOptions = categories.map((category) => ({ value: category.id, label: category.name }))
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
      <DialogContent className="grid max-h-[92vh] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b bg-slate-50/80 px-6 py-5 pr-14 sm:px-7">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <ClipboardList className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-semibold tracking-tight text-slate-900">Request supplies for a department</DialogTitle>
              <DialogDescription className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
                Select the receiving department and required quantities. Stock is deducted only when store staff post the issue.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading request details…</div>
        ) : loadFailed ? (
          <div className="min-h-64 px-6 py-8"><LoadFailed onRetry={() => setAttempt((n) => n + 1)}>Could not load the departments this form needs.</LoadFailed></div>
        ) : (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5 sm:px-7">
            <section aria-labelledby="indent-request-details" className="space-y-4">
              <div>
                <h3 id="indent-request-details" className="text-sm font-semibold text-slate-900">Request details</h3>
                <p className="mt-0.5 text-xs text-slate-500">Choose the receiving department and when the supplies are needed.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5 md:col-span-1">
                  <Label htmlFor="ind-dept">Department <span className="text-red-500">*</span></Label>
                  {myDepartment ? (
                    <p id="ind-dept" className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-800">{myDepartment.name}</p>
                  ) : (
                    <SearchableSelect
                      id="ind-dept"
                      className="w-full"
                      options={departments.map((d) => ({ value: d.id, label: d.name }))}
                      value={form.departmentId}
                      onChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
                      placeholder="Which department needs these items?"
                      emptyText="No departments found — ask an administrator to add one in Settings"
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ind-priority">Priority</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                    <SelectTrigger id="ind-priority" className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(PRIORITY).map(([v, p]) => <SelectItem key={v} value={v}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ind-by">Required by</Label>
                  <Input id="ind-by" type="date" min={localYmd()} value={form.neededBy} onChange={(e) => setForm((f) => ({ ...f, neededBy: e.target.value }))} className="h-10" />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <Label htmlFor="ind-purpose">Reason for request{form.priority !== 'normal' && <span className="text-red-500"> *</span>}</Label>
                  <Textarea id="ind-purpose" rows={2} maxLength={500} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                    placeholder="For example: monthly ICU restock — current stock will last 5 days" className="min-h-20 resize-y" />
                  {needsReason && <p className="text-xs font-medium text-red-600">Add a reason for this {PRIORITY[form.priority].label.toLowerCase()} request.</p>}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs text-slate-500">Common reasons:</span>
                    {PURPOSE_SUGGESTIONS.map((reason) => (
                      <Button key={reason} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
                        onClick={() => setForm((f) => ({ ...f, purpose: f.purpose ? `${f.purpose}; ${reason}` : reason }))}>
                        {reason}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section aria-labelledby="indent-request-items" className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id="indent-request-items" className="text-sm font-semibold text-slate-900">Requested items</h3>
                    <Badge variant="secondary" className="rounded-full px-2 text-xs">{filled.length} selected</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">Choose a category, then select an item from the hospital catalogue.</p>
                </div>
                <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setLines((ls) => [...ls, blankLine(ls[ls.length - 1]?.categoryId || '')])} disabled={lines.length >= 100}>
                  <Plus className="mr-1.5 h-4 w-4" />Add item
                </Button>
              </div>

              <div className="space-y-3">
                {lines.map((l, i) => {
                  const units = unitsOf(l.item)
                  return (
                    <div key={l.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Item {i + 1}</p>
                        <Button type="button" size="sm" variant="ghost" aria-label={`Remove item ${i + 1}`}
                          className="h-8 px-2 text-slate-500 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((x) => x.key !== l.key)))}>
                          <X className="mr-1 h-4 w-4" /><span className="text-xs">Remove</span>
                        </Button>
                      </div>
                      <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)_130px_150px] lg:items-start">
                        <div className="min-w-0 space-y-2">
                          <Label htmlFor={`indent-category-${l.key}`}>Category <span className="text-red-500">*</span></Label>
                          <SearchableSelect
                            id={`indent-category-${l.key}`}
                            className="w-full"
                            options={categoryOptions}
                            value={l.categoryId}
                            onChange={(v) => pickCategory(l, v)}
                            placeholder="Choose category…"
                            searchPlaceholder="Search categories"
                            emptyText="No categories available"
                          />
                        </div>
                        <div className="min-w-0 space-y-2">
                          <Label htmlFor={`indent-item-${l.key}`}>Item <span className="text-red-500">*</span></Label>
                          <SearchableSelect
                            id={`indent-item-${l.key}`}
                            className="w-full"
                            options={itemOptions[l.key] || []}
                            onSearch={l.categoryId ? (q) => searchItems(l.key, q, l.categoryId) : undefined}
                            disabled={!l.categoryId}
                            minSearchLength={0}
                            loading={searchingLine === l.key}
                            value={l.itemId}
                            selectedLabel={l.itemName}
                            onChange={(v) => pickItem(l.key, v)}
                            placeholder={l.categoryId ? 'Choose or search an item…' : 'Choose category first'}
                            searchPlaceholder="Item name or code"
                            emptyText={l.categoryId ? 'No item in this category' : 'Choose a category first'}
                          />
                          <Input className="h-9 text-sm" aria-label={`Note for item ${i + 1}`} placeholder="Note (size, brand…) — optional" maxLength={200}
                            value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} />
                          {l.item && (l.item.inStock
                            ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Stock available</Badge>
                            : <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{NOT_IN_STOCK}</Badge>)}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`indent-unit-${l.key}`}>Unit <span className="text-red-500">*</span></Label>
                          <Select value={l.unitId} onValueChange={(v) => setLine(l.key, { unitId: v })} disabled={!l.item}>
                            <SelectTrigger id={`indent-unit-${l.key}`} className="h-10"><SelectValue placeholder="Select unit" /></SelectTrigger>
                            <SelectContent>
                              {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.code}{u.factor !== 1 ? ` (${u.factor} ${l.item.stockUnit.code})` : ''}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`indent-qty-${l.key}`}>Quantity <span className="text-red-500">*</span></Label>
                          <QuantityInput id={`indent-qty-${l.key}`} aria-label={`Quantity for item ${i + 1}`} value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} className="w-full" />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="shrink-0 border-t bg-white px-6 py-4 sm:px-7">
          <p className="mr-auto hidden self-center text-xs text-slate-500 sm:block">{filled.length ? `${filled.length} item${filled.length === 1 ? '' : 's'} ready to request` : 'Add an item and quantity to continue'}</p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading || loadFailed || !ready}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Submit store request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
