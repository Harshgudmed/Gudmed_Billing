import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Plus, Pencil, Loader2, Trash2, Ban, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { useDateFilter } from '@/components/common/DateFilter'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { showApiError } from '@/lib/apiRequest'
import { useMe } from './requestMeta'
import { flattenCategories, categoryPickerOptions, categoryFilterOptions } from './categoryOptions'
import { purchaseApi, PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { usePickList } from './usePickList'
import LoadFailed from './LoadFailed'

// Items — everything the hospital buys. An item is where the other masters
// meet: its CATEGORY says what it is (and suggests its GST and the heading
// Finance reports it under), its UNIT says how it is counted, its VENDOR says
// who it usually comes from. Requests and orders pick the item and inherit all
// of that, so nobody retypes it.
//
// The server decides what follows from what (a service is never stocked, GST
// comes from the category unless set); this form shows those choices as they
// are made so the person sees what will be saved.

const STATUS_OPTIONS = [
  { value: 'all', label: 'All items' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Retired' },
]
const PURCHASE_TYPES = [
  { value: 'product', label: 'Product' },
  { value: 'raw_material', label: 'Raw material' },
  { value: 'service', label: 'Service' },
  { value: 'licence', label: 'Licence' },
  { value: 'personnel', label: 'Manpower' },
]
const NOT_STOCKED = new Set(['service', 'licence', 'personnel'])
const ALL = '__all'

const EMPTY = {
  name: '', aliases: '', description: '', categoryId: '', purchaseType: 'product',
  hsnCode: '', gstRate: '', stockUnitId: '', preferredVendorId: '',
  reorderLevel: '',
  conversions: [],
}

export default function ItemsMaster({ units, categories, onChanged }) {
  // Store and purchase staff keep items; an approver (Finance) only reads them.
  // Adding and changing is for those who order; Finance only reads.
  const { canManageMasters } = useMe()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState(ALL)
  const dateFilter = useDateFilter('all', { showClear: false })
  const debouncedSearch = useDebounce(search, 300)
  const items = useServerPagination(PURCHASE_ENDPOINT, {
    params: {
      resource: 'items', search: debouncedSearch,
      status: status === 'all' ? '' : status,
      categoryId: categoryFilter === ALL ? '' : categoryFilter,
      startDate: dateFilter.range.startDate,
      endDate: dateFilter.range.endDate,
    },
  })
  useLiveData('purchase', items.refresh)

  const gstRates = usePickList(purchaseApi.getGstRates)

  // Categories as the picker needs them: every category, its parent beside it.
  const flatCategories = useMemo(() => flattenCategories(categories), [categories])
  const categoryById = useMemo(() => Object.fromEntries(flatCategories.map((c) => [c.id, c])), [flatCategories])
  const categoryOptions = useMemo(() => categoryPickerOptions(flatCategories), [flatCategories])
  const unitById = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u])), [units])

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const set = (key) => (e) => setField(key, e?.target ? e.target.value : e)
  // Read each time the form opens, so a vendor added a minute ago is offered.
  const vendors = usePickList(() => purchaseApi.getVendors({ status: 'active' }), { enabled: open })

  const startAdd = () => {
    setEditingId(null)
    setForm({ ...EMPTY, stockUnitId: units.find((u) => u.code === 'PCS')?.id || '' })
    setOpen(true)
  }
  const startEdit = async (row) => {
    try {
      const { data: it } = await purchaseApi.getItem(row.id)
      setForm({
        name: it.name, aliases: it.aliases || '', description: it.description || '',
        categoryId: it.categoryId, purchaseType: it.purchaseType, hsnCode: it.hsnCode || '',
        gstRate: String(it.gstRate), stockUnitId: it.stockUnitId, preferredVendorId: it.preferredVendorId || '',
        reorderLevel: it.reorderLevel == null ? '' : String(it.reorderLevel),
        conversions: it.conversions.map((c) => ({ unitId: c.unitId, factor: String(c.factor), isPurchaseDefault: c.isPurchaseDefault })),
      })
      setEditingId(row.id)
      setOpen(true)
    } catch (err) {
      showApiError(err, 'Could not open this item')
    }
  }

  // Choosing a category brings its purchase type and suggested GST with it —
  // the person can still change either.
  const pickCategory = (id) => {
    const c = categoryById[id]
    setForm((f) => ({
      ...f,
      categoryId: id,
      purchaseType: c?.purchaseType || f.purchaseType,
      gstRate: c?.defaultGstRate != null ? String(c.defaultGstRate) : f.gstRate,
    }))
  }

  const notStocked = NOT_STOCKED.has(form.purchaseType)
  const stockUnit = unitById[form.stockUnitId]

  const setConversion = (i, patch) => setForm((f) => ({
    ...f,
    conversions: f.conversions.map((c, j) => {
      if (j === i) return { ...c, ...patch }
      // Only one unit can be the default for buying.
      return patch.isPurchaseDefault ? { ...c, isPurchaseDefault: false } : c
    }),
  }))

  const save = async () => {
    setSaving(true)
    const body = {
      ...form,
      gstRate: form.gstRate === '' ? undefined : Number(form.gstRate),
      conversions: form.conversions.filter((c) => c.unitId && c.factor !== '')
        .map((c) => ({ unitId: c.unitId, factor: Number(c.factor), isPurchaseDefault: !!c.isPurchaseDefault })),
    }
    try {
      if (editingId) await purchaseApi.updateItem(editingId, body)
      else await purchaseApi.createItem(body)
      toast.success(editingId ? 'Item updated' : 'Item added')
      setOpen(false)
      items.refresh()
      onChanged?.()
    } catch (err) {
      showApiError(err, editingId ? 'Could not update the item' : 'Could not add the item')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (row) => {
    try {
      await purchaseApi.updateItem(row.id, { isActive: !row.isActive })
      toast.success(row.isActive ? `${row.name} retired` : `${row.name} restored`)
      items.refresh()
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not change the item')
    }
  }

  // Groups and their categories: "Furniture" can be picked on its own, a group
  // ("Office & General (all)") takes everything under it.
  const topCategoryOptions = categoryFilterOptions(flatCategories, ALL)

  return (
    // The HMS list layout, as on Pharmacy's tabs: the filter row with the Add
    // button at its end, then the table in a card.
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search item name, code, HSN or other names (e.g. chadar)…"
        active={!!search || status !== 'all' || categoryFilter !== ALL || dateFilter.active}
        onClear={() => { setSearch(''); setStatus('all'); setCategoryFilter(ALL); dateFilter.reset() }}
        actions={canManageMasters && <Button onClick={startAdd}><Plus className="h-4 w-4 mr-1" />Add Item</Button>}
      >
        <FilterSelect value={categoryFilter} onChange={setCategoryFilter} options={topCategoryOptions} className="w-64" />
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        {dateFilter.control}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
        <PaginatedTable
          pagination={items}
          empty={search || status !== 'all' || categoryFilter !== ALL || dateFilter.active ? 'No item matches these filters' : 'No items yet — add the first one'}
          columns={[
            { header: 'Code' }, { header: 'Item' }, { header: 'Category' }, { header: 'Unit' },
            { header: 'GST' }, { header: 'Usual vendor' }, { header: 'Status' }, ...(canManageMasters ? [{ header: 'Actions' }] : []),
          ]}
          renderRow={(it) => (
            <TableRow key={it.id} className={it.isActive ? '' : 'opacity-60'}>
              <TableCell className="font-mono text-sm whitespace-nowrap">{it.code}</TableCell>
              <TableCell>
                <div className="font-medium">{it.name}</div>
                <div className="text-xs text-gray-500">
                  {[it.hsnCode && `HSN ${it.hsnCode}`, it.aliases && `also: ${it.aliases}`].filter(Boolean).join(' · ')}
                </div>
              </TableCell>
              <TableCell className="text-sm">
                <div>{it.category?.name}</div>
                {it.category?.parent && <div className="text-xs text-gray-500">{it.category.parent.name}</div>}
              </TableCell>
              <TableCell className="text-sm">
                <div>{it.stockUnit?.name}</div>
                {it.conversions?.length > 0 && (
                  <div className="text-xs text-gray-500">
                    {it.conversions.map((c) => `1 ${c.unit.name} = ${c.factor} ${it.stockUnit?.name}`).join(' · ')}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-sm">{it.gstRate}%</TableCell>
              <TableCell className="text-sm">{it.preferredVendor?.name || '—'}</TableCell>
              <TableCell>
                {it.isActive
                  ? (!NOT_STOCKED.has(it.purchaseType)
                    ? <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">Stocked</Badge>
                    // A service, licence or manpower: paid for, never on a shelf.
                    : <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Spend only</Badge>)
                  : <Badge variant="outline">Retired</Badge>}
              </TableCell>
              {canManageMasters && (
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" title="Edit" aria-label={`Edit ${it.name}`} onClick={() => startEdit(it)}><Pencil className="h-4 w-4" /></Button>
                    {it.isActive
                      ? <Button size="sm" variant="ghost" className="text-red-500" title="Retire" aria-label={`Retire ${it.name}`} onClick={() => toggleActive(it)}><Ban className="h-4 w-4" /></Button>
                      : <Button size="sm" variant="ghost" className="text-green-600" title="Restore" aria-label={`Restore ${it.name}`} onClick={() => toggleActive(it)}><RotateCcw className="h-4 w-4" /></Button>}
                  </div>
                </TableCell>
              )}
            </TableRow>
          )}
        />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? `Edit item — ${form.name}` : 'Add item'}</DialogTitle>
            <DialogDescription>Pick the category first — its GST and type fill in, and can still be changed.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <Section title="What it is">
              <Field label="Name *" id="i-name" className="md:col-span-2"><Input id="i-name" value={form.name} onChange={set('name')} placeholder="e.g. Visitor Chair (Plastic)" /></Field>
              <Field label="Category *" id="i-cat">
                <SearchableSelect className="w-full" options={categoryOptions} value={form.categoryId} onChange={pickCategory}
                  placeholder="Choose category" searchPlaceholder="Search category…" contentClassName="w-[320px]" />
              </Field>
              <Field label="Also searched as" id="i-alias" className="md:col-span-2" hint="Other words people use — kursi, chadar, bedsheet">
                <Input id="i-alias" value={form.aliases} onChange={set('aliases')} placeholder="e.g. kursi, chair" />
              </Field>
              <Field label="Type" id="i-type">
                <Select value={form.purchaseType} onValueChange={set('purchaseType')}>
                  <SelectTrigger id="i-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{PURCHASE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </Section>

            <Section title="Tax">
              <Field label="HSN / SAC" id="i-hsn" hint="4, 6 or 8 digits — needed for GST filing"><Input id="i-hsn" value={form.hsnCode} onChange={set('hsnCode')} inputMode="numeric" maxLength={8} className="font-mono" /></Field>
              <Field label="GST %" id="i-gst" hint={form.categoryId && categoryById[form.categoryId]?.defaultGstRate != null ? `Category suggests ${categoryById[form.categoryId].defaultGstRate}%` : 'Confirm the rate with your CA'}>
                <Select value={form.gstRate} onValueChange={set('gstRate')}>
                  <SelectTrigger id="i-gst"><SelectValue placeholder="Choose GST" /></SelectTrigger>
                  <SelectContent>{gstRates.list.map((g) => <SelectItem key={g} value={String(g)}>{g}%</SelectItem>)}</SelectContent>
                </Select>
                {gstRates.failed && <LoadFailed onRetry={gstRates.reload}>Could not load the GST rates.</LoadFailed>}
              </Field>
              <Field label="Usual vendor" id="i-vendor" hint="Filled in on new purchase orders">
                <SearchableSelect
                  className="w-full"
                  options={[{ value: '', label: 'None' }, ...vendors.list.map((v) => ({ value: v.id, label: v.name, sublabel: v.code || '' }))]}
                  value={form.preferredVendorId} onChange={set('preferredVendorId')}
                  placeholder="Choose vendor" searchPlaceholder="Search vendor…" />
                {vendors.failed && <LoadFailed onRetry={vendors.reload}>Could not load the vendors.</LoadFailed>}
              </Field>
            </Section>

            <Section title="How it is counted">
              <Field label="Stock unit *" id="i-unit" hint="The unit the store counts it in">
                <Select value={form.stockUnitId} onValueChange={set('stockUnitId')}>
                  <SelectTrigger id="i-unit"><SelectValue placeholder="Choose unit" /></SelectTrigger>
                  <SelectContent>{units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.code})</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Reorder level" id="i-reorder" hint={notStocked ? 'Not stocked' : `Alert when stock falls below this${stockUnit ? ` (${stockUnit.name})` : ''}`}>
                <Input id="i-reorder" value={form.reorderLevel} onChange={set('reorderLevel')} inputMode="decimal" disabled={notStocked} />
              </Field>
              <div className="md:col-span-3 space-y-2">
                <Label>Bought in another unit?</Label>
                <p className="text-xs text-gray-500">E.g. bought as a 100-metre roll, stocked as bed sheets: add Roll = 200 and Metre = 2.</p>
                {form.conversions.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>1</span>
                    <div className="w-40">
                      <Select value={c.unitId} onValueChange={(v) => setConversion(i, { unitId: v })}>
                        <SelectTrigger aria-label="Unit bought in"><SelectValue placeholder="Unit" /></SelectTrigger>
                        <SelectContent>{units.filter((u) => u.id !== form.stockUnitId).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <span>=</span>
                    <Input aria-label="How many stock units" className="w-24" value={c.factor} onChange={(e) => setConversion(i, { factor: e.target.value })} inputMode="decimal" />
                    <span className="text-gray-600">{stockUnit?.name || 'stock units'}</span>
                    <label className="flex items-center gap-1 ml-2 text-xs text-gray-600">
                      <input type="radio" name="purchase-default" checked={!!c.isPurchaseDefault} onChange={() => setConversion(i, { isPurchaseDefault: true })} />
                      buy in this unit by default
                    </label>
                    <Button size="icon" variant="ghost" aria-label="Remove conversion"
                      onClick={() => setField('conversions', form.conversions.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4 text-gray-500" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setField('conversions', [...form.conversions, { unitId: '', factor: '', isPurchaseDefault: false }])}>
                  <Plus className="h-4 w-4 mr-1" />Add a unit
                </Button>
              </div>
            </Section>

            {/* No tracking switches here: whether an item is stocked follows from
                its type (a service never is — the server decides), and batch,
                expiry and asset tracking are kept as they are on the item until
                the receiving and asset screens that use them are built. */}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim() || !form.categoryId || !form.stockUnitId}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editingId ? 'Save changes' : 'Add item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-gray-700 mb-2">{title}</legend>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{children}</div>
    </fieldset>
  )
}

function Field({ label, id, hint, className = '', children }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
