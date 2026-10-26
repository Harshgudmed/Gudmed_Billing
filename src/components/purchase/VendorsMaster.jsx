import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Loader2, Ban, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { useDateFilter } from '@/components/common/DateFilter'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { showApiError } from '@/lib/apiRequest'
import { useMe } from './requestMeta'
import { purchaseApi, PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { usePickList } from './usePickList'
import LoadFailed from './LoadFailed'
import AddressFields from '@/components/common/AddressFields'
import { bankFromIfsc } from '@/lib/ifscBanks'

// Vendors — who the hospital buys from. Set once, then every purchase order,
// receipt and bill picks the vendor from here instead of retyping it.
//
// The server is the judge of every field (GSTIN check character, PAN matching
// the GSTIN, IFSC shape); this form only helps while typing: once a GSTIN has
// its 15 characters it shows the state and PAN it carries, so the person sees
// what will be saved before pressing Save.

const STATUS_OPTIONS = [
  { value: 'all', label: 'All vendors' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Retired' },
]
const VENDOR_TYPES = [{ value: 'goods', label: 'Goods' }, { value: 'services', label: 'Services' }, { value: 'both', label: 'Goods & services' }]
const TDS_SECTIONS = [
  { value: '194C', label: '194C — Contractor' },
  { value: '194J', label: '194J — Professional / technical' },
  { value: '194I', label: '194I — Rent' },
  { value: '194H', label: '194H — Commission' },
  { value: '194Q', label: '194Q — Purchase of goods' },
]
const NONE = '__none'

const EMPTY = {
  name: '', contactPerson: '', phone: '', email: '', vendorType: '',
  gstNumber: '', pan: '', stateCode: '', msmeNumber: '', defaultTdsSection: '',
  houseNumber: '', street: '', locality: '', city: '', district: '', pincode: '',
  bankAccountName: '', bankName: '', bankAccountNumber: '', bankIfsc: '', paymentTermsDays: '',
}

/** What a GSTIN says about itself, for the live hint — or null while incomplete. */
function readGstin(value, statesByCode) {
  const g = String(value || '').replace(/\s+/g, '').toUpperCase()
  if (g.length !== 15) return null
  const state = statesByCode[g.slice(0, 2)]
  return state ? { stateCode: g.slice(0, 2), stateName: state, pan: g.slice(2, 12) } : { unknownState: g.slice(0, 2) }
}

export default function VendorsMaster({ onChanged }) {
  // Store and purchase staff keep vendors; an approver (Finance) only reads them.
  // Adding and changing is for those who order; Finance only reads.
  const { canManageMasters } = useMe()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const dateFilter = useDateFilter('all', { showClear: false })
  const debouncedSearch = useDebounce(search, 300)
  const vendors = useServerPagination(PURCHASE_ENDPOINT, {
    params: {
      resource: 'vendors',
      search: debouncedSearch,
      status: status === 'all' ? '' : status,
      startDate: dateFilter.range.startDate,
      endDate: dateFilter.range.endDate,
    },
  })
  // A vendor added on another screen appears here on its own.
  useLiveData('purchase', vendors.refresh)

  const states = usePickList(purchaseApi.getStates)
  const statesByCode = useMemo(() => Object.fromEntries(states.list.map((s) => [s.code, s.name])), [states.list])

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }))
  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  // The IFSC names the bank; fill it in unless the person typed their own.
  const setIfsc = (e) => {
    const bankIfsc = e.target.value
    setForm((f) => {
      const filled = !f.bankName || f.bankName === bankFromIfsc(f.bankIfsc)
      return { ...f, bankIfsc, ...(filled ? { bankName: bankFromIfsc(bankIfsc) || '' } : {}) }
    })
  }

  const startAdd = () => { setEditingId(null); setForm(EMPTY); setOpen(true) }
  const startEdit = async (row) => {
    try {
      const res = await purchaseApi.getVendor(row.id)
      const v = res.data
      setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, v[k] == null ? '' : String(v[k])])))
      setEditingId(row.id)
      setOpen(true)
    } catch (err) {
      showApiError(err, 'Could not open this vendor')
    }
  }

  const save = async () => {
    const digits = String(form.phone || '').replace(/\D/g, '')
    const phoneValid = digits.length >= 8 && digits.length <= 15
    const requiredOk = !!form.name.trim() && !!form.phone.trim() && phoneValid

    if (!requiredOk) {
      toast.error('Phone number is required and must be 8 to 15 digits.')
      return
    }

    setSaving(true)
    // With a GSTIN the server reads the state and PAN from it. Sending the
    // boxes' older values instead (typed before the GSTIN) would be refused as
    // a mismatch the person cannot see — the boxes already show the GSTIN's.
    const g = readGstin(form.gstNumber, statesByCode)
    const body = g?.stateName ? { ...form, pan: '', stateCode: '' } : form
    try {
      if (editingId) await purchaseApi.updateVendor(editingId, body)
      else await purchaseApi.createVendor(body)
      toast.success(editingId ? 'Vendor updated' : 'Vendor added')
      setOpen(false)
      vendors.refresh()
      onChanged?.()
    } catch (err) {
      // The form stays open with everything typed, so one wrong field is fixed
      // in place rather than the whole vendor re-entered.
      showApiError(err, editingId ? 'Could not update the vendor' : 'Could not add the vendor')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (row) => {
    try {
      await purchaseApi.updateVendor(row.id, { isActive: !row.isActive })
      toast.success(row.isActive ? `${row.name} retired` : `${row.name} restored`)
      vendors.refresh()
      onChanged?.()
    } catch (err) {
      showApiError(err, 'Could not change the vendor')
    }
  }

  const gst = readGstin(form.gstNumber, statesByCode)
  const phoneDigits = String(form.phone || '').replace(/\D/g, '')
  const phoneValid = phoneDigits.length >= 8 && phoneDigits.length <= 15
  const requiredFieldsComplete = !!form.name.trim() && !!form.phone.trim() && phoneValid

  return (
    // The HMS list layout, as on Pharmacy's tabs: the filter row with the Add
    // button at its end, then the table in a card.
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search vendor name, code, GSTIN, phone or city…"
        active={!!search || status !== 'all' || dateFilter.active}
        onClear={() => { setSearch(''); setStatus('all'); dateFilter.reset() }}
        actions={canManageMasters && <Button onClick={startAdd}><Plus className="h-4 w-4 mr-1" />Add Vendor</Button>}
      >
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        {dateFilter.control}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
        <PaginatedTable
          pagination={vendors}
          empty={search || status !== 'all' || dateFilter.active ? 'No vendor matches these filters' : 'No vendors yet — add the first one'}
          columns={[
            { header: 'Code' }, { header: 'Vendor' }, { header: 'GSTIN' }, { header: 'State' },
            { header: 'Phone' }, { header: 'Terms' }, { header: 'Status' }, ...(canManageMasters ? [{ header: 'Actions' }] : []),
          ]}
          renderRow={(v) => (
            <TableRow key={v.id} className={v.isActive ? '' : 'opacity-60'}>
              <TableCell className="font-mono text-sm">{v.code || '—'}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{v.name}</span>
                  {/* An MSME must be paid within 45 days by law — worth seeing at a glance. */}
                  {v.msmeNumber && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0" title={v.msmeNumber}>MSME</Badge>}
                </div>
                {(v.contactPerson || v.city) && <div className="text-xs text-gray-500">{[v.contactPerson, v.city].filter(Boolean).join(' · ')}</div>}
              </TableCell>
              <TableCell className="font-mono text-xs">{v.gstNumber || <span className="text-gray-400 font-sans">Unregistered</span>}</TableCell>
              <TableCell className="text-sm">{statesByCode[v.stateCode] || '—'}</TableCell>
              <TableCell className="text-sm">{v.phone || '—'}</TableCell>
              <TableCell className="text-sm">{v.paymentTermsDays != null ? `${v.paymentTermsDays} days` : '—'}</TableCell>
              <TableCell>{v.isActive ? <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">Active</Badge> : <Badge variant="outline">Retired</Badge>}</TableCell>
              {canManageMasters && (
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" title="Edit" aria-label={`Edit ${v.name}`} onClick={() => startEdit(v)}><Pencil className="h-4 w-4" /></Button>
                    {v.isActive
                      ? <Button size="sm" variant="ghost" className="text-red-500" title="Retire" aria-label={`Retire ${v.name}`} onClick={() => toggleActive(v)}><Ban className="h-4 w-4" /></Button>
                      : <Button size="sm" variant="ghost" className="text-green-600" title="Restore" aria-label={`Restore ${v.name}`} onClick={() => toggleActive(v)}><RotateCcw className="h-4 w-4" /></Button>}
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
            <DialogTitle>{editingId ? `Edit vendor ${form.name ? `— ${form.name}` : ''}` : 'Add vendor'}</DialogTitle>
            <DialogDescription>Only the name is required. Fill the GSTIN and the state and PAN follow from it.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <Section title="Vendor">
              <Field label="Name *" id="v-name" className="md:col-span-2"><Input id="v-name" value={form.name} onChange={set('name')} placeholder="e.g. ABC Medical Supplies" /></Field>
              <Field label="Contact person" id="v-contact"><Input id="v-contact" value={form.contactPerson} onChange={set('contactPerson')} /></Field>
              <Field label="Phone Number *" id="v-phone"><Input id="v-phone" value={form.phone} onChange={set('phone')} placeholder="Mobile or landline" maxLength={15} minLength={10} /></Field>
              <Field label="Email" id="v-email"><Input id="v-email" type="email" value={form.email} onChange={set('email')} /></Field>
              <Field label="Supplies" id="v-type">
                <Select value={form.vendorType || NONE} onValueChange={(v) => set('vendorType')(v === NONE ? '' : v)}>
                  <SelectTrigger id="v-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {VENDOR_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </Section>

            <Section title="Tax">
              <Field label="GSTIN" id="v-gst" className="md:col-span-2"
                hint={gst?.stateName ? `${gst.stateName} · PAN ${gst.pan} — taken from the GSTIN` : gst?.unknownState ? `${gst.unknownState} is not a GST state code` : 'Leave empty for an unregistered vendor'}>
                <Input id="v-gst" value={form.gstNumber} onChange={set('gstNumber')} placeholder="27AAPFU0939F1ZV" className="font-mono uppercase" maxLength={15} />
              </Field>
              <Field label="PAN" id="v-pan" hint={gst?.pan ? 'From the GSTIN' : 'Needed for TDS'}>
                <Input id="v-pan" value={gst?.pan || form.pan} onChange={set('pan')} disabled={!!gst?.pan} className="font-mono uppercase" maxLength={10} />
              </Field>
              <Field label="MSME (Udyam) no." id="v-msme" hint="MSME vendors must be paid within 45 days"><Input id="v-msme" value={form.msmeNumber} onChange={set('msmeNumber')} className="font-mono uppercase" /></Field>
              <Field label="Default TDS section" id="v-tds">
                <Select value={form.defaultTdsSection || NONE} onValueChange={(v) => set('defaultTdsSection')(v === NONE ? '' : v)}>
                  <SelectTrigger id="v-tds"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {TDS_SECTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </Section>

            {/* The same address block as patient registration. The state is the
                GST state: with a GSTIN it is read from it and locked. */}
            <AddressFields
              values={{ ...form, stateCode: gst?.stateCode || form.stateCode }}
              setField={setField}
              required={false}
              stateKey="stateCode"
              stateOptions={states.list.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))}
              stateDisabled={!!gst?.stateName}
              stateHint={gst?.stateName ? 'From the GSTIN' : 'Decides CGST + SGST or IGST'}
            />
            {states.failed && <LoadFailed onRetry={states.reload}>Could not load the list of states — the state and the GSTIN check need it.</LoadFailed>}

            <Section title="Payment">
              <Field label="Account name" id="v-acname"><Input id="v-acname" value={form.bankAccountName} onChange={set('bankAccountName')} /></Field>
              <Field label="Account number" id="v-acno" hint={form.bankAccountNumber.includes('•') ? 'Hidden for your role — left unchanged' : undefined}>
                <Input id="v-acno" value={form.bankAccountNumber} onChange={set('bankAccountNumber')} inputMode="numeric" className="font-mono" />
              </Field>
              <Field label="IFSC" id="v-ifsc"><Input id="v-ifsc" value={form.bankIfsc} onChange={setIfsc} placeholder="SBIN0001234" className="font-mono uppercase" maxLength={11} /></Field>
              <Field label="Bank name" id="v-bank" hint={form.bankName && form.bankName === bankFromIfsc(form.bankIfsc) ? 'From the IFSC' : undefined}>
                <Input id="v-bank" value={form.bankName} onChange={set('bankName')} placeholder="Fills in from the IFSC" />
              </Field>
              <Field label="Payment terms (days)" id="v-terms" hint="A bill falls due this many days after its date">
                <Input id="v-terms" value={form.paymentTermsDays} onChange={set('paymentTermsDays')} inputMode="numeric" placeholder="e.g. 30" />
              </Field>
            </Section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !requiredFieldsComplete}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editingId ? 'Save changes' : 'Add vendor'}
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
