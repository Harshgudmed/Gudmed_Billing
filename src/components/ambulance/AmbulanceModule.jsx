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
import { Ambulance, Plus, Search, Trash2, Loader2, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import client from '@/api/client'

const TYPES = [
  { value: 'BLS', label: 'BLS (Basic Life Support)' },
  { value: 'ALS', label: 'ALS (Advanced Life Support)' },
  { value: 'ICU', label: 'ICU / Critical Care' },
  { value: 'NEONATAL', label: 'Neonatal' },
  { value: 'PTV', label: 'Patient Transport Vehicle' },
  { value: 'MORTUARY', label: 'Mortuary Van' },
]

const STATUS_STYLES = {
  scheduled: 'bg-blue-100 text-blue-700',
  enroute: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-200 text-gray-600',
}

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`

const EMPTY = {
  patientId: '', ambulanceType: 'ALS', fromLocation: '', toLocation: 'Hospital',
  distanceKm: '', charge: '', status: 'completed', driverName: '', vehicleNumber: '', contactPhone: '', notes: '',
}

export default function AmbulanceModule() {
  const [trips, setTrips] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null) // via shared PatientLookup (server search)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY)

  async function fetchTrips() {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await client.get(`/ambulance?${params}`)
      if (res.success) setTrips(res.data || [])
      else setError(res.error || 'Failed to load')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { fetchTrips() }, [search])

  const stats = useMemo(() => ({
    total: trips.length,
    completed: trips.filter(t => t.status === 'completed').length,
    active: trips.filter(t => ['scheduled', 'enroute'].includes(t.status)).length,
    revenue: trips.reduce((s, t) => s + (t.charge || 0), 0),
  }), [trips])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.fromLocation && !form.patientId) { toast.error('Select a patient or enter a pickup location'); return }
    setSaving(true)
    try {
      const res = await client.post('/ambulance', form)
      if (res.success) { toast.success(`Trip ${res.data.tripNumber} added`); setForm(EMPTY); setSelectedPatient(null); fetchTrips() }
      else toast.error(res.error || 'Failed to add trip')
    } catch (e) { toast.error(e.message || 'Failed to add trip') } finally { setSaving(false) }
  }

  async function changeStatus(id, status) {
    try {
      const res = await client.patch('/ambulance', { id, status })
      if (res.success) { setTrips(ts => ts.map(t => t.id === id ? res.data : t)) }
    } catch { toast.error('Failed to update status') }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this trip?')) return
    try {
      const res = await client.delete(`/ambulance?id=${id}`)
      if (res.success) { toast.success('Trip deleted'); fetchTrips() }
    } catch { toast.error('Failed to delete') }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Ambulance className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-bold">Ambulance</h1>
          <p className="text-gray-500">Trip logging &amp; transport billing</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Total Trips</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card className="border-l-4 border-l-amber-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Active</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.active}</div></CardContent></Card>
        <Card className="border-l-4 border-l-green-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Completed</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.completed}</div></CardContent></Card>
        <Card className="border-l-4 border-l-blue-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Revenue</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{inr(stats.revenue)}</div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Billing table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2"><Ambulance className="h-5 w-5 text-blue-600" /> Ambulance Billing</CardTitle>
              <div className="relative w-full md:w-64">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input placeholder="Search trip, patient, location..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading && trips.length === 0 ? (
              <div className="flex justify-center p-10"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /></div>
            ) : error ? (
              <div className="flex flex-col items-center p-8 text-center text-red-600">
                <AlertCircle className="h-8 w-8 mb-2" />{error}
                <Button variant="outline" className="mt-3" onClick={fetchTrips}>Retry</Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trip ID</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Km</TableHead>
                    <TableHead>Charge</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trips.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-10 text-gray-500">No ambulance trips yet.</TableCell></TableRow>
                  ) : trips.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono font-medium text-blue-700">{t.tripNumber}</TableCell>
                      <TableCell>{t.patient ? `${t.patient.firstName} ${t.patient.lastName}` : '—'}</TableCell>
                      <TableCell><Badge variant="outline">{t.ambulanceType}</Badge></TableCell>
                      <TableCell>{t.fromLocation || '—'}</TableCell>
                      <TableCell>{t.toLocation || '—'}</TableCell>
                      <TableCell>{t.distanceKm != null ? `${t.distanceKm} km` : '—'}</TableCell>
                      <TableCell className="font-medium">{inr(t.charge)}</TableCell>
                      <TableCell>{format(new Date(t.tripDate), 'yyyy-MM-dd')}</TableCell>
                      <TableCell>
                        <Select value={t.status} onValueChange={v => changeStatus(t.id, v)}>
                          <SelectTrigger className={`h-7 w-[120px] border-0 ${STATUS_STYLES[t.status] || ''}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="scheduled">Scheduled</SelectItem>
                            <SelectItem value="enroute">En Route</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="text-red-600 hover:bg-red-50" onClick={() => handleDelete(t.id)}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* New trip form */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-green-600" /> New Ambulance Trip</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Patient</Label>
                <PatientLookup
                  selectedPatient={selectedPatient}
                  onSelect={(p) => { setSelectedPatient(p); set('patientId', p.id) }}
                  onClear={() => { setSelectedPatient(null); set('patientId', '') }}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Ambulance Type</Label>
                <Select value={form.ambulanceType} onValueChange={v => set('ambulanceType', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>From (Pickup)</Label><Input className="mt-1" placeholder="Pickup location" value={form.fromLocation} onChange={e => set('fromLocation', e.target.value)} /></div>
                <div><Label>To (Destination)</Label><Input className="mt-1" placeholder="Destination" value={form.toLocation} onChange={e => set('toLocation', e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Distance (km)</Label><Input className="mt-1" type="number" step="0.1" placeholder="km" value={form.distanceKm} onChange={e => set('distanceKm', e.target.value)} /></div>
                <div><Label>Charge (₹)</Label><Input className="mt-1" type="number" placeholder="₹" value={form.charge} onChange={e => set('charge', e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Driver</Label><Input className="mt-1" placeholder="Driver name" value={form.driverName} onChange={e => set('driverName', e.target.value)} /></div>
                <div><Label>Vehicle No.</Label><Input className="mt-1" placeholder="e.g. DL1CAB1234" value={form.vehicleNumber} onChange={e => set('vehicleNumber', e.target.value)} /></div>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => set('status', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="enroute">En Route</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Notes</Label><Textarea className="mt-1" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
              <Button type="submit" className="bg-green-600 hover:bg-green-700 w-full" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />} Add Trip
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
