import { useState, useEffect, useCallback } from 'react'
import { getOrgSettings } from '@/lib/orgSettings'
import PostConsultationWorkflow from '@/components/consultations/PostConsultationWorkflow'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Activity, Heart, Thermometer, Droplet, Scale, Ruler, Wind,
  Plus, Save, Printer, FileText, Stethoscope, ClipboardList,
  Pill, AlertCircle, User, Loader2, RefreshCw,
  FlaskConical, Scan, Trash2, ArrowLeft, Eye, Edit, Search,
  ChevronLeft, ChevronRight, X, CalendarClock
} from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import client from '@/api/client'
import { drName, cToF, fToC } from '@/lib/utils'
import PatientLookup from '@/components/common/PatientLookup'

const ICD10_CODES = [
  { code: 'J00',  description: 'Common cold' },
  { code: 'J18.9',description: 'Pneumonia, unspecified' },
  { code: 'J45.9',description: 'Asthma, unspecified' },
  { code: 'A09',  description: 'Diarrhoea & gastroenteritis' },
  { code: 'K29.7',description: 'Gastritis, unspecified' },
  { code: 'M54.5',description: 'Low back pain' },
  { code: 'N39.0',description: 'Urinary tract infection' },
  { code: 'R50.9',description: 'Fever, unspecified' },
  { code: 'R51',  description: 'Headache' },
  { code: 'E11.9',description: 'Type 2 diabetes mellitus' },
  { code: 'I10',  description: 'Essential hypertension' },
  { code: 'B50.9',description: 'Malaria — P. falciparum' },
]

const vitalsSchema = z.object({
  temperature: z.number().min(86).max(113).optional(), // °F (≈30–45°C)
  bloodPressureSystolic: z.number().min(60).max(250).optional(),
  bloodPressureDiastolic: z.number().min(40).max(150).optional(),
  pulseRate: z.number().min(30).max(200).optional(),
  respiratoryRate: z.number().min(8).max(40).optional(),
  weight: z.number().min(0.5).max(300).optional(),
  height: z.number().min(30).max(250).optional(),
  oxygenSaturation: z.number().min(50).max(100).optional(),
})

const clinicalSchema = z.object({
  chiefComplaint: z.string().min(3, 'Chief complaint required'),
  historyOfPresentIllness: z.string().optional(),
  physicalExamination: z.string().optional(),
  diagnosis: z.string().min(3, 'Diagnosis required'),
  icd10Code: z.string().optional(),
  treatmentPlan: z.string().optional(),
  followUpInstructions: z.string().optional(),
  followUpDate: z.string().optional(),
  referredTo: z.string().optional(),
  referralReason: z.string().optional(),
  notes: z.string().optional(),
})

const DEFAULT_VITALS = {
  temperature: 98.6, bloodPressureSystolic: 120, bloodPressureDiastolic: 80,
  pulseRate: 72, respiratoryRate: 16, weight: 70, height: 170, oxygenSaturation: 98,
}

const getFullName = (p) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')
const getAge = (dob) => {
  const d = new Date(dob), t = new Date()
  let a = t.getFullYear() - d.getFullYear()
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--
  return a
}
const initials = (name) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
const bmiCategory = (bmi) => {
  if (!bmi) return { label: 'N/A', color: 'text-gray-400' }
  if (bmi < 18.5) return { label: 'Underweight', color: 'text-blue-500' }
  if (bmi < 25) return { label: 'Normal', color: 'text-green-600' }
  if (bmi < 30) return { label: 'Overweight', color: 'text-yellow-500' }
  return { label: 'Obese', color: 'text-red-500' }
}

function printViaIframe(html) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none'
  document.body.appendChild(iframe)
  iframe.contentDocument.open()
  iframe.contentDocument.write(html)
  iframe.contentDocument.close()
  setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => document.body.removeChild(iframe), 1000) }, 500)
}

