import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { QuantityInput } from '@/components/ui/quantity-input'
import { Plus, Trash2, Loader2, Send, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, localYmd } from '@/lib/format'
import { PRIORITY, APPROVER_LABEL, useMe, showNotifyWarning } from './requestMeta'
import LoadFailed from './LoadFailed'
import { ALL, unitsOf, suggestedRate, useItemSearch } from './itemPicking'

// A purchase request, new or a draft being changed: which department wants
// what, by when, and why. The person asks for items and quantities; a price is
// optional — whoever asks rarely knows it. The approx. rate starts from the
// item's last price when there is one; the real price and GST are settled on
// the purchase order.
//
// Each line starts with a category (Furniture, Linen…) and its item picker then
// offers only that category's items — a group takes everything under it. A new
// line starts in the category of the line above, so a furniture request is
// furniture all the way down without choosing it again.
//
// The bottom of the form says who will have to approve it, worked out from
// the hospital's rules and the total as it is typed — no surprise after
// pressing Send.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
let nextKey = 1
const blankLine = (categoryId = '') => ({ key: nextKey++, categoryId, itemId: '', itemName: '', item: null, unitId: '', quantity: '', estimatedRate: '', rateTyped: false, note: '' })


export default function RequestForm({ open, onOpenChange, request, onSaved }) {
  const editing = !!request
  // The store raises requests without prices (the server sends it none).
  const money = useMe().seesMoney
  const [departments, setDepartments] = useState([])
  const [rules, setRules] = useState([])
  const [approverNames, setApproverNames] = useState({}) // role → names of the people who hold it
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState({ departmentId: '', requiredBy: '', priority: 'normal', purpose: '' })
  const [lines, setLines] = useState([blankLine()])
  const [loading, setLoading] = useState(false)
  // The form could not be filled (a list or a draft line's item did not load):
  // it says so with a retry, and cannot be saved over the draft half-loaded.
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(null) // 'draft' | 'send'

  // Item search, one list per line (each line has its own category) — shared with the order form.
  const { itemOptions, searchingLine, searchItems, found, categoryOptions } = useItemSearch(categories)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setLoadFailed(false)
    ;(async () => {
      try {
        // The approval levels follow the amount, which the store does not see
        // (the server leaves the ₹ thresholds out for it), so it does not ask.
        const [d, r, c] = await Promise.all([client.get('/settings?resource=departments'), money ? purchaseApi.getApprovalRules() : null, purchaseApi.getCategories()])
        if (!alive) return
        setCategories(c?.data ?? [])
        setDepartments((d?.data ?? []).filter((x) => x.isActive !== false || x.id === request?.departmentId))
        setRules(r?.data?.rules ?? [])
        setApproverNames(r?.data?.approverNames ?? {})
        if (request) {
          // A draft's lines need their items' units for the unit picker. A
          // failed read fails the form: a line without its item lost its
          // category and unit choices.
          const items = await Promise.all([...new Set(request.lines.map((l) => l.itemId))].map((id) => purchaseApi.getItem(id).then((x) => x.data)))
          if (!alive) return
          const byId = new Map(items.map((it) => [it.id, it]))
          setForm({
            departmentId: request.departmentId,
            requiredBy: request.requiredBy ? String(request.requiredBy).slice(0, 10) : '',
            priority: request.priority, purpose: request.purpose || '',
          })
          setLines(request.lines.length ? request.lines.map((l) => ({
            key: nextKey++, categoryId: byId.get(l.itemId)?.categoryId || '', itemId: l.itemId, itemName: l.itemName, item: byId.get(l.itemId) || null,
            unitId: l.unitId, quantity: String(l.quantity), estimatedRate: String(l.estimatedRate), rateTyped: true, note: l.note || '',
          })) : [blankLine()])
        } else {
          setForm({ departmentId: '', requiredBy: '', priority: 'normal', purpose: '' })
          setLines([blankLine()])
        }
      } catch (err) {
        if (!alive) return
        setLoadFailed(true)
        showApiError(err, 'Could not open the request form')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [open, request, money, attempt])

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  // A new category empties the line — the item chosen before may not be in it.
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
    setLine(key, { itemId, itemName: item.name, item, unitId: unit.id, estimatedRate: suggestedRate(item, unit.factor), rateTyped: false })
  }
  const pickUnit = (line, unitId) => {
    const unit = unitsOf(line.item).find((u) => u.id === unitId)
    // A rate the person typed is theirs; one we suggested follows the unit.
    setLine(line.key, { unitId, ...(line.rateTyped ? {} : { estimatedRate: suggestedRate(line.item, unit?.factor ?? 1) }) })
  }

  const lineTotal = (l) => round2((Number(l.quantity) || 0) * (Number(l.estimatedRate) || 0) * (1 + (l.item?.gstRate ?? 0) / 100))
  const total = round2(lines.reduce((s, l) => s + lineTotal(l), 0))
  const approvers = useMemo(() => [...rules].sort((a, b) => a.level - b.level).filter((r) => total >= r.minAmount), [rules, total])

  const body = () => ({
    departmentId: form.departmentId,
    requiredBy: form.requiredBy || null,
    priority: form.priority,
    purpose: form.purpose,
    lines: lines.filter((l) => l.itemId).map((l) => ({
      itemId: l.itemId, unitId: l.unitId, quantity: l.quantity,
      // the store's request carries no rate: the server starts from the last price paid
      estimatedRate: !money || l.estimatedRate === '' ? undefined : l.estimatedRate, note: l.note,
    })),
  })

  const save = async (send) => {
    setSaving(send ? 'send' : 'draft')
    try {
      const saved = editing ? await purchaseApi.saveRequest(request.id, body()) : await purchaseApi.createRequest(body())
      const pr = saved.data
      if (send) {
        try {
          const sent = await purchaseApi.submitRequest(pr.id)
          toast.success(sent.data.status === 'approved' ? `${pr.number} approved — under every approval limit` : `${pr.number} sent for approval`)
          showNotifyWarning(sent)
          onSaved?.(sent.data)
        } catch (err) {
          // Saved as a draft either way; say why it could not go yet.
          showApiError(err, `${pr.number} is saved as a draft but could not be sent`)
          onSaved?.(pr)
        }
      } else {
        toast.success(editing ? `${pr.number} saved` : `Draft ${pr.number} saved`)
        onSaved?.(pr)
      }
      onOpenChange(false)
    } catch (err) {
      showApiError(err, 'Could not save the request')
    } finally {
      setSaving(null)
    }
  }

  const ready = form.departmentId && lines.some((l) => l.itemId)

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${request.number}` : 'New purchase request'}</DialogTitle>
          <DialogDescription>Ask for what the department needs. Nothing is ordered until the request is approved.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading…</div>
        ) : loadFailed ? (
          <LoadFailed onRetry={() => setAttempt((n) => n + 1)}>
            Could not load the departments, items and categories this form needs{editing ? ` — ${request.number} is unchanged` : ''}.
          </LoadFailed>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1 md:col-span-2">
                <Label>Department *</Label>
                <SearchableSelect
                  className="w-full"
                  options={departments.map((d) => ({ value: d.id, label: d.name }))}
                  value={form.departmentId}
                  onChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
                  placeholder="Which department needs it?"
                  emptyText="No department — add one in Settings"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pr-by">Needed by</Label>
                <Input id="pr-by" type="date" min={localYmd()} value={form.requiredBy} onChange={(e) => setForm((f) => ({ ...f, requiredBy: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pr-priority">Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                  <SelectTrigger id="pr-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PRIORITY).map(([v, p]) => <SelectItem key={v} value={v}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-4">
                <Label htmlFor="pr-purpose">Why is it needed?{form.priority !== 'normal' && ' *'}</Label>
                <Textarea id="pr-purpose" rows={2} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  placeholder="e.g. Monthly restock for ICU — current stock lasts 5 days" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Items</h3>
                <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine(ls[ls.length - 1]?.categoryId || '')])} disabled={lines.length >= 100}>
                  <Plus className="h-4 w-4 mr-1" />Add item
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-2 py-2 w-48">Category</th>
                      <th className="text-left font-medium px-2 py-2 min-w-[240px]">Item</th>
                      <th className="text-left font-medium px-2 py-2 w-28">Unit</th>
                      <th className="text-center font-medium px-2 py-2 w-36">Qty</th>
                      {money && <th className="text-right font-medium px-2 py-2 w-32">Approx. rate ₹ <span className="font-normal text-gray-400">(optional)</span></th>}
                      {money && <th className="text-right font-medium px-2 py-2 w-32">Approx. cost</th>}
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((l, i) => {
                      const units = unitsOf(l.item)
                      return (
                        <tr key={l.key} className="align-top">
                          <td className="px-2 py-2">
                            <SearchableSelect
                              className="w-full"
                              options={categoryOptions}
                              value={l.categoryId || ALL}
                              onChange={(v) => pickCategory(l, v)}
                              placeholder="All categories"
                              searchPlaceholder="Furniture, Linen, Electrical…"
                              contentClassName="w-[300px]"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <SearchableSelect
                              className="w-full"
                              options={itemOptions[l.key] || []}
                              onSearch={(q) => searchItems(l.key, q, l.categoryId)}
                              // Items show as soon as it opens; typing narrows from the first letter.
                              minSearchLength={0}
                              loading={searchingLine === l.key}
                              value={l.itemId}
                              selectedLabel={l.itemName}
                              onChange={(v) => pickItem(l.key, v)}
                              placeholder="Choose or search an item…"
                              searchPlaceholder="Item name, code or other name"
                              emptyText={l.categoryId ? 'No item in this category — add it in the Items tab' : 'No item found — add it in the Items tab'}
                              contentClassName="w-[420px]"
                            />
                            <Input className="mt-1 h-8 text-xs" aria-label={`Note for line ${i + 1}`} placeholder="Note (size, brand…) — optional"
                              value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} />
                          </td>
                          <td className="px-2 py-2">
                            <Select value={l.unitId} onValueChange={(v) => pickUnit(l, v)} disabled={!l.item}>
                              <SelectTrigger aria-label={`Unit for line ${i + 1}`}><SelectValue placeholder={l.item ? 'Unit' : 'Pick item first'} /></SelectTrigger>
                              <SelectContent>
                                {units.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>{u.code}{u.factor !== 1 ? ` (${u.factor} ${l.item.stockUnit.code})` : ''}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-2">
                            <QuantityInput aria-label={`Quantity for line ${i + 1}`} value={l.quantity}
                              onChange={(v) => setLine(l.key, { quantity: v })} />
                          </td>
                          {money && (
                            <td className="px-2 py-2">
                              <Input aria-label={`Rate for line ${i + 1}`} className="text-right" inputMode="decimal" value={l.estimatedRate}
                                placeholder="If known"
                                onChange={(e) => setLine(l.key, { estimatedRate: e.target.value, rateTyped: true })} />
                            </td>
                          )}
                          {money && <td className="px-2 py-2 text-right font-medium tabular-nums pt-4">{l.itemId && Number(l.estimatedRate) > 0 ? formatMoney(lineTotal(l)) : <span className="font-normal text-gray-400">—</span>}</td>}
                          <td className="px-1 py-2">
                            <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`}
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
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-md bg-gray-50 px-4 py-3">
              <div className="text-sm">
                {/* Where the request goes once it is sent — the hospital's rules
                    for this amount, and the people who hold each role. */}
                <span className="text-gray-500">After sending, it goes for approval to: </span>
                {!money ? (
                  // The store sees no prices, so the levels (which follow the amount) are worked out on sending.
                  <span className="font-medium">the approvers for its value — worked out from the hospital's last prices when you send it</span>
                ) : approvers.length === 0 ? (
                  <span className="font-medium text-green-700">nobody — no approval needed at this amount</span>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-1 font-medium">
                    {approvers.map((r, i) => {
                      const names = approverNames[r.approverRole] || []
                      return (
                        <span key={r.level} className="inline-flex items-center gap-1">
                          {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-gray-400" />}
                          {APPROVER_LABEL[r.approverRole] || r.approverRole}
                          <span className="font-normal text-gray-600">
                            ({names.length ? names.join(', ') : 'nobody has this role yet — add one in Settings → Users'})
                          </span>
                        </span>
                      )
                    })}
                  </span>
                )}
              </div>
              {money && (
                <div className="text-right shrink-0">
                  <div className="text-xs text-gray-500">Approx. total, GST included</div>
                  <div className="text-xl font-bold tabular-nums">{formatMoney(total)}</div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!saving}>Close</Button>
          <Button variant="outline" onClick={() => save(false)} disabled={!!saving || loading || loadFailed || !form.departmentId}>
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
