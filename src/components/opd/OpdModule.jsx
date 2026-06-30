// OPD Prescription module — premium two-column outpatient prescription.
// Left: clean form (Department -> Problem -> suggested test/medicine chips, vitals,
// diagnosis, Rx, tests, advice). Right: a sticky LIVE prescription preview that
// updates as the doctor types. Full doctor CRUD on the /consultations API.
import { useState, useEffect, useCallback } from 'react'
import { getOrgSettings } from '@/lib/orgSettings'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Activity, Heart, Thermometer, Droplet, Scale,
  Plus, Save, Printer, Stethoscope, ClipboardList, BookOpen,
  Pill, AlertTriangle, User, Loader2, RefreshCw, Check, Sparkles,
  FlaskConical, Scan, ArrowLeft, Eye, Edit, Search, Trash2,
  ChevronLeft, ChevronRight, X, CalendarClock, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import client from '@/api/client'
import { drName, cToF, fToC } from '@/lib/utils'
import PatientLookup from '@/components/common/PatientLookup'
import { printPrescription } from './utils/printOpd'
const vitalsSchema = z.object({
  temperature: z.number().min(86).max(113).optional(),
  bloodPressureSystolic: z.number().min(60).max(250).optional(),
  bloodPressureDiastolic: z.number().min(40).max(150).optional(),
  pulseRate: z.number().min(30).max(200).optional(),
  oxygenSaturation: z.number().min(50).max(100).optional(),
  weight: z.number().min(0.5).max(300).optional(),
})

const clinicalSchema = z.object({
  chiefComplaint: z.string().min(3, 'Chief complaint required'),
  diagnosis: z.string().min(3, 'Diagnosis required'),
  icd10Code: z.string().optional(),
  advice: z.string().optional(),
  followUpDate: z.string().optional(),
})

const DEFAULT_VITALS = {
  temperature: 98.6, bloodPressureSystolic: 120, bloodPressureDiastolic: 80,
  pulseRate: 72, oxygenSaturation: 98, weight: 70,
}

const getFullName = (p) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')
const getAge = (dob) => {
  const d = new Date(dob), t = new Date()
  let a = t.getFullYear() - d.getFullYear()
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--
  return a
}
const initials = (name) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')


function GuidanceField({ label, value }) {
  if (!value || /not specified/i.test(value)) return null
  return (
    <div className="mb-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-600 mb-1">{label}</p>
      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{value}</p>
    </div>
  )
}

// Consistent premium section card.
function Section({ icon, title, desc, accent = 'cyan', children, right }) {
  const ring = {
    cyan: 'bg-[#2E4168]/10 text-[#2E4168]', green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700', violet: 'bg-violet-100 text-violet-700',
    amber: 'bg-amber-100 text-amber-700',
  }[accent]
  return (
    <Card className="rounded-2xl border-slate-200/70 shadow-sm overflow-hidden">
      <CardHeader className="py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${ring}`}>{icon}</span>
            <div>
              <CardTitle className="text-base leading-tight">{title}</CardTitle>
              {desc && <CardDescription className="text-xs">{desc}</CardDescription>}
            </div>
          </div>
          {right}
        </div>
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  )
}

const ITEMS_PER_PAGE = 15