function printConsultation(consultation, patientName, patientMrn, patientAge, patientGender, doctorName, orgInfo = { name: 'Hospital' }) {
  const visitDate = format(new Date(consultation.visitDate), 'dd MMMM yyyy HH:mm')
  const printDate = format(new Date(), 'dd MMM yyyy HH:mm')
  const followUp = consultation.followUpDate ? format(new Date(consultation.followUpDate), 'dd MMM yyyy') : null
  let bmiVal = null
  if (consultation.weight && consultation.height && consultation.height > 0) {
    const h = consultation.height / 100
    bmiVal = (consultation.weight / (h * h)).toFixed(1)
  }
  const parsePrescriptions = () => {
    if (!consultation.prescriptions || consultation.prescriptions.length === 0) return ''
    const rows = consultation.prescriptions.flatMap(rx => {
      try {
        const items = JSON.parse(rx.items)
        return items.map(item =>
          `<tr><td>${item.drugName}${item.genericName ? ` <span style="color:#888">(${item.genericName})</span>` : ''}</td><td>${item.dosage}</td><td>${item.frequency}</td><td>${item.duration}</td><td>${item.quantity}</td><td>${item.instructions || '—'}</td></tr>`)
      } catch { return [] }
    }).join('')
    if (!rows) return ''
    return `<div class="section"><div class="section-title">Prescription</div>
    <table><thead><tr><th>Drug</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Qty</th><th>Instructions</th></tr></thead><tbody>${rows}</tbody></table></div>`
  }
  const icd = (() => { try { const a = JSON.parse(consultation.icd10Codes || '[]'); return Array.isArray(a) ? a.join(', ') : consultation.icd10Codes } catch { return consultation.icd10Codes } })()

  const html = `<!DOCTYPE html><html><head><title>Consultation Note — ${patientMrn}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;background:#fff}.page{max-width:210mm;margin:0 auto;padding:12mm 14mm 10mm}.hosp-header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:8px;margin-bottom:8px}.hosp-name{font-size:18pt;font-weight:bold;color:#1e3a5f}.hosp-sub{font-size:9pt;color:#555;margin-top:2px}.doc-ref{font-size:8.5pt;color:#555;text-align:right;line-height:1.6}.banner{background:#1e3a5f;color:#fff;text-align:center;padding:5px;font-size:12pt;font-weight:bold;letter-spacing:2px;margin-bottom:8px}.pt-box{border:1px solid #333;margin-bottom:10px}.pt-hdr{background:#1e3a5f;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;text-transform:uppercase}.g4{display:grid;grid-template-columns:repeat(4,1fr)}.cell{padding:4px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}.cell:last-child{border-right:none}.lbl{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase}.val{font-size:10pt;margin-top:1px}.vitals-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #333;margin-bottom:10px}.v-cell{padding:6px 10px;border-right:1px solid #ccc;text-align:center}.v-cell:last-child{border-right:none}.v-num{font-size:14pt;font-weight:bold;color:#1e3a5f}.v-unit{font-size:8pt;color:#888}.v-lbl{font-size:8pt;color:#555;margin-top:1px}.section{margin-bottom:10px}.section-title{font-weight:bold;font-size:10pt;color:#1e3a5f;border-bottom:1.5px solid #1e3a5f;padding-bottom:2px;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.5px}.section-body{font-size:10pt;line-height:1.6;padding-left:4px;white-space:pre-wrap}.dx-box{border:2px solid #1e3a5f;padding:10px;background:#f0f4f8;margin-bottom:10px}.dx-title{font-weight:bold;font-size:10.5pt;color:#1e3a5f;margin-bottom:3px;text-transform:uppercase}.dx-body{font-size:11pt;font-weight:500}.fu-box{border-left:4px solid #10b981;background:#f0fdf4;padding:7px 10px;margin-bottom:10px;font-size:10pt}.ref-box{border-left:4px solid #f59e0b;background:#fffbeb;padding:7px 10px;margin-bottom:10px;font-size:10pt}table{width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:8px}th{background:#1e3a5f;color:#fff;padding:5px 8px;text-align:left;font-size:9pt}td{padding:4px 8px;border-bottom:1px solid #e8e8e8}tr:nth-child(even) td{background:#f9f9f9}.sig-section{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:16px;padding-top:10px;border-top:2px solid #000}.sig-line{border-bottom:1px solid #000;height:38px;margin-bottom:4px}.sig-label{font-size:9pt;color:#444;line-height:1.6}.footer{margin-top:12px;border-top:1px solid #ccc;padding-top:4px;font-size:8pt;color:#888;text-align:center}@media print{.page{padding:8mm}}</style></head><body>
<div class="page">
<div class="hosp-header"><div><div class="hosp-name">${orgInfo.name}</div><div class="hosp-sub">Clinical Department — Consultation Note</div></div><div class="doc-ref">Visit Date: <strong>${visitDate}</strong><br/>Attending: <strong>${drName(doctorName)}</strong><br/>Printed: ${printDate}</div></div>
<div class="banner">CONSULTATION NOTE</div>
<div class="pt-box"><div class="pt-hdr">Patient Information</div><div class="g4">
<div class="cell"><div class="lbl">Patient Name</div><div class="val"><strong>${patientName}</strong></div></div>
<div class="cell"><div class="lbl">UHID</div><div class="val">${patientMrn}</div></div>
<div class="cell"><div class="lbl">Age / Sex</div><div class="val">${patientAge} yrs / ${patientGender}</div></div>
<div class="cell"><div class="lbl">Visit Type</div><div class="val" style="text-transform:capitalize">${consultation.visitType || 'Outpatient'}</div></div>
</div></div>
${(consultation.temperature || consultation.pulseRate || consultation.bloodPressureSystolic) ? `<div class="pt-hdr" style="background:#1e3a5f;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;text-transform:uppercase;margin-bottom:0">Vital Signs</div><div class="vitals-grid">
${consultation.temperature ? `<div class="v-cell"><div class="v-num">${cToF(consultation.temperature)}°</div><div class="v-unit">Fahrenheit</div><div class="v-lbl">Temperature</div></div>` : ''}
${consultation.bloodPressureSystolic ? `<div class="v-cell"><div class="v-num">${consultation.bloodPressureSystolic}/${consultation.bloodPressureDiastolic || '—'}</div><div class="v-unit">mmHg</div><div class="v-lbl">Blood Pressure</div></div>` : ''}
${consultation.pulseRate ? `<div class="v-cell"><div class="v-num">${consultation.pulseRate}</div><div class="v-unit">bpm</div><div class="v-lbl">Pulse Rate</div></div>` : ''}
${consultation.oxygenSaturation ? `<div class="v-cell"><div class="v-num">${consultation.oxygenSaturation}%</div><div class="v-unit">SpO₂</div><div class="v-lbl">Oxygen Sat.</div></div>` : ''}
${consultation.weight ? `<div class="v-cell"><div class="v-num">${consultation.weight}</div><div class="v-unit">kg</div><div class="v-lbl">Weight</div></div>` : ''}
${consultation.height ? `<div class="v-cell"><div class="v-num">${consultation.height}</div><div class="v-unit">cm</div><div class="v-lbl">Height</div></div>` : ''}
${bmiVal ? `<div class="v-cell"><div class="v-num">${bmiVal}</div><div class="v-unit">kg/m²</div><div class="v-lbl">BMI</div></div>` : ''}
</div>` : ''}
<div class="section"><div class="section-title">Subjective</div>
${consultation.chiefComplaint ? `<div style="margin-bottom:6px"><strong>Chief Complaint:</strong> ${consultation.chiefComplaint}</div>` : ''}
${consultation.historyOfPresentIllness ? `<div><strong>History of Present Illness:</strong><div class="section-body" style="margin-top:3px">${consultation.historyOfPresentIllness}</div></div>` : ''}
</div>
${consultation.physicalExamination ? `<div class="section"><div class="section-title">Objective — Physical Examination</div><div class="section-body">${consultation.physicalExamination}</div></div>` : ''}
<div class="dx-box"><div class="dx-title">Assessment / Diagnosis</div><div class="dx-body">${consultation.diagnosis || '—'}</div>
${icd ? `<div style="margin-top:5px;font-size:9pt;color:#555"><strong>ICD-10:</strong> ${icd}</div>` : ''}</div>
${consultation.treatmentPlan ? `<div class="section"><div class="section-title">Plan — Treatment</div><div class="section-body">${consultation.treatmentPlan}</div></div>` : ''}
${parsePrescriptions()}
${followUp || consultation.followUpInstructions ? `<div class="fu-box">${followUp ? `<div><strong>Follow-up Date:</strong> ${followUp}</div>` : ''}${consultation.followUpInstructions ? `<div style="margin-top:4px"><strong>Instructions:</strong> ${consultation.followUpInstructions}</div>` : ''}</div>` : ''}
${consultation.referredTo ? `<div class="ref-box"><strong>Referral:</strong> ${consultation.referredTo}${consultation.referralReason ? ` — ${consultation.referralReason}` : ''}</div>` : ''}
${consultation.notes ? `<div class="section"><div class="section-title">Additional Notes</div><div class="section-body">${consultation.notes}</div></div>` : ''}
<div class="sig-section">
<div><div class="sig-line"></div><div class="sig-label"><strong>Consulting Physician:</strong> ${drName(doctorName)}<br/>Date: ${visitDate}</div></div>
<div><div class="sig-line"></div><div class="sig-label"><strong>Patient / Guardian Signature</strong><br/>Date: ___________________</div></div>
</div>
<div class="footer">${orgInfo.name} — Clinical Department &nbsp;|&nbsp; Confidential Medical Record &nbsp;|&nbsp; Printed: ${printDate}</div>
</div></body></html>`

  printViaIframe(html)
}

const ITEMS_PER_PAGE = 15

