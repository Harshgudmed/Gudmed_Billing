import { useState, useEffect, useMemo } from 'react'
import { getOrgSettings } from '@/lib/orgSettings'
import { cToF, fToC } from '@/lib/utils'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  History, Plus, Search, Thermometer, UserPlus,
  ArrowRight, CheckCircle, Clock, Activity, AlertTriangle,
  RefreshCw, Loader2, Eye, Pencil, Printer, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import client from '@/api/client'
import PatientLookup, { calculatePatientAge, getPatientFullName } from '@/components/common/PatientLookup'
import { useDateFilter } from '@/components/common/DateFilter'

// ── Schema ───────────────────────────────────────────────────────────────────
const screeningSchema = z.object({
  patientId: z.string().optional(),
  firstName: z.string().optional().or(z.literal('')),
  lastName: z.string().optional().or(z.literal('')),
  age: z.coerce.number().optional().nullable(),
  gender: z.string().optional(),
  phone: z.string().optional(),
  chiefComplaint: z.string().min(5, 'Chief complaint is required'),
  briefHistory: z.string().optional(),
  temperature: z.coerce.number().optional().nullable(),
  bloodPressureSystolic: z.coerce.number().optional().nullable(),
  bloodPressureDiastolic: z.coerce.number().optional().nullable(),
  pulseRate: z.coerce.number().optional().nullable(),
  respiratoryRate: z.coerce.number().optional().nullable(),
  spo2: z.coerce.number().min(0).max(100).optional().nullable(),
  weight: z.coerce.number().min(0).optional().nullable(),
  height: z.coerce.number().min(0).optional().nullable(),
  bmi: z.coerce.number().optional().nullable(),
  fbs: z.coerce.number().optional().nullable(),
  ppbs: z.coerce.number().optional().nullable(),
  routedTo: z.string().optional(),
})

// ── Helpers ──────────────────────────────────────────────────────────────────
function getBmiCategory(bmi) {
  if (bmi < 18.5) return { label: 'Underweight', color: 'text-blue-600' }
  if (bmi < 25)   return { label: 'Normal',      color: 'text-green-600' }
  if (bmi < 30)   return { label: 'Overweight',  color: 'text-yellow-600' }
  return                  { label: 'Obese',       color: 'text-red-600' }
}

