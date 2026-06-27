import { useState, useEffect, useCallback } from 'react'
import { getOrgSettings } from '@/lib/orgSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  UserCog, IndianRupee, CheckCircle2, BarChart3,
  Search, Plus, Edit2, Trash2, CheckSquare, RefreshCw,
  Users, Clock, Wallet, Printer, FileDown, CheckCheck, ChevronLeft, ChevronRight,
} from 'lucide-react'
import client from '@/api/client'
import DoctorTiming from './DoctorTiming'

function fmt(n) {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function periodLabel(p) {
  if (!p) return '—'
  const s = String(p)
  // New format: a plain number of days. Old data may still be "YYYY-MM".
  if (/^\d+$/.test(s)) return `${s} day${s === '1' ? '' : 's'}`
  const [y, m] = s.split('-')
  if (!m) return s
  return new Date(Number(y), Number(m) - 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

function printViaIframe(html) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;'
  document.body.appendChild(iframe)
  iframe.contentDocument.open()
  iframe.contentDocument.write(html)
  iframe.contentDocument.close()
  iframe.contentWindow.focus()
  setTimeout(() => {
    iframe.contentWindow.print()
    setTimeout(() => document.body.removeChild(iframe), 1000)
  }, 300)
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`p-3 rounded-lg ${color}`}><Icon className="h-5 w-5 text-white" /></div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// Unified per-doctor setup: base fee + follow-up day-ranges + commission, all in one place.
function DoctorsTab() {
  const [doctors, setDoctors] = useState([])
  const [slabCounts, setSlabCounts] = useState({})   // doctorId -> number of follow-up ranges
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [setupPage, setSetupPage] = useState(1)
  const ITEMS_PER_PAGE = 10

  // Configure dialog state
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfgDoctor, setCfgDoctor] = useState(null)
  const [baseFee, setBaseFee] = useState('')
  const [comm, setComm] = useState({ commissionType: 'percentage', commissionRate: '10', isActive: true, notes: '' })
  const [savingCfg, setSavingCfg] = useState(false)
  // Follow-up ranges (editable rows) inside the dialog
  const [rows, setRows] = useState([])
  const [slabsLoading, setSlabsLoading] = useState(false)
  const [savingKey, setSavingKey] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [dRes, sRes] = await Promise.all([
      client.get('/doctor-accountability?resource=doctors'),
      client.get('/fee-slabs'),
    ])
    if (dRes.success) setDoctors(dRes.data)
    if (sRes.success) {
      const counts = {}
      sRes.data.forEach(s => { counts[s.doctorId] = (counts[s.doctorId] || 0) + 1 })
      setSlabCounts(counts)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSetupPage(1) }, [search])

  async function openConfigure(doc) {
    setCfgDoctor(doc)
    setBaseFee(doc.consultationFee != null ? String(doc.consultationFee) : '')
    setComm(doc.commissionConfig ? {
      commissionType: doc.commissionConfig.commissionType,
      commissionRate: String(doc.commissionConfig.commissionRate),
      isActive: doc.commissionConfig.isActive,
      notes: doc.commissionConfig.notes || '',
    } : { commissionType: 'percentage', commissionRate: '10', isActive: true, notes: '' })
    setRows([])
    setCfgOpen(true)
    setSlabsLoading(true)
    const res = await client.get(`/fee-slabs?doctorId=${doc.id}`)
    if (res.success) {
      setRows(res.data.sort((a, b) => a.fromDays - b.fromDays).map(s => ({
        key: s.id, id: s.id, fromDays: String(s.fromDays), toDays: String(s.toDays),
        feeAmount: String(s.feeAmount), isActive: s.isActive, notes: s.notes || '',
      })))
    }
    setSlabsLoading(false)
  }

  // Save base fee + commission together (one API call)
  async function saveDoctorSetup() {
    if (!cfgDoctor) return
    const fee = baseFee === '' ? null : parseFloat(baseFee)
    if (baseFee !== '' && (isNaN(fee) || fee < 0)) { toast.error('Enter a valid base fee'); return }
    const rate = parseFloat(comm.commissionRate)
    if (isNaN(rate) || rate < 0) { toast.error('Enter a valid commission rate'); return }
    setSavingCfg(true)
    const res = await client.post('/doctor-accountability?resource=config', {
      doctorId: cfgDoctor.id,
      consultationFee: fee,
      commissionType: comm.commissionType,
      commissionRate: rate,
      isActive: comm.isActive,
      notes: comm.notes || null,
    })
    if (res.success) { toast.success('Doctor setup saved'); load() }
    else toast.error(res.error || 'Failed to save')
    setSavingCfg(false)
  }

  // ── Follow-up range row handlers ──────────────────────────────────────────
  function updateRow(key, patch) { setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r))) }
  function addRange() {
    setRows(prev => {
      const last = prev[prev.length - 1]
      const from = last && last.toDays !== '' ? last.toDays : ''
      return [...prev, { key: `new-${Date.now()}`, id: null, fromDays: from, toDays: '', feeAmount: '', isActive: true, notes: '' }]
    })
  }
  function validateRow(row) {
    const from = parseInt(row.fromDays), to = parseInt(row.toDays), fee = parseFloat(row.feeAmount)
    if (isNaN(from) || isNaN(to) || isNaN(fee)) return 'From Day, To Day and Charge are required'
    if (from < 0 || to < 0) return 'Days cannot be negative'
    if (from >= to) return 'From Day must be less than To Day'
    if (fee < 0) return 'Charge cannot be negative'
    const overlap = rows.find(r => r.key !== row.key && r.fromDays !== '' && r.toDays !== '' &&
      (from < parseInt(r.toDays)) && (to > parseInt(r.fromDays)))
    if (overlap) return `Overlaps with range ${overlap.fromDays}-${overlap.toDays} days`
    return null
  }
  async function reloadSlabs(doctorId) {
    const res = await client.get(`/fee-slabs?doctorId=${doctorId}`)
    if (res.success) {
      setRows(res.data.sort((a, b) => a.fromDays - b.fromDays).map(s => ({
        key: s.id, id: s.id, fromDays: String(s.fromDays), toDays: String(s.toDays),
        feeAmount: String(s.feeAmount), isActive: s.isActive, notes: s.notes || '',
      })))
      setSlabCounts(prev => ({ ...prev, [doctorId]: res.data.length }))
    }
  }
  async function saveRow(row) {
    const err = validateRow(row)
    if (err) { toast.error(err); return }
    setSavingKey(row.key)
    const payload = { fromDays: parseInt(row.fromDays), toDays: parseInt(row.toDays), feeAmount: parseFloat(row.feeAmount), isActive: row.isActive, notes: row.notes || null }
    try {
      const res = row.id
        ? await client.patch(`/fee-slabs/${row.id}`, payload)
        : await client.post('/fee-slabs', { doctorId: cfgDoctor.id, ...payload })
      if (res.success) { toast.success(row.id ? 'Range updated' : 'Range added'); await reloadSlabs(cfgDoctor.id) }
      else toast.error(res.error || 'Failed to save range')
    } catch { toast.error('Error saving range') }
    setSavingKey(null)
  }
  async function deleteRow(row) {
    if (!row.id) { setRows(prev => prev.filter(r => r.key !== row.key)); return }
    if (!confirm('Delete this day-range?')) return
    try {
      const res = await client.delete(`/fee-slabs/${row.id}`)
      if (res.success) { toast.success('Range deleted'); await reloadSlabs(cfgDoctor.id) }
      else toast.error(res.error || 'Failed to delete')
    } catch { toast.error('Error deleting range') }
  }

  const filtered = doctors.filter(d =>
    d.fullName.toLowerCase().includes(search.toLowerCase()) ||
    (d.specialization || '').toLowerCase().includes(search.toLowerCase())
  )
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated = filtered.slice((setupPage - 1) * ITEMS_PER_PAGE, setupPage * ITEMS_PER_PAGE)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search doctor by name..." className="pl-9" />
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading doctors...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No doctors found. Click "Add Doctor" above to create one.</div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doctor</TableHead>
                <TableHead>Specialization</TableHead>
                <TableHead>Base Fee</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Setup</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map(doc => {
                const cfg = doc.commissionConfig
                const ranges = slabCounts[doc.id] || 0
                const ready = cfg && doc.consultationFee != null
                return (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">{doc.fullName}</TableCell>
                    <TableCell className="text-gray-500">{doc.specialization || '—'}</TableCell>
                    <TableCell>
                      {doc.consultationFee != null
                        ? <span className="font-medium text-gray-800">{fmt(doc.consultationFee)}</span>
                        : <span className="text-gray-400 italic">Not set</span>}
                    </TableCell>
                    <TableCell>
                      {ranges > 0
                        ? <span className="text-gray-700">{ranges} range{ranges > 1 ? 's' : ''}</span>
                        : <span className="text-gray-400 italic">None</span>}
                    </TableCell>
                    <TableCell>
                      {cfg
                        ? (cfg.commissionType === 'percentage' ? `${cfg.commissionRate}%` : fmt(cfg.commissionRate))
                        : <span className="text-gray-400 italic">Not set</span>}
                    </TableCell>
                    <TableCell>
                      {ready
                        ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-0">Active</Badge>
                        : <Badge variant="outline" className="text-amber-600 border-amber-300">Setup needed</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openConfigure(doc)}>
                        <Edit2 className="h-3.5 w-3.5 mr-1" />Configure
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {filtered.length > ITEMS_PER_PAGE && (
            <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
              <Button variant="outline" size="sm" onClick={() => setSetupPage(p => Math.max(1, p - 1))} disabled={setupPage === 1}>
                <ChevronLeft className="h-4 w-4 mr-1" />Previous
              </Button>
              <span className="text-sm text-gray-600">Page {setupPage} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setSetupPage(p => Math.min(totalPages, p + 1))} disabled={setupPage === totalPages}>
                Next<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Configure dialog: base fee + follow-up ranges + commission in one place */}
      <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Configure — {cfgDoctor?.fullName}</DialogTitle></DialogHeader>
          <div className="space-y-6 pt-2">
            {/* ① New Patient base fee */}
            <section>
              <h4 className="font-semibold text-sm text-gray-800 mb-2">① New Patient Fee</h4>
              <div className="flex items-end gap-3">
                <div className="w-44">
                  <Label className="text-xs">Base charge (₹)</Label>
                  <Input type="number" min={0} step={50} className="mt-1" value={baseFee}
                    onChange={e => setBaseFee(e.target.value)} placeholder="e.g. 1000" />
                </div>
                <p className="text-xs text-gray-400 pb-2">Charged on the first visit and after the 30-day reset.</p>
              </div>
            </section>

            {/* ② Follow-up day-ranges */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm text-gray-800">② Follow-up Charges (by days)</h4>
                <Button size="sm" variant="secondary" onClick={addRange}><Plus className="h-4 w-4 mr-1" />Add Range</Button>
              </div>
              {slabsLoading ? (
                <div className="text-center py-6 text-gray-400 text-sm">Loading ranges...</div>
              ) : (
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">From</TableHead>
                        <TableHead className="w-20">To</TableHead>
                        <TableHead className="w-24">Charge ₹</TableHead>
                        <TableHead className="w-16">Active</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="text-right w-28">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center text-gray-400 py-5">No ranges yet. Click "Add Range".</TableCell></TableRow>
                      ) : rows.map(row => (
                        <TableRow key={row.key} className={row.id ? '' : 'bg-amber-50'}>
                          <TableCell><Input type="number" min={0} className="h-8" value={row.fromDays} onChange={e => updateRow(row.key, { fromDays: e.target.value })} placeholder="0" /></TableCell>
                          <TableCell><Input type="number" min={0} className="h-8" value={row.toDays} onChange={e => updateRow(row.key, { toDays: e.target.value })} placeholder="3" /></TableCell>
                          <TableCell><Input type="number" min={0} step={50} className="h-8" value={row.feeAmount} onChange={e => updateRow(row.key, { feeAmount: e.target.value })} placeholder="0=free" /></TableCell>
                          <TableCell><input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={row.isActive} onChange={e => updateRow(row.key, { isActive: e.target.checked })} /></TableCell>
                          <TableCell><Input className="h-8" value={row.notes} onChange={e => updateRow(row.key, { notes: e.target.value })} placeholder="optional" /></TableCell>
                          <TableCell className="text-right space-x-1 whitespace-nowrap">
                            <Button size="sm" className="h-7" onClick={() => saveRow(row)} disabled={savingKey === row.key}>{savingKey === row.key ? '...' : (row.id ? 'Save' : 'Add')}</Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-red-600" onClick={() => deleteRow(row)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell className="text-gray-400 text-sm font-medium">30+</TableCell>
                        <TableCell className="text-gray-400 text-sm">—</TableCell>
                        <TableCell className="text-gray-500 text-sm">{baseFee ? `₹${baseFee}` : 'base'}</TableCell>
                        <TableCell colSpan={3} className="text-gray-400 text-sm italic">After 30 days → New Patient (base fee)</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {/* ③ Commission */}
            <section>
              <h4 className="font-semibold text-sm text-gray-800 mb-2">③ Commission</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Type</Label>
                  <Select value={comm.commissionType} onValueChange={v => setComm(c => ({ ...c, commissionType: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="fixed">Fixed Amount (₹)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Rate {comm.commissionType === 'percentage' ? '(%)' : '(₹)'}</Label>
                  <Input type="number" min={0} step={comm.commissionType === 'percentage' ? 0.5 : 10} className="mt-1" value={comm.commissionRate} onChange={e => setComm(c => ({ ...c, commissionRate: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={comm.isActive ? 'active' : 'inactive'} onValueChange={v => setComm(c => ({ ...c, isActive: v === 'active' }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Input className="mt-1" value={comm.notes} onChange={e => setComm(c => ({ ...c, notes: e.target.value }))} placeholder="optional" />
                </div>
              </div>
            </section>

            <div className="flex gap-2 pt-1 justify-end border-t pt-4">
              <Button variant="outline" onClick={() => setCfgOpen(false)}>Close</Button>
              <Button onClick={saveDoctorSetup} disabled={savingCfg}>{savingCfg ? 'Saving...' : 'Save Doctor Setup'}</Button>
            </div>
            <p className="text-xs text-gray-400 -mt-2">Tip: "Save Doctor Setup" saves the base fee &amp; commission. Follow-up ranges save individually with their own Save button.</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CommissionsTab({ openAddSignal }) {
  const [commissions, setCommissions] = useState([])
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterDoctor, setFilterDoctor] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDate, setFilterDate] = useState('all')
  // Bulk settle (merged from the old Settlement tab)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkSettling, setBulkSettling] = useState(false)

  // Add dialog
  const [addDialog, setAddDialog] = useState(false)
  const [form, setForm] = useState({ doctorId: '', invoiceId: '', invoiceAmount: '' })
  const [saving, setSaving] = useState(false)

  // Edit dialog
  const [editDialog, setEditDialog] = useState(false)
  const [editEntry, setEditEntry] = useState(null)
  const [editForm, setEditForm] = useState({ invoiceAmount: '', invoiceId: '' })
  const [editSaving, setEditSaving] = useState(false)

  // Quick-settle dialog
  const [settleDialog, setSettleDialog] = useState(false)
  const [settleEntry, setSettleEntry] = useState(null)
  const [settleRef, setSettleRef] = useState('')
  const [settleNote, setSettleNote] = useState('')
  const [settling, setSettling] = useState(false)

  const [commissionsPage, setCommissionsPage] = useState(1)
  const [commissionsMeta, setCommissionsMeta] = useState({ total: 0, limit: 10, offset: 0, page: 1, totalPages: 1, hasMore: false })

  const ITEMS_PER_PAGE = 10

  const load = useCallback(async () => {
    setLoading(true)
    const offset = (commissionsPage - 1) * ITEMS_PER_PAGE
    const params = new URLSearchParams({ resource: 'commissions', limit: String(ITEMS_PER_PAGE), offset: String(offset) })
    if (filterDoctor !== 'all') params.set('doctorId', filterDoctor)
    if (filterStatus !== 'all') params.set('status', filterStatus)
    try {
      const [cRes, dRes] = await Promise.all([
        client.get(`/doctor-accountability?${params}`),
        client.get('/doctor-accountability?resource=doctors'),
      ])
      if (cRes.success) {
        setCommissions(cRes.data)
        if (cRes.meta) setCommissionsMeta(cRes.meta)
      }
      if (dRes.success) setDoctors(dRes.data)
    } catch (err) {
      toast.error(err.message || 'Failed to load commissions')
    } finally {
      setLoading(false)
    }
  }, [filterDoctor, filterStatus, commissionsPage])

  useEffect(() => { load() }, [load])

  // Open the Add Commission dialog when triggered from the module header button
  useEffect(() => {
    if (openAddSignal) setAddDialog(true)
  }, [openAddSignal])

  useEffect(() => {
    setCommissionsPage(1)
  }, [filterDoctor, filterStatus, filterDate])

  // ── Client-side date filter ────────────────────────────────────────────────
  const now = new Date()
  const displayed = commissions.filter(c => {
    if (filterDate === 'all') return true
    const d = new Date(c.createdAt)
    if (filterDate === 'today') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    }
    if (filterDate === 'week') {
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
      return d >= weekStart
    }
    if (filterDate === 'month') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }
    return true
  })

  // ── Add commission ─────────────────────────────────────────────────────────
  async function addCommission() {
    const doctor = doctors.find(d => d.id === form.doctorId)
    const config = doctor?.commissionConfig
    if (!config) { toast.error('Doctor has no commission config set up'); return }
    const invoiceAmt = parseFloat(form.invoiceAmount)
    if (!form.doctorId || isNaN(invoiceAmt)) { toast.error('Fill in doctor and invoice amount'); return }
    const commAmt = config.commissionType === 'percentage'
      ? (invoiceAmt * config.commissionRate) / 100
      : config.commissionRate
    setSaving(true)
    const res = await client.post('/doctor-accountability?resource=commission', {
      doctorId: form.doctorId, invoiceId: form.invoiceId || null,
      invoiceAmount: invoiceAmt, commissionRate: config.commissionRate,
      commissionType: config.commissionType, commissionAmount: commAmt,
    })
    if (res.success) {
      toast.success('Commission entry added')
      setAddDialog(false)
      setForm({ doctorId: '', invoiceId: '', invoiceAmount: '' })
      load()
    } else toast.error(res.error || 'Failed to add')
    setSaving(false)
  }

  // ── Edit commission ────────────────────────────────────────────────────────
  function openEdit(c) {
    setEditEntry(c)
    setEditForm({
      invoiceAmount: String(c.invoiceAmount),
      invoiceId: c.invoiceId || '',
    })
    setEditDialog(true)
  }

  async function saveEdit() {
    if (!editEntry) return
    const invoiceAmt = parseFloat(editForm.invoiceAmount)
    if (isNaN(invoiceAmt) || invoiceAmt <= 0) { toast.error('Enter a valid invoice amount'); return }
    const commAmt = editEntry.commissionType === 'percentage'
      ? (invoiceAmt * editEntry.commissionRate) / 100
      : editEntry.commissionRate
    setEditSaving(true)
    const res = await client.patch(`/doctor-accountability?resource=commission&id=${editEntry.id}`, {
      invoiceAmount: invoiceAmt,
      commissionAmount: commAmt,
      invoiceId: editForm.invoiceId || null,
    })
    if (res.success) { toast.success('Commission updated'); setEditDialog(false); load() }
    else toast.error(res.error || 'Failed to update')
    setEditSaving(false)
  }

  // ── Quick settle single commission ─────────────────────────────────────────
  function openSettle(c) {
    setSettleEntry(c)
    setSettleRef('')
    setSettleNote('')
    setSettleDialog(true)
  }

  async function quickSettle() {
    if (!settleEntry) return
    setSettling(true)
    const res = await client.patch('/doctor-accountability?resource=settle', {
      commissionIds: [settleEntry.id],
      settlementNote: settleNote,
      settlementRef: settleRef,
    })
    if (res.success) {
      toast.success('Commission settled')
      setSettleDialog(false)
      load()
    } else toast.error(res.error || 'Failed to settle')
    setSettling(false)
  }

  // ── Bulk settle selected pending commissions ───────────────────────────────
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  async function bulkSettle() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setBulkSettling(true)
    const res = await client.patch('/doctor-accountability?resource=settle', { commissionIds: ids })
    if (res.success) {
      toast.success(`${ids.length} commission(s) settled`)
      setSelectedIds(new Set())
      load()
    } else toast.error(res.error || 'Failed to settle')
    setBulkSettling(false)
  }

  // ── Delete commission ──────────────────────────────────────────────────────
  async function deleteCommission(id) {
    if (!confirm('Delete this commission entry?')) return
    const res = await client.delete(`/doctor-accountability?resource=commission&id=${id}`)
    if (res.success) { toast.success('Deleted'); load() }
    else toast.error(res.error || 'Failed')
  }

  // ── Print receipt for a settled entry ─────────────────────────────────────
  function printReceipt(c) {
    const html = `<!DOCTYPE html><html><head><title>Settlement Receipt</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:24px;font-size:11pt;color:#1e293b}
.hosp{font-size:16pt;font-weight:bold;color:#1e3a5f;border-bottom:2px solid #1e3a5f;padding-bottom:8px;margin-bottom:16px}
.title{font-size:13pt;font-weight:bold;margin-bottom:16px;color:#334155}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9}
.lbl{color:#64748b;font-size:10pt}
.val{font-weight:600}
.total{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px 14px;margin-top:16px;display:flex;justify-content:space-between}
.footer{font-size:8pt;color:#94a3b8;text-align:center;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px}
@media print{body{padding:12px}}</style></head><body>
<div class="hosp">${orgInfo.name}</div>
<div class="title">Commission Settlement Receipt</div>
<div class="row"><span class="lbl">Doctor</span><span class="val">${c.doctor.fullName}</span></div>
<div class="row"><span class="lbl">Invoice ID</span><span class="val">${c.invoiceId || '—'}</span></div>
<div class="row"><span class="lbl">Invoice Amount</span><span class="val">${fmt(c.invoiceAmount)}</span></div>
<div class="row"><span class="lbl">Commission Rate</span><span class="val">${c.commissionType === 'percentage' ? `${c.commissionRate}%` : fmt(c.commissionRate)}</span></div>
<div class="row"><span class="lbl">Settlement Reference</span><span class="val">${c.settlementRef || '—'}</span></div>
<div class="row"><span class="lbl">Settled On</span><span class="val">${c.settledAt ? format(new Date(c.settledAt), 'dd MMM yyyy HH:mm') : format(new Date(), 'dd MMM yyyy HH:mm')}</span></div>
<div class="total"><span style="font-weight:600;color:#15803d">Commission Settled</span><span style="font-size:14pt;font-weight:bold;color:#15803d">${fmt(c.commissionAmount)}</span></div>
<div class="footer">Printed: ${format(new Date(), 'dd MMM yyyy HH:mm')} | ${orgInfo.name} — Doctor Accountability System</div>
</body></html>`
    printViaIframe(html)
  }

  // ── CSV export ─────────────────────────────────────────────────────────────
  function exportCSV() {
    const rows = [
      ['Date', 'Doctor', 'Invoice ID', 'Invoice Amount (₹)', 'Rate', 'Commission (₹)', 'Status', 'Settlement Ref'],
      ...displayed.map(c => [
        format(new Date(c.createdAt), 'dd/MM/yyyy'),
        c.doctor.fullName,
        c.invoiceId || '',
        c.invoiceAmount,
        c.commissionType === 'percentage' ? `${c.commissionRate}%` : `₹${c.commissionRate}`,
        c.commissionAmount,
        c.status,
        c.settlementRef || '',
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `commissions-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const configuredDoctors = doctors.filter(d => d.commissionConfig)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterDoctor} onValueChange={setFilterDoctor}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Doctors" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Doctors</SelectItem>
            {doctors.map(d => <SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="settled">Settled</SelectItem>
          </SelectContent>
        </Select>
        {/* Date range filter */}
        <Select value={filterDate} onValueChange={setFilterDate}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Created Date" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCSV} title="Export CSV">
            <FileDown className="h-4 w-4 mr-1" />Export CSV
          </Button>
          <Button size="sm" onClick={() => setAddDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />Add Commission
          </Button>
        </div>
      </div>

      {/* Bulk settle bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <span className="text-sm text-blue-800 font-medium">
            {selectedIds.size} selected — total {fmt(commissions.filter(c => selectedIds.has(c.id)).reduce((s, c) => s + (c.commissionAmount || 0), 0))}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            <Button size="sm" onClick={bulkSettle} disabled={bulkSettling}>
              <CheckCheck className="h-4 w-4 mr-1" />{bulkSettling ? 'Settling...' : 'Settle Selected'}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No commission entries found.</div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Date</TableHead><TableHead>Doctor</TableHead><TableHead>Invoice ID</TableHead>
                <TableHead>Invoice Amt</TableHead><TableHead>Rate</TableHead><TableHead>Commission</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.map(c => (
                  <TableRow key={c.id} className={selectedIds.has(c.id) ? 'bg-blue-50/50' : ''}>
                    <TableCell>
                      {c.status === 'pending' ? (
                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300"
                          checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} />
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{format(new Date(c.createdAt), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="font-medium">{c.doctor.fullName}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{c.invoiceId || '—'}</TableCell>
                    <TableCell>{fmt(c.invoiceAmount)}</TableCell>
                    <TableCell className="text-gray-500 text-sm">{c.commissionType === 'percentage' ? `${c.commissionRate}%` : fmt(c.commissionRate)}</TableCell>
                    <TableCell className="font-semibold text-green-700">{fmt(c.commissionAmount)}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === 'settled' ? 'default' : 'secondary'} className={c.status === 'settled' ? 'bg-green-100 text-green-700 hover:bg-green-100' : 'bg-amber-100 text-amber-700 hover:bg-amber-100'}>
                        {c.status === 'settled' ? 'Settled' : 'Pending'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {c.status === 'pending' && (
                          <>
                            {/* Edit */}
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-blue-600" title="Edit" onClick={() => openEdit(c)}>
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            {/* Quick settle */}
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600" title="Settle" onClick={() => openSettle(c)}>
                              <CheckCheck className="h-3.5 w-3.5" />
                            </Button>
                            {/* Delete */}
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500" title="Delete" onClick={() => deleteCommission(c.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {c.status === 'settled' && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-gray-500" title="Print Receipt" onClick={() => printReceipt(c)}>
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
              ))}
            </TableBody>
          </Table>
          {commissionsMeta.total > 10 && (() => {
            const totalPages = commissionsMeta.totalPages
            return (
              <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
                <Button variant="outline" size="sm" onClick={() => setCommissionsPage(p => Math.max(1, p - 1))} disabled={commissionsPage === 1}>
                  <ChevronLeft className="h-4 w-4 mr-1" />Previous
                </Button>
                <span className="text-sm text-gray-600">Page {commissionsPage} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setCommissionsPage(p => Math.min(totalPages, p + 1))} disabled={commissionsPage === totalPages}>
                  Next<ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )
          })()}
        </div>
      )}

      {/* Add Commission Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Commission Entry</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Doctor *</Label>
              <SearchableSelect
                className="mt-1 w-full"
                value={form.doctorId}
                onChange={v => setForm(f => ({ ...f, doctorId: v }))}
                options={doctors.map(d => ({
                  value: d.id,
                  label: d.fullName,
                  sublabel: d.commissionConfig
                    ? `Commission ${d.commissionConfig.commissionType === 'percentage' ? `${d.commissionConfig.commissionRate}%` : fmt(d.commissionConfig.commissionRate)}`
                    : (d.specialization || undefined),
                }))}
                placeholder="Select doctor"
                searchPlaceholder="Search doctor by name..."
                emptyText="No doctors found"
              />
              {doctors.length === 0 && <p className="text-xs text-amber-600 mt-1">No doctors found. Add doctors in Settings → Users first.</p>}
            </div>
            <div>
              <Label>Invoice Amount (₹) *</Label>
              <Input className="mt-1" type="number" value={form.invoiceAmount} onChange={e => setForm(f => ({ ...f, invoiceAmount: e.target.value }))} placeholder="e.g. 5000" />
            </div>
            {form.doctorId && form.invoiceAmount && (() => {
              const doc = doctors.find(d => d.id === form.doctorId)
              const cfg = doc?.commissionConfig
              if (!cfg) return null
              const inv = parseFloat(form.invoiceAmount) || 0
              const comm = cfg.commissionType === 'percentage' ? (inv * cfg.commissionRate) / 100 : cfg.commissionRate
              return (
                <div className="bg-green-50 rounded-lg p-3 text-sm">
                  <span className="text-gray-600">Commission to be recorded: </span>
                  <span className="font-bold text-green-700">{fmt(comm)}</span>
                </div>
              )
            })()}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setAddDialog(false)}>Cancel</Button>
              <Button onClick={addCommission} disabled={saving}>{saving ? 'Adding...' : 'Add Entry'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Commission Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Commission — {editEntry?.doctor?.fullName}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Invoice Amount (₹) *</Label>
              <Input className="mt-1" type="number" value={editForm.invoiceAmount} onChange={e => setEditForm(f => ({ ...f, invoiceAmount: e.target.value }))} />
            </div>
            {editEntry && editForm.invoiceAmount && (() => {
              const inv = parseFloat(editForm.invoiceAmount) || 0
              const comm = editEntry.commissionType === 'percentage'
                ? (inv * editEntry.commissionRate) / 100
                : editEntry.commissionRate
              return (
                <div className="bg-blue-50 rounded-lg p-3 text-sm">
                  <span className="text-gray-600">Recalculated commission: </span>
                  <span className="font-bold text-blue-700">{fmt(comm)}</span>
                </div>
              )
            })()}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setEditDialog(false)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={editSaving}>{editSaving ? 'Saving...' : 'Save Changes'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Settle Dialog */}
      <Dialog open={settleDialog} onOpenChange={setSettleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Settle Commission</DialogTitle></DialogHeader>
          {settleEntry && (
            <div className="space-y-4 pt-2">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm space-y-1">
                <div className="font-semibold text-green-800">{settleEntry.doctor?.fullName}</div>
                <div className="text-gray-600">Commission: <span className="font-bold text-green-700">{fmt(settleEntry.commissionAmount)}</span></div>
              </div>
              <div>
                <Label>Settlement Reference</Label>
                <Input className="mt-1" value={settleRef} onChange={e => setSettleRef(e.target.value)} placeholder="Cheque / Transfer / UPI ref" />
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Input className="mt-1" value={settleNote} onChange={e => setSettleNote(e.target.value)} placeholder="Optional note" />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setSettleDialog(false)}>Cancel</Button>
                <Button className="bg-green-600 hover:bg-green-700" onClick={quickSettle} disabled={settling}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  {settling ? 'Settling...' : `Settle ${fmt(settleEntry.commissionAmount)}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SettlementTab() {
  const [commissions, setCommissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [settling, setSettling] = useState(false)
  const [note, setNote] = useState('')
  const [ref, setRef] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await client.get('/doctor-accountability?resource=commissions&status=pending')
    if (res.success) setCommissions(res.data)
    setLoading(false)
    setSelected(new Set())
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleAll() {
    if (selected.size === commissions.length) setSelected(new Set())
    else setSelected(new Set(commissions.map(c => c.id)))
  }

  async function settle() {
    if (selected.size === 0) { toast.error('Select at least one commission to settle'); return }
    setSettling(true)
    const res = await client.patch('/doctor-accountability?resource=settle', {
      commissionIds: Array.from(selected), settlementNote: note, settlementRef: ref,
    })
    if (res.success) { toast.success(res.message || 'Settled successfully'); setNote(''); setRef(''); load() }
    else toast.error(res.error || 'Failed to settle')
    setSettling(false)
  }

  const totalSelected = commissions.filter(c => selected.has(c.id)).reduce((s, c) => s + c.commissionAmount, 0)

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : commissions.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No pending commissions to settle.</div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{commissions.length} pending commissions</p>
            <Button variant="outline" size="sm" onClick={toggleAll}>
              <CheckSquare className="h-4 w-4 mr-1" />
              {selected.size === commissions.length ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Doctor</TableHead><TableHead>Invoice Amt</TableHead>
                <TableHead>Commission</TableHead><TableHead>Follow-up Valid</TableHead><TableHead>Invoice ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.map(c => (
                <TableRow key={c.id} className={selected.has(c.id) ? 'bg-blue-50' : ''}>
                  <TableCell>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 cursor-pointer" />
                  </TableCell>
                  <TableCell className="font-medium">{c.doctor.fullName}</TableCell>
                  <TableCell>{fmt(c.invoiceAmount)}</TableCell>
                  <TableCell className="font-semibold text-green-700">{fmt(c.commissionAmount)}</TableCell>
                  <TableCell className="text-sm text-gray-500">{periodLabel(c.period)}</TableCell>
                  <TableCell className="text-sm text-gray-500">{c.invoiceId || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {selected.size > 0 && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-blue-800">{selected.size} commission(s) selected — Total: {fmt(totalSelected)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Settlement Reference</Label>
                    <Input value={ref} onChange={e => setRef(e.target.value)} placeholder="Cheque / Transfer ref" className="mt-1 h-9 bg-white" />
                  </div>
                  <div>
                    <Label className="text-xs">Settlement Note</Label>
                    <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note" className="mt-1 h-9 bg-white" />
                  </div>
                </div>
                <Button onClick={settle} disabled={settling} className="w-full bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {settling ? 'Settling...' : `Settle ${selected.size} Commission(s) — ${fmt(totalSelected)}`}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function FeeStructureTab() {
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDoctor, setSelectedDoctor] = useState(null)
  const [rows, setRows] = useState([])             // editable follow-up day-ranges
  const [slabsLoading, setSlabsLoading] = useState(false)
  const [baseFee, setBaseFee] = useState('')       // doctor's new-patient base fee
  const [savingBase, setSavingBase] = useState(false)
  const [savingKey, setSavingKey] = useState(null) // key of the row currently saving

  const loadDoctors = useCallback(async () => {
    setLoading(true)
    const res = await client.get('/doctor-accountability?resource=doctors')
    if (res.success) setDoctors(res.data)
    setLoading(false)
  }, [])

  const loadSlabs = useCallback(async (doctorId) => {
    setSlabsLoading(true)
    const res = await client.get(`/fee-slabs?doctorId=${doctorId}`)
    if (res.success) {
      setRows(res.data
        .sort((a, b) => a.fromDays - b.fromDays)
        .map(s => ({
          key: s.id, id: s.id,
          fromDays: String(s.fromDays), toDays: String(s.toDays),
          feeAmount: String(s.feeAmount), isActive: s.isActive, notes: s.notes || '',
        })))
    } else toast.error(res.error || 'Failed to load slabs')
    setSlabsLoading(false)
  }, [])

  useEffect(() => { loadDoctors() }, [loadDoctors])

  function handleSelectDoctor(doctorId) {
    setSelectedDoctor(doctorId)
    const doc = doctors.find(d => d.id === doctorId)
    setBaseFee(doc?.consultationFee != null ? String(doc.consultationFee) : '')
    loadSlabs(doctorId)
  }

  // ── New-patient base fee ───────────────────────────────────────────────────
  // Persist the doctor's base fee without disturbing their commission config.
  async function saveBaseFee() {
    const fee = parseFloat(baseFee)
    if (isNaN(fee) || fee < 0) { toast.error('Enter a valid base fee'); return }
    setSavingBase(true)
    try {
      const doc = doctors.find(d => d.id === selectedDoctor)
      const cfg = doc?.commissionConfig
      const res = await client.post('/doctor-accountability?resource=config', {
        doctorId: selectedDoctor,
        consultationFee: fee,
        commissionType: cfg?.commissionType || 'percentage',
        commissionRate: cfg?.commissionRate ?? 0,
        isActive: cfg?.isActive ?? true,
        notes: cfg?.notes || null,
      })
      if (res.success) { toast.success('New-patient base fee saved'); loadDoctors() }
      else toast.error(res.error || 'Failed to save base fee')
    } catch (err) {
      toast.error('Error saving base fee')
    }
    setSavingBase(false)
  }

  // ── Follow-up day-ranges (multiple, inline editable) ───────────────────────
  function updateRow(key, patch) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)))
  }

  // Add a new blank range; prefill its "From Day" with the previous range's "To Day"
  function addRange() {
    setRows(prev => {
      const last = prev[prev.length - 1]
      const from = last && last.toDays !== '' ? last.toDays : ''
      return [...prev, { key: `new-${Date.now()}`, id: null, fromDays: from, toDays: '', feeAmount: '', isActive: true, notes: '' }]
    })
  }

  function validateRow(row) {
    const from = parseInt(row.fromDays)
    const to = parseInt(row.toDays)
    const fee = parseFloat(row.feeAmount)
    if (isNaN(from) || isNaN(to) || isNaN(fee)) return 'From Day, To Day and Charge are required'
    if (from < 0 || to < 0) return 'Days cannot be negative'
    if (from >= to) return 'From Day must be less than To Day'
    if (fee < 0) return 'Charge cannot be negative'
    const overlap = rows.find(r =>
      r.key !== row.key && r.fromDays !== '' && r.toDays !== '' &&
      (from < parseInt(r.toDays)) && (to > parseInt(r.fromDays)))
    if (overlap) return `Overlaps with range ${overlap.fromDays}-${overlap.toDays} days`
    return null
  }

  async function saveRow(row) {
    const err = validateRow(row)
    if (err) { toast.error(err); return }
    setSavingKey(row.key)
    const payload = {
      fromDays: parseInt(row.fromDays),
      toDays: parseInt(row.toDays),
      feeAmount: parseFloat(row.feeAmount),
      isActive: row.isActive,
      notes: row.notes || null,
    }
    try {
      const res = row.id
        ? await client.patch(`/fee-slabs/${row.id}`, payload)
        : await client.post('/fee-slabs', { doctorId: selectedDoctor, ...payload })
      if (res.success) { toast.success(row.id ? 'Range updated' : 'Range added'); await loadSlabs(selectedDoctor) }
      else toast.error(res.error || 'Failed to save range')
    } catch (err) {
      toast.error('Error saving range')
    }
    setSavingKey(null)
  }

  async function deleteRow(row) {
    // Unsaved draft row → just drop it locally
    if (!row.id) { setRows(prev => prev.filter(r => r.key !== row.key)); return }
    if (!confirm('Delete this day-range?')) return
    try {
      const res = await client.delete(`/fee-slabs/${row.id}`)
      if (res.success) { toast.success('Range deleted'); await loadSlabs(selectedDoctor) }
      else toast.error(res.error || 'Failed to delete')
    } catch (err) {
      toast.error('Error deleting range')
    }
  }

  const selectedDoc = doctors.find(d => d.id === selectedDoctor)

  return (
    <div className="space-y-4">
      <div className="flex-1 max-w-md">
        <Label className="text-sm text-gray-600">Select Doctor</Label>
        <SearchableSelect
          className="mt-1 w-full"
          value={selectedDoctor || ''}
          onChange={handleSelectDoctor}
          options={doctors.map(doc => ({
            value: doc.id,
            label: doc.fullName,
            sublabel: doc.specialization || undefined,
          }))}
          placeholder="Choose a doctor to set fees..."
          searchPlaceholder="Search doctor by name..."
          emptyText="No doctors found"
        />
      </div>

      {!selectedDoctor ? (
        <div className="text-center py-12 text-gray-400">Select a doctor to configure their fees.</div>
      ) : (
        <>
          {/* ── New Patient base fee ───────────────────────────────── */}
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold text-sm mb-1">New Patient — Base Fee</h3>
            <p className="text-xs text-gray-500 mb-3">Charged on the first visit and after the 30-day reset window.</p>
            <div className="flex items-end gap-3">
              <div className="w-40">
                <Label className="text-xs">Charge Amount (₹)</Label>
                <Input
                  type="number" min={0} step={50} className="mt-1"
                  value={baseFee}
                  onChange={e => setBaseFee(e.target.value)}
                  placeholder="e.g. 1000"
                />
              </div>
              <Button onClick={saveBaseFee} disabled={savingBase}>
                {savingBase ? 'Saving...' : 'Save Base Fee'}
              </Button>
            </div>
          </div>

          {/* ── Follow-up day-ranges (multiple, fully editable) ─────── */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-sm">Follow-up — Day-based Charges</h3>
              <Button size="sm" onClick={addRange}>
                <Plus className="h-4 w-4 mr-1" />Add Range
              </Button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Add as many ranges as you like (e.g. 0–3 → free, 3–10 → ₹500, 10–20 → ₹300…). Edit any value and click Save on that row. Ranges must not overlap; after 30 days the patient is charged as a New Patient again.
            </p>

            {slabsLoading ? (
              <div className="text-center py-8 text-gray-400">Loading ranges...</div>
            ) : (
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">From Day</TableHead>
                      <TableHead className="w-24">To Day</TableHead>
                      <TableHead className="w-28">Charge (₹)</TableHead>
                      <TableHead className="w-20">Active</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right w-32">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-gray-400 py-6">
                          No follow-up ranges yet. Click "Add Range" to create one.
                        </TableCell>
                      </TableRow>
                    ) : rows.map(row => (
                      <TableRow key={row.key} className={row.id ? '' : 'bg-amber-50'}>
                        <TableCell>
                          <Input type="number" min={0} step={1} className="h-8"
                            value={row.fromDays}
                            onChange={e => updateRow(row.key, { fromDays: e.target.value })}
                            placeholder="0" />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} step={1} className="h-8"
                            value={row.toDays}
                            onChange={e => updateRow(row.key, { toDays: e.target.value })}
                            placeholder="3" />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} step={50} className="h-8"
                            value={row.feeAmount}
                            onChange={e => updateRow(row.key, { feeAmount: e.target.value })}
                            placeholder="0 = free" />
                        </TableCell>
                        <TableCell>
                          <input type="checkbox" className="h-4 w-4 rounded border-gray-300"
                            checked={row.isActive}
                            onChange={e => updateRow(row.key, { isActive: e.target.checked })} />
                        </TableCell>
                        <TableCell>
                          <Input className="h-8"
                            value={row.notes}
                            onChange={e => updateRow(row.key, { notes: e.target.value })}
                            placeholder="optional" />
                        </TableCell>
                        <TableCell className="text-right space-x-2 whitespace-nowrap">
                          <Button size="sm" onClick={() => saveRow(row)} disabled={savingKey === row.key}>
                            {savingKey === row.key ? '...' : (row.id ? 'Save' : 'Add')}
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700"
                            onClick={() => deleteRow(row)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="text-gray-400 text-sm font-medium">30+</TableCell>
                      <TableCell className="text-gray-400 text-sm">—</TableCell>
                      <TableCell className="text-gray-500 text-sm">
                        {selectedDoc?.consultationFee != null ? `₹${selectedDoc.consultationFee}` : 'base fee'}
                      </TableCell>
                      <TableCell colSpan={3} className="text-gray-400 text-sm italic">
                        After 30 days → charged as a New Patient (base fee)
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ReportsTab() {
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [reportsPage, setReportsPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await client.get('/doctor-accountability?resource=stats')
    if (res.success) setStats(res.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const totalPending = stats.reduce((s, d) => s + d.pendingAmount, 0)
  const totalSettled = stats.reduce((s, d) => s + d.settledAmount, 0)
  const totalDoctors = stats.filter(d => d.isActive).length

  function exportReportCSV() {
    const rows = [
      ['Doctor', 'Rate', 'Commission Type', 'Total Invoiced (₹)', 'Total Entries', 'Pending (₹)', 'Pending Count', 'Settled (₹)', 'Settled Count', 'Status'],
      ...stats.map(s => [
        s.doctorName,
        s.isActive ? (s.commissionType === 'percentage' ? `${s.commissionRate}%` : `₹${s.commissionRate}`) : 'Not configured',
        s.commissionType || '',
        s.totalInvoiceAmount,
        s.totalCommissions,
        s.pendingAmount,
        s.pendingCount,
        s.settledAmount,
        s.settledCount,
        s.isActive ? 'Active' : 'Inactive',
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `commission-report-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Active Doctors" value={String(totalDoctors)} color="bg-blue-500" />
        <StatCard icon={Clock} label="Total Pending" value={fmt(totalPending)} color="bg-amber-500" />
        <StatCard icon={CheckCircle2} label="Total Settled" value={fmt(totalSettled)} color="bg-green-500" />
        <StatCard icon={Wallet} label="Total Earned" value={fmt(totalPending + totalSettled)} color="bg-purple-500" />
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={exportReportCSV}>
          <FileDown className="h-4 w-4 mr-1" />Export Report CSV
        </Button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading stats...</div>
      ) : stats.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No data yet. Set up commissions and add entries first.</div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doctor</TableHead><TableHead>Rate</TableHead><TableHead>Total Invoiced</TableHead>
                <TableHead>Total Commissions</TableHead><TableHead>Pending</TableHead><TableHead>Settled</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const ITEMS_PER_PAGE = 10
                const totalPages = Math.ceil(stats.length / ITEMS_PER_PAGE)
                const startIdx = (reportsPage - 1) * ITEMS_PER_PAGE
                const endIdx = startIdx + ITEMS_PER_PAGE
                const paginatedStats = stats.slice(startIdx, endIdx)
                return paginatedStats.map(s => (
                  <TableRow key={s.doctorId}>
                    <TableCell className="font-medium">{s.doctorName}</TableCell>
                    <TableCell className="text-gray-500">
                      {s.isActive
                        ? s.commissionType === 'percentage' ? `${s.commissionRate}%` : fmt(s.commissionRate)
                        : <span className="text-gray-400 italic">Not configured</span>}
                    </TableCell>
                    <TableCell>{fmt(s.totalInvoiceAmount)}</TableCell>
                    <TableCell>{s.totalCommissions} entries</TableCell>
                    <TableCell><span className="font-semibold text-amber-700">{fmt(s.pendingAmount)}</span><span className="text-xs text-gray-400 ml-1">({s.pendingCount})</span></TableCell>
                    <TableCell><span className="font-semibold text-green-700">{fmt(s.settledAmount)}</span><span className="text-xs text-gray-400 ml-1">({s.settledCount})</span></TableCell>
                    <TableCell>
                      <Badge variant={s.isActive ? 'default' : 'outline'} className={s.isActive ? '' : 'text-gray-400'}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              })()}
            </TableBody>
          </Table>
          {stats.length > 10 && (() => {
            const ITEMS_PER_PAGE = 10
            const totalPages = Math.ceil(stats.length / ITEMS_PER_PAGE)
            return (
              <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
                <Button variant="outline" size="sm" onClick={() => setReportsPage(p => Math.max(1, p - 1))} disabled={reportsPage === 1}>
                  <ChevronLeft className="h-4 w-4 mr-1" />Previous
                </Button>
                <span className="text-sm text-gray-600">Page {reportsPage} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setReportsPage(p => Math.min(totalPages, p + 1))} disabled={reportsPage === totalPages}>
                  Next<ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

const TABS = [
  { id: 'doctors', label: 'Doctors', icon: UserCog },
  { id: 'commissions', label: 'Commissions', icon: IndianRupee },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'doctors-timetable', label: "Doctor's Timetable", icon: Clock },
]

export default function DoctorAccountabilityModule() {
  const [tab, setTab] = useState('doctors')
  const [reloadKey, setReloadKey] = useState(0)
  const [addCommissionSignal, setAddCommissionSignal] = useState(0)

  // Add Doctor
  const [addOpen, setAddOpen] = useState(false)
  const [savingDoc, setSavingDoc] = useState(false)
  const [departments, setDepartments] = useState([])
  const [docForm, setDocForm] = useState({ fullName: '', email: '', specialization: '', phone: '', departmentId: '' })

  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const res = await client.get('/settings?resource=departments')
        if (res.success) {
          setDepartments(res.data)
        }
      } catch (err) {
        console.error('Failed to load departments:', err)
      }
    }

    loadDepartments()
  }, [])

  async function addDoctor() {
    if (!docForm.fullName.trim() || !docForm.email.trim()) {
      toast.error('Full name and email are required')
      return
    }
    setSavingDoc(true)
    try {
      const res = await client.post('/settings', { resource: 'user', role: 'doctor', ...docForm })
      if (res.success) {
        toast.success(`Doctor ${res.data.fullName} added`)
        setAddOpen(false)
        setDocForm({ fullName: '', email: '', specialization: '', phone: '', departmentId: '' })
        setTab('doctors')
        setReloadKey(k => k + 1)   // remount DoctorsTab so the new doctor appears
      } else toast.error(res.error || 'Failed to add doctor')
    } catch (e) {
      toast.error(e.message || 'Failed to add doctor')
    } finally {
      setSavingDoc(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Doctor Accountability</h2>
          <p className="text-gray-500 mt-1">Track and settle doctor commissions for services rendered.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setTab('commissions'); setAddCommissionSignal(s => s + 1) }}>
            <IndianRupee className="h-4 w-4 mr-2" />Add Commission
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />Add Doctor
          </Button>
        </div>
      </div>
      <div className="flex border-b gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>
      <div>
        {tab === 'doctors' && <DoctorsTab key={reloadKey} />}
        {tab === 'commissions' && <CommissionsTab openAddSignal={addCommissionSignal} />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'doctors-timetable' && <DoctorTiming />}
      </div>

      {/* Add Doctor Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Doctor</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Full Name *</Label>
                <Input className="mt-1" value={docForm.fullName} onChange={e => setDocForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Dr. John Doe" />
              </div>
              <div>
                <Label>Email *</Label>
                <Input className="mt-1" type="email" value={docForm.email} onChange={e => setDocForm(f => ({ ...f, email: e.target.value }))} placeholder="doctor@hospital.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Specialization</Label>
                <Input className="mt-1" value={docForm.specialization} onChange={e => setDocForm(f => ({ ...f, specialization: e.target.value }))} placeholder="e.g. Cardiology" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input className="mt-1" value={docForm.phone} onChange={e => setDocForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91XXXXXXXXXX" />
              </div>
            </div>
            <div>
              <Label className="mb-1 block">Department</Label>
              <SearchableSelect
                className="w-full"
                options={departments.map(d => ({ value: d.id, label: d.name }))}
                value={docForm.departmentId}
                onChange={v => setDocForm(f => ({ ...f, departmentId: v }))}
                placeholder="Select department"
                searchPlaceholder="Search departments..."
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={addDoctor} disabled={savingDoc}>{savingDoc ? 'Adding...' : 'Add Doctor'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
