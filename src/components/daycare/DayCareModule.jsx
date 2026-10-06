import { useState, useEffect, useMemo } from 'react'
import { drName } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PatientLookup from '@/components/common/PatientLookup'
import { FilterBar, FilterSelect, statusOptions } from '@/components/common/FilterBar'
import { useLiveData } from '@/lib/useLiveData'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Sun, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import client from '@/api/client'
import PaymentFields from '@/components/billing/PaymentFields'
import RecordBillDialog, { BillSummary, PAY_STYLES } from './RecordBillDialog'
import { raiseRecordBill } from '@/lib/billing'

const STATUS_STYLES = {
  admitted: 'bg-blue-100 text-blue-700',
  in_procedure: 'bg-amber-100 text-amber-700',
  observation: 'bg-purple-100 text-purple-700',
  discharged: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-200 text-gray-600',
}
import { formatMoney as inr } from '@/lib/format'
import { getFullName } from "@/lib/patient";
const labelize = (s) => (s || '').replace(/_/g, ' ')

// amountPaid / paymentMethod are not stored on the case: they are the payment
// taken on its bill at admission (handleSubmit).
const EMPTY = { patientId: '', doctorId: '', procedure: '', fee: '', amountPaid: '', paymentMethod: 'cash', status: 'admitted', dischargeTime: '', notes: '' }
// The wording of the case's line on its bill.
const billLine = (c) => (c.procedure ? `Day care: ${c.procedure}` : 'Day care')

// The filter row's dropdowns, built from the same status lists the table uses.
const DAY_CARE_STATUS_OPTIONS = statusOptions(Object.keys(STATUS_STYLES), { label: (v) => labelize(v).replace(/^\w/, (c) => c.toUpperCase()) })
const PAYMENT_OPTIONS = statusOptions(Object.keys(PAY_STYLES), { allLabel: 'All Payments', label: (v) => v.replace(/^\w/, (c) => c.toUpperCase()) })