export default function ConsultationModule() {
  const [view, setView] = useState('list')
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [editingId, setEditingId] = useState(null)
  const [viewingConsultation, setViewingConsultation] = useState(null)
  const [filterSearch, setFilterSearch] = useState('')
  const [filterDoctor, setFilterDoctor] = useState('all')
  const [filterDate, setFilterDate] = useState('all') // all | today | week | month | specific | custom
  const [specificDate, setSpecificDate] = useState('')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const [activeTab, setActiveTab] = useState('vitals')
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [selectedDoctorId, setSelectedDoctorId] = useState('')
  const [prescriptionItems, setPrescriptionItems] = useState([])
  const [selectedDrug, setSelectedDrug] = useState('')
  const [bmi, setBmi] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [patientSearch, setPatientSearch] = useState('')
  const [showPatientDialog, setShowPatientDialog] = useState(false)
  const [postWorkflow, setPostWorkflow] = useState(null) // { consultation, prescriptionId }
  const [labOrderItems, setLabOrderItems] = useState([])
  const [radiologyOrderItems, setRadiologyOrderItems] = useState([])
  const [selectedLabUrgency, setSelectedLabUrgency] = useState('routine')
  const [selectedRadUrgency, setSelectedRadUrgency] = useState('routine')
  const [ordersClinicalIndication, setOrdersClinicalIndication] = useState('')
  const [labTests, setLabTests] = useState([])
  const [radiologyExams, setRadiologyExams] = useState([])
  const [selectedLabTest, setSelectedLabTest] = useState('')
  const [selectedRadExam, setSelectedRadExam] = useState('')

  const [patients, setPatients] = useState([])
  const [doctors, setDoctors] = useState([])
  const [drugs, setDrugs] = useState([])
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading] = useState(true)

  const vitalsForm = useForm({
    resolver: zodResolver(vitalsSchema),
    defaultValues: DEFAULT_VITALS,
  })

  const clinicalForm = useForm({
    resolver: zodResolver(clinicalSchema),
    defaultValues: { chiefComplaint: '', historyOfPresentIllness: '', physicalExamination: '', diagnosis: '', icd10Code: '', treatmentPlan: '', followUpInstructions: '', followUpDate: '', referredTo: '', referralReason: '', notes: '' },
  })

  const selectedPatient = patients.find(p => p.id === selectedPatientId)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [cRes, pRes, uRes, dRes, lRes, rRes] = await Promise.allSettled([
      client.get('/consultations'),
      client.get('/patients?status=active&limit=500'),
      client.get('/settings?resource=users'),
      client.get('/pharmacy/drugs?limit=5000'),
      client.get('/laboratory?resource=tests'),
      client.get('/radiology?resource=exams'),
    ])
    if (cRes.status === 'fulfilled') setConsultations(cRes.value?.data ?? [])
    if (pRes.status === 'fulfilled') setPatients(pRes.value?.data ?? [])
    if (uRes.status === 'fulfilled') setDoctors((uRes.value?.data ?? []).filter(u => u.role === 'doctor' && u.isActive))
    if (dRes.status === 'fulfilled') setDrugs(dRes.value?.data ?? [])
    if (lRes.status === 'fulfilled') setLabTests((lRes.value?.data ?? []).filter(t => t.isActive !== false))
    if (rRes.status === 'fulfilled') setRadiologyExams((rRes.value?.data ?? []).filter(e => e.isActive !== false))
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { getOrgSettings().then(setOrgInfo) }, [])

  const filteredPatients = patientSearch
    ? patients.filter(p => {
        const q = patientSearch.toLowerCase()
        return getFullName(p).toLowerCase().includes(q) || p.mrn.toLowerCase().includes(q)
      })
    : patients

  const matchesDateFilter = (visitDate) => {
    if (filterDate === 'all') return true
    const d = new Date(visitDate)
    const now = new Date()
    if (filterDate === 'today') return d.toDateString() === now.toDateString()
    if (filterDate === 'week') {
      const start = new Date(now)
      const dow = (now.getDay() + 6) % 7 // Monday = 0
      start.setDate(now.getDate() - dow); start.setHours(0, 0, 0, 0)
      const end = new Date(start); end.setDate(start.getDate() + 7)
      return d >= start && d < end
    }
    if (filterDate === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    if (filterDate === 'specific') return !specificDate || d.toDateString() === new Date(specificDate + 'T00:00:00').toDateString()
    if (filterDate === 'custom') {
      let ok = true
      if (customStart) ok = ok && d >= new Date(customStart + 'T00:00:00')
      if (customEnd) ok = ok && d <= new Date(customEnd + 'T23:59:59')
      return ok
    }
    return true
  }

  const filteredConsultations = consultations.filter(c => {
    const name = c.patient ? getFullName(c.patient).toLowerCase() : ''
    const q = filterSearch.toLowerCase()
    const matchSearch = !filterSearch || name.includes(q) || (c.patient?.mrn || '').toLowerCase().includes(q) || (c.diagnosis || '').toLowerCase().includes(q)
    const matchDoctor = filterDoctor === 'all' || c.doctorId === filterDoctor
    return matchSearch && matchDoctor && matchesDateFilter(c.visitDate)
  })

  useEffect(() => {
    setCurrentPage(1)
  }, [filterSearch, filterDoctor, filterDate, specificDate, customStart, customEnd])

  const calcBMI = useCallback(() => {
    const w = vitalsForm.getValues('weight'), h = vitalsForm.getValues('height')
    if (w && h && h > 0) setBmi(Math.round(w / ((h / 100) ** 2) * 10) / 10)
  }, [vitalsForm])

  const addDrug = () => {
    const drug = drugs.find(d => d.id === selectedDrug)
    if (!drug) return
    setPrescriptionItems(prev => [...prev, { drugId: drug.id, drugName: drug.drugName, genericName: drug.genericName, dosage: '', frequency: 'TID', duration: '7 days', quantity: 21, instructions: '' }])
    setSelectedDrug('')
  }
  const removeDrug = (i) => setPrescriptionItems(p => p.filter((_, idx) => idx !== i))
  const updateItem = (i, field, value) =>
    setPrescriptionItems(p => p.map((item, idx) => idx === i ? { ...item, [field]: value } : item))

  const addLabTest = () => {
    const test = labTests.find(t => t.id === selectedLabTest)
    if (!test) return
    if (labOrderItems.find(i => i.testId === test.id)) { toast.error('Test already added'); return }
    setLabOrderItems(prev => [...prev, { testId: test.id, testName: test.testName, testCode: test.testCode || '', urgency: selectedLabUrgency, specimenType: test.specimenType || '' }])
    setSelectedLabTest('')
  }

  const removeLabItem = (testId) => setLabOrderItems(prev => prev.filter(i => i.testId !== testId))

  const addRadExam = () => {
    const exam = radiologyExams.find(e => e.id === selectedRadExam)
    if (!exam) return
    if (radiologyOrderItems.find(i => i.examId === exam.id)) { toast.error('Exam already added'); return }
    setRadiologyOrderItems(prev => [...prev, { examId: exam.id, examName: exam.examName, examCode: exam.examCode || '', examCategory: exam.examCategory || '', urgency: selectedRadUrgency, bodyPart: exam.bodyPart || '' }])
    setSelectedRadExam('')
  }

  const removeRadItem = (examId) => setRadiologyOrderItems(prev => prev.filter(i => i.examId !== examId))

  const resetForm = () => {
    vitalsForm.reset(DEFAULT_VITALS)
    clinicalForm.reset()
    setPrescriptionItems([])
    setLabOrderItems([])
    setRadiologyOrderItems([])
    setOrdersClinicalIndication('')
    setSelectedLabTest('')
    setSelectedRadExam('')
    setBmi(null)
    setSelectedPatientId('')
    setSelectedDoctorId('')
    setEditingId(null)
    setActiveTab('vitals')
  }

  const openEdit = (c) => {
    setEditingId(c.id)
    setSelectedPatientId(c.patientId)
    setSelectedDoctorId(c.doctorId)
    
    if (c.prescriptions && c.prescriptions.length > 0) {
      try { setPrescriptionItems(JSON.parse(c.prescriptions[0].items)) } catch(e) { setPrescriptionItems([]) }
    } else { setPrescriptionItems([]) }
    
    if (c.labOrders && c.labOrders.length > 0) {
      try {
        setLabOrderItems(JSON.parse(c.labOrders[0].tests))
        setOrdersClinicalIndication(c.labOrders[0].clinicalIndication || '')
      } catch(e) { setLabOrderItems([]) }
    } else { setLabOrderItems([]) }
    
    if (c.radiologyOrders && c.radiologyOrders.length > 0) {
      const allRadItems = []
      c.radiologyOrders.forEach(order => {
        // Prefer the exam included on the order; fall back to the catalog lookup.
        const exam = order.exam || radiologyExams.find(e => e.id === order.examId)
        if (exam) {
          allRadItems.push({
            examId: exam.id || order.examId,
            examName: exam.examName,
            examCode: exam.examCode || '',
            examCategory: exam.examCategory || '',
            urgency: order.urgency || 'routine',
            bodyPart: exam.bodyPart || ''
          })
        }
      })
      setRadiologyOrderItems(allRadItems)
    } else { setRadiologyOrderItems([]) }

    vitalsForm.reset({
      temperature: cToF(c.temperature) ?? undefined, // stored °C → show °F in form
      bloodPressureSystolic: c.bloodPressureSystolic ?? undefined,
      bloodPressureDiastolic: c.bloodPressureDiastolic ?? undefined,
      pulseRate: c.pulseRate ?? undefined,
      respiratoryRate: c.respiratoryRate ?? undefined,
      weight: c.weight ?? undefined,
      height: c.height ?? undefined,
      oxygenSaturation: c.oxygenSaturation ?? undefined,
    })
    clinicalForm.reset({
      chiefComplaint: c.chiefComplaint || '',
      historyOfPresentIllness: c.historyOfPresentIllness || '',
      physicalExamination: c.physicalExamination || '',
      diagnosis: c.diagnosis || '',
      icd10Code: (() => { try { const a = JSON.parse(c.icd10Codes || '[]'); return Array.isArray(a) ? a[0] || '' : '' } catch { return '' } })(),
      treatmentPlan: c.treatmentPlan || '',
      followUpInstructions: c.followUpInstructions || '',
      followUpDate: c.followUpDate ? format(new Date(c.followUpDate), 'yyyy-MM-dd') : '',
      referredTo: c.referredTo || '',
      referralReason: c.referralReason || '',
      notes: c.notes || '',
    })
    setView('form')
    setActiveTab('vitals')
  }

  const saveConsultation = async () => {
    if (!selectedPatientId) { toast.error('Please select a patient'); return }
    if (!selectedDoctorId) { toast.error('Please select a doctor'); return }
    const clinical = clinicalForm.getValues()
    const vitals = vitalsForm.getValues()
    if (!clinical.chiefComplaint || !clinical.diagnosis) {
      toast.error('Please fill in chief complaint and diagnosis')
      setActiveTab('clinical')
      return
    }
    setIsSaving(true)
    try {
      const payload = {
        patientId: selectedPatientId,
        doctorId: selectedDoctorId,
        visitType: 'outpatient',
        ...vitals,
        temperature: fToC(vitals.temperature) ?? undefined, // typed °F → store °C
        chiefComplaint: clinical.chiefComplaint,
        historyOfPresentIllness: clinical.historyOfPresentIllness,
        physicalExamination: clinical.physicalExamination,
        diagnosis: clinical.diagnosis,
        icd10Codes: clinical.icd10Code ? [clinical.icd10Code] : [],
        treatmentPlan: clinical.treatmentPlan,
        followUpInstructions: clinical.followUpInstructions,
        followUpDate: clinical.followUpDate || undefined,
        referredTo: clinical.referredTo,
        referralReason: clinical.referralReason,
        notes: clinical.notes,
        prescriptionItems: prescriptionItems.length > 0 ? prescriptionItems : undefined,
        // Backend + validation schema expect `labTests` / `radiologyExams` (not
        // labOrderItems/radiologyOrderItems) — mismatched keys were silently
        // stripped by Zod, so lab/radiology orders never got saved.
        labTests: labOrderItems.length > 0 ? labOrderItems : undefined,
        radiologyExams: radiologyOrderItems.length > 0 ? radiologyOrderItems : undefined,
        ordersClinicalIndication: ordersClinicalIndication || undefined,
      }

      if (editingId) {
        const upd = await client.patch(`/consultations/${editingId}`, payload)
        toast.success('Consultation updated successfully')
        const updData = upd?.data || upd
        const rxId = updData?.prescriptions?.[0]?.id || updData?.prescriptionId || null
        // Auto-send WhatsApp summary on update too
        client.post('/notifications/consultation', { consultationId: editingId })
          .then(() => toast.success('WhatsApp summary sent'))
          .catch(() => {})
        // Send prescription bill + YES/NO pharmacy purchase prompt
        if (rxId) {
          const consultFee = Number(payload.consultationFee) || 0
          setTimeout(() => {
            client.post('/notifications/prescription', { prescriptionId: rxId, consultationFee: consultFee })
              .then(() => toast.success('Pharmacy purchase prompt sent'))
              .catch(() => {})
          }, 3000)
        }
        resetForm()
        fetchAll()
        setView('list')
      } else {
        const res = await client.post('/consultations', payload)
        toast.success('Consultation saved successfully')
        const saved = res?.data || res
        // prescriptionId is returned at the TOP level of the response, not inside data
        const prescriptionId = res?.prescriptionId || saved?.prescriptionId || saved?.prescription?.id || null
        const patientObj = saved?.patient || patients.find(p => p.id === selectedPatientId) || null

        // Auto-send WhatsApp notification immediately
        if (saved?.id) {
          client.post('/notifications/consultation', { consultationId: saved.id })
            .then(() => toast.success('WhatsApp summary sent'))
            .catch(() => {})
        }

        // If prescription exists, send prescription + start the YES/NO pharmacy purchase bot flow
        if (prescriptionId) {
          const consultFee = Number(payload.consultationFee) || 0
          setTimeout(() => {
            client.post('/notifications/prescription', { prescriptionId, consultationFee: consultFee })
              .then(() => toast.success('Pharmacy purchase prompt sent'))
              .catch(() => {})
          }, 3000) // delay 3s so summary arrives first
        }

        setPostWorkflow({ consultation: { ...saved, patient: patientObj, prescriptionItems: payload.prescriptionItems }, prescriptionId })
        resetForm()
        fetchAll()
        setView('list')
      }
    } catch (err) {
      toast.error('Failed to save consultation')
    } finally {
      setIsSaving(false)
    }
  }

  // ── LIST VIEW ──
  if (view === 'list') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Stethoscope className="h-7 w-7 text-blue-600" />
              Consultations
            </h1>
            <p className="text-gray-500 text-sm">View, manage and print patient consultation records</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchAll}>
              <RefreshCw className="h-4 w-4 mr-1" />Refresh
            </Button>
            <Button onClick={() => { resetForm(); setView('form') }}>
              <Plus className="h-4 w-4 mr-2" />New Consultation
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total', value: consultations.length, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Today', value: consultations.filter(c => { const d = new Date(c.visitDate); const t = new Date(); return d.toDateString() === t.toDateString() }).length, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'This Week', value: consultations.filter(c => { const d = new Date(c.visitDate); const t = new Date(); return (t.getTime() - d.getTime()) < 7 * 86400000 }).length, color: 'text-purple-600', bg: 'bg-purple-50' },
            { label: 'With Rx', value: consultations.filter(c => c.prescriptions && c.prescriptions.length > 0).length, color: 'text-orange-600', bg: 'bg-orange-50' },
          ].map(s => (
            <Card key={s.label} className={`${s.bg} border-0`}>
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

        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input className="pl-9" placeholder="Search by patient name, UHID, diagnosis..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
          </div>
          <Select value={filterDoctor} onValueChange={setFilterDoctor}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Filter by doctor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Doctors</SelectItem>
              {doctors.map(d => <SelectItem key={d.id} value={d.id}>{d.fullName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterDate} onValueChange={setFilterDate}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Date" /></SelectTrigger>
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
            <Input type="date" className="w-44" value={specificDate} onChange={e => setSpecificDate(e.target.value)} />
          )}
          {filterDate === 'custom' && (
            <>
              <Input type="date" className="w-44" value={customStart} max={customEnd || undefined} onChange={e => setCustomStart(e.target.value)} />
              <span className="text-gray-400 text-sm">to</span>
              <Input type="date" className="w-44" value={customEnd} min={customStart || undefined} onChange={e => setCustomEnd(e.target.value)} />
            </>
          )}
          {(filterDate !== 'all' || filterDoctor !== 'all' || filterSearch) && (
            <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => { setFilterDate('all'); setSpecificDate(''); setCustomStart(''); setCustomEnd(''); setFilterDoctor('all'); setFilterSearch('') }}>
              <X className="h-4 w-4 mr-1" />Clear
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : filteredConsultations.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center py-16 text-center">
              <Stethoscope className="h-14 w-14 text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-600">No Consultations Found</h3>
              <p className="text-gray-400 text-sm mt-1 mb-6">{filterSearch || filterDoctor !== 'all' ? 'Try changing the filter criteria' : 'Start by creating a new consultation'}</p>
              {!filterSearch && filterDoctor === 'all' && (
                <Button onClick={() => { resetForm(); setView('form') }}>
                  <Plus className="h-4 w-4 mr-2" />New Consultation
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {(() => {
              const totalPages = Math.ceil(filteredConsultations.length / ITEMS_PER_PAGE)
              const startIdx = (currentPage - 1) * ITEMS_PER_PAGE
              const endIdx = startIdx + ITEMS_PER_PAGE
              const paginatedConsultations = filteredConsultations.slice(startIdx, endIdx)

              return (
                <>
                  {paginatedConsultations.map(c => {
                    const pat = c.patient
                    const patName = pat ? getFullName(pat) : 'Unknown Patient'
                    const patMrn = pat?.mrn || '—'
                    const patAge = pat?.dateOfBirth ? getAge(pat.dateOfBirth) : 0
                    const patGender = pat?.gender || ''
                    const docName = c.doctor?.fullName || '—'
                    const hasPrescription = c.prescriptions && c.prescriptions.length > 0
                    const bmiNum = c.weight && c.height ? Math.round(c.weight / ((c.height / 100) ** 2) * 10) / 10 : null
                    return (
                      <Card key={c.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <div className="h-11 w-11 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                              {initials(patName)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-base">{patName}</p>
                                  <p className="text-sm text-gray-500">UHID: {patMrn} &bull; {patAge} yrs &bull; {patGender}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  <div className="text-sm text-gray-500">{format(new Date(c.visitDate), 'dd MMM yyyy HH:mm')}</div>
                                  <Badge variant="outline" className="text-xs capitalize">{c.visitType || 'Outpatient'}</Badge>
                                </div>
                              </div>
                              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                                {c.chiefComplaint && <p className="text-sm"><span className="font-medium text-gray-600">Chief Complaint:</span> {c.chiefComplaint}</p>}
                                {c.diagnosis && <p className="text-sm"><span className="font-medium text-gray-600">Diagnosis:</span> {c.diagnosis}</p>}
                              </div>
                              {(c.temperature || c.bloodPressureSystolic || c.pulseRate || c.oxygenSaturation || bmiNum || c.followUpDate) && (
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                    {c.temperature && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5"><Thermometer className="h-3 w-3" />{cToF(c.temperature)}°F</span>}
                                    {c.bloodPressureSystolic && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5"><Heart className="h-3 w-3" />{c.bloodPressureSystolic}/{c.bloodPressureDiastolic}</span>}
                                    {c.pulseRate && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5"><Activity className="h-3 w-3" />{c.pulseRate} bpm</span>}
                                    {c.oxygenSaturation && <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5"><Droplet className="h-3 w-3" />{c.oxygenSaturation}%</span>}
                                    {bmiNum && <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5"><Scale className="h-3 w-3" />BMI {bmiNum}</span>}
                                  </div>
                                  {c.followUpDate && (() => {
                                    const fu = new Date(c.followUpDate)
                                    const today = new Date(); today.setHours(0, 0, 0, 0)
                                    const upcoming = fu >= today
                                    return (
                                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border ${upcoming ? 'bg-green-50 text-green-700 border-green-300' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                                        <CalendarClock className="h-3.5 w-3.5" />
                                        {upcoming ? 'Follow-up' : 'Follow-up was'}: {format(fu, 'dd MMM yyyy')}
                                      </span>
                                    )
                                  })()}
                                </div>
                              )}
                              <div className="mt-2 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-500">{drName(docName)}</span>
                                 
                                </div>
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" className="h-8 px-2 text-gray-600" onClick={() => setViewingConsultation(c)}>
                                    <Eye className="h-4 w-4 mr-1" />View
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-8 px-2 text-blue-600" onClick={() => openEdit(c)}>
                                    <Edit className="h-4 w-4 mr-1" />Edit
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-8 px-2 text-green-600" onClick={() => printConsultation(c, patName, patMrn, patAge, patGender, docName, orgInfo)}>
                                    <Printer className="h-4 w-4 mr-1" />Print
                                  </Button>
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
                  )}
                </>
              )
            })()}
          </div>
        )}

        {/* View Dialog */}
        <Dialog open={!!viewingConsultation} onOpenChange={() => setViewingConsultation(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Consultation Record</DialogTitle>
              <DialogDescription>
                {viewingConsultation && viewingConsultation.patient
                  ? `${getFullName(viewingConsultation.patient)} (${viewingConsultation.patient.mrn}) — ${format(new Date(viewingConsultation.visitDate), 'dd MMM yyyy')}`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            {viewingConsultation && (() => {
              const c = viewingConsultation
              const pat = c.patient
              const patName = pat ? getFullName(pat) : 'Unknown'
              const docName = c.doctor?.fullName || '—'
              return (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-blue-50 p-3 rounded-lg">
                    <div><p className="text-gray-500 font-medium">Patient</p><p className="font-semibold">{patName}</p></div>
                    <div><p className="text-gray-500 font-medium">UHID</p><p>{pat?.mrn || '—'}</p></div>
                    <div><p className="text-gray-500 font-medium">Age / Sex</p><p>{pat?.dateOfBirth ? getAge(pat.dateOfBirth) : '—'} yrs / {pat?.gender}</p></div>
                    <div><p className="text-gray-500 font-medium">Doctor</p><p>{drName(docName)}</p></div>
                    <div><p className="text-gray-500 font-medium">Visit Date</p><p>{format(new Date(c.visitDate), 'dd MMM yyyy HH:mm')}</p></div>
                    <div><p className="text-gray-500 font-medium">Visit Type</p><p className="capitalize">{c.visitType || 'Outpatient'}</p></div>
                  </div>
                  {(c.temperature || c.pulseRate || c.bloodPressureSystolic) && (
                    <div>
                      <p className="font-semibold text-gray-700 mb-2 uppercase text-xs tracking-wide">Vital Signs</p>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: 'Temp', value: c.temperature ? `${cToF(c.temperature)}°F` : null },
                          { label: 'BP', value: c.bloodPressureSystolic ? `${c.bloodPressureSystolic}/${c.bloodPressureDiastolic} mmHg` : null },
                          { label: 'Pulse', value: c.pulseRate ? `${c.pulseRate} bpm` : null },
                          { label: 'SpO₂', value: c.oxygenSaturation ? `${c.oxygenSaturation}%` : null },
                          { label: 'Weight', value: c.weight ? `${c.weight} kg` : null },
                          { label: 'Height', value: c.height ? `${c.height} cm` : null },
                          { label: 'Resp Rate', value: c.respiratoryRate ? `${c.respiratoryRate}/min` : null },
                          { label: 'BMI', value: c.weight && c.height ? `${(c.weight / ((c.height / 100) ** 2)).toFixed(1)}` : null },
                        ].filter(v => v.value).map(v => (
                          <div key={v.label} className="bg-gray-50 rounded p-2 text-center">
                            <p className="text-xs text-gray-400">{v.label}</p>
                            <p className="font-semibold text-blue-700">{v.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <Separator />
                  {c.chiefComplaint && <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Chief Complaint</p><p>{c.chiefComplaint}</p></div>}
                  {c.historyOfPresentIllness && <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">History of Present Illness</p><p className="whitespace-pre-wrap">{c.historyOfPresentIllness}</p></div>}
                  {c.physicalExamination && <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Physical Examination</p><p className="whitespace-pre-wrap">{c.physicalExamination}</p></div>}
                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                    <p className="font-semibold text-blue-800 text-xs uppercase tracking-wide mb-1">Diagnosis</p>
                    <p className="text-base font-medium">{c.diagnosis || '—'}</p>
                  </div>
                  {c.treatmentPlan && <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Treatment Plan</p><p className="whitespace-pre-wrap">{c.treatmentPlan}</p></div>}
                  {c.followUpDate && <div className="bg-green-50 border border-green-200 rounded p-2"><p className="text-green-800 font-medium">Follow-up: {format(new Date(c.followUpDate), 'dd MMM yyyy')}</p>{c.followUpInstructions && <p className="text-sm text-green-700">{c.followUpInstructions}</p>}</div>}
                  {c.referredTo && <div className="bg-yellow-50 border border-yellow-200 rounded p-2"><p className="font-medium">Referral: {c.referredTo}</p>{c.referralReason && <p className="text-sm">{c.referralReason}</p>}</div>}
                  {c.notes && <div><p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Notes</p><p>{c.notes}</p></div>}

                  {/* Medicines prescribed (from prescriptions[].items JSON) */}
                  {(() => {
                    const meds = (c.prescriptions || []).flatMap(rx => { try { return JSON.parse(rx.items || '[]') } catch { return [] } })
                    if (!meds.length) return null
                    return (
                      <div>
                        <p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Medicines Prescribed</p>
                        <div className="border rounded divide-y">
                          {meds.map((m, i) => (
                            <div key={i} className="p-2 flex flex-wrap justify-between gap-2">
                              <span className="font-medium">{m.drugName || m.name || '—'}{m.strength ? ` ${m.strength}` : ''}</span>
                              <span className="text-gray-500 text-xs">{[m.dosage, m.frequency, m.duration, m.quantity ? `Qty: ${m.quantity}` : null, m.instructions].filter(Boolean).join(' · ')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Lab tests ordered (from labOrders[].tests JSON) */}
                  {(() => {
                    const labs = (c.labOrders || []).flatMap(o => { try { return JSON.parse(o.tests || '[]') } catch { return [] } })
                    if (!labs.length) return null
                    return (
                      <div>
                        <p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Lab Tests Ordered</p>
                        <div className="flex flex-wrap gap-2">
                          {labs.map((t, i) => (
                            <span key={i} className="inline-block bg-purple-50 text-purple-700 border border-purple-200 rounded px-2 py-0.5 text-xs">{t.testName || t.name || t.testCode || '—'}</span>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Radiology exams ordered (from radiologyOrders[].exam) */}
                  {(() => {
                    const rads = (c.radiologyOrders || []).map(o => o.exam?.examName || o.examName).filter(Boolean)
                    if (!rads.length) return null
                    return (
                      <div>
                        <p className="font-semibold text-gray-700 uppercase text-xs tracking-wide mb-1">Radiology Ordered</p>
                        <div className="flex flex-wrap gap-2">
                          {rads.map((n, i) => (
                            <span key={i} className="inline-block bg-cyan-50 text-cyan-700 border border-cyan-200 rounded px-2 py-0.5 text-xs">{n}</span>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })()}
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewingConsultation(null)}>Close</Button>
              {viewingConsultation && (
                <>
                  <Button variant="outline" onClick={() => { openEdit(viewingConsultation); setViewingConsultation(null) }}>
                    <Edit className="h-4 w-4 mr-1" />Edit
                  </Button>
                  <Button onClick={() => {
                    const c = viewingConsultation
                    printConsultation(c, c.patient ? getFullName(c.patient) : 'Unknown', c.patient?.mrn || '—', c.patient?.dateOfBirth ? getAge(c.patient.dateOfBirth) : 0, c.patient?.gender || '', c.doctor?.fullName || '—', orgInfo)
                  }}>
                    <Printer className="h-4 w-4 mr-1" />Print Report
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ── FORM VIEW ──
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { resetForm(); setView('list') }}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Stethoscope className="h-6 w-6 text-blue-600" />
              {editingId ? 'Edit Consultation' : 'New Consultation'}
            </h1>
            <p className="text-gray-400 text-xs">Fill all sections then click Save</p>
          </div>
        </div>
        <Button onClick={saveConsultation} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {isSaving ? 'Saving...' : editingId ? 'Update Consultation' : 'Save Consultation'}
        </Button>
      </div>

      {/* Patient & Doctor */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">Patient *</Label>
              {selectedPatient ? (
                <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-blue-200">
                  <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
                    {initials(getFullName(selectedPatient))}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">{getFullName(selectedPatient)}</p>
                    <p className="text-xs text-gray-500">UHID: {selectedPatient.mrn} &bull; {getAge(selectedPatient.dateOfBirth)} yrs &bull; {selectedPatient.gender}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setShowPatientDialog(true)}>Change</Button>
                </div>
              ) : (
                <Button variant="outline" className="w-full justify-start h-auto py-3 bg-white" onClick={() => setShowPatientDialog(true)}>
                  <User className="h-5 w-5 mr-2 text-gray-400" />
                  <span className="text-gray-500">Click to select a patient...</span>
                </Button>
              )}
            </div>
            <div>
              <Label className="text-sm font-medium mb-2 block">Attending Doctor *</Label>
              <Select value={selectedDoctorId} onValueChange={setSelectedDoctorId}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Select doctor" /></SelectTrigger>
                <SelectContent>
                  {doctors.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      {drName(d.fullName)}{d.specialization ? ` — ${d.specialization}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Patient select dialog */}
      <Dialog open={showPatientDialog} onOpenChange={setShowPatientDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select Patient</DialogTitle>
            <DialogDescription>Search and select a patient</DialogDescription>
          </DialogHeader>
          <PatientLookup
            showHint={false}
            selectedPatient={null}
            onSelect={(p) => {
              setPatients(prev => prev.some(x => x.id === p.id) ? prev : [p, ...prev])
              setSelectedPatientId(p.id)
              setShowPatientDialog(false)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="vitals">Vital Signs</TabsTrigger>
          <TabsTrigger value="clinical">Clinical Notes</TabsTrigger>
          <TabsTrigger value="prescription">Prescription</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
        </TabsList>

        {/* Vitals */}
        <TabsContent value="vitals" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-blue-600" />Vital Signs</CardTitle>
              <CardDescription>Record patient vital signs</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...vitalsForm}>
                <form className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { name: 'temperature',           label: 'Temperature (°F)',   icon: <Thermometer className="h-4 w-4 text-red-500" />,    step: '0.1', parse: parseFloat },
                      { name: 'bloodPressureSystolic', label: 'BP Systolic (mmHg)', icon: <Heart className="h-4 w-4 text-red-500" />,          step: '1',   parse: parseInt },
                      { name: 'bloodPressureDiastolic',label: 'BP Diastolic (mmHg)',icon: <Heart className="h-4 w-4 text-red-400" />,          step: '1',   parse: parseInt },
                      { name: 'pulseRate',             label: 'Pulse Rate (bpm)',   icon: <Activity className="h-4 w-4 text-pink-500" />,      step: '1',   parse: parseInt },
                      { name: 'respiratoryRate',       label: 'Resp Rate (/min)',   icon: <Wind className="h-4 w-4 text-cyan-500" />,          step: '1',   parse: parseInt },
                      { name: 'weight',                label: 'Weight (kg)',        icon: <Scale className="h-4 w-4 text-purple-500" />,       step: '0.1', parse: parseFloat },
                      { name: 'height',                label: 'Height (cm)',        icon: <Ruler className="h-4 w-4 text-orange-500" />,       step: '0.1', parse: parseFloat },
                      { name: 'oxygenSaturation',      label: 'SpO₂ (%)',           icon: <Droplet className="h-4 w-4 text-blue-500" />,       step: '1',   parse: parseFloat },
                    ].map(f => (
                      <FormField key={f.name} control={vitalsForm.control} name={f.name} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-1">{f.icon}{f.label}</FormLabel>
                          <FormControl>
                            <Input type="number" step={f.step} {...field}
                              onChange={e => { field.onChange(f.parse(e.target.value)); if (f.name === 'weight' || f.name === 'height') setTimeout(calcBMI, 100) }} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    ))}
                  </div>
                  {bmi && (
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <Scale className="h-5 w-5 text-purple-500" />
                      <div>
                        <p className="text-sm font-medium">BMI: <span className="text-lg font-bold">{bmi}</span></p>
                        <p className={`text-sm font-medium ${bmiCategory(bmi).color}`}>{bmiCategory(bmi).label}</p>
                      </div>
                    </div>
                  )}
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Clinical Notes */}
        <TabsContent value="clinical" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />Clinical Notes</CardTitle>
              <CardDescription>SOAP format — Subjective, Objective, Assessment, Plan</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...clinicalForm}>
                <form className="space-y-4">
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-xs font-semibold text-blue-700 uppercase mb-2">S — Subjective</p>
                    <div className="space-y-3">
                      <FormField control={clinicalForm.control} name="chiefComplaint" render={({ field }) => (
                        <FormItem><FormLabel>Chief Complaint *</FormLabel><FormControl><Input placeholder="Main reason for visit..." {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={clinicalForm.control} name="historyOfPresentIllness" render={({ field }) => (
                        <FormItem><FormLabel>History of Present Illness</FormLabel><FormControl><Textarea rows={3} placeholder="Onset, duration, character..." {...field} /></FormControl></FormItem>
                      )} />
                    </div>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                    <p className="text-xs font-semibold text-green-700 uppercase mb-2">O — Objective</p>
                    <FormField control={clinicalForm.control} name="physicalExamination" render={({ field }) => (
                      <FormItem><FormLabel>Physical Examination</FormLabel><FormControl><Textarea rows={3} placeholder="General appearance, systems examination findings..." {...field} /></FormControl></FormItem>
                    )} />
                  </div>
                  <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                    <p className="text-xs font-semibold text-yellow-700 uppercase mb-2">A — Assessment</p>
                    <div className="space-y-3">
                      <FormField control={clinicalForm.control} name="diagnosis" render={({ field }) => (
                        <FormItem><FormLabel>Diagnosis *</FormLabel><FormControl><Input placeholder="Working diagnosis..." {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={clinicalForm.control} name="icd10Code" render={({ field }) => (
                        <FormItem>
                          <FormLabel>ICD-10 Code</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select ICD-10 code (optional)" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {ICD10_CODES.map(c => <SelectItem key={c.code} value={c.code}>{c.code} — {c.description}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                    <p className="text-xs font-semibold text-purple-700 uppercase mb-2">P — Plan</p>
                    <div className="space-y-3">
                      <FormField control={clinicalForm.control} name="treatmentPlan" render={({ field }) => (
                        <FormItem><FormLabel>Treatment Plan</FormLabel><FormControl><Textarea rows={3} placeholder="Medications, procedures, lifestyle advice..." {...field} /></FormControl></FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={clinicalForm.control} name="followUpDate" render={({ field }) => (
                          <FormItem><FormLabel>Follow-up Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                        )} />
                        <FormField control={clinicalForm.control} name="followUpInstructions" render={({ field }) => (
                          <FormItem><FormLabel>Follow-up Instructions</FormLabel><FormControl><Input placeholder="Return if..." {...field} /></FormControl></FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={clinicalForm.control} name="referredTo" render={({ field }) => (
                          <FormItem><FormLabel>Referred To</FormLabel><FormControl><Input placeholder="Specialist / department..." {...field} /></FormControl></FormItem>
                        )} />
                        <FormField control={clinicalForm.control} name="referralReason" render={({ field }) => (
                          <FormItem><FormLabel>Referral Reason</FormLabel><FormControl><Input placeholder="Reason for referral..." {...field} /></FormControl></FormItem>
                        )} />
                      </div>
                      <FormField control={clinicalForm.control} name="notes" render={({ field }) => (
                        <FormItem><FormLabel>Additional Notes</FormLabel><FormControl><Textarea rows={2} placeholder="Any additional notes..." {...field} /></FormControl></FormItem>
                      )} />
                    </div>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Prescription */}
        <TabsContent value="prescription" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Pill className="h-5 w-5 text-green-600" />Prescription</CardTitle>
              <CardDescription>Add medications to the prescription</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <SearchableSelect
                  className="flex-1"
                  value={selectedDrug}
                  onChange={setSelectedDrug}
                  placeholder="Search and select a drug..."
                  searchPlaceholder="Type drug or generic name..."
                  emptyText={drugs.length === 0 ? 'No drugs available — seed pharmacy first' : 'No matching drugs'}
                  options={drugs.map(d => ({
                    value: d.id,
                    label: `${d.drugName}${d.strength ? ` — ${d.strength}` : ''}`,
                    sublabel: d.genericName || '',
                    keywords: `${d.genericName || ''} ${d.strength || ''}`,
                  }))}
                />
                <Button onClick={addDrug} disabled={!selectedDrug}><Plus className="h-4 w-4 mr-1" />Add</Button>
              </div>
              {prescriptionItems.length === 0 ? (
                <div className="text-center py-10 text-gray-400 border-2 border-dashed rounded-lg">
                  <Pill className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No medications added yet</p>
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto border rounded-lg">
                  <div className="space-y-3 p-3">
                    {prescriptionItems.map((item, i) => (
                      <div key={i} className="border rounded-lg p-3 bg-gray-50">
                        <div className="flex justify-between mb-2">
                          <div>
                            <p className="font-semibold">{item.drugName}</p>
                            {item.genericName && <p className="text-xs text-gray-500">{item.genericName}</p>}
                          </div>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeDrug(i)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                          <div>
                            <Label className="text-xs text-gray-500">Dosage</Label>
                            <Input className="h-8 text-sm" value={item.dosage} placeholder="e.g. 500mg" onChange={e => updateItem(i, 'dosage', e.target.value)} />
                          </div>
                          <div>
                            <Label className="text-xs text-gray-500">Frequency</Label>
                            <Select value={item.frequency} onValueChange={v => updateItem(i, 'frequency', v)}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {['OD', 'BD', 'TID', 'QID', 'SOS', 'Stat', 'HS', 'AC', 'PC'].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-gray-500">Duration</Label>
                            <Select value={item.duration} onValueChange={v => updateItem(i, 'duration', v)}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {['1 day', '3 days', '5 days', '7 days', '10 days', '14 days', '1 month', '3 months', 'Ongoing'].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-gray-500">Quantity</Label>
                            <Input className="h-8 text-sm" type="number" value={item.quantity} onChange={e => updateItem(i, 'quantity', parseInt(e.target.value))} />
                          </div>
                          <div className="col-span-2 md:col-span-4">
                            <Label className="text-xs text-gray-500">Instructions</Label>
                            <Input className="h-8 text-sm" value={item.instructions} placeholder="e.g. Take after food" onChange={e => updateItem(i, 'instructions', e.target.value)} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Orders */}
        <TabsContent value="orders" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Clinical Indication</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea rows={2} placeholder="Reason for ordering these tests..." value={ordersClinicalIndication} onChange={e => setOrdersClinicalIndication(e.target.value)} />
            </CardContent>
          </Card>

          {/* Lab Orders */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-blue-600" />Laboratory Tests</CardTitle>
              <CardDescription>Add lab tests to order for this consultation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <SearchableSelect
                  className="flex-1"
                  value={selectedLabTest}
                  onChange={setSelectedLabTest}
                  placeholder="Search and select a lab test..."
                  searchPlaceholder="Type test name or code..."
                  emptyText={labTests.length === 0 ? 'No lab tests available' : 'No matching tests'}
                  options={labTests.map(t => ({
                    value: t.id,
                    label: `${t.testName}${t.testCode ? ` (${t.testCode})` : ''}`,
                    sublabel: [t.testCategory, t.specimenType].filter(Boolean).join(' · '),
                    keywords: `${t.testCode || ''} ${t.testCategory || ''}`,
                  }))}
                />
                <Select value={selectedLabUrgency} onValueChange={setSelectedLabUrgency}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="routine">Routine</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="stat">STAT</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={addLabTest} disabled={!selectedLabTest}><Plus className="h-4 w-4 mr-1" />Add</Button>
              </div>
              {labOrderItems.length === 0 ? (
                <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                  <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No lab tests ordered yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {labOrderItems.map(item => (
                    <div key={item.testId} className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                      <FlaskConical className="h-4 w-4 text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{item.testName}</p>
                        {item.testCode && <p className="text-xs text-gray-500">{item.testCode}{item.specimenType ? ` · ${item.specimenType}` : ''}</p>}
                      </div>
                      <Badge className={item.urgency === 'stat' ? 'bg-red-100 text-red-800' : item.urgency === 'urgent' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}>
                        {item.urgency}
                      </Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 shrink-0" onClick={() => removeLabItem(item.testId)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Radiology Orders */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Scan className="h-5 w-5 text-purple-600" />Radiology Exams</CardTitle>
              <CardDescription>Add radiology exams to order for this consultation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <SearchableSelect
                  className="flex-1"
                  value={selectedRadExam}
                  onChange={setSelectedRadExam}
                  placeholder="Search and select a radiology exam..."
                  searchPlaceholder="Type exam name, modality or body part..."
                  emptyText={radiologyExams.length === 0 ? 'No radiology exams available' : 'No matching exams'}
                  options={radiologyExams.map(e => ({
                    value: e.id,
                    label: `${e.examName}${e.examCode ? ` (${e.examCode})` : ''}`,
                    sublabel: [e.examCategory && e.examCategory.toUpperCase(), e.bodyPart, e.modality].filter(Boolean).join(' · '),
                    keywords: `${e.examCode || ''} ${e.examCategory || ''} ${e.bodyPart || ''} ${e.modality || ''}`,
                  }))}
                />
                <Select value={selectedRadUrgency} onValueChange={setSelectedRadUrgency}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="routine">Routine</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="stat">STAT</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={addRadExam} disabled={!selectedRadExam}><Plus className="h-4 w-4 mr-1" />Add</Button>
              </div>
              {radiologyOrderItems.length === 0 ? (
                <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                  <Scan className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No radiology exams ordered yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {radiologyOrderItems.map(item => (
                    <div key={item.examId} className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                      <Scan className="h-4 w-4 text-purple-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{item.examName}</p>
                        {item.examCode && <p className="text-xs text-gray-500">{item.examCode}{item.examCategory ? ` · ${item.examCategory.toUpperCase()}` : ''}{item.bodyPart ? ` · ${item.bodyPart}` : ''}</p>}
                      </div>
                      <Badge className={item.urgency === 'stat' ? 'bg-red-100 text-red-800' : item.urgency === 'urgent' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}>
                        {item.urgency}
                      </Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 shrink-0" onClick={() => removeRadItem(item.examId)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Post-consultation workflow modal */}
      {postWorkflow && (
        <PostConsultationWorkflow
          consultation={postWorkflow.consultation}
          prescriptionId={postWorkflow.prescriptionId}
          onClose={() => setPostWorkflow(null)}
        />
      )}
    </div>
  )
}