function formatRoutedTo(val) {
  if (!val) return '—'
  return val.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const isAbnormalTemp  = v => v != null && (v > 37.5 || v < 36)
const isAbnormalSpo2  = v => v != null && v < 95
const isAbnormalPulse = v => v != null && (v < 60 || v > 100)
const isAbnormalResp  = v => v != null && (v < 12 || v > 20)

// ── Print Slip ────────────────────────────────────────────────────────────────
function printSlip(s, orgInfo = { name: 'Hospital', address: '', phone: '', email: '' }) {
  const routedTo = formatRoutedTo(s.routedTo)
  const screenedAt = s.screenedAt ? format(new Date(s.screenedAt), 'dd MMM yyyy, HH:mm') : '—'
  const printedAt  = format(new Date(), 'dd MMM yyyy, HH:mm')

  const vitalRow = (label, value, unit, abnormal) =>
    `<div class="field">
      <div class="label">${label}</div>
      <div class="value${abnormal ? ' abnormal' : ''}">${value != null ? `${value} ${unit}` : '—'}</div>
    </div>`

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Pre-Triage Slip — ${s.screeningNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:12px;color:#000;padding:20px}
    .header{text-align:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:14px}
    .hosp{font-size:18px;font-weight:bold}
    .slip-title{font-size:13px;color:#555;margin:2px 0}
    .scr-no{font-size:15px;font-weight:bold;color:#1d4ed8;margin:4px 0}
    .section{margin:12px 0}
    .sec-title{font-weight:bold;font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #ddd;padding-bottom:3px;margin-bottom:8px;color:#555}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 20px}
    .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px 10px}
    .field{margin:3px 0}
    .label{color:#666;font-size:10px}
    .value{font-weight:600;font-size:12px}
    .abnormal{color:#dc2626}
    .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-weight:bold;font-size:11px;background:#fed7aa;color:#c2410c}
    .footer{margin-top:18px;border-top:1px dashed #ccc;padding-top:8px;font-size:10px;color:#888;text-align:center}
  </style>
</head>
<body>
  <div class="header">
    <div class="hosp">${orgInfo.name}</div>
    <div class="slip-title">Pre-Triage Screening Slip</div>
    <div class="scr-no">${s.screeningNumber}</div>
    <div>Screened: ${screenedAt}</div>
  </div>

  <div class="section">
    <div class="sec-title">Patient Information</div>
    <div class="grid">
      <div class="field"><div class="label">Name</div><div class="value">${s.firstName || ''} ${s.lastName || ''}</div></div>
      <div class="field"><div class="label">Age / Gender</div><div class="value">${s.age ?? '—'}y / ${s.gender || '—'}</div></div>
      <div class="field"><div class="label">Phone</div><div class="value">${s.phone || '—'}</div></div>
      <div class="field"><div class="label">Chief Complaint</div><div class="value">${s.chiefComplaint || '—'}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="sec-title">Vital Signs</div>
    <div class="grid3">
      ${vitalRow('Temperature',    cToF(s.temperature),    '°F',   isAbnormalTemp(s.temperature))}
      ${vitalRow('Pulse Rate',     s.pulseRate,            'bpm',  isAbnormalPulse(s.pulseRate))}
      ${vitalRow('SpO₂',          s.spo2,                 '%',    isAbnormalSpo2(s.spo2))}
      ${vitalRow('Resp. Rate',    s.respiratoryRate,       '/min', isAbnormalResp(s.respiratoryRate))}
      ${vitalRow('BP Systolic',   s.bloodPressureSystolic, 'mmHg', false)}
      ${vitalRow('BP Diastolic',  s.bloodPressureDiastolic,'mmHg', false)}
    </div>
  </div>

  <div class="section">
    <div class="sec-title">Anthropometric</div>
    <div class="grid3">
      <div class="field"><div class="label">Weight</div><div class="value">${s.weight != null ? s.weight + ' kg' : '—'}</div></div>
      <div class="field"><div class="label">Height</div><div class="value">${s.height != null ? s.height + ' cm' : '—'}</div></div>
      <div class="field"><div class="label">BMI</div><div class="value">${s.bmi ?? '—'}</div></div>
    </div>
  </div>

  ${(s.fbs != null || s.ppbs != null) ? `
  <div class="section">
    <div class="sec-title">Blood Sugar</div>
    <div class="grid">
      <div class="field"><div class="label">FBS</div><div class="value">${s.fbs != null ? s.fbs + ' mg/dL' : '—'}</div></div>
      <div class="field"><div class="label">PPBS</div><div class="value">${s.ppbs != null ? s.ppbs + ' mg/dL' : '—'}</div></div>
    </div>
  </div>` : ''}

  <div class="section">
    <div class="sec-title">Routing</div>
    <div class="grid">
      <div class="field"><div class="label">Status</div><div><span class="badge">${s.status?.replace(/_/g, ' ') || '—'}</span></div></div>
      <div class="field"><div class="label">Routed To</div><div class="value">${routedTo}</div></div>
    </div>
  </div>

  <div class="footer">Printed: ${printedAt} &bull; ${orgInfo.name}</div>
  <script>window.onload = function(){ window.print() }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=620,height=820')
  win.document.write(html)
  win.document.close()
}

// ── Vital badge ───────────────────────────────────────────────────────────────
function VitalBadge({ icon, value, unit, abnormal }) {
  if (value == null) return null
  return (
    <Badge
      variant="outline"
      className={`text-xs font-normal gap-0.5 ${abnormal ? 'bg-red-50 text-red-700 border-red-200' : ''}`}
    >
      {icon}
      {value}{unit}
    </Badge>
  )
}

// ── View Details Dialog ───────────────────────────────────────────────────────
function VitalCard({ label, value, unit, abnormal }) {
  return (
    <div className={`rounded border p-2 ${abnormal ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-sm font-semibold ${abnormal ? 'text-red-600' : 'text-gray-800'}`}>
        {value != null ? `${value} ${unit}` : '—'}
      </div>
    </div>
  )
}

function ViewDetailsDialog({ screening, onClose, onEdit, orgInfo = {} }) {
  if (!screening) return null
  const s = screening
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-blue-600" /> Pre-Triage Details
        </DialogTitle>
        <DialogDescription className="sr-only">Screening details</DialogDescription>

        <div className="space-y-4 text-sm">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div>
              <span className="text-gray-500">Screening No: </span>
              <span className="font-semibold text-blue-600">{s.screeningNumber}</span>
            </div>
            <div>
              <span className="text-gray-500">Screened at: </span>
              <span className="font-semibold">
                {s.screenedAt ? format(new Date(s.screenedAt), 'dd MMM yyyy, HH:mm') : '—'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Name: </span>
              <span className="font-semibold">{s.firstName} {s.lastName}</span>
            </div>
            <div>
              <span className="text-gray-500">Age / Gender: </span>
              <span className="font-semibold">{s.age ?? '—'}y / {s.gender || '—'}</span>
            </div>
            {s.phone && (
              <div>
                <span className="text-gray-500">Phone: </span>
                <span className="font-semibold">{s.phone}</span>
              </div>
            )}
            <div>
              <span className="text-gray-500">Chief Complaint: </span>
              <span className="font-semibold">{s.chiefComplaint}</span>
            </div>
          </div>

          {/* Vitals */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Vital Signs</p>
            <div className="grid grid-cols-3 gap-2">
              <VitalCard label="Temperature"  value={cToF(s.temperature)}    unit="°F"   abnormal={isAbnormalTemp(s.temperature)} />
              <VitalCard label="Pulse Rate"   value={s.pulseRate}            unit="bpm"  abnormal={isAbnormalPulse(s.pulseRate)} />
              <VitalCard label="SpO₂"         value={s.spo2}                 unit="%"    abnormal={isAbnormalSpo2(s.spo2)} />
              <VitalCard label="Resp. Rate"   value={s.respiratoryRate}      unit="/min" abnormal={isAbnormalResp(s.respiratoryRate)} />
              <VitalCard label="BP Systolic"  value={s.bloodPressureSystolic}  unit="mmHg" abnormal={false} />
              <VitalCard label="BP Diastolic" value={s.bloodPressureDiastolic} unit="mmHg" abnormal={false} />
            </div>
          </div>

          {/* Anthropometric */}
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Anthropometric</p>
              <div className="space-y-0.5">
                <div className="flex justify-between"><span className="text-gray-500">Weight</span><span className="font-medium">{s.weight != null ? `${s.weight} kg` : '—'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Height</span><span className="font-medium">{s.height != null ? `${s.height} cm` : '—'}</span></div>
                <div className="flex justify-between">
                  <span className="text-gray-500">BMI</span>
                  <span className={`font-semibold ${s.bmi ? getBmiCategory(s.bmi).color : ''}`}>
                    {s.bmi ?? '—'}
                  </span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Blood Sugar</p>
              <div className="space-y-0.5">
                <div className="flex justify-between"><span className="text-gray-500">FBS</span><span className="font-medium">{s.fbs != null ? `${s.fbs} mg/dL` : '—'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">PPBS</span><span className="font-medium">{s.ppbs != null ? `${s.ppbs} mg/dL` : '—'}</span></div>
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-3">
            <span className="text-gray-500">Status:</span>
            <Badge className={
              s.status === 'screening' ? 'bg-blue-100 text-blue-800 border-0' :
              s.status === 'routed' ? 'bg-orange-100 text-orange-800 border-0' :
              'bg-green-100 text-green-800 border-0'
            }>
              {s.status === 'screening' ? 'Pending' : s.status === 'routed' ? 'Routed' : 'Registered'}
            </Badge>
            {s.routedTo && (
              <span className="text-gray-600">Routed to: <strong>{formatRoutedTo(s.routedTo)}</strong></span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="outline" onClick={() => printSlip(s, orgInfo)}>
            <Printer className="h-4 w-4 mr-2" /> Print Slip
          </Button>
          <Button variant="outline" onClick={() => { onClose(); onEdit(s) }}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
const FILTERS = [
  { key: 'all',        label: 'All' },
  { key: 'pending',    label: 'Pending' },
  { key: 'routed',     label: 'Routed' },
  { key: 'registered', label: 'Registered' },
]

const STATUS_DB_MAP = {
  pending:    'screening',
  routed:     'routed',
  registered: 'registered_as_patient',
}

export default function PreTriageModule() {
  const [screenings,      setScreenings]      = useState([])
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)
  const [searchQuery,     setSearchQuery]     = useState('')
  const [activeFilter,    setActiveFilter]    = useState('all')
  const dateFilter = useDateFilter()
  const [currentPage,     setCurrentPage]     = useState(1)
  const ITEMS_PER_PAGE = 10
  const [showFormDialog,  setShowFormDialog]  = useState(false)
  const [editingScreening, setEditingScreening] = useState(null)
  const [viewScreening,   setViewScreening]   = useState(null)
  const [isSubmitting,    setIsSubmitting]    = useState(false)
  const [selectedPatient, setSelectedPatient] = useState(null)

  const form = useForm({
    resolver: zodResolver(screeningSchema),
    defaultValues: {
      patientId: '', firstName: '', lastName: '', age: null, gender: 'male', phone: '',
      chiefComplaint: '', briefHistory: '',
      temperature: null, bloodPressureSystolic: null, bloodPressureDiastolic: null,
      pulseRate: null, respiratoryRate: null, spo2: null,
      weight: null, height: null, bmi: null, fbs: null, ppbs: null,
      routedTo: 'adult_triage',
    },
  })

  // Auto-calculate BMI
  const watchedWeight = useWatch({ control: form.control, name: 'weight' })
  const watchedHeight = useWatch({ control: form.control, name: 'height' })
  useEffect(() => {
    if (watchedWeight && watchedHeight && watchedHeight > 0) {
      const hM = watchedHeight / 100
      form.setValue('bmi', parseFloat((watchedWeight / (hM * hM)).toFixed(1)))
    } else {
      form.setValue('bmi', null)
    }
  }, [watchedWeight, watchedHeight, form])
  useEffect(() => { getOrgSettings().then(setOrgInfo) }, [])

  const fetchScreenings = async () => {
    try {
      setLoading(true)
      setError(null)
      // Pass limit=500 to ensure ALL records are fetched (backend default is limit=50)
      const res = await client.get('/pre-triage?limit=500&offset=0')
      setScreenings(res.data ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchScreenings() }, [])

  useEffect(() => { setCurrentPage(1) }, [searchQuery, activeFilter, dateFilter.key])

  const stats = useMemo(() => ({
    total:      screenings.length,
    pending:    screenings.filter(s => (s.status || '').toLowerCase() === 'screening').length,
    routed:     screenings.filter(s => (s.status || '').toLowerCase() === 'routed').length,
    registered: screenings.filter(s => (s.status || '').toLowerCase() === 'registered_as_patient').length,
  }), [screenings])

  const filteredScreenings = useMemo(() => {
    let list = screenings
    if (activeFilter !== 'all') {
      const dbStatus = STATUS_DB_MAP[activeFilter]
      list = list.filter(s => (s.status || '').toLowerCase() === dbStatus)
    }
    if (searchQuery) {
      const lower = searchQuery.toLowerCase()
      list = list.filter(s =>
        (s.screeningNumber || '').toLowerCase().includes(lower) ||
        (s.firstName || '').toLowerCase().includes(lower) ||
        (s.lastName || '').toLowerCase().includes(lower) ||
        (s.phone || '').includes(lower) ||
        (s.patient?.mrn || '').toLowerCase().includes(lower)
      )
    }
    list = list.filter(s => dateFilter.matches(s.createdAt))
    return list
  }, [screenings, activeFilter, searchQuery, dateFilter.key])

  // ── Patient lookup helpers ──────────────────────────────────────────────────
  const fillFromPatient = (patient) => {
    setSelectedPatient(patient)
    form.setValue('patientId',  patient.id)
    form.setValue('firstName',  patient.firstName || '')
    form.setValue('lastName',   patient.lastName || '')
    form.setValue('age',        calculatePatientAge(patient.dateOfBirth))
    form.setValue('gender',     patient.gender || 'male')
    form.setValue('phone',      patient.phonePrimary || '')
  }

  const clearPatient = () => {
    setSelectedPatient(null)
    form.setValue('patientId', '')
    form.setValue('firstName', '')
    form.setValue('lastName', '')
    form.setValue('age', null)
    form.setValue('gender', 'male')
    form.setValue('phone', '')
  }

  // ── Open / close form dialog ────────────────────────────────────────────────
  const openNewDialog = () => {
    setEditingScreening(null)
    clearPatient()
    form.reset()
    setShowFormDialog(true)
  }

  const openEditDialog = (s) => {
    setEditingScreening(s)
    setSelectedPatient(null)
    form.reset({
      patientId: s.patientId || '',
      firstName: s.firstName || '', lastName: s.lastName || '',
      age: s.age, gender: s.gender || 'male', phone: s.phone || '',
      chiefComplaint: s.chiefComplaint || '', briefHistory: s.briefHistory || '',
      temperature: cToF(s.temperature), bloodPressureSystolic: s.bloodPressureSystolic,
      bloodPressureDiastolic: s.bloodPressureDiastolic, pulseRate: s.pulseRate,
      respiratoryRate: s.respiratoryRate, spo2: s.spo2,
      weight: s.weight, height: s.height, bmi: s.bmi, fbs: s.fbs, ppbs: s.ppbs,
      routedTo: s.routedTo || 'adult_triage',
    })
    setShowFormDialog(true)
  }

  const closeFormDialog = () => {
    setShowFormDialog(false)
    setEditingScreening(null)
    clearPatient()
    form.reset()
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  const onSubmit = async (data) => {
    try {
      setIsSubmitting(true)
      const payload = { ...data }
      if (data.temperature != null && data.temperature !== '') payload.temperature = fToC(data.temperature) // typed °F → store °C
      if (selectedPatient) payload.patientId = selectedPatient.id

      if (editingScreening) {
        await client.patch(`/pre-triage/${editingScreening.id}`, payload)
        toast.success('Screening updated successfully')
      } else {
        await client.post('/pre-triage', payload)
        toast.success('Screening recorded successfully')
      }
      closeFormDialog()
      fetchScreenings()
    } catch {
      toast.error(editingScreening ? 'Failed to update screening' : 'Failed to record screening')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleConvert = async (id) => {
    try {
      const res = await client.post(`/pre-triage/${id}/convert`)
      toast.success(`Converted to patient. UHID: ${res.data.mrn}`)
      fetchScreenings()
    } catch {
      toast.error('Failed to convert to patient')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center p-12">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
    </div>
  )

  if (error) return (
    <Card className="border-red-200 bg-red-50">
      <CardContent className="flex flex-col items-center p-6 text-center">
        <AlertTriangle className="h-12 w-12 text-red-500 mb-4" />
        <h3 className="text-lg font-semibold text-red-700">Failed to Load Screenings</h3>
        <p className="text-red-600 mb-4">{error}</p>
        <Button onClick={fetchScreenings} variant="outline" className="border-red-300">
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="h-8 w-8 text-blue-600" />
            Pre-Triage Screening
          </h1>
          <p className="text-gray-500">Rapid assessment and routing for incoming patients</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchScreenings}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button onClick={openNewDialog}>
            <Plus className="mr-2 h-4 w-4" /> New Screening
          </Button>
        </div>
      </div>

      {/* Stats — click to filter */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card
          onClick={() => setActiveFilter('all')}
          className={`cursor-pointer transition-all hover:shadow-md ${activeFilter === 'all' ? 'ring-2 ring-gray-400' : ''}`}
        >
          <CardHeader className="py-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Total Today</CardTitle>
            <History className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent>
        </Card>

        <Card
          onClick={() => setActiveFilter('pending')}
          className={`border-l-4 border-l-blue-500 cursor-pointer transition-all hover:shadow-md ${activeFilter === 'pending' ? 'ring-2 ring-blue-400' : ''}`}
        >
          <CardHeader className="py-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Pending Routing</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.pending}</div></CardContent>
        </Card>

        <Card
          onClick={() => setActiveFilter('routed')}
          className={`border-l-4 border-l-orange-500 cursor-pointer transition-all hover:shadow-md ${activeFilter === 'routed' ? 'ring-2 ring-orange-400' : ''}`}
        >
          <CardHeader className="py-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Routed to Triage</CardTitle>
            <ArrowRight className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.routed}</div></CardContent>
        </Card>

        <Card
          onClick={() => setActiveFilter('registered')}
          className={`border-l-4 border-l-green-500 cursor-pointer transition-all hover:shadow-md ${activeFilter === 'registered' ? 'ring-2 ring-green-400' : ''}`}
        >
          <CardHeader className="py-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Registered Patients</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.registered}</div></CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>Screenings</CardTitle>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Filter tabs with live counts */}
              <div className="flex rounded-md border overflow-hidden">
                <button
                  onClick={() => setActiveFilter('all')}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    activeFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  All
                  <span className={`text-xs rounded-full px-1.5 py-0 ${
                    activeFilter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>{stats.total}</span>
                </button>
                <button
                  onClick={() => setActiveFilter('pending')}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    activeFilter === 'pending' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Pending
                  <span className={`text-xs rounded-full px-1.5 py-0 ${
                    activeFilter === 'pending' ? 'bg-blue-500 text-white' : 'bg-blue-100 text-blue-700'
                  }`}>{stats.pending}</span>
                </button>
                <button
                  onClick={() => setActiveFilter('routed')}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    activeFilter === 'routed' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Routed
                  <span className={`text-xs rounded-full px-1.5 py-0 ${
                    activeFilter === 'routed' ? 'bg-blue-500 text-white' : 'bg-orange-100 text-orange-700'
                  }`}>{stats.routed}</span>
                </button>
                <button
                  onClick={() => setActiveFilter('registered')}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    activeFilter === 'registered' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Registered
                  <span className={`text-xs rounded-full px-1.5 py-0 ${
                    activeFilter === 'registered' ? 'bg-blue-500 text-white' : 'bg-green-100 text-green-700'
                  }`}>{stats.registered}</span>
                </button>
              </div>
              {/* Search */}
              <div className="relative w-64">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  placeholder="Search name, UHID, phone..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {dateFilter.control}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Screening #</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Age/Gender</TableHead>
                <TableHead>Complaint</TableHead>
                <TableHead>Vitals</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredScreenings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                    No screenings found
                  </TableCell>
                </TableRow>
              ) : (() => {
                const totalPages = Math.ceil(filteredScreenings.length / ITEMS_PER_PAGE)
                const startIdx = (currentPage - 1) * ITEMS_PER_PAGE
                const endIdx = startIdx + ITEMS_PER_PAGE
                const paginatedScreenings = filteredScreenings.slice(startIdx, endIdx)
                return paginatedScreenings.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.screeningNumber}</TableCell>
                    <TableCell>
                      <div>{s.firstName} {s.lastName}</div>
                      {s.patient?.mrn && <div className="text-xs font-mono text-gray-500">UHID: {s.patient.mrn}</div>}
                      {s.phone && <div className="text-xs text-gray-400">{s.phone}</div>}
                    </TableCell>
                    <TableCell>{s.age ?? '—'}y / {s.gender}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{s.chiefComplaint}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <VitalBadge
                          icon={<Thermometer className="h-3 w-3 mr-0.5" />}
                          value={cToF(s.temperature)} unit="°F"
                          abnormal={isAbnormalTemp(s.temperature)}
                        />
                        {(s.bloodPressureSystolic || s.bloodPressureDiastolic) && (
                          <Badge variant="outline" className="text-xs font-normal">
                            {s.bloodPressureSystolic}/{s.bloodPressureDiastolic} mmHg
                          </Badge>
                        )}
                        <VitalBadge
                          value={s.spo2} unit="%" icon={<span className="text-[10px] mr-0.5">SpO₂</span>}
                          abnormal={isAbnormalSpo2(s.spo2)}
                        />
                        <VitalBadge
                          value={s.pulseRate} unit=" bpm" icon={null}
                          abnormal={isAbnormalPulse(s.pulseRate)}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={
                        s.status === 'screening'             ? 'bg-blue-100 text-blue-800 border-0' :
                        s.status === 'routed'                ? 'bg-orange-100 text-orange-800 border-0' :
                        'bg-green-100 text-green-800 border-0'
                      }>
                        {s.status === 'screening' ? 'Pending' : s.status === 'routed' ? 'Routed' : 'Registered'}
                      </Badge>
                      {s.routedTo && (
                        <div className="text-xs text-gray-500 mt-0.5">{formatRoutedTo(s.routedTo)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon" variant="ghost"
                          className="h-8 w-8 text-gray-500 hover:text-blue-600"
                          onClick={() => setViewScreening(s)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          className="h-8 w-8 text-gray-500 hover:text-gray-800"
                          onClick={() => openEditDialog(s)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {s.status === 'screening' && (
                          <Button
                            size="sm" variant="outline"
                            onClick={() => handleConvert(s.id)}
                            className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100 ml-1"
                          >
                            <UserPlus className="h-4 w-4 mr-1" /> Convert
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              })()}
            </TableBody>
          </Table>
          {filteredScreenings.length > ITEMS_PER_PAGE && (() => {
            const totalPages = Math.ceil(filteredScreenings.length / ITEMS_PER_PAGE)
            return (
              <div className="flex items-center justify-end gap-2 p-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />Previous
                </Button>
                <span className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next<ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* View Details Dialog */}
      <ViewDetailsDialog
        screening={viewScreening}
        onClose={() => setViewScreening(null)}
        onEdit={openEditDialog}
        orgInfo={orgInfo}
      />

      {/* New / Edit Screening Dialog */}
      <Dialog open={showFormDialog} onOpenChange={(open) => { if (!open) closeFormDialog() }}>
        <DialogContent className="max-w-2xl flex flex-col p-0" style={{ maxHeight: '92vh' }}>
          <div className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="text-lg font-bold">
              {editingScreening ? 'Edit Screening' : 'Record New Pre-Triage Screening'}
            </DialogTitle>
            <DialogDescription>
              {editingScreening
                ? `Editing: ${editingScreening.screeningNumber}`
                : 'Quick assessment for routing patients to appropriate triage sections.'}
            </DialogDescription>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4" style={{ minHeight: 0 }}>
            <Form {...form}>
              <form id="screening-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {!editingScreening && (
                  <PatientLookup
                    selectedPatient={selectedPatient}
                    onSelect={fillFromPatient}
                    onClear={clearPatient}
                    placeholder="Search registered patient by UHID, name, or phone..."
                  />
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="firstName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name {selectedPatient ? '(from record)' : ''}</FormLabel>
                      <FormControl>
                        <Input {...field} readOnly={!!selectedPatient} className={selectedPatient ? 'bg-gray-50' : ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="lastName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name {selectedPatient ? '(from record)' : ''}</FormLabel>
                      <FormControl>
                        <Input {...field} readOnly={!!selectedPatient} className={selectedPatient ? 'bg-gray-50' : ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <FormField control={form.control} name="age" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Age (Years)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} value={field.value ?? ''} readOnly={!!selectedPatient} className={selectedPatient ? 'bg-gray-50' : ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="gender" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gender</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={!!selectedPatient}>
                        <FormControl><SelectTrigger className={selectedPatient ? 'bg-gray-50' : ''}><SelectValue placeholder="Gender" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input {...field} readOnly={!!selectedPatient} className={selectedPatient ? 'bg-gray-50' : ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {selectedPatient && (
                  <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded px-3 py-2">
                    Registered patient: <strong>{getPatientFullName(selectedPatient)}</strong> (UHID: {selectedPatient.mrn})
                  </p>
                )}

                <FormField control={form.control} name="chiefComplaint" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chief Complaint *</FormLabel>
                    <FormControl><Input placeholder="Main reason for visit" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Vital Signs */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-3 bg-red-500 rounded" />
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Vital Signs</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { name: 'temperature',          label: 'Temp (°F)',       placeholder: '98.6', step: '0.1' },
                      { name: 'bloodPressureSystolic', label: 'BP Systolic',    placeholder: '120' },
                      { name: 'bloodPressureDiastolic',label: 'BP Diastolic',   placeholder: '80' },
                      { name: 'pulseRate',             label: 'Pulse (bpm)',    placeholder: '72' },
                      { name: 'respiratoryRate',       label: 'Resp. Rate (/min)', placeholder: '16' },
                      { name: 'spo2',                  label: 'SpO₂ (%)',       placeholder: '98', step: '0.1' },
                    ].map(({ name, label, placeholder, step }) => (
                      <FormField key={name} control={form.control} name={name} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">{label}</FormLabel>
                          <FormControl><Input type="number" step={step || '1'} placeholder={placeholder} {...field} value={field.value ?? ''} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    ))}
                  </div>
                </div>

                {/* Anthropometric */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-3 bg-blue-500 rounded" />
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Anthropometric</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={form.control} name="weight" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Weight (kg)</FormLabel>
                        <FormControl><Input type="number" step="0.1" min="0" placeholder="70.0" {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="height" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Height (cm)</FormLabel>
                        <FormControl><Input type="number" step="0.1" min="0" placeholder="170" {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="bmi" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">BMI (auto)</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input type="number" step="0.1" readOnly placeholder="—"
                              className="bg-gray-50 text-gray-700 font-semibold"
                              {...field} value={field.value ?? ''} />
                            {field.value && (
                              <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold ${getBmiCategory(field.value).color}`}>
                                {getBmiCategory(field.value).label}
                              </span>
                            )}
                          </div>
                        </FormControl>
                      </FormItem>
                    )} />
                  </div>
                </div>

                {/* Blood Sugar */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-3 bg-orange-500 rounded" />
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Blood Sugar</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="fbs" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">FBS — Fasting Blood Sugar (mg/dL)</FormLabel>
                        <FormControl><Input type="number" step="0.1" min="0" placeholder="90" {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="ppbs" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">PPBS — Post-Prandial Blood Sugar (mg/dL)</FormLabel>
                        <FormControl><Input type="number" step="0.1" min="0" placeholder="120" {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                {/* Route To */}
                <FormField control={form.control} name="routedTo" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Route To</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select Triage Area" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="adult_triage">Adult Triage</SelectItem>
                        <SelectItem value="pediatric_triage">Pediatric Triage</SelectItem>
                        <SelectItem value="mch_triage">MCH Triage</SelectItem>
                        <SelectItem value="emergency_triage">Emergency Triage</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </form>
            </Form>
          </div>
          <div className="px-6 py-3 border-t shrink-0 flex justify-end gap-2 bg-gray-50">
            <Button type="button" variant="outline" onClick={closeFormDialog}>Cancel</Button>
            <Button type="submit" form="screening-form" disabled={isSubmitting}>
              {isSubmitting
                ? (editingScreening ? 'Updating...' : 'Recording...')
                : (editingScreening ? 'Update Screening' : 'Record Screening')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