export default function DayCareModule() {
  const [cases, setCases] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null) // via shared PatientLookup
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [quickFilter, setQuickFilter] = useState('all') // 'all' | 'active' | 'discharged', driven by the stat cards
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [billCaseId, setBillCaseId] = useState(null) // the case whose Bill dialog is open

  async function fetchCases() {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (paymentFilter !== 'all') params.set('paymentStatus', paymentFilter)
      const res = await client.get(`/day-care?${params}`)
      if (res.success) setCases(res.data || [])
      else setError(res.error || 'Failed to load')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { fetchCases() }, [search, statusFilter, paymentFilter])

  // Live: a day-care case admitted or discharged at another desk shows up here
  // on its own, so this screen never needs a Refresh button.
  useLiveData('day-care', fetchCases)

  useEffect(() => {
    client.get('/settings?resource=users').then(r => { if (r.success) setDoctors((r.data || []).filter(u => u.role === 'doctor' && u.isActive !== false)) }).catch(() => {})
  }, [])

  const stats = useMemo(() => ({
    total: cases.length,
    active: cases.filter(c => !['discharged', 'cancelled'].includes(c.status)).length,
    discharged: cases.filter(c => c.status === 'discharged').length,
    // Money actually collected: what was paid on each case's bill (net of
    // refunds), or what was recorded on the case before it was linked to
    // Billing. A fee nobody has paid yet is not revenue.
    revenue: cases.reduce((s, c) => s + (c.bill ? (c.bill.status === 'cancelled' ? 0 : Number(c.bill.amountPaid) || 0) : (c.paidOutsideBilling || 0)), 0),
  }), [cases])

  const displayedCases = useMemo(() => {
    if (quickFilter === 'active') return cases.filter(c => !['discharged', 'cancelled'].includes(c.status))
    if (quickFilter === 'discharged') return cases.filter(c => c.status === 'discharged')
    return cases
  }, [cases, quickFilter])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.patientId) { toast.error('Select a patient'); return }
    const fee = Number(form.fee) || 0
    const paidNow = Number(form.amountPaid) || 0
    if (paidNow > fee) { toast.error('The amount received cannot be more than the fee'); return }
    setSaving(true)
    try {
      const { amountPaid, paymentMethod, ...caseFields } = form
      const res = await client.post('/day-care', caseFields)
      if (!res.success) { toast.error(res.error || 'Failed to create'); return }
      const dayCase = res.data
      toast.success(`Day care case ${dayCase.caseNumber} created`)
      setForm(EMPTY); setSelectedPatient(null); setOpen(false)
      // Its fee is billed in Billing, like a lab order — the money is taken on
      // that bill, so Billing, revenue and the patient's bills all see it.
      if (fee > 0) {
        try {
          const raised = await raiseRecordBill('daycare', { number: dayCase.caseNumber, patientId: dayCase.patientId, serviceName: billLine(dayCase), charge: fee, amountPaid, paymentMethod })
          if (!raised?.invoice) throw new Error('Billing did not accept it')
          toast.success(paidNow > 0 ? `Bill raised; ${inr(paidNow)} received` : 'Bill raised in Billing')
        } catch (err) {
          toast.error(`The case is saved, but its bill was not completed: ${err.message || 'please try again'}. Open its Bill to finish.`)
        }
      }
      fetchCases()
    } catch (e) { toast.error(e.message || 'Failed to create') } finally { setSaving(false) }
  }

  // Resolves with the saved case, or throws with the server's reason.
  async function saveCase(id, body) {
    const res = await client.patch('/day-care', { id, ...body })
    if (!res.success) throw new Error(res.error || 'Failed to update')
    setCases(cs => cs.map(c => c.id === id ? res.data : c))
    return res.data
  }

  async function patch(id, body) {
    try { await saveCase(id, body) } catch (e) { toast.error(e.message || 'Failed to update') }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this day care case?')) return
    try {
      const res = await client.delete(`/day-care?id=${id}`)
      if (res.success) { toast.success('Deleted'); fetchCases() }
    } catch (e) { toast.error(e.message || 'Failed to delete') }
  }

  const billCase = cases.find(c => c.id === billCaseId) || null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sun className="h-8 w-8 text-amber-500" />
          <div>
            <h1 className="text-3xl font-bold">Day Care</h1>
            <p className="text-gray-500">Same-day procedures &amp; short-stay observation</p>
          </div>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { setForm(EMPTY); setOpen(true) }}>
          <Plus className="h-4 w-4 mr-2" /> New Day Care Patient
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          className={`cursor-pointer transition-shadow hover:shadow-md ${quickFilter === 'all' ? 'ring-2 ring-[#2E4168]' : ''}`}
          onClick={() => setQuickFilter('all')}
        ><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Total Cases</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card
          className={`cursor-pointer transition-shadow hover:shadow-md border-l-4 border-l-amber-500 ${quickFilter === 'active' ? 'ring-2 ring-amber-500' : ''}`}
          onClick={() => setQuickFilter(f => f === 'active' ? 'all' : 'active')}
        ><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Active</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.active}</div></CardContent></Card>
        <Card
          className={`cursor-pointer transition-shadow hover:shadow-md border-l-4 border-l-green-500 ${quickFilter === 'discharged' ? 'ring-2 ring-green-500' : ''}`}
          onClick={() => setQuickFilter(f => f === 'discharged' ? 'all' : 'discharged')}
        ><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Discharged</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.discharged}</div></CardContent></Card>
        <Card className="border-l-4 border-l-blue-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Revenue (collected)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{inr(stats.revenue)}</div></CardContent></Card>
      </div>

      {/* The shared filter row (components/common/FilterBar) — the same one
          Radiology, Laboratory and the rest use. It used to be squeezed into the
          card header, where the search box was a third of its width. */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search name, procedure, UHID..."
        active={!!search || statusFilter !== 'all' || paymentFilter !== 'all'}
        onClear={() => { setSearch(''); setStatusFilter('all'); setPaymentFilter('all') }}
      >
        <FilterSelect value={statusFilter} onChange={setStatusFilter} options={DAY_CARE_STATUS_OPTIONS} />
        <FilterSelect value={paymentFilter} onChange={setPaymentFilter} options={PAYMENT_OPTIONS} />
      </FilterBar>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sun className="h-5 w-5 text-amber-500" /> Day Care Patients</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && cases.length === 0 ? (
            <div className="flex justify-center p-10"><Loader2 className="h-7 w-7 animate-spin text-[#2E4168]" /></div>
          ) : error ? (
            <div className="flex flex-col items-center p-8 text-center text-red-600"><AlertCircle className="h-8 w-8 mb-2" />{error}<Button variant="outline" className="mt-3" onClick={fetchCases}>Retry</Button></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead><TableHead>Name</TableHead><TableHead>Doctor</TableHead>
                  <TableHead>Procedure</TableHead><TableHead>Date</TableHead><TableHead>Fee</TableHead>
                  <TableHead>Payment</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedCases.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-gray-500">No day care patients yet.</TableCell></TableRow>
                ) : displayedCases.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-medium text-blue-700">{c.caseNumber}</TableCell>
                    <TableCell>{c.patient ? getFullName(c.patient) : '—'}</TableCell>
                    <TableCell>{(c.doctor?.fullName || c.doctorName) ? drName(c.doctor?.fullName || c.doctorName) : '—'}</TableCell>
                    <TableCell>{c.procedure || '—'}</TableCell>
                    <TableCell>{format(new Date(c.admissionDate), 'yyyy-MM-dd')}</TableCell>
                    <TableCell className="font-medium">{inr(c.fee)}</TableCell>
                    {/* What its bill says — the status used to be a drop-down that
                        saved nothing (the server never took it) and no money moved. */}
                    <TableCell><BillSummary record={c} onOpen={() => setBillCaseId(c.id)} /></TableCell>
                    <TableCell>
                      <Select value={c.status} onValueChange={v => patch(c.id, { status: v })}>
                        <SelectTrigger className={`h-7 w-[140px] border-0 capitalize ${STATUS_STYLES[c.status] || ''}`}><SelectValue>{labelize(c.status)}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admitted">Admitted</SelectItem>
                          <SelectItem value="in_procedure">In Procedure</SelectItem>
                          <SelectItem value="observation">Observation</SelectItem>
                          <SelectItem value="discharged">Discharged</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="text-red-600 hover:bg-red-50" onClick={() => handleDelete(c.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Day Care Patient</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Patient *</Label>
              <PatientLookup
                selectedPatient={selectedPatient}
                onSelect={(p) => { setSelectedPatient(p); set('patientId', p.id) }}
                onClear={() => { setSelectedPatient(null); set('patientId', '') }}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Doctor</Label>
              <Select value={form.doctorId} onValueChange={v => set('doctorId', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select doctor..." /></SelectTrigger>
                <SelectContent>{doctors.map(d => <SelectItem key={d.id} value={d.id}>{drName(d.fullName)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Procedure</Label><Input className="mt-1" placeholder="e.g. Cataract Surgery, Dialysis" value={form.procedure} onChange={e => set('procedure', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Fee (₹)</Label><Input className="mt-1" type="number" placeholder="₹" value={form.fee} onChange={e => set('fee', e.target.value)} /></div>
              <div><Label>Discharge Time</Label><Input className="mt-1" type="time" value={form.dischargeTime} onChange={e => set('dischargeTime', e.target.value)} /></div>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => set('status', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admitted">Admitted</SelectItem>
                  <SelectItem value="in_procedure">In Procedure</SelectItem>
                  <SelectItem value="observation">Observation</SelectItem>
                  <SelectItem value="discharged">Discharged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea className="mt-1" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
            {/* Taken on the case's bill in Billing, raised when the case is saved. */}
            <PaymentFields
              amount={form.amountPaid}
              method={form.paymentMethod}
              onAmountChange={v => set('amountPaid', v)}
              onMethodChange={v => set('paymentMethod', v)}
              charge={form.fee}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <RecordBillDialog
        open={!!billCase}
        onOpenChange={(o) => { if (!o) setBillCaseId(null) }}
        kind="daycare"
        record={billCase}
        number={billCase?.caseNumber}
        charge={billCase?.fee}
        serviceName={billCase ? billLine(billCase) : ''}
        saveCharge={(fee) => saveCase(billCase.id, { fee })}
        onChanged={fetchCases}
      />
    </div>
  )
}
