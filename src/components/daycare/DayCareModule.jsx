import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PatientLookup from '@/components/common/PatientLookup'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Sun, Plus, Search, Trash2, Loader2, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import client from '@/api/client'

const STATUS_STYLES = {
  admitted: 'bg-blue-100 text-blue-700',
  in_procedure: 'bg-amber-100 text-amber-700',
  observation: 'bg-purple-100 text-purple-700',
  discharged: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-200 text-gray-600',
}
const PAY_STYLES = { pending: 'bg-orange-100 text-orange-700', partial: 'bg-amber-100 text-amber-700', paid: 'bg-green-100 text-green-700' }
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`
const labelize = (s) => (s || '').replace(/_/g, ' ')

const EMPTY = { patientId: '', doctorId: '', procedure: '', fee: '', paymentStatus: 'pending', status: 'admitted', dischargeTime: '', notes: '' }

export default function DayCareModule() {
  const [cases, setCases] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null) // via shared PatientLookup
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY)

  async function fetchCases() {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await client.get(`/day-care?${params}`)
      if (res.success) setCases(res.data || [])
      else setError(res.error || 'Failed to load')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { fetchCases() }, [search, statusFilter])
  useEffect(() => {
    client.get('/settings?resource=users').then(r => { if (r.success) setDoctors((r.data || []).filter(u => u.role === 'doctor' && u.isActive !== false)) }).catch(() => {})
  }, [])

  const stats = useMemo(() => ({
    total: cases.length,
    active: cases.filter(c => !['discharged', 'cancelled'].includes(c.status)).length,
    discharged: cases.filter(c => c.status === 'discharged').length,
    revenue: cases.reduce((s, c) => s + (c.fee || 0), 0),
  }), [cases])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.patientId) { toast.error('Select a patient'); return }
    setSaving(true)
    try {
      const res = await client.post('/day-care', form)
      if (res.success) { toast.success(`Day care case ${res.data.caseNumber} created`); setForm(EMPTY); setSelectedPatient(null); setOpen(false); fetchCases() }
      else toast.error(res.error || 'Failed to create')
    } catch (e) { toast.error(e.message || 'Failed to create') } finally { setSaving(false) }
  }

  async function patch(id, body) {
    try {
      const res = await client.patch('/day-care', { id, ...body })
      if (res.success) setCases(cs => cs.map(c => c.id === id ? res.data : c))
    } catch { toast.error('Failed to update') }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this day care case?')) return
    try {
      const res = await client.delete(`/day-care?id=${id}`)
      if (res.success) { toast.success('Deleted'); fetchCases() }
    } catch { toast.error('Failed to delete') }
  }

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
        <Card><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Total Cases</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card className="border-l-4 border-l-amber-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Active</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.active}</div></CardContent></Card>
        <Card className="border-l-4 border-l-green-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Discharged</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.discharged}</div></CardContent></Card>
        <Card className="border-l-4 border-l-blue-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Revenue</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{inr(stats.revenue)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2"><Sun className="h-5 w-5 text-amber-500" /> Day Care Patients</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full md:w-64">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input placeholder="Search name, procedure, UHID..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="admitted">Admitted</SelectItem>
                  <SelectItem value="in_procedure">In Procedure</SelectItem>
                  <SelectItem value="observation">Observation</SelectItem>
                  <SelectItem value="discharged">Discharged</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && cases.length === 0 ? (
            <div className="flex justify-center p-10"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /></div>
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
                {cases.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-gray-500">No day care patients yet.</TableCell></TableRow>
                ) : cases.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-medium text-blue-700">{c.caseNumber}</TableCell>
                    <TableCell>{c.patient ? `${c.patient.firstName} ${c.patient.lastName}` : '—'}</TableCell>
                    <TableCell>{c.doctor?.fullName || c.doctorName || '—'}</TableCell>
                    <TableCell>{c.procedure || '—'}</TableCell>
                    <TableCell>{format(new Date(c.admissionDate), 'yyyy-MM-dd')}</TableCell>
                    <TableCell className="font-medium">{inr(c.fee)}</TableCell>
                    <TableCell>
                      <Select value={c.paymentStatus} onValueChange={v => patch(c.id, { paymentStatus: v })}>
                        <SelectTrigger className={`h-7 w-[110px] border-0 capitalize ${PAY_STYLES[c.paymentStatus] || ''}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="partial">Partial</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
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
                <SelectContent>{doctors.map(d => <SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Procedure</Label><Input className="mt-1" placeholder="e.g. Cataract Surgery, Dialysis" value={form.procedure} onChange={e => set('procedure', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Fee (₹)</Label><Input className="mt-1" type="number" placeholder="₹" value={form.fee} onChange={e => set('fee', e.target.value)} /></div>
              <div><Label>Discharge Time</Label><Input className="mt-1" type="time" value={form.dischargeTime} onChange={e => set('dischargeTime', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payment</Label>
                <Select value={form.paymentStatus} onValueChange={v => set('paymentStatus', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="partial">Partial</SelectItem><SelectItem value="paid">Paid</SelectItem></SelectContent>
                </Select>
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
            </div>
            <div><Label>Notes</Label><Textarea className="mt-1" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
