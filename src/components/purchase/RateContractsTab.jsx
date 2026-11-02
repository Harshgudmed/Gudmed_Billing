import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { TableCell, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { Plus, Pencil, Loader2, Ban, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { useDebounce } from '@/lib/useDebounce'
import { useServerPagination } from '@/lib/useServerPagination'
import { purchaseApi, PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, localYmd } from '@/lib/format'
import { useMe } from './requestMeta'

// Rate contracts — a negotiated vendor+item rate, good for a date range.
// While one is active, OrderForm offers it as soon as that item and vendor
// are both on a line, instead of a fresh RFQ (sir: "Rate Contract auto-trigger").

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired / ended' },
]

const EMPTY = { vendorId: '', vendorName: '', itemId: '', itemName: '', rate: '', gstRate: '', validFrom: localYmd(), validTo: '', notes: '' }

function isLive(rc) {
  const today = localYmd()
  return rc.isActive && rc.validFrom.slice(0, 10) <= today && rc.validTo.slice(0, 10) >= today
}

export default function RateContractsTab() {
  const { canManageMasters } = useMe()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const debouncedSearch = useDebounce(search, 300)
  const list = useServerPagination(PURCHASE_ENDPOINT, {
    params: { resource: 'rate-contracts', search: debouncedSearch, status: status === 'all' ? '' : status },
  })

  const [vendors, setVendors] = useState([])
  useEffect(() => { purchaseApi.getVendors({ status: 'active' }).then((r) => setVendors(r?.data ?? [])).catch(() => {}) }, [])
  const vendorOptions = vendors.map((v) => ({ value: v.id, label: v.name }))

  const [itemOptions, setItemOptions] = useState([])
  const [itemSearching, setItemSearching] = useState(false)
  const searchItems = useCallback(async (q) => {
    setItemSearching(true)
    try {
      const r = await purchaseApi.getItems({ search: q, status: 'active', limit: 20 })
      setItemOptions((r?.data ?? []).map((it) => ({ value: it.id, label: it.name, sublabel: it.code, item: it })))
    } catch { /* the picker just shows nothing found */ }
    finally { setItemSearching(false) }
  }, [])

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const startAdd = () => { setEditingId(null); setForm(EMPTY); setItemOptions([]); setOpen(true) }
  const startEdit = (rc) => {
    setForm({
      vendorId: rc.vendorId, vendorName: rc.vendorName, itemId: rc.itemId, itemName: rc.itemName,
      rate: String(rc.rate), gstRate: rc.gstRate != null ? String(rc.gstRate) : '',
      validFrom: rc.validFrom.slice(0, 10), validTo: rc.validTo.slice(0, 10), notes: rc.notes || '',
    })
    setItemOptions([{ value: rc.itemId, label: rc.itemName, sublabel: rc.itemCode }])
    setEditingId(rc.id)
    setOpen(true)
  }

  const ready = form.vendorId && form.itemId && Number(form.rate) > 0 && form.validFrom && form.validTo && form.validTo >= form.validFrom

  const save = async () => {
    if (!ready) { toast.error('Fill the vendor, item, rate and a valid date range'); return }
    setSaving(true)
    try {
      const body = {
        vendorId: form.vendorId, itemId: form.itemId, rate: Number(form.rate),
        gstRate: form.gstRate === '' ? undefined : Number(form.gstRate),
        validFrom: form.validFrom, validTo: form.validTo, notes: form.notes || null,
      }
      if (editingId) await purchaseApi.updateRateContract(editingId, body)
      else await purchaseApi.createRateContract(body)
      toast.success(editingId ? 'Rate contract updated' : 'Rate contract added')
      setOpen(false)
      list.refresh()
    } catch (err) {
      showApiError(err, editingId ? 'Could not update the rate contract' : 'Could not add the rate contract')
    } finally {
      setSaving(false)
    }
  }

  const endEarly = async (rc) => {
    if (!window.confirm(`End ${rc.number} now? Orders will no longer be offered this rate.`)) return
    try {
      await purchaseApi.updateRateContract(rc.id, { isActive: false })
      toast.success(`${rc.number} ended`)
      list.refresh()
    } catch (err) { showApiError(err, 'Could not end the rate contract') }
  }

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search by number, vendor or item…"
        active={!!search || status !== 'all'}
        onClear={() => { setSearch(''); setStatus('all') }}
        actions={canManageMasters && <Button onClick={startAdd}><Plus className="h-4 w-4 mr-1" />New Rate Contract</Button>}
      >
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <PaginatedTable
            pagination={list}
            empty={search || status !== 'all' ? 'No rate contract matches these filters' : 'No rate contracts yet — add one to skip the RFQ for an item you already have a price on'}
            columns={[
              { header: 'Number' }, { header: 'Item' }, { header: 'Vendor' }, { header: 'Rate', className: 'text-right' },
              { header: 'Valid' }, { header: 'Status' }, ...(canManageMasters ? [{ header: 'Actions' }] : []),
            ]}
            renderRow={(rc) => (
              <TableRow key={rc.id} className={isLive(rc) ? '' : 'opacity-60'}>
                <TableCell className="font-mono text-sm">{rc.number}</TableCell>
                <TableCell><div className="font-medium">{rc.itemName}</div><div className="text-xs text-gray-500">{rc.itemCode}</div></TableCell>
                <TableCell>{rc.vendorName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(rc.rate)}{rc.gstRate != null && <div className="text-xs text-gray-500">+{rc.gstRate}% GST</div>}</TableCell>
                <TableCell className="text-sm">{new Date(rc.validFrom).toLocaleDateString('en-IN')} – {new Date(rc.validTo).toLocaleDateString('en-IN')}</TableCell>
                <TableCell>
                  {isLive(rc)
                    ? <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700"><Tag className="h-3 w-3 mr-1" />Active</Badge>
                    : <Badge variant="outline">{rc.isActive ? 'Expired' : 'Ended'}</Badge>}
                </TableCell>
                {canManageMasters && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" title="Edit" aria-label={`Edit ${rc.number}`} onClick={() => startEdit(rc)}><Pencil className="h-4 w-4" /></Button>
                      {rc.isActive && <Button size="sm" variant="ghost" className="text-red-500" title="End early" aria-label={`End ${rc.number}`} onClick={() => endEarly(rc)}><Ban className="h-4 w-4" /></Button>}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            )}
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? `Edit rate contract` : 'New rate contract'}</DialogTitle>
            <DialogDescription>A price held with a vendor for an item, good for a date range. Orders for that item from that vendor are offered this rate while it is active.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Vendor *</Label>
              <SearchableSelect options={vendorOptions} value={form.vendorId} selectedLabel={form.vendorName}
                onChange={(v) => setForm((f) => ({ ...f, vendorId: v }))} placeholder="Choose the vendor" disabled={!!editingId} />
            </div>
            <div className="space-y-1">
              <Label>Item *</Label>
              <SearchableSelect options={itemOptions} value={form.itemId} selectedLabel={form.itemName}
                onSearch={searchItems} minSearchLength={0} loading={itemSearching}
                onChange={(v) => { const it = itemOptions.find((o) => o.value === v); setForm((f) => ({ ...f, itemId: v, itemName: it?.label || f.itemName })) }}
                placeholder="Search an item…" disabled={!!editingId} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rc-rate">Rate ₹, per unit *</Label>
                <Input id="rc-rate" inputMode="decimal" value={form.rate} placeholder="e.g. 180"
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rc-gst">GST % <span className="text-xs font-normal text-gray-400">(optional — else the item's own)</span></Label>
                <Input id="rc-gst" inputMode="decimal" value={form.gstRate} placeholder="e.g. 12"
                  onChange={(e) => setForm((f) => ({ ...f, gstRate: e.target.value.replace(/[^\d.]/g, '') }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rc-from">Valid from *</Label>
                <Input id="rc-from" type="date" value={form.validFrom} onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rc-to">Valid to *</Label>
                <Input id="rc-to" type="date" min={form.validFrom} value={form.validTo} onChange={(e) => setForm((f) => ({ ...f, validTo: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-notes">Notes <span className="text-xs font-normal text-gray-400">(optional)</span></Label>
              <Textarea id="rc-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g. Annual rate contract signed 01-Apr-2026" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !ready}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? 'Save changes' : 'Add rate contract'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
