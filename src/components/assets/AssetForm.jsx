import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { localYmd } from '@/lib/format'

const CATEGORIES = ['Medical Equipment', 'Furniture', 'IT Equipment', 'Vehicle', 'Other']
const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'UNDER_REPAIR', label: 'Under Repair' },
  { value: 'RETIRED', label: 'Retired' },
  { value: 'DISPOSED', label: 'Disposed' },
]

const EMPTY = {
  name: '', category: '', serialNumber: '', departmentId: '', location: '', status: 'ACTIVE',
  vendorId: '', purchaseDate: '', purchaseCost: '',
  warrantyExpiry: '', amcVendorId: '', amcStartDate: '', amcExpiry: '', amcCost: '',
  usefulLifeYears: '', residualValue: '', maintenanceIntervalDays: '', nextMaintenanceDue: '',
  notes: '',
}

// toYmd(asset.purchaseDate) etc. — an edit opens with the API's ISO strings,
// a date input needs "YYYY-MM-DD".
const toYmd = (v) => (v ? localYmd(new Date(v)) : '')

export default function AssetForm({ open, onOpenChange, asset, onSaved }) {
  const editing = !!asset
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [departments, setDepartments] = useState([])
  const [vendors, setVendors] = useState([])

  useEffect(() => {
    if (!open) return
    setForm(asset ? {
      name: asset.name || '', category: asset.category || '', serialNumber: asset.serialNumber || '',
      departmentId: asset.departmentId || '', location: asset.location || '', status: asset.status || 'ACTIVE',
      vendorId: asset.vendorId || '', purchaseDate: toYmd(asset.purchaseDate), purchaseCost: asset.purchaseCost ?? '',
      warrantyExpiry: toYmd(asset.warrantyExpiry), amcVendorId: asset.amcVendorId || '',
      amcStartDate: toYmd(asset.amcStartDate), amcExpiry: toYmd(asset.amcExpiry), amcCost: asset.amcCost ?? '',
      usefulLifeYears: asset.usefulLifeYears ?? '', residualValue: asset.residualValue ?? '',
      maintenanceIntervalDays: asset.maintenanceIntervalDays ?? '', nextMaintenanceDue: toYmd(asset.nextMaintenanceDue),
      notes: asset.notes || '',
    } : EMPTY)
  }, [open, asset])

  // Small, bounded lists (a hospital's own departments/vendors) — loaded once
  // per open rather than through the Purchase module's server-search picker,
  // which is built for a catalogue of thousands.
  useEffect(() => {
    if (!open) return
    client.get('/settings?resource=departments').then((res) => setDepartments(res.data || [])).catch(() => {})
    purchaseApi.getVendors({ status: 'active', limit: 500 }).then((res) => setVendors(res.data || [])).catch(() => {})
  }, [open])

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }))
  const setInput = (field) => (e) => set(field)(e.target.value)

  const deptOptions = departments.map((d) => ({ value: d.id, label: d.name }))
  const vendorOptions = vendors.map((v) => ({ value: v.id, label: v.name }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Asset name is required')
    if (!form.category) return toast.error('Category is required')
    setSaving(true)
    try {
      const body = { ...form }
      for (const k of ['departmentId', 'vendorId', 'amcVendorId']) if (!body[k]) body[k] = null
      const res = editing
        ? await client.patch(`/assets/${asset.id}`, body)
        : await client.post('/assets', body)
      toast.success(editing ? 'Asset updated' : `Asset ${res.data.assetTag} added`)
      onOpenChange(false)
      onSaved?.(res.data)
    } catch (err) {
      showApiError(err, editing ? 'Could not update the asset' : 'Could not add the asset')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${asset.assetTag}` : 'Add asset'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-3">
            <div className="text-sm font-semibold text-gray-700">Basic details</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-3"><Label>Asset Name *</Label><Input className="mt-1" value={form.name} onChange={setInput('name')} placeholder="e.g. Patient Monitor — ICU 3" /></div>
              <div>
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={set('category')}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Serial Number</Label><Input className="mt-1" value={form.serialNumber} onChange={setInput('serialNumber')} /></div>
              <div>
                <Label>Department</Label>
                <SearchableSelect className="mt-1 w-full" value={form.departmentId} onChange={set('departmentId')}
                  options={deptOptions} placeholder="Select department" />
              </div>
              <div><Label>Location</Label><Input className="mt-1" value={form.location} onChange={setInput('location')} placeholder="e.g. ICU Room 3" /></div>
              {editing && (
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={set('status')}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="text-sm font-semibold text-gray-700">Purchase</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Vendor</Label>
                <SearchableSelect className="mt-1 w-full" value={form.vendorId} onChange={set('vendorId')}
                  options={vendorOptions} placeholder="Select vendor" />
              </div>
              <div><Label>Purchase Date</Label><Input type="date" className="mt-1" value={form.purchaseDate} onChange={setInput('purchaseDate')} /></div>
              <div><Label>Purchase Cost (₹)</Label><Input type="number" step="0.01" className="mt-1" value={form.purchaseCost} onChange={setInput('purchaseCost')} /></div>
              <div><Label>Warranty Expiry</Label><Input type="date" className="mt-1" value={form.warrantyExpiry} onChange={setInput('warrantyExpiry')} /></div>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="text-sm font-semibold text-gray-700">AMC (Annual Maintenance Contract)</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>AMC Vendor</Label>
                <SearchableSelect className="mt-1 w-full" value={form.amcVendorId} onChange={set('amcVendorId')}
                  options={vendorOptions} placeholder="Select vendor" />
              </div>
              <div><Label>AMC Cost (₹ / year)</Label><Input type="number" step="0.01" className="mt-1" value={form.amcCost} onChange={setInput('amcCost')} /></div>
              <div><Label>AMC Start</Label><Input type="date" className="mt-1" value={form.amcStartDate} onChange={setInput('amcStartDate')} /></div>
              <div><Label>AMC Expiry</Label><Input type="date" className="mt-1" value={form.amcExpiry} onChange={setInput('amcExpiry')} /></div>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="text-sm font-semibold text-gray-700">Maintenance schedule &amp; depreciation</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><Label>Maintenance Interval (days)</Label><Input type="number" className="mt-1" value={form.maintenanceIntervalDays} onChange={setInput('maintenanceIntervalDays')} placeholder="e.g. 90" /></div>
              <div><Label>Next Maintenance Due</Label><Input type="date" className="mt-1" value={form.nextMaintenanceDue} onChange={setInput('nextMaintenanceDue')} /></div>
              <div><Label>Useful Life (years)</Label><Input type="number" className="mt-1" value={form.usefulLifeYears} onChange={setInput('usefulLifeYears')} /></div>
              <div><Label>Residual Value (₹)</Label><Input type="number" step="0.01" className="mt-1" value={form.residualValue} onChange={setInput('residualValue')} /></div>
            </div>
          </div>

          <div><Label>Notes</Label><Textarea className="mt-1" rows={2} value={form.notes} onChange={setInput('notes')} /></div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? 'Save changes' : 'Add asset'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
