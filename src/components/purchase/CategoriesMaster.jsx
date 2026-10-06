import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ChevronRight, Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { showApiError } from '@/lib/apiRequest'
import { purchaseApi } from '@/api/purchaseApi'
import { usePickList } from './usePickList'
import LoadFailed from './LoadFailed'

// Item categories:
//   editable={false} (default): read-only, with a pointer to where they change —
//                        not shown anywhere today; kept for a read-only view
//   Settings → Integrations  editable={true}:  add groups and categories, change the
//                        suggested GST and Finance heading, retire, delete
// Two levels, as everywhere else: a group (Medical) and its categories
// (Medicine, Medical device…). The server enforces what may change.

export const PURCHASE_TYPE_LABEL = {
  product: 'Product', service: 'Service', licence: 'Licence', personnel: 'Manpower', raw_material: 'Raw material',
}
const PER_ITEM = '__per_item'

export default function CategoriesMaster({ categories, editable = false, onChanged }) {
  const gstRates = usePickList(purchaseApi.getGstRates, { enabled: editable })

  // `target`: { mode: 'add-group' | 'add-child' | 'edit', parent?, row? }
  const [target, setTarget] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }))

  const open = (mode, { parent = null, row = null } = {}) => {
    setTarget({ mode, parent, row })
    const base = row || parent
    setForm({
      name: row?.name || '',
      purchaseType: base?.purchaseType || 'product',
      expenseHead: row?.expenseHead || '',
      defaultGstRate: base?.defaultGstRate == null ? (row ? PER_ITEM : '18') : String(base.defaultGstRate),
    })
  }

  const save = async () => {
    setSaving(true)
    const body = {
      name: form.name, purchaseType: form.purchaseType, expenseHead: form.expenseHead,
      defaultGstRate: form.defaultGstRate === PER_ITEM ? null : Number(form.defaultGstRate),
    }
    try {
      if (target.mode === 'edit') await purchaseApi.updateCategory(target.row.id, body)
      else await purchaseApi.createCategory({ ...body, parentId: target.mode === 'add-child' ? target.parent.id : null })
      toast.success(target.mode === 'edit' ? 'Category updated' : 'Category added')
      setTarget(null)
      onChanged?.()
    } catch (err) {
      showApiError(err, target.mode === 'edit' ? 'Could not update the category' : 'Could not add the category')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (row) => {
    try {
      await purchaseApi.updateCategory(row.id, { isActive: !row.isActive })
      toast.success(row.isActive ? `${row.name} retired` : `${row.name} restored`)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not change the category')
    }
  }

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.name}"? This cannot be undone.`)) return
    try {
      await purchaseApi.deleteCategory(row.id)
      toast.success(`${row.name} deleted`)
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not delete the category')
    }
  }

  const actions = (row) => editable && (
    <div className="flex gap-1 shrink-0">
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => open('edit', { row })}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
      <Button size="sm" variant="ghost" className={`h-7 px-2 ${row.isActive ? 'text-amber-700' : 'text-green-700'}`} onClick={() => toggleActive(row)}>
        {row.isActive ? 'Retire' : 'Restore'}
      </Button>
      {!row.isSystem && (
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${row.name}`} onClick={() => remove(row)}>
          <Trash2 className="h-3.5 w-3.5 text-red-600" />
        </Button>
      )}
    </div>
  )

  const gstText = (rate) => (rate != null ? `GST ${rate}%` : 'GST per item')

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-500">
          Where each item is filed, the GST a new item starts with, and the heading Finance reports its spend under.
          {!editable && ' An administrator adds and changes categories in Settings → Integrations → Purchase Setup.'}
        </p>
        {editable && <Button onClick={() => open('add-group')} className="shrink-0"><Plus className="h-4 w-4 mr-1" />Add group</Button>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {categories.map((top) => (
          <Card key={top.id} className={`overflow-hidden shadow-sm ${top.isActive === false ? 'opacity-60' : ''}`}>
            <CardHeader className="border-b bg-gray-50/70 pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-lg">{top.name}</CardTitle>
                <div className="flex items-center gap-2">
                  {top.isActive === false && <Badge variant="outline">Retired</Badge>}
                  <Badge variant="outline">{PURCHASE_TYPE_LABEL[top.purchaseType] || top.purchaseType}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardDescription className="min-w-0">Reported as {top.expenseHead} · {gstText(top.defaultGstRate)} by default</CardDescription>
                {actions(top)}
              </div>
            </CardHeader>
            {(top.children.length > 0 || editable) && (
              <CardContent className="divide-y px-6 pb-4 pt-1">
                {top.children.map((c) => (editable ? (
                  // Editing: the buttons need the row's width, so the details go
                  // on a second line instead of being cut to "Medical…".
                  <div key={c.id} className={`rounded-md px-1 py-2.5 text-sm hover:bg-gray-50 ${c.isActive === false ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2">
                      <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                      <span className="font-medium truncate min-w-0">{c.name}</span>
                      {c.isActive === false && <Badge variant="outline" className="shrink-0">Retired</Badge>}
                      <div className="ml-auto">{actions(c)}</div>
                    </div>
                    <div className="pl-6 text-xs text-gray-500">
                      Reported as {c.expenseHead} · {gstText(c.defaultGstRate)} · {c.itemCount} items
                    </div>
                  </div>
                ) : (
                  <div key={c.id} className={`flex items-center gap-2 py-2 text-sm ${c.isActive === false ? 'opacity-60' : ''}`}>
                    <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                    <span className="font-medium whitespace-nowrap">{c.name}</span>
                    <span className="text-gray-500 truncate min-w-0" title={c.expenseHead}>· {c.expenseHead}</span>
                    <span className="ml-auto text-gray-500 whitespace-nowrap shrink-0">
                      {gstText(c.defaultGstRate)} · {c.itemCount} items
                    </span>
                  </div>
                )))}
                {editable && top.isActive !== false && (
                  <div className="pt-2">
                    <Button size="sm" variant="outline" onClick={() => open('add-child', { parent: top })}>
                      <Plus className="h-4 w-4 mr-1" />Add category in {top.name}
                    </Button>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {editable && (
        <Dialog open={!!target} onOpenChange={(v) => !saving && !v && setTarget(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {target?.mode === 'edit' ? `Edit — ${target.row.name}` : target?.mode === 'add-child' ? `Add category in ${target.parent.name}` : 'Add group'}
              </DialogTitle>
              <DialogDescription>
                The GST here only fills in on NEW items — items already made keep their own rate.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="c-name">Name *</Label>
                <Input id="c-name" value={form.name || ''} onChange={set('name')} placeholder={target?.mode === 'add-group' ? 'e.g. Utilities' : 'e.g. Oxygen & gases'} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="c-type">Type</Label>
                  <Select value={form.purchaseType} onValueChange={set('purchaseType')}>
                    <SelectTrigger id="c-type"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(PURCHASE_TYPE_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="c-gst">Suggested GST</Label>
                  <Select value={form.defaultGstRate} onValueChange={set('defaultGstRate')}>
                    <SelectTrigger id="c-gst"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PER_ITEM}>Per item (no default)</SelectItem>
                      {gstRates.list.map((g) => <SelectItem key={g} value={String(g)}>{g}%</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {gstRates.failed && <LoadFailed onRetry={gstRates.reload}>Could not load the GST rates — only "Per item" can be chosen until they load.</LoadFailed>}
              <div className="space-y-1">
                <Label htmlFor="c-head">Reported to Finance as *</Label>
                <Input id="c-head" value={form.expenseHead || ''} onChange={set('expenseHead')} placeholder="e.g. Medical Gases" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTarget(null)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving || (form.name || '').trim().length < 2 || (form.expenseHead || '').trim().length < 2}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{target?.mode === 'edit' ? 'Save changes' : 'Add'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