export default function OpdModule() {
  const [view, setView] = useState('list')
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital' })
  const [editingId, setEditingId] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [filterSearch, setFilterSearch] = useState('')
  const [filterDoctor, setFilterDoctor] = useState('all')
  const [filterDate, setFilterDate] = useState('all')
  const [specificDate, setSpecificDate] = useState('')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [selectedDoctorId, setSelectedDoctorId] = useState('')
  const [prescriptionItems, setPrescriptionItems] = useState([])
  const [selectedDrug, setSelectedDrug] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showPatientDialog, setShowPatientDialog] = useState(false)
  const [labOrderItems, setLabOrderItems] = useState([])
  const [radiologyOrderItems, setRadiologyOrderItems] = useState([])
  const [selectedLabTest, setSelectedLabTest] = useState('')
  const [selectedRadExam, setSelectedRadExam] = useState('')

  const [specialties, setSpecialties] = useState([])
  const [department, setDepartment] = useState('')
  const [conditions, setConditions] = useState([])
  const [problem, setProblem] = useState('')
  const [guidance, setGuidance] = useState(null)
  const [guidanceLoading, setGuidanceLoading] = useState(false)
  const [guidanceOpen, setGuidanceOpen] = useState(false)

  const [patients, setPatients] = useState([])
  const [doctors, setDoctors] = useState([])
  const [drugs, setDrugs] = useState([])
  const [labTests, setLabTests] = useState([])
  const [radiologyExams, setRadiologyExams] = useState([])
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading] = useState(true)

  const vitalsForm = useForm({ resolver: zodResolver(vitalsSchema), defaultValues: DEFAULT_VITALS })
  const clinicalForm = useForm({
    resolver: zodResolver(clinicalSchema),
    defaultValues: { chiefComplaint: '', diagnosis: '', icd10Code: '', advice: '', followUpDate: '' },
  })

  // Live values for the right-hand prescription preview.
  const wDiagnosis = clinicalForm.watch('diagnosis')
  const wComplaint = clinicalForm.watch('chiefComplaint')
  const wIcd = clinicalForm.watch('icd10Code')
  const wAdvice = clinicalForm.watch('advice')
  const wFollow = clinicalForm.watch('followUpDate')
  const vw = vitalsForm.watch()

  const selectedPatient = patients.find(p => p.id === selectedPatientId)
  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [cRes, pRes, uRes, dRes, lRes, rRes, sRes] = await Promise.allSettled([
      client.get('/consultations'),
      client.get('/patients?status=active&limit=500'),
      client.get('/settings?resource=users'),
      client.get('/pharmacy/drugs?limit=5000'),
      client.get('/laboratory?resource=tests&limit=1000'),
      client.get('/radiology?resource=exams&limit=1000'),
      client.get('/clinical-kb/specialties'),
    ])
    if (cRes.status === 'fulfilled') setConsultations(cRes.value?.data ?? [])
    if (pRes.status === 'fulfilled') setPatients(pRes.value?.data ?? [])
    if (uRes.status === 'fulfilled') setDoctors((uRes.value?.data ?? []).filter(u => u.role === 'doctor' && u.isActive))
    if (dRes.status === 'fulfilled') setDrugs(dRes.value?.data ?? [])
    if (lRes.status === 'fulfilled') setLabTests((lRes.value?.data ?? []).filter(t => t.isActive !== false))
    if (rRes.status === 'fulfilled') setRadiologyExams((rRes.value?.data ?? []).filter(e => e.isActive !== false))
    if (sRes.status === 'fulfilled') setSpecialties(sRes.value?.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  useEffect(() => {
    const loadOrgSettings = async () => {
      try {
        const settings = await getOrgSettings()
        setOrgInfo(settings)
      } catch (err) {
        console.error('Failed to load organization settings:', err)
      }
    }

    loadOrgSettings()
  }, [])

  const onDepartmentChange = async (dept) => {
    setDepartment(dept); setProblem(''); setGuidance(null); setConditions([])
    if (!dept) return
    try {
      const res = await client.get(`/clinical-kb?specialty=${encodeURIComponent(dept)}`)
      setConditions(res?.data ?? [])
    } catch { setConditions([]) }
  }

  const onProblemChange = async (cond) => {
    setProblem(cond)
    if (!cond) { setGuidance(null); return }
    setGuidanceLoading(true)
    try {
      const res = await client.get(`/clinical-kb/condition?specialty=${encodeURIComponent(department)}&condition=${encodeURIComponent(cond)}`)
      const g = res?.data || null
      setGuidance(g)
      setGuidanceOpen(false)
      if (g) {
        clinicalForm.setValue('diagnosis', g.condition || cond)
        if (g.icd10 && !/not specified/i.test(g.icd10)) clinicalForm.setValue('icd10Code', g.icd10)
        if (!clinicalForm.getValues('chiefComplaint')) clinicalForm.setValue('chiefComplaint', g.condition || cond)
        toast.success('Diagnosis filled — tap suggested tests / medicines')
      }
    } catch {
      toast.error('Could not load this condition')
    } finally {
      setGuidanceLoading(false)
    }
  }

  const filteredConsultations = consultations.filter(c => {
    const name = c.patient ? getFullName(c.patient).toLowerCase() : ''
    const q = filterSearch.toLowerCase()
    const matchSearch = !filterSearch || name.includes(q) || (c.patient?.mrn || '').toLowerCase().includes(q) || (c.diagnosis || '').toLowerCase().includes(q)
    const matchDoctor = filterDoctor === 'all' || c.doctorId === filterDoctor
    let matchDate = true
    if (filterDate !== 'all') {
      const cDate = new Date(c.visitDate)
      const today = new Date()
      if (filterDate === 'today') {
        matchDate = cDate.toDateString() === today.toDateString()
      } else if (filterDate === 'week') {
        matchDate = (today.getTime() - cDate.getTime()) < 7 * 86400000
      } else if (filterDate === 'month') {
        matchDate = cDate.getMonth() === today.getMonth() && cDate.getFullYear() === today.getFullYear()
      } else if (filterDate === 'specific' && specificDate) {
        matchDate = cDate.toDateString() === new Date(specificDate).toDateString()
      } else if (filterDate === 'custom') {
        const dStr = cDate.toISOString().split('T')[0]
        if (customStart && dStr < customStart) matchDate = false
        if (customEnd && dStr > customEnd) matchDate = false
      }
    }
    return matchSearch && matchDoctor && matchDate
  })
  useEffect(() => { setCurrentPage(1) }, [filterSearch, filterDoctor, filterDate, specificDate, customStart, customEnd])

  const addDrug = () => {
    const drug = drugs.find(d => d.id === selectedDrug)
    if (!drug) return
    if (prescriptionItems.some(i => i.drugId === drug.id)) { toast.error('Already added'); return }
    setPrescriptionItems(prev => [...prev, { drugId: drug.id, drugName: drug.drugName, genericName: drug.genericName, dosage: '', frequency: 'TID', duration: '7 days', quantity: 21, instructions: '' }])
    setSelectedDrug('')
  }
  const addSuggestedDrug = (name) => {
    if (prescriptionItems.some(i => (i.drugName || '').toLowerCase() === name.toLowerCase())) return
    const match = drugs.find(d => d.drugName?.toLowerCase() === name.toLowerCase() || (d.genericName || '').toLowerCase() === name.toLowerCase())
    setPrescriptionItems(prev => [...prev, match
      ? { drugId: match.id, drugName: match.drugName, genericName: match.genericName, dosage: '', frequency: 'TID', duration: '7 days', quantity: 21, instructions: '' }
      : { drugId: `kb-${slug(name)}`, drugName: name, genericName: '', dosage: '', frequency: 'TID', duration: '7 days', quantity: 21, instructions: '' }])
  }
  const removeDrug = (i) => setPrescriptionItems(p => p.filter((_, idx) => idx !== i))
  const updateItem = (i, field, value) => setPrescriptionItems(p => p.map((item, idx) => idx === i ? { ...item, [field]: value } : item))

  const addLabTest = () => {
    const test = labTests.find(t => t.id === selectedLabTest)
    if (!test) return
    if (labOrderItems.some(i => i.testId === test.id)) { toast.error('Already added'); return }
    setLabOrderItems(prev => [...prev, { testId: test.id, testName: test.testName, testCode: test.testCode || '', urgency: 'routine', specimenType: test.specimenType || '' }])
    setSelectedLabTest('')
  }
  const addSuggestedTest = (name) => {
    if (labOrderItems.some(i => (i.testName || '').toLowerCase() === name.toLowerCase())) return
    const match = labTests.find(t => t.testName?.toLowerCase() === name.toLowerCase())
    setLabOrderItems(prev => [...prev, match
      ? { testId: match.id, testName: match.testName, testCode: match.testCode || '', urgency: 'routine', specimenType: match.specimenType || '' }
      : { testId: `kb-${slug(name)}`, testName: name, testCode: '', urgency: 'routine', specimenType: '' }])
  }
  const removeLabItem = (testId) => setLabOrderItems(prev => prev.filter(i => i.testId !== testId))

  const addRadExam = () => {
    const exam = radiologyExams.find(e => e.id === selectedRadExam)
    if (!exam) return
    if (radiologyOrderItems.some(i => i.examId === exam.id)) { toast.error('Already added'); return }
    setRadiologyOrderItems(prev => [...prev, { examId: exam.id, examName: exam.examName, examCode: exam.examCode || '', examCategory: exam.examCategory || '', urgency: 'routine', bodyPart: exam.bodyPart || '' }])
    setSelectedRadExam('')
  }
  const removeRadItem = (examId) => setRadiologyOrderItems(prev => prev.filter(i => i.examId !== examId))

  const isTestAdded = (name) => labOrderItems.some(i => (i.testName || '').toLowerCase() === name.toLowerCase())
  const isDrugAdded = (name) => prescriptionItems.some(i => (i.drugName || '').toLowerCase() === name.toLowerCase())

  const resetForm = () => {
    vitalsForm.reset(DEFAULT_VITALS)
    clinicalForm.reset()
    setPrescriptionItems([]); setLabOrderItems([]); setRadiologyOrderItems([])
    setSelectedLabTest(''); setSelectedRadExam('')
    setSelectedPatientId(''); setSelectedDoctorId(''); setEditingId(null)
    setDepartment(''); setProblem(''); setConditions([]); setGuidance(null)
  }

  const openEdit = (c) => {
    setEditingId(c.id)
    setSelectedPatientId(c.patientId)
    setSelectedDoctorId(c.doctorId)
    setDepartment(''); setProblem(''); setConditions([]); setGuidance(null)

    if (c.prescriptions && c.prescriptions.length > 0) {
      try { setPrescriptionItems(JSON.parse(c.prescriptions[0].items)) } catch { setPrescriptionItems([]) }
    } else setPrescriptionItems([])
    if (c.labOrders && c.labOrders.length > 0) {
      try { setLabOrderItems(JSON.parse(c.labOrders[0].tests)) } catch { setLabOrderItems([]) }
    } else setLabOrderItems([])
    if (c.radiologyOrders && c.radiologyOrders.length > 0) {
      const items = []
      c.radiologyOrders.forEach(order => {
        const exam = order.exam || radiologyExams.find(e => e.id === order.examId)
        if (exam) items.push({ examId: exam.id || order.examId, examName: exam.examName, examCode: exam.examCode || '', examCategory: exam.examCategory || '', urgency: order.urgency || 'routine', bodyPart: exam.bodyPart || '' })
      })
      setRadiologyOrderItems(items)
    } else setRadiologyOrderItems([])

    vitalsForm.reset({
      temperature: cToF(c.temperature) ?? undefined,
      bloodPressureSystolic: c.bloodPressureSystolic ?? undefined,
      bloodPressureDiastolic: c.bloodPressureDiastolic ?? undefined,
      pulseRate: c.pulseRate ?? undefined,
      oxygenSaturation: c.oxygenSaturation ?? undefined,
      weight: c.weight ?? undefined,
    })
    clinicalForm.reset({
      chiefComplaint: c.chiefComplaint || '',
      diagnosis: c.diagnosis || '',
      icd10Code: (() => { try { const a = JSON.parse(c.icd10Codes || '[]'); return Array.isArray(a) ? a[0] || '' : '' } catch { return '' } })(),
      advice: c.notes || '',
      followUpDate: c.followUpDate ? format(new Date(c.followUpDate), 'yyyy-MM-dd') : '',
    })
    setView('form')
  }

  const saveConsultation = async () => {
    if (!selectedPatientId) { toast.error('Please select a patient'); return }
    if (!selectedDoctorId) { toast.error('Please select an attending doctor'); return }
    const clinical = clinicalForm.getValues()
    const vitals = vitalsForm.getValues()
    if (!clinical.chiefComplaint || !clinical.diagnosis) {
      toast.error('Please fill in chief complaint and diagnosis')
      return
    }
    setIsSaving(true)
    try {
      const payload = {
        patientId: selectedPatientId,
        doctorId: selectedDoctorId,
        visitType: 'outpatient',
        ...vitals,
        temperature: fToC(vitals.temperature) ?? undefined,
        chiefComplaint: clinical.chiefComplaint,
        diagnosis: clinical.diagnosis,
        icd10Codes: clinical.icd10Code ? [clinical.icd10Code] : [],
        followUpDate: clinical.followUpDate || undefined,
        notes: clinical.advice,
        prescriptionItems: prescriptionItems.length > 0 ? prescriptionItems : undefined,
        labTests: labOrderItems.length > 0 ? labOrderItems : undefined,
        radiologyExams: radiologyOrderItems.length > 0 ? radiologyOrderItems : undefined,
      }
      if (editingId) {
        await client.patch(`/consultations/${editingId}`, payload)
        toast.success('OPD prescription updated')
      } else {
        await client.post('/consultations', payload)
        toast.success('OPD prescription saved')
      }
      resetForm(); fetchAll(); setView('list')
    } catch {
      toast.error('Failed to save prescription')
    } finally {
      setIsSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setIsDeleting(true)
    try {
      await client.delete(`/consultations/${deleting.id}`)
      toast.success('Prescription deleted')
      setConsultations(prev => prev.filter(c => c.id !== deleting.id))
      setDeleting(null)
    } catch {
      toast.error('Failed to delete')
    } finally {
      setIsDeleting(false)
    }
  }

  // ── LIST VIEW ──
  if (view === 'list') {
    const totalPages = Math.ceil(filteredConsultations.length / ITEMS_PER_PAGE)
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE
    const paginated = filteredConsultations.slice(startIdx, startIdx + ITEMS_PER_PAGE)
    return (
      <div className="space-y-6">
        {/* Clean white header matching the old Consultations module */}
        <div>
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900"><Stethoscope className="h-6 w-6 text-blue-600" />OPD Consultations</h1>
              <p className="text-gray-500 text-sm mt-1">View, manage and print patient consultation records</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchAll}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => { resetForm(); setView('form') }}><Plus className="h-4 w-4 mr-2" />New Consultation</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total', value: consultations.length, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Today', value: consultations.filter(c => new Date(c.visitDate).toDateString() === new Date().toDateString()).length, color: 'text-green-600', bg: 'bg-green-50' },
              { label: 'This Week', value: consultations.filter(c => (Date.now() - new Date(c.visitDate).getTime()) < 7 * 86400000).length, color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: 'With Rx', value: consultations.filter(c => c.prescriptions && c.prescriptions.length > 0).length, color: 'text-orange-600', bg: 'bg-orange-50' },
            ].map(s => (
              <Card key={s.label} className={`${s.bg} border-0 shadow-sm`}>
                <CardContent className="p-4 flex justify-between items-center">
                  <div>
                    <p className="text-sm text-gray-500">{s.label}</p>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  </div>
                  <ClipboardList className={`h-8 w-8 ${s.color} opacity-40`} />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input className="pl-9 rounded-xl" placeholder="Search by patient, UHID, diagnosis..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
          </div>
          <Select value={filterDoctor} onValueChange={setFilterDoctor}>
            <SelectTrigger className="w-52 rounded-xl"><SelectValue placeholder="Filter by doctor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Doctors</SelectItem>
              {doctors.map(d => <SelectItem key={d.id} value={d.id}>{drName(d.fullName)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterDate} onValueChange={setFilterDate}>
            <SelectTrigger className="w-40 rounded-xl"><SelectValue placeholder="Date" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Dates</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="specific">Specific Date</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
          {filterDate === 'specific' && (
            <Input type="date" className="w-44 rounded-xl" value={specificDate} onChange={e => setSpecificDate(e.target.value)} />
          )}
          {filterDate === 'custom' && (
            <>
              <Input type="date" className="w-40 rounded-xl" value={customStart} max={customEnd || undefined} onChange={e => setCustomStart(e.target.value)} />
              <span className="text-gray-400 text-sm">to</span>
              <Input type="date" className="w-40 rounded-xl" value={customEnd} min={customStart || undefined} onChange={e => setCustomEnd(e.target.value)} />
            </>
          )}
          {(filterDoctor !== 'all' || filterSearch || filterDate !== 'all') && (
            <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => { setFilterDoctor('all'); setFilterSearch(''); setFilterDate('all'); setSpecificDate(''); setCustomStart(''); setCustomEnd('') }}><X className="h-4 w-4 mr-1" />Clear</Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : filteredConsultations.length === 0 ? (
          <Card className="border-dashed rounded-2xl">
            <CardContent className="flex flex-col items-center py-16 text-center">
              <Stethoscope className="h-14 w-14 text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-600">No Prescriptions Found</h3>
              <p className="text-gray-400 text-sm mt-1 mb-6">{filterSearch || filterDoctor !== 'all' ? 'Try changing the filters' : 'Start by creating a new OPD prescription'}</p>
              {!filterSearch && filterDoctor === 'all' && (
                <Button onClick={() => { resetForm(); setView('form') }} className="bg-[#2E4168] hover:bg-[#24344f]"><Plus className="h-4 w-4 mr-2" />New Prescription</Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {paginated.map(c => {
              const pat = c.patient
              const patName = pat ? getFullName(pat) : 'Unknown Patient'
              const patMrn = pat?.mrn || '—'
              const patAge = pat?.dateOfBirth ? getAge(pat.dateOfBirth) : 0
              const patGender = pat?.gender || ''
              const docName = c.doctor?.fullName || '—'
              const icd = (() => { try { const a = JSON.parse(c.icd10Codes || '[]'); return Array.isArray(a) ? a[0] : '' } catch { return '' } })()
              return (
                <Card key={c.id} className="rounded-2xl border-slate-200/70 shadow-sm hover:shadow-md hover:border-[#2E4168]/25 transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="h-11 w-11 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">{initials(patName)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-base">{patName}</p>
                            <p className="text-sm text-gray-500">UHID: {patMrn} &bull; {patAge} yrs &bull; {patGender}</p>
                          </div>
                          <div className="text-sm text-gray-500 shrink-0">{format(new Date(c.visitDate), 'dd MMM yyyy HH:mm')}</div>
                        </div>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                          {c.chiefComplaint && <p className="text-sm"><span className="font-medium text-gray-600">Chief Complaint:</span> {c.chiefComplaint}</p>}
                          {c.diagnosis && <p className="text-sm"><span className="font-medium text-gray-600">Diagnosis:</span> {c.diagnosis}</p>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {c.temperature && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs"><Thermometer className="h-3 w-3" />{cToF(c.temperature)}°F</span>}
                            {c.bloodPressureSystolic && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-xs"><Heart className="h-3 w-3" />{c.bloodPressureSystolic}/{c.bloodPressureDiastolic}</span>}
                            {c.pulseRate && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs"><Activity className="h-3 w-3" />{c.pulseRate} bpm</span>}
                            {c.oxygenSaturation && <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 text-xs"><Droplet className="h-3 w-3" />{c.oxygenSaturation}%</span>}
                            {c.weight && c.height && (() => {
                               const m = c.height / 100
                               const bmi = (c.weight / (m * m)).toFixed(1)
                               return <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 text-xs"><Scale className="h-3 w-3" />BMI {bmi}</span>
                            })()}
                          </div>
                          {c.followUpDate && (() => {
                            const fu = new Date(c.followUpDate)
                            const today = new Date(); today.setHours(0, 0, 0, 0)
                            const upcoming = fu >= today
                            return (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border ${upcoming ? 'bg-white text-green-700 border-green-300' : 'bg-white text-gray-500 border-gray-200'}`}>
                                <CalendarClock className="h-3.5 w-3.5" />
                                {upcoming ? `Follow-up: ${format(fu, 'dd MMM yyyy')}` : `Follow-up was: ${format(fu, 'dd MMM yyyy')}`}
                              </span>
                            )
                          })()}
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-xs text-gray-500">Dr. {drName(docName).replace('Dr. ', '')}</span>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-gray-600 hover:text-blue-600" onClick={() => setViewing(c)}><Eye className="h-4 w-4 mr-1" />View</Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-blue-600 hover:text-blue-700" onClick={() => openEdit(c)}><Edit className="h-4 w-4 mr-1" />Edit</Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-green-600 hover:text-green-700" onClick={() => printPrescription(c, patName, patMrn, patAge, patGender, docName, orgInfo)}><Printer className="h-4 w-4 mr-1" />Print</Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2 text-red-600 hover:text-red-700" onClick={() => setDeleting(c)}><Trash2 className="h-4 w-4 mr-1" />Delete</Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t">
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4 mr-1" />Previous</Button>
                <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
              </div>
            )}
          </div>
        )}

        {/* View dialog */}
        <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>OPD Prescription</DialogTitle>
              <DialogDescription>{viewing && viewing.patient ? `${getFullName(viewing.patient)} (${viewing.patient.mrn}) — ${format(new Date(viewing.visitDate), 'dd MMM yyyy')}` : ''}</DialogDescription>
            </DialogHeader>
            {viewing && (() => {
              const c = viewing
              const meds = (c.prescriptions || []).flatMap(rx => { try { return JSON.parse(rx.items || '[]') } catch { return [] } })
              const labs = (c.labOrders || []).flatMap(o => { try { return JSON.parse(o.tests || '[]') } catch { return [] } })
              const rads = (c.radiologyOrders || []).map(o => o.exam?.examName || o.examName).filter(Boolean)
              return (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-[#2E4168]/5 p-3 rounded-lg">
                    <div><p className="text-gray-500 font-medium">Patient</p><p className="font-semibold">{c.patient ? getFullName(c.patient) : '—'}</p></div>
                    <div><p className="text-gray-500 font-medium">UHID</p><p>{c.patient?.mrn || '—'}</p></div>
                    <div><p className="text-gray-500 font-medium">Doctor</p><p>{drName(c.doctor?.fullName || '—')}</p></div>
                    <div><p className="text-gray-500 font-medium">Date</p><p>{format(new Date(c.visitDate), 'dd MMM yyyy HH:mm')}</p></div>
                  </div>
                  <div className="bg-[#2E4168]/5 border border-[#2E4168]/25 rounded p-3">
                    <p className="font-semibold text-[#2E4168] text-xs uppercase tracking-wide mb-1">Diagnosis</p>
                    <p className="text-base font-medium">{c.diagnosis || '—'}</p>
                  </div>
                  {c.chiefComplaint && <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Complaint</p><p>{c.chiefComplaint}</p></div>}
                  {meds.length > 0 && (
                    <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Medicines</p>
                      <div className="border rounded divide-y">{meds.map((m, i) => (
                        <div key={i} className="p-2 flex flex-wrap justify-between gap-2"><span className="font-medium">{m.drugName || '—'}</span><span className="text-gray-500 text-xs">{[m.dosage, m.frequency, m.duration, m.quantity ? `Qty: ${m.quantity}` : null].filter(Boolean).join(' · ')}</span></div>
                      ))}</div>
                    </div>
                  )}
                  {labs.length > 0 && <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Lab Tests</p><div className="flex flex-wrap gap-2">{labs.map((t, i) => <span key={i} className="bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5 text-xs">{t.testName || t.testCode || '—'}</span>)}</div></div>}
                  {rads.length > 0 && <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Radiology</p><div className="flex flex-wrap gap-2">{rads.map((n, i) => <span key={i} className="bg-purple-50 text-purple-700 border border-purple-200 rounded px-2 py-0.5 text-xs">{n}</span>)}</div></div>}
                  {c.notes && <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Advice</p><p className="whitespace-pre-wrap">{c.notes}</p></div>}
                  {c.followUpDate && <div className="bg-green-50 border border-green-200 rounded p-2 text-green-800 font-medium">Follow-up: {format(new Date(c.followUpDate), 'dd MMM yyyy')}</div>}
                </div>
              )
            })()}
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
              {viewing && <Button variant="outline" onClick={() => { openEdit(viewing); setViewing(null) }}><Edit className="h-4 w-4 mr-1" />Edit</Button>}
              {viewing && <Button className="bg-[#2E4168] hover:bg-[#24344f]" onClick={() => { const c = viewing; printPrescription(c, c.patient ? getFullName(c.patient) : 'Unknown', c.patient?.mrn || '—', c.patient?.dateOfBirth ? getAge(c.patient.dateOfBirth) : 0, c.patient?.gender || '', c.doctor?.fullName || '—', orgInfo) }}><Printer className="h-4 w-4 mr-1" />Print</Button>}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="h-5 w-5" />Delete Prescription?</DialogTitle>
              <DialogDescription>This permanently removes the OPD prescription{deleting?.patient ? ` for ${getFullName(deleting.patient)}` : ''} and its medicines &amp; test orders. This cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>Cancel</Button>
              <Button className="bg-red-600 hover:bg-red-700" onClick={confirmDelete} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ── FORM VIEW ──
  if (loading) {
    return <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
  }

  const SaveBtn = ({ size }) => (
    <Button onClick={saveConsultation} disabled={isSaving} size={size} className="bg-white text-[#2E4168] hover:bg-[#2E4168]/5 shadow-sm">
      {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
      {isSaving ? 'Saving...' : editingId ? 'Update' : 'Save Prescription'}
    </Button>
  )

  return (
    <div className="space-y-4 pb-10">
      {/* Premium gradient header */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-4 bg-gradient-to-r from-[#2E4168] via-[#34497a] to-[#24344f] text-white shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/15" onClick={() => { resetForm(); setView('list') }}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2"><Stethoscope className="h-5 w-5" />{editingId ? 'Edit OPD Prescription' : 'New OPD Prescription'}</h1>
            <p className="text-white/75 text-xs">Department → Problem → add medicines &amp; tests → save</p>
          </div>
        </div>
        <SaveBtn />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* LEFT: form */}
        <div className="xl:col-span-2 space-y-4">
          {/* Patient & Doctor */}
          <Section icon={<User className="h-5 w-5" />} title="Patient & Doctor" desc="Who is this prescription for">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Patient *</Label>
                {selectedPatient ? (
                  <div className="flex items-center gap-3 p-3 bg-[#2E4168]/5 rounded-xl border border-[#2E4168]/25">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#2E4168] to-[#3b5488] flex items-center justify-center text-white text-sm font-bold">{initials(getFullName(selectedPatient))}</div>
                    <div className="flex-1"><p className="font-semibold">{getFullName(selectedPatient)}</p><p className="text-xs text-gray-500">UHID: {selectedPatient.mrn} &bull; {getAge(selectedPatient.dateOfBirth)} yrs &bull; {selectedPatient.gender}</p></div>
                    <Button variant="ghost" size="sm" onClick={() => setShowPatientDialog(true)}>Change</Button>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full justify-start h-auto py-3 rounded-xl" onClick={() => setShowPatientDialog(true)}><User className="h-5 w-5 mr-2 text-gray-400" /><span className="text-gray-500">Click to select a patient...</span></Button>
                )}
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">Attending Doctor *</Label>
                <Select value={selectedDoctorId} onValueChange={setSelectedDoctorId}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select doctor" /></SelectTrigger>
                  <SelectContent>{doctors.map(d => <SelectItem key={d.id} value={d.id}>{drName(d.fullName)}{d.specialization ? ` — ${d.specialization}` : ''}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </Section>

          {/* Department → Problem + suggestions */}
          <Section icon={<Sparkles className="h-5 w-5" />} title="Condition & Suggestions" desc="Diagnosis auto-fills; tap chips to add tests & medicines">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Department</Label>
                <SearchableSelect
                  className="w-full rounded-xl"
                  value={department}
                  onChange={onDepartmentChange}
                  options={specialties.map(s => ({ value: s, label: s }))}
                  placeholder="Select department"
                  searchPlaceholder="Type to search departments..."
                  emptyText="No matching department"
                />
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">Problem</Label>
                <SearchableSelect
                  className="w-full rounded-xl"
                  value={problem}
                  onChange={onProblemChange}
                  disabled={!department}
                  options={conditions.map(c => ({
                    value: c.condition,
                    label: c.condition,
                    sublabel: c.icd10 && !/not specified/i.test(c.icd10) ? c.icd10 : undefined,
                    keywords: c.icd10 || '',
                  }))}
                  placeholder={department ? 'Select problem' : 'Select a department first'}
                  searchPlaceholder="Type to search problems..."
                  emptyText="No matching problem"
                />
              </div>
            </div>

            {guidanceLoading && <div className="flex items-center gap-2 text-sm text-gray-500 mt-4"><Loader2 className="h-4 w-4 animate-spin" />Loading...</div>}

            {guidance && (
              <div className="space-y-3 mt-4">
                {guidance.suggestedTests?.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700 mb-2"><FlaskConical className="h-3.5 w-3.5" />Suggested Tests <span className="text-gray-400 font-normal normal-case">— tap to add</span></p>
                    <div className="flex flex-wrap gap-2">
                      {guidance.suggestedTests.map(t => {
                        const added = isTestAdded(t)
                        return (
                          <button key={t} type="button" onClick={() => addSuggestedTest(t)} disabled={added}
                            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm shadow-sm transition-all ${added ? 'bg-blue-600 text-white border-blue-600 cursor-default' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50 hover:-translate-y-0.5'}`}>
                            {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{t}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {guidance.suggestedDrugs?.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-green-700 mb-2"><Pill className="h-3.5 w-3.5" />Suggested Medicines <span className="text-gray-400 font-normal normal-case">— tap to add, then set dose</span></p>
                    <div className="flex flex-wrap gap-2">
                      {guidance.suggestedDrugs.map(d => {
                        const added = isDrugAdded(d)
                        return (
                          <button key={d} type="button" onClick={() => addSuggestedDrug(d)} disabled={added}
                            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm shadow-sm transition-all ${added ? 'bg-green-600 text-white border-green-600 cursor-default' : 'bg-white text-green-700 border-green-300 hover:bg-green-50 hover:-translate-y-0.5'}`}>
                            {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{d}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {(!guidance.suggestedTests?.length && !guidance.suggestedDrugs?.length) && (
                  <p className="text-sm text-gray-400">No structured suggestions — add medicines &amp; tests manually below.</p>
                )}

                <div className="rounded-xl border border-gray-200 bg-gray-50/70">
                  <button type="button" onClick={() => setGuidanceOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-gray-600">
                    <span className="flex items-center gap-2"><BookOpen className="h-4 w-4" />View clinical guidance</span>
                    {guidanceOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {guidanceOpen && (
                    <div className="px-4 pb-4">
                      <div className="flex items-center gap-2 mb-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />Advisory only — verify every dose before prescribing.
                      </div>
                      <div className="max-h-[360px] overflow-y-auto pr-1">
                        <GuidanceField label="When to Suspect" value={guidance.whenToSuspect} />
                        <GuidanceField label="Investigations" value={guidance.investigations} />
                        <GuidanceField label="Drugs & Dosage" value={guidance.drugs} />
                        <GuidanceField label="Management" value={guidance.management} />
                        <GuidanceField label="Referral / Red Flags" value={guidance.referralRedFlags} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Section>

          {/* Vitals */}
          <Section icon={<Activity className="h-5 w-5" />} title="Vitals" accent="amber">
            <Form {...vitalsForm}>
              <form className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { name: 'temperature', label: 'Temp (°F)', icon: <Thermometer className="h-4 w-4 text-red-500" />, step: '0.1', parse: parseFloat },
                  { name: 'bloodPressureSystolic', label: 'BP Sys', icon: <Heart className="h-4 w-4 text-red-500" />, step: '1', parse: parseInt },
                  { name: 'bloodPressureDiastolic', label: 'BP Dia', icon: <Heart className="h-4 w-4 text-red-400" />, step: '1', parse: parseInt },
                  { name: 'pulseRate', label: 'Pulse', icon: <Activity className="h-4 w-4 text-pink-500" />, step: '1', parse: parseInt },
                  { name: 'oxygenSaturation', label: 'SpO₂ (%)', icon: <Droplet className="h-4 w-4 text-blue-500" />, step: '1', parse: parseFloat },
                  { name: 'weight', label: 'Weight (kg)', icon: <Scale className="h-4 w-4 text-purple-500" />, step: '0.1', parse: parseFloat },
                ].map(f => (
                  <FormField key={f.name} control={vitalsForm.control} name={f.name} render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1 text-xs">{f.icon}{f.label}</FormLabel>
                      <FormControl><Input type="number" step={f.step} className="rounded-xl" {...field} onChange={e => field.onChange(f.parse(e.target.value))} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                ))}
              </form>
            </Form>
          </Section>

          {/* Diagnosis */}
          <Section icon={<ClipboardList className="h-5 w-5" />} title="Complaint & Diagnosis" accent="cyan">
            <Form {...clinicalForm}>
              <form className="grid grid-cols-1 gap-4">
                <FormField control={clinicalForm.control} name="chiefComplaint" render={({ field }) => (<FormItem><FormLabel>Chief Complaint *</FormLabel><FormControl><Input className="rounded-xl" placeholder="Main reason for visit..." {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={clinicalForm.control} name="diagnosis" render={({ field }) => (<FormItem><FormLabel>Diagnosis *</FormLabel><FormControl><Input className="rounded-xl" placeholder="Working diagnosis..." {...field} /></FormControl><FormMessage /></FormItem>)} />
              </form>
            </Form>
          </Section>

          {/* Medicines */}
          <Section icon={<Pill className="h-5 w-5" />} title="Medicines (Rx)" accent="green">
            <div className="space-y-4">
              <div className="flex gap-2">
                <SearchableSelect className="flex-1" value={selectedDrug} onChange={setSelectedDrug} placeholder="Search and add a medicine..." searchPlaceholder="Type drug or generic name..." emptyText={drugs.length === 0 ? 'No drugs available — seed pharmacy first' : 'No matching drugs'} options={drugs.map(d => ({ value: d.id, label: `${d.drugName}${d.strength ? ` — ${d.strength}` : ''}`, sublabel: d.genericName || '', keywords: `${d.genericName || ''} ${d.strength || ''}` }))} />
                <Button onClick={addDrug} disabled={!selectedDrug} className="bg-[#2E4168] hover:bg-[#24344f]"><Plus className="h-4 w-4 mr-1" />Add</Button>
              </div>
              {prescriptionItems.length === 0 ? (
                <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-xl"><Pill className="h-8 w-8 mx-auto mb-2 opacity-40" /><p className="text-sm">No medicines yet — tap a suggestion above or search here</p></div>
              ) : (
                <div className="space-y-3">
                  {prescriptionItems.map((item, i) => (
                    <div key={i} className="border rounded-xl p-3 bg-slate-50/70">
                      <div className="flex justify-between mb-2">
                        <div><p className="font-semibold">{item.drugName}</p>{item.genericName && <p className="text-xs text-gray-500">{item.genericName}</p>}</div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeDrug(i)}><X className="h-4 w-4" /></Button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div><Label className="text-xs text-gray-500">Dose</Label><Input className="h-8 text-sm rounded-lg" value={item.dosage} placeholder="e.g. 500mg" onChange={e => updateItem(i, 'dosage', e.target.value)} /></div>
                        <div><Label className="text-xs text-gray-500">Frequency</Label>
                          <Select value={item.frequency} onValueChange={v => updateItem(i, 'frequency', v)}><SelectTrigger className="h-8 text-sm rounded-lg"><SelectValue /></SelectTrigger><SelectContent>{['OD', 'BD', 'TID', 'QID', 'SOS', 'Stat', 'HS', 'AC', 'PC'].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent></Select>
                        </div>
                        <div><Label className="text-xs text-gray-500">Duration</Label>
                          <Select value={item.duration} onValueChange={v => updateItem(i, 'duration', v)}><SelectTrigger className="h-8 text-sm rounded-lg"><SelectValue /></SelectTrigger><SelectContent>{['1 day', '3 days', '5 days', '7 days', '10 days', '14 days', '1 month', '3 months', 'Ongoing'].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>
                        </div>
                        <div><Label className="text-xs text-gray-500">Qty</Label><Input className="h-8 text-sm rounded-lg" type="number" value={item.quantity} onChange={e => updateItem(i, 'quantity', parseInt(e.target.value))} /></div>
                        <div className="col-span-2 md:col-span-4"><Label className="text-xs text-gray-500">Instructions</Label><Input className="h-8 text-sm rounded-lg" value={item.instructions} placeholder="e.g. After food" onChange={e => updateItem(i, 'instructions', e.target.value)} /></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {/* Tests */}
          <Section icon={<FlaskConical className="h-5 w-5" />} title="Tests & Investigations" accent="blue">
            <div className="space-y-4">
              <div className="flex gap-2">
                <SearchableSelect className="flex-1" value={selectedLabTest} onChange={setSelectedLabTest} placeholder="Add a lab test..." searchPlaceholder="Type test name or code..." emptyText={labTests.length === 0 ? 'No lab tests available' : 'No matching tests'} options={labTests.map(t => ({ value: t.id, label: `${t.testName}${t.testCode ? ` (${t.testCode})` : ''}`, sublabel: [t.testCategory, t.specimenType].filter(Boolean).join(' · '), keywords: `${t.testCode || ''} ${t.testCategory || ''}` }))} />
                <Button onClick={addLabTest} disabled={!selectedLabTest} className="bg-[#2E4168] hover:bg-[#24344f]"><Plus className="h-4 w-4 mr-1" />Add</Button>
              </div>
              <div className="flex gap-2">
                <SearchableSelect className="flex-1" value={selectedRadExam} onChange={setSelectedRadExam} placeholder="Add a radiology exam..." searchPlaceholder="Type exam, modality or body part..." emptyText={radiologyExams.length === 0 ? 'No radiology exams available' : 'No matching exams'} options={radiologyExams.map(e => ({ value: e.id, label: `${e.examName}${e.examCode ? ` (${e.examCode})` : ''}`, sublabel: [e.examCategory && e.examCategory.toUpperCase(), e.bodyPart, e.modality].filter(Boolean).join(' · '), keywords: `${e.examCode || ''} ${e.examCategory || ''} ${e.bodyPart || ''} ${e.modality || ''}` }))} />
                <Button onClick={addRadExam} disabled={!selectedRadExam} className="bg-[#2E4168] hover:bg-[#24344f]"><Plus className="h-4 w-4 mr-1" />Add</Button>
              </div>
              {(labOrderItems.length > 0 || radiologyOrderItems.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {labOrderItems.map(item => (
                    <span key={item.testId} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-3 py-1 text-sm shadow-sm">
                      <FlaskConical className="h-3.5 w-3.5" />{item.testName}
                      <button type="button" onClick={() => removeLabItem(item.testId)} className="ml-0.5 text-blue-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                    </span>
                  ))}
                  {radiologyOrderItems.map(item => (
                    <span key={item.examId} className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-3 py-1 text-sm shadow-sm">
                      <Scan className="h-3.5 w-3.5" />{item.examName}
                      <button type="button" onClick={() => removeRadItem(item.examId)} className="ml-0.5 text-purple-400 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-gray-400 border-2 border-dashed rounded-xl"><FlaskConical className="h-7 w-7 mx-auto mb-1 opacity-40" /><p className="text-sm">No tests yet — tap a suggestion above or search here</p></div>
              )}
            </div>
          </Section>

          {/* Advice & follow-up */}
          <Section icon={<CalendarClock className="h-5 w-5" />} title="Advice & Follow-up" accent="violet">
            <Form {...clinicalForm}>
              <form className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField control={clinicalForm.control} name="advice" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Advice / Instructions</FormLabel><FormControl><Textarea rows={2} className="rounded-xl" placeholder="Diet, rest, warning signs, when to return..." {...field} /></FormControl></FormItem>)} />
                <FormField control={clinicalForm.control} name="followUpDate" render={({ field }) => (<FormItem><FormLabel>Follow-up Date</FormLabel><FormControl><Input type="date" className="rounded-xl" {...field} /></FormControl></FormItem>)} />
              </form>
            </Form>
          </Section>
        </div>

        {/* RIGHT: live prescription preview */}
        <div className="xl:col-span-1">
          <div className="xl:sticky xl:top-24">
            <Card className="rounded-2xl border-slate-200/70 shadow-md overflow-hidden">
              <div className="bg-gradient-to-r from-[#2E4168] to-[#3b5488] text-white px-4 py-3 flex items-center justify-between">
                <span className="font-semibold flex items-center gap-2"><span className="text-xl font-serif">℞</span> Live Prescription</span>
                <Badge className="bg-white/20 text-white hover:bg-white/20 border-0">{prescriptionItems.length} med · {labOrderItems.length + radiologyOrderItems.length} test</Badge>
              </div>
              <CardContent className="p-4 space-y-3 text-sm">
                {/* Patient */}
                <div className="rounded-xl bg-slate-50 p-3">
                  {selectedPatient ? (
                    <>
                      <p className="font-semibold">{getFullName(selectedPatient)}</p>
                      <p className="text-xs text-gray-500">UHID {selectedPatient.mrn} · {getAge(selectedPatient.dateOfBirth)}y · {selectedPatient.gender}</p>
                    </>
                  ) : <p className="text-gray-400 italic">No patient selected</p>}
                  {selectedDoctor && <p className="text-xs text-[#2E4168] mt-1">{drName(selectedDoctor.fullName)}</p>}
                </div>

                {/* Vitals line */}
                {(vw.temperature || vw.bloodPressureSystolic || vw.pulseRate || vw.oxygenSaturation) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                    {vw.temperature ? <span>🌡 {vw.temperature}°F</span> : null}
                    {vw.bloodPressureSystolic ? <span>BP {vw.bloodPressureSystolic}/{vw.bloodPressureDiastolic}</span> : null}
                    {vw.pulseRate ? <span>♥ {vw.pulseRate}</span> : null}
                    {vw.oxygenSaturation ? <span>SpO₂ {vw.oxygenSaturation}%</span> : null}
                    {vw.weight ? <span>{vw.weight}kg</span> : null}
                  </div>
                )}

                {/* Diagnosis */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#2E4168]">Diagnosis</p>
                  <p className="font-medium">{wDiagnosis || <span className="text-gray-400 italic font-normal">—</span>}</p>
                  {wComplaint && <p className="text-xs text-gray-500 mt-0.5">C/O: {wComplaint}</p>}
                </div>

                {/* Medicines */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-green-700 flex items-center gap-1"><Pill className="h-3 w-3" />Medicines</p>
                  {prescriptionItems.length === 0 ? <p className="text-gray-400 italic text-xs">None yet</p> : (
                    <ol className="mt-1 space-y-1 list-decimal list-inside">
                      {prescriptionItems.map((m, i) => (
                        <li key={i} className="text-sm"><span className="font-medium">{m.drugName}</span>
                          <span className="text-xs text-gray-500"> {[m.dosage, m.frequency, m.duration].filter(Boolean).join(' · ')}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                {/* Tests */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700 flex items-center gap-1"><FlaskConical className="h-3 w-3" />Tests</p>
                  {(labOrderItems.length + radiologyOrderItems.length) === 0 ? <p className="text-gray-400 italic text-xs">None yet</p> : (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {labOrderItems.map(t => <span key={t.testId} className="bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 text-xs">{t.testName}</span>)}
                      {radiologyOrderItems.map(t => <span key={t.examId} className="bg-purple-50 text-purple-700 border border-purple-200 rounded px-1.5 py-0.5 text-xs">{t.examName}</span>)}
                    </div>
                  )}
                </div>

                {(wAdvice || wFollow) && (
                  <div className="border-t pt-2 text-xs text-gray-600">
                    {wAdvice && <p><span className="font-semibold">Advice:</span> {wAdvice}</p>}
                    {wFollow && <p className="text-green-700 font-medium mt-0.5">Follow-up: {format(new Date(wFollow), 'dd MMM yyyy')}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="mt-3 hidden xl:block">
              <Button onClick={saveConsultation} disabled={isSaving} className="w-full bg-[#2E4168] hover:bg-[#24344f]" size="lg">
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {isSaving ? 'Saving...' : editingId ? 'Update Prescription' : 'Save Prescription'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Patient select dialog */}
      <Dialog open={showPatientDialog} onOpenChange={setShowPatientDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Select Patient</DialogTitle><DialogDescription>Search and select a patient</DialogDescription></DialogHeader>
          <PatientLookup showHint={false} selectedPatient={null} onSelect={(p) => { setPatients(prev => prev.some(x => x.id === p.id) ? prev : [p, ...prev]); setSelectedPatientId(p.id); setShowPatientDialog(false) }} />
        </DialogContent>
      </Dialog>

      {/* Mobile save */}
      <div className="flex justify-end xl:hidden">
        <Button onClick={saveConsultation} disabled={isSaving} size="lg" className="bg-[#2E4168] hover:bg-[#24344f]">
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {isSaving ? 'Saving...' : editingId ? 'Update Prescription' : 'Save Prescription'}
        </Button>
      </div>
    </div>
  )
}
