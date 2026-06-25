import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { getOrgSettings } from '@/lib/orgSettings'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  Users, Plus, Search, RefreshCw, Eye, Edit, UserPlus, Phone,
  Shield, Loader2, AlertTriangle, ChevronLeft, ChevronRight, Printer, Trash2,
  FlaskConical, Scan, AlertCircle, FileText, Microscope, ScanLine, BedDouble,
  CalendarDays, IndianRupee, XCircle, Clock
} from 'lucide-react'
import client from '@/api/client'
import RegisterPatientForm from '@/components/common/RegisterPatientForm'
import { useDateFilter } from '@/components/common/DateFilter'

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry'
]

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

const INSURANCE_PROVIDERS = [
  'CGHS', 'ESIC', 'PM-JAY (Ayushman Bharat)', 'Star Health', 'HDFC ERGO',
  'Niva Bupa', 'Care Health', 'ICICI Lombard', 'Bajaj Allianz', 'LIC Health',
  'United India', 'New India Assurance', 'Oriental Insurance', 'National Insurance',
  'Max Bupa', 'Reliance Health', 'SBI Health', 'Tata AIG',
]

const patientSchema = z.object({
  firstName: z.string().min(2, 'First name is required'),
  middleName: z.string().optional(),
  lastName: z.string().min(2, 'Last name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other']),
  phonePrimary: z.string().min(10, 'Valid phone number required'),
  phoneSecondary: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  region: z.string().optional(),
  zone: z.string().optional(),
  woreda: z.string().optional(),
  kebele: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  bloodGroup: z.string().optional(),
  hasInsurance: z.boolean().optional().default(false),
  insuranceProvider: z.string().optional(),
  insuranceId: z.string().optional(),
})

const getFullName = (p) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')
const calculateAge = (dob) => {
  const today = new Date()
  const birthDate = new Date(dob)
  let age = today.getFullYear() - birthDate.getFullYear()
  const m = today.getMonth() - birthDate.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--
  return age
}
const initials = (name) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

// Defined OUTSIDE PatientsModule so React never recreates the component type on re-render
function PatientForm({ form, isSubmitting, onSubmitFn, submitLabel }) {
  const [otherProvider, setOtherProvider] = useState(false)
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmitFn)} className="space-y-4">
        {/* Name */}
        <div className="grid grid-cols-3 gap-3">
          {['firstName', 'middleName', 'lastName'].map((name) => (
            <FormField key={name} control={form.control} name={name} render={({ field }) => (
              <FormItem>
                <FormLabel>{name === 'firstName' ? 'First Name *' : name === 'middleName' ? 'Middle Name' : 'Last Name *'}</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          ))}
        </div>

        {/* DOB & Gender */}
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="dateOfBirth" render={({ field }) => (
            <FormItem>
              <FormLabel>Date of Birth *</FormLabel>
              <FormControl><Input type="date" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="gender" render={({ field }) => (
            <FormItem>
              <FormLabel>Gender *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* Phone & Email */}
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="phonePrimary" render={({ field }) => (
            <FormItem>
              <FormLabel>Phone (Primary) *</FormLabel>
              <FormControl><Input placeholder="+91XXXXXXXXXX" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl><Input type="email" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* State & Blood Group */}
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="region" render={({ field }) => (
            <FormItem>
              <FormLabel>State / Region</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger></FormControl>
                <SelectContent>
                  {INDIAN_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormItem>
          )} />
          <FormField control={form.control} name="bloodGroup" render={({ field }) => (
            <FormItem>
              <FormLabel>Blood Group</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                <SelectContent>
                  {BLOOD_GROUPS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormItem>
          )} />
        </div>

        {/* Emergency Contact */}
        <div className="grid grid-cols-3 gap-3">
          <FormField control={form.control} name="emergencyContactName" render={({ field }) => (
            <FormItem>
              <FormLabel>Emergency Contact</FormLabel>
              <FormControl><Input placeholder="Contact name" {...field} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="emergencyContactPhone" render={({ field }) => (
            <FormItem>
              <FormLabel>Contact Phone</FormLabel>
              <FormControl><Input placeholder="Phone number" {...field} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="emergencyContactRelationship" render={({ field }) => (
            <FormItem>
              <FormLabel>Relationship</FormLabel>
              <FormControl><Input placeholder="e.g. Spouse" {...field} /></FormControl>
            </FormItem>
          )} />
        </div>

        {/* Insurance */}
        {(() => {
          const hasIns = form.watch('hasInsurance')
          const provider = form.watch('insuranceProvider') || ''
          const inList = INSURANCE_PROVIDERS.includes(provider)
          const isOther = otherProvider || (!!provider && !inList)
          return (
            <div className="rounded-lg border p-3 space-y-3 bg-gray-50/50">
              {/* Step 1: ask if patient has insurance */}
              <FormField control={form.control} name="hasInsurance" render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(!!checked)
                        if (!checked) {
                          form.setValue('insuranceProvider', '')
                          form.setValue('insuranceId', '')
                          setOtherProvider(false)
                        }
                      }}
                    />
                  </FormControl>
                  <FormLabel className="cursor-pointer font-medium">Patient has health insurance</FormLabel>
                </FormItem>
              )} />

              {/* Step 2: only if insured, show provider + ID */}
              {hasIns && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <FormItem>
                    <FormLabel>Insurance Provider *</FormLabel>
                    <Select
                      value={isOther ? 'Other' : provider}
                      onValueChange={(v) => {
                        if (v === 'Other') { setOtherProvider(true); form.setValue('insuranceProvider', '') }
                        else { setOtherProvider(false); form.setValue('insuranceProvider', v) }
                      }}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {INSURANCE_PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        <SelectItem value="Other">Other (type below)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>

                  <FormField control={form.control} name="insuranceId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance ID / Policy No. *</FormLabel>
                      <FormControl><Input placeholder="e.g. POL123456789" {...field} /></FormControl>
                    </FormItem>
                  )} />

                  {/* Step 3: if "Other", let them type the provider name */}
                  {isOther && (
                    <FormField control={form.control} name="insuranceProvider" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Provider Name (Other) *</FormLabel>
                        <FormControl><Input placeholder="Type insurance company name" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  )}
                </div>
              )}
            </div>
          )
        })()}

        <DialogFooter>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

export default function PatientsModule() {
  const [patients, setPatients] = useState([])
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [offset, setOffset] = useState(0)
  const dateFilter = useDateFilter()
  const { startDate: dfStart, endDate: dfEnd } = dateFilter.range
  const limit = 10

  const [showRegDialog, setShowRegDialog] = useState(false)
  const location = useLocation()

  // Auto-open the registration dialog when navigated here from a bed click
  // (e.g. /patients?register=1). Works via query param or history state.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('register') === '1' || location.state?.openNew) {
      setShowRegDialog(true)
    }
  }, [location.search, location.state])
  const [showViewDialog, setShowViewDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [viewTab, setViewTab] = useState('overview')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Lab/pathology + radiology reports for the selected patient (live)
  const [records, setRecords] = useState({ labOrders: [], radiologyOrders: [], admissions: [], appointments: [], invoices: [], patientDocuments: [], billing: null })
  const [recordsLoading, setRecordsLoading] = useState(false)

  const fetchRecords = useCallback(async (patientId) => {
    if (!patientId) return
    try {
      const res = await client.get(`/patients/${patientId}/records`)
      if (res.success) setRecords(res.data)
    } catch {
      // keep last known records on transient errors
    }
  }, [])

  const [cancellingId, setCancellingId] = useState(null)
  const cancelAppointment = useCallback(async (appt) => {
    if (!window.confirm('Cancel this appointment?')) return
    setCancellingId(appt.id)
    try {
      const res = await client.patch(`/appointments/${appt.id}`, { status: 'cancelled' })
      if (res.success !== false) {
        toast.success('Appointment cancelled')
        if (selectedPatient) fetchRecords(selectedPatient.id)
      } else {
        toast.error(res.error || 'Failed to cancel')
      }
    } catch (err) {
      toast.error('Failed to cancel appointment')
    } finally {
      setCancellingId(null)
    }
  }, [selectedPatient, fetchRecords])

  const openPatient = useCallback((patient, tab = 'overview') => {
    setSelectedPatient(patient)
    setViewTab(tab)
    setRecords({ labOrders: [], radiologyOrders: [], admissions: [], appointments: [], invoices: [], patientDocuments: [], billing: null })
    setRecordsLoading(true)
    setShowViewDialog(true)
    fetchRecords(patient.id).finally(() => setRecordsLoading(false))
  }, [fetchRecords])

  // Real-time: poll the open patient's reports every 12s so new lab/radiology
  // results created elsewhere show up without reopening the dialog.
  useEffect(() => {
    if (!showViewDialog || !selectedPatient) return
    const t = setInterval(() => fetchRecords(selectedPatient.id), 12000)
    return () => clearInterval(t)
  }, [showViewDialog, selectedPatient, fetchRecords])

  const form = useForm({
    resolver: zodResolver(patientSchema),
    defaultValues: {
      firstName: '', middleName: '', lastName: '', dateOfBirth: '',
      gender: 'male', phonePrimary: '', phoneSecondary: '', email: '',
      region: '', zone: '', woreda: '', kebele: '',
      emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelationship: '',
      bloodGroup: '', hasInsurance: false, insuranceProvider: '', insuranceId: '',
    },
  })

  const fetchPatients = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status !== 'all') params.set('status', status)
      if (dfStart) params.set('startDate', dfStart)
      if (dfEnd) params.set('endDate', dfEnd)
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      const res = await client.get(`/patients?${params}`)
      setPatients(res.data ?? [])
      setTotal(res.meta?.total ?? 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [search, status, offset, dfStart, dfEnd])

  useEffect(() => { fetchPatients() }, [fetchPatients])
  useEffect(() => { getOrgSettings().then(setOrgInfo) }, [])
  useEffect(() => { setOffset(0) }, [search, status, dfStart, dfEnd])

  const onSubmit = async (data) => {
    try {
      setIsSubmitting(true)
      const res = await client.post('/patients', data)
      toast.success(res.message || `Patient registered. UHID: ${res.data?.mrn}`)
      setShowRegDialog(false)
      form.reset()
      fetchPatients()
    } catch (err) {
      toast.error(err.message || 'Failed to register patient')
    } finally {
      setIsSubmitting(false)
    }
  }

  const onEdit = async (data) => {
    if (!selectedPatient) return
    try {
      setIsSubmitting(true)
      await client.patch(`/patients/${selectedPatient.id}`, data)
      toast.success('Patient updated successfully')
      setShowEditDialog(false)
      fetchPatients()
    } catch (err) {
      toast.error(err.message || 'Failed to update patient')
    } finally {
      setIsSubmitting(false)
    }
  }

  const openEdit = (patient) => {
    setSelectedPatient(patient)
    form.reset({
      firstName: patient.firstName || '',
      middleName: patient.middleName || '',
      lastName: patient.lastName || '',
      dateOfBirth: patient.dateOfBirth ? format(new Date(patient.dateOfBirth), 'yyyy-MM-dd') : '',
      gender: patient.gender || 'male',
      phonePrimary: patient.phonePrimary || '',
      phoneSecondary: patient.phoneSecondary || '',
      email: patient.email || '',
      region: patient.region || '',
      zone: patient.zone || '',
      woreda: patient.woreda || '',
      kebele: patient.kebele || '',
      emergencyContactName: patient.emergencyContactName || '',
      emergencyContactPhone: patient.emergencyContactPhone || '',
      emergencyContactRelationship: patient.emergencyContactRelationship || '',
      bloodGroup: patient.bloodGroup || '',
      hasInsurance: patient.hasInsurance || false,
      insuranceProvider: patient.insuranceProvider || '',
      insuranceId: patient.insuranceId || '',
    })
    setShowEditDialog(true)
  }

  // Uses a hidden iframe instead of window.open to avoid popup blockers
  const handlePrintCard = (patient) => {
    const name = getFullName(patient)
    const age = patient.dateOfBirth ? `${calculateAge(patient.dateOfBirth)} Yrs` : '0 Yrs'
    const gender = patient.gender ? patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1) : '—'
    const printedAt = format(new Date(), 'dd/MM/yyyy HH:mm')
    const dateStr = format(new Date(), 'dd / MM / yyyy')
    const orgAddr = [orgInfo.address, orgInfo.city].filter(Boolean).join(', ')
    const win = window.open('', '_blank', 'width=800,height=1050')
    if (!win) { toast.error('Please allow pop-ups to print'); return }
    win.document.write(`<!DOCTYPE html><html>
<head><title>Prescription — ${patient.mrn}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;background:#fff;padding:0}
.page{max-width:210mm;margin:0 auto;padding:10mm 12mm 8mm;min-height:297mm;position:relative}
.meta-top{display:flex;justify-content:space-between;font-size:8pt;color:#555;margin-bottom:6px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px}
.hosp-name{font-size:22pt;font-weight:bold;color:#1e3a8a;line-height:1}
.hosp-sub{font-size:9pt;color:#555;margin-top:2px}
.rx-logo{text-align:right}
.rx-big{font-size:36pt;font-weight:bold;font-style:italic;color:#1e3a8a;line-height:1;font-family:Georgia,serif}
.rx-label{font-size:8pt;font-weight:bold;color:#1e3a8a;letter-spacing:1px}
.blue-line{border-bottom:3px solid #1e3a8a;margin:6px 0 8px}
.dr-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border-bottom:1px solid #333;padding-bottom:4px;margin-bottom:4px}
.dr-field{font-size:9pt}
.dr-label{color:#555;font-size:8pt}
.dr-line{border-bottom:1px solid #333;display:inline-block;width:140px;margin-left:2px}
.opd-no{text-align:right}
.opd-no .opd-label{font-size:8pt;font-weight:bold;color:#1e3a8a}
.opd-no .opd-val{font-size:11pt;font-weight:bold;color:#1e3a8a}
.date-row{text-align:right;font-size:9pt;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #ccc}
.date-val{font-weight:bold;font-size:10pt;color:#c00}
.patient-box{border:1px solid #333;margin-bottom:6px}
.pt-header{display:grid;grid-template-columns:2fr 1.5fr 1.5fr 1fr;border-bottom:1px solid #333}
.pt-cell{padding:4px 6px;border-right:1px solid #333;font-size:8.5pt}
.pt-cell:last-child{border-right:none}
.pt-label{font-size:7.5pt;font-weight:bold;background:#1e3a8a;color:#fff;padding:1px 4px;margin-bottom:2px;display:block}
.pt-val{font-weight:600;font-size:10pt}
.vitals-row{display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid #333}
.vt-cell{padding:3px 4px;border-right:1px solid #333;text-align:center;font-size:7.5pt}
.vt-cell:last-child{border-right:none}
.vt-lbl{font-weight:bold;color:#c00}
.vt-val{border-bottom:1px dotted #aaa;min-height:14px;margin-top:1px}
.section-title{font-size:8.5pt;font-weight:bold;color:#1e3a8a;text-transform:uppercase;letter-spacing:0.5px;margin:6px 0 2px;border-bottom:1px solid #1e3a8a;padding-bottom:1px}
.blank-line{border-bottom:1px solid #ccc;height:18px;margin-bottom:2px}
.rx-symbol{font-size:28pt;font-weight:bold;font-style:italic;color:#1e3a8a;font-family:Georgia,serif;line-height:1;margin-bottom:2px}
.rx-table{width:100%;border-collapse:collapse;margin-bottom:4px}
.rx-table th{font-size:8pt;font-weight:bold;color:#555;text-align:left;padding:2px 4px;border-bottom:1px solid #333}
.rx-table td{padding:2px 4px;border-bottom:1px dotted #ddd;height:22px;font-size:9pt}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:6px}
.follow-box{border:1.5px solid #f59e0b;border-radius:4px;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;background:#fffbeb;margin-bottom:8px}
.follow-label{font-size:8.5pt;font-weight:bold;color:#d97706}
.follow-line{border-bottom:1px solid #aaa;display:inline-block;width:200px;margin-left:4px}
.surgical{font-size:8.5pt;font-weight:bold;color:#d97706}
.sig-section{margin-top:12px;text-align:right}
.sig-line{border-bottom:1px solid #000;width:200px;display:inline-block;margin-bottom:3px}
.sig-label{font-size:8.5pt;color:#333}
.sig-dr{font-size:8pt;color:#555;border-top:1px dotted #aaa;width:200px;padding-top:2px;margin-top:2px}
.page-footer{position:absolute;bottom:8mm;left:12mm;right:12mm;border-top:1px solid #ccc;padding-top:4px;display:flex;justify-content:space-between;font-size:7.5pt;color:#777}
.print-btn{display:block;margin:16px auto 0;background:#1e3a8a;color:#fff;border:none;padding:9px 28px;font-size:13px;font-weight:600;border-radius:6px;cursor:pointer}
@media print{.print-btn{display:none}body{padding:0}.page{padding:8mm}}
</style></head>
<body>
<div class="page">
  <div class="meta-top">
    <span>${printedAt}</span>
    <span style="font-weight:bold;color:#1e3a8a">Prescription — ${patient.mrn}</span>
  </div>

  <div class="header">
    <div>
      <div class="hosp-name">${orgInfo.name || '123 Hospital'}</div>
      <div class="hosp-sub">OPD Prescription</div>
      <div class="hosp-sub" style="font-size:8pt;margin-top:2px">${orgAddr || ''}</div>
      <div class="hosp-sub" style="font-size:8pt">Tel: ${orgInfo.phone || '—'} | Email: ${orgInfo.email || '—'}</div>
    </div>
    <div class="rx-logo">
      <div class="rx-big">R<span style="font-size:18pt">x</span></div>
      <div class="rx-label">OPD PRESCRIPTION</div>
    </div>
  </div>
  <div class="blue-line"></div>

  <div style="display:grid;grid-template-columns:1fr auto;gap:16px;margin-bottom:4px">
    <div>
      <div style="font-size:9pt;margin-bottom:3px">Dr. <span class="dr-line" style="width:160px"></span> &nbsp;&nbsp; Department: <span class="dr-line" style="width:100px"></span></div>
      <div style="font-size:9pt">Qualification: <span class="dr-line" style="width:130px"></span> &nbsp;&nbsp; Reg. No: <span class="dr-line" style="width:100px"></span></div>
    </div>
    <div class="opd-no">
      <div class="opd-label">OPD NO.</div>
      <div class="opd-val">${patient.mrn}</div>
    </div>
  </div>

  <div class="date-row">Date: &nbsp;<span class="date-val">${dateStr}</span></div>

  <div class="patient-box">
    <div class="pt-header">
      <div class="pt-cell"><span class="pt-label">PATIENT NAME</span><span class="pt-val">${name}</span></div>
      <div class="pt-cell"><span class="pt-label">AGE / GENDER</span><span class="pt-val">${age} / ${gender}</span></div>
      <div class="pt-cell"><span class="pt-label">PHONE</span><span class="pt-val">${patient.phonePrimary || '—'}</span></div>
      <div class="pt-cell"><span class="pt-label">BLOOD GROUP</span><span class="pt-val" style="color:#c00">${patient.bloodGroup || '—'}</span></div>
    </div>
    <div class="vitals-row">
      <div class="vt-cell"><div class="vt-lbl">BP (MMHG)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">PULSE (BPM)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl" style="color:#c00">TEMP (°F)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">RR (/MIN)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">SPO₂ (%)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">WT (KG)</div><div class="vt-val"></div></div>
      <div class="vt-cell"><div class="vt-lbl">HT (CM)</div><div class="vt-val"></div></div>
    </div>
  </div>

  <div class="section-title">Diagnosis / Chief Complaint</div>
  <div class="blank-line"></div>
  <div class="blank-line"></div>

  <div style="margin:6px 0 2px">
    <div class="rx-symbol">R<span style="font-size:16pt">x</span></div>
    <table class="rx-table">
      <thead><tr><th style="width:24px">#</th><th>Medicine Name &amp; Strength</th><th>Dose / Frequency / Route</th><th>Duration</th></tr></thead>
      <tbody>
        ${[1,2,3,4,5,6,7].map(n => `<tr><td>${n}.</td><td></td><td></td><td></td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="two-col">
    <div>
      <div class="section-title">Advice / Instructions</div>
      <div class="blank-line"></div>
      <div class="blank-line"></div>
    </div>
    <div>
      <div class="section-title">Investigations / Tests Ordered</div>
      <div class="blank-line"></div>
      <div class="blank-line"></div>
    </div>
  </div>

  <div class="follow-box">
    <div><span class="follow-label">Follow-up Date:</span> <span class="follow-line"></span></div>
    <div class="surgical">Surgical Opinion Needed: &nbsp; YES &nbsp;/&nbsp; NO</div>
  </div>

  <div class="sig-section">
    <div class="sig-line"></div><br/>
    <div class="sig-label">Doctor Signature &amp; Stamp</div>
    <div class="sig-dr">Dr. ___________________________</div>
  </div>

  <div class="page-footer">
    <span>Patient: <strong>${name}</strong> | UHID: <strong style="color:#1e3a8a">${patient.mrn}</strong> | ${age} / ${gender}</span>
    <span>Printed: ${printedAt} &nbsp;|&nbsp; ${orgInfo.name || '123 Hospital'} — OPD Prescription</span>
  </div>
  <div style="text-align:center;font-size:7pt;color:#aaa;margin-top:8px">This prescription is valid for 30 days from the date of issue. Keep this slip for reference.</div>

  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</div>
</body></html>`)
    win.document.close()
  }

  // Open a printable lab/pathology report (Save as PDF from the print dialog)
  const handlePrintLabReport = (order) => {
    const p = selectedPatient
    if (!p) return
    const win = window.open('', '_blank', 'width=900,height=780')
    if (!win) { toast.error('Please allow pop-ups to open the report'); return }
    const name = getFullName(p)
    const age = p.dateOfBirth ? `${calculateAge(p.dateOfBirth)} yrs` : '—'
    const gender = p.gender ? p.gender.charAt(0).toUpperCase() + p.gender.slice(1) : '—'
    const printDate = format(new Date(), 'dd MMM yyyy HH:mm')
    const orderDate = order.orderDate ? format(new Date(order.orderDate), 'dd MMM yyyy HH:mm') : format(new Date(order.createdAt), 'dd MMM yyyy HH:mm')
    const results = order.results || []
    const hasResults = results.length > 0
    const hasAbnormal = results.some(r => r.isAbnormal || r.isCritical)
    const orgAddr = [orgInfo.address, orgInfo.city].filter(Boolean).join(', ')

    const rows = hasResults
      ? results.map(r => {
          const refRange = r.referenceRangeText || (r.referenceRangeMin != null && r.referenceRangeMax != null ? `${r.referenceRangeMin} – ${r.referenceRangeMax}` : '—')
          const rowClass = r.isCritical ? 'result-critical' : r.isAbnormal ? 'result-abnormal' : ''
          const valStyle = r.isAbnormal || r.isCritical ? `font-weight:bold;color:${r.isCritical ? '#dc2626' : '#b45309'}` : 'font-weight:bold'
          const flag = r.isCritical ? '⚠ CRITICAL' : (r.flag || 'N')
          return `<tr class="${rowClass}">
            <td>${r.test?.testName || '—'}</td>
            <td style="${valStyle}">${r.resultValue ?? '—'}</td>
            <td>${r.resultUnit || r.test?.unit || '—'}</td>
            <td>${refRange}</td>
            <td>${flag}</td>
          </tr>`
        }).join('')
      : `<tr><td colspan="5" style="color:#888;font-style:italic;text-align:center;padding:14px">Results pending</td></tr>`

    win.document.write(`<!DOCTYPE html><html><head><title>Laboratory Report — ${order.orderNumber}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;background:#fff}
.page{max-width:210mm;margin:0 auto;padding:12mm 14mm}
.hosp-header{display:flex;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:10px}
.hosp-name{font-size:19pt;font-weight:bold;color:#1e3a5f}
.hosp-sub{font-size:9pt;color:#555;margin-top:2px}
.hosp-contact{font-size:8.5pt;color:#555;text-align:right;line-height:1.6}
.report-banner{background:#1e3a5f;color:#fff;text-align:center;padding:5px 0;font-size:13pt;font-weight:bold;letter-spacing:3px;margin-bottom:10px}
.info-box{border:1px solid #333;margin-bottom:10px}
.info-box-hdr{background:#1e3a5f;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;text-transform:uppercase}
.info-grid{display:grid;grid-template-columns:repeat(4,1fr)}
.info-cell{padding:5px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.info-cell:last-child{border-right:none}
.info-label{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase}
.info-value{font-size:10pt;margin-top:1px}
.clinical-bar{padding:7px 12px;background:#f0f4f8;border-left:4px solid #1e3a5f;margin-bottom:10px;font-size:10pt}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:9.5pt}
thead th{background:#1e3a5f;color:#fff;padding:6px 8px;text-align:left;font-size:9pt}
td{padding:5px 8px;border-bottom:1px solid #e8e8e8}
tr:nth-child(even) td{background:#f9f9f9}
.result-abnormal td{background:#fffbeb!important}
.result-critical td{background:#fef2f2!important}
.critical-note{background:#fef2f2;border:1px solid #dc2626;padding:8px 12px;margin-bottom:10px;font-size:9.5pt;color:#991b1b;border-radius:3px}
.footer{margin-top:12px;border-top:1px solid #ccc;padding-top:5px;font-size:8pt;color:#888;text-align:center}
.print-btn{display:block;margin:16px auto 0;background:#1e3a5f;color:#fff;border:none;padding:9px 28px;font-size:13px;font-weight:600;border-radius:6px;cursor:pointer}
@media print{.print-btn{display:none}body{padding:0}.page{padding:8mm}}
</style></head><body>
<div class="page">
  <div class="hosp-header">
    <div>
      <div class="hosp-name">${orgInfo.name || 'Hospital'}</div>
      <div class="hosp-sub">Laboratory &amp; Pathology Department</div>
      <div class="hosp-sub">${orgAddr}</div>
    </div>
    <div class="hosp-contact">
      Order #: <strong>${order.orderNumber}</strong><br/>
      ${order.accessionNumber ? `Accession #: <strong>${order.accessionNumber}</strong><br/>` : ''}
      Printed: ${printDate}
    </div>
  </div>
  <div class="report-banner">LABORATORY REPORT</div>
  <div class="info-box">
    <div class="info-box-hdr">Patient Information</div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-label">Patient Name</div><div class="info-value"><strong>${name}</strong></div></div>
      <div class="info-cell"><div class="info-label">UHID</div><div class="info-value">${p.mrn}</div></div>
      <div class="info-cell"><div class="info-label">Age / Sex</div><div class="info-value">${age} / ${gender}</div></div>
      <div class="info-cell"><div class="info-label">Order Date</div><div class="info-value">${orderDate}</div></div>
    </div>
  </div>
  ${order.clinicalIndication ? `<div class="clinical-bar"><strong>Clinical Indication:</strong> ${order.clinicalIndication}</div>` : ''}
  ${hasAbnormal ? `<div class="critical-note">⚠ This report contains abnormal/critical values. Please review highlighted results.</div>` : ''}
  <table>
    <thead><tr><th style="width:32%">TEST NAME</th><th style="width:16%">RESULT</th><th style="width:14%">UNIT</th><th style="width:24%">REFERENCE RANGE</th><th style="width:14%">FLAG</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${order.notes ? `<div class="clinical-bar"><strong>Notes:</strong> ${order.notes}</div>` : ''}
  <div class="footer">${orgInfo.name || 'Hospital'} — Laboratory &amp; Pathology Department &nbsp;|&nbsp; Confidential &nbsp;|&nbsp; Printed: ${printDate}</div>
  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</div>
</body></html>`)
    win.document.close()
  }

  // Open a printable radiology report (Save as PDF from the print dialog)
  const handlePrintRadReport = (order) => {
    const p = selectedPatient
    if (!p) return
    const win = window.open('', '_blank', 'width=900,height=780')
    if (!win) { toast.error('Please allow pop-ups to open the report'); return }
    const name = getFullName(p)
    const age = p.dateOfBirth ? `${calculateAge(p.dateOfBirth)} yrs` : '—'
    const gender = p.gender ? p.gender.charAt(0).toUpperCase() + p.gender.slice(1) : '—'
    const printDate = format(new Date(), 'dd MMM yyyy HH:mm')
    const orderDate = format(new Date(order.createdAt), 'dd MMM yyyy HH:mm')
    const rep = order.report
    const orgAddr = [orgInfo.address, orgInfo.city].filter(Boolean).join(', ')

    win.document.write(`<!DOCTYPE html><html><head><title>Radiology Report — ${order.exam?.examName || ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#000;background:#fff}
.page{max-width:210mm;margin:0 auto;padding:12mm 14mm}
.hosp-header{display:flex;justify-content:space-between;border-bottom:3px solid #4338ca;padding-bottom:10px;margin-bottom:10px}
.hosp-name{font-size:19pt;font-weight:bold;color:#4338ca}
.hosp-sub{font-size:9pt;color:#555;margin-top:2px}
.hosp-contact{font-size:8.5pt;color:#555;text-align:right;line-height:1.6}
.report-banner{background:#4338ca;color:#fff;text-align:center;padding:5px 0;font-size:13pt;font-weight:bold;letter-spacing:3px;margin-bottom:10px}
.info-box{border:1px solid #333;margin-bottom:12px}
.info-box-hdr{background:#4338ca;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;text-transform:uppercase}
.info-grid{display:grid;grid-template-columns:repeat(4,1fr)}
.info-cell{padding:5px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.info-cell:last-child{border-right:none}
.info-label{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase}
.info-value{font-size:10pt;margin-top:1px}
.section-title{font-size:10pt;font-weight:bold;color:#4338ca;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #4338ca;padding-bottom:2px;margin:12px 0 5px}
.section-body{font-size:10.5pt;line-height:1.6;white-space:pre-wrap}
.critical-note{background:#fef2f2;border:1px solid #dc2626;padding:8px 12px;margin:10px 0;font-size:9.5pt;color:#991b1b;border-radius:3px}
.footer{margin-top:16px;border-top:1px solid #ccc;padding-top:5px;font-size:8pt;color:#888;text-align:center}
.print-btn{display:block;margin:16px auto 0;background:#4338ca;color:#fff;border:none;padding:9px 28px;font-size:13px;font-weight:600;border-radius:6px;cursor:pointer}
@media print{.print-btn{display:none}body{padding:0}.page{padding:8mm}}
</style></head><body>
<div class="page">
  <div class="hosp-header">
    <div>
      <div class="hosp-name">${orgInfo.name || 'Hospital'}</div>
      <div class="hosp-sub">Department of Radiology &amp; Imaging</div>
      <div class="hosp-sub">${orgAddr}</div>
    </div>
    <div class="hosp-contact">Printed: ${printDate}</div>
  </div>
  <div class="report-banner">RADIOLOGY REPORT</div>
  <div class="info-box">
    <div class="info-box-hdr">Patient &amp; Exam Information</div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-label">Patient Name</div><div class="info-value"><strong>${name}</strong></div></div>
      <div class="info-cell"><div class="info-label">UHID</div><div class="info-value">${p.mrn}</div></div>
      <div class="info-cell"><div class="info-label">Age / Sex</div><div class="info-value">${age} / ${gender}</div></div>
      <div class="info-cell"><div class="info-label">Exam Date</div><div class="info-value">${orderDate}</div></div>
      <div class="info-cell"><div class="info-label">Examination</div><div class="info-value"><strong>${order.exam?.examName || '—'}</strong></div></div>
      <div class="info-cell"><div class="info-label">Modality</div><div class="info-value">${order.exam?.modality || '—'}</div></div>
      <div class="info-cell"><div class="info-label">Body Part</div><div class="info-value">${order.exam?.bodyPart || '—'}</div></div>
      <div class="info-cell"><div class="info-label">Status</div><div class="info-value" style="text-transform:capitalize">${(order.status || '').replace(/_/g, ' ')}</div></div>
    </div>
  </div>
  ${order.clinicalIndication ? `<div class="section-title">Clinical Indication</div><div class="section-body">${order.clinicalIndication}</div>` : ''}
  ${rep?.hasCriticalFindings ? `<div class="critical-note">⚠ CRITICAL FINDINGS: ${rep.criticalFindings || 'Requires immediate attention'}</div>` : ''}
  ${rep?.technique ? `<div class="section-title">Technique</div><div class="section-body">${rep.technique}</div>` : ''}
  <div class="section-title">Findings</div><div class="section-body">${rep?.findings || 'Report pending.'}</div>
  ${rep?.impression ? `<div class="section-title">Impression</div><div class="section-body"><strong>${rep.impression}</strong></div>` : ''}
  ${rep?.recommendations ? `<div class="section-title">Recommendations</div><div class="section-body">${rep.recommendations}</div>` : ''}
  <div class="footer">${orgInfo.name || 'Hospital'} — Department of Radiology &nbsp;|&nbsp; Confidential &nbsp;|&nbsp; Printed: ${printDate}</div>
  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</div>
</body></html>`)
    win.document.close()
  }

  const handleDeletePatient = async (patient) => {
    if (!window.confirm(`Delete patient "${getFullName(patient)}" (${patient.mrn})?\n\nThis will permanently remove all records. This cannot be undone.`)) return
    try {
      const res = await client.delete(`/patients/${patient.id}`)
      if (res.success) {
        toast.success(`Patient ${patient.mrn} deleted successfully`)
        fetchPatients()
      } else {
        toast.error(res.error || 'Failed to delete patient')
      }
    } catch (err) {
      toast.error(err.message || 'Failed to delete patient')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8 text-blue-600" />
            Patients
          </h1>
          <p className="text-gray-500">Manage patient records and registrations</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchPatients}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
          <Dialog open={showRegDialog} onOpenChange={(open) => { setShowRegDialog(open); if (!open) form.reset() }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Register Patient</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
              <RegisterPatientForm
                onCancel={() => setShowRegDialog(false)}
                onSuccess={() => { setShowRegDialog(false); fetchPatients() }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Patients', val: total, color: 'blue' },
          { label: 'Loaded', val: patients.length, color: 'green' },
          { label: 'Insured', val: patients.filter(p => p.hasInsurance).length, color: 'purple' },
          { label: 'VIP', val: patients.filter(p => p.isVip).length, color: 'amber' },
        ].map(({ label, val, color }) => (
          <Card key={label} className={`bg-${color}-50 border-${color}-200`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className={`text-sm text-${color}-600 font-medium`}>{label}</p>
                <p className={`text-2xl font-bold text-${color}-700`}>{val}</p>
              </div>
              <Users className={`h-8 w-8 text-${color}-400`} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-10"
            placeholder="Search by name, UHID, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Patients</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {dateFilter.control}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-3" />
              <p className="text-red-600 mb-3">{error}</p>
              <Button onClick={fetchPatients} variant="outline"><RefreshCw className="h-4 w-4 mr-2" />Retry</Button>
            </div>
          ) : patients.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>No patients found</p>
              <Button className="mt-4" onClick={() => setShowRegDialog(true)}>
                <UserPlus className="h-4 w-4 mr-2" />Register First Patient
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>UHID</TableHead>
                  <TableHead>Age / Gender</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Insurance</TableHead>
                  <TableHead>Reports</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patients.map(patient => {
                  const name = getFullName(patient)
                  const age = patient.dateOfBirth ? calculateAge(patient.dateOfBirth) : '—'
                  return (
                    <TableRow key={patient.id} className="cursor-pointer hover:bg-gray-50" onClick={() => openPatient(patient)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-blue-100 text-blue-700 text-sm font-bold">
                              {initials(name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{name}</div>
                            {patient.isVip && <Badge className="text-[10px] bg-amber-100 text-amber-700 border-0 px-1 py-0">VIP</Badge>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{patient.mrn}</TableCell>
                      <TableCell>
                        <div>{age} yrs</div>
                        <div className="text-xs text-gray-500 capitalize">{patient.gender}</div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {patient.phonePrimary ? (
                          <a
                            href={`tel:${patient.phonePrimary.replace(/[^0-9+]/g, '')}`}
                            title={`Call ${patient.phonePrimary}`}
                            className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-blue-600 hover:underline"
                          >
                            <Phone className="h-3 w-3 text-gray-400" />
                            {patient.phonePrimary}
                          </a>
                        ) : (
                          <span className="flex items-center gap-1 text-sm text-gray-400"><Phone className="h-3 w-3" />—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {patient.hasInsurance
                          ? <Badge className="bg-green-100 text-green-700 border-0"><Shield className="h-3 w-3 mr-1" />{patient.insuranceProvider || 'Insured'}</Badge>
                          : <Badge variant="outline" className="text-gray-400">None</Badge>
                        }
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {patient.labReportCount > 0 || patient.radiologyReportCount > 0 || patient.admittedCount > 0 || patient.documentCount > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {patient.labReportCount > 0 && (
                              <button
                                type="button"
                                title={`View ${patient.labReportCount} pathology / lab report${patient.labReportCount > 1 ? 's' : ''}`}
                                onClick={() => openPatient(patient, 'lab')}
                                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-teal-50 to-cyan-50 text-teal-700 ring-1 ring-inset ring-teal-200 pl-1.5 pr-2 py-0.5 text-xs font-semibold shadow-sm transition-all hover:from-teal-100 hover:to-cyan-100 hover:shadow hover:scale-105"
                              >
                                <Microscope className="h-3.5 w-3.5" />
                                <span>Pathology</span>
                                <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-teal-600 text-white text-[10px] leading-none px-1">
                                  {patient.labReportCount}
                                </span>
                              </button>
                            )}
                            {patient.radiologyReportCount > 0 && (
                              <button
                                type="button"
                                title={`View ${patient.radiologyReportCount} radiology report${patient.radiologyReportCount > 1 ? 's' : ''}`}
                                onClick={() => openPatient(patient, 'radiology')}
                                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 pl-1.5 pr-2 py-0.5 text-xs font-semibold shadow-sm transition-all hover:from-indigo-100 hover:to-violet-100 hover:shadow hover:scale-105"
                              >
                                <ScanLine className="h-3.5 w-3.5" />
                                <span>Radiology</span>
                                <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-indigo-600 text-white text-[10px] leading-none px-1">
                                  {patient.radiologyReportCount}
                                </span>
                              </button>
                            )}
                            {patient.admittedCount > 0 && (
                              <button
                                type="button"
                                title="Admitted — view IPD / admission details"
                                onClick={() => openPatient(patient, 'ipd')}
                                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-rose-50 to-orange-50 text-rose-700 ring-1 ring-inset ring-rose-200 pl-1.5 pr-2 py-0.5 text-xs font-semibold shadow-sm transition-all hover:from-rose-100 hover:to-orange-100 hover:shadow hover:scale-105"
                              >
                                <BedDouble className="h-3.5 w-3.5" />
                                <span>IPD</span>
                              </button>
                            )}
                            {patient.documentCount > 0 && (
                              <button
                                type="button"
                                title={`View ${patient.documentCount} uploaded document${patient.documentCount > 1 ? 's' : ''}`}
                                onClick={() => openPatient(patient, 'documents')}
                                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-blue-50 to-sky-50 text-blue-700 ring-1 ring-inset ring-blue-200 pl-1.5 pr-2 py-0.5 text-xs font-semibold shadow-sm transition-all hover:from-blue-100 hover:to-sky-100 hover:shadow hover:scale-105"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                <span>Documents</span>
                                <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-blue-600 text-white text-[10px] leading-none px-1">
                                  {patient.documentCount}
                                </span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={patient.isActive ? 'bg-green-100 text-green-700 border-0' : 'bg-gray-100 text-gray-500 border-0'}>
                          {patient.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="View"
                            onClick={() => openPatient(patient)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" title="Print OPD Prescription"
                            onClick={() => handlePrintCard(patient)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" title="Delete Patient"
                            onClick={() => handleDeletePatient(patient)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!loading && total > limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total} patients
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
              <ChevronLeft className="h-4 w-4 mr-1" />Previous
            </Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* View Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Patient Details</DialogTitle>
          </DialogHeader>
          {selectedPatient && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xl font-bold">
                  {initials(getFullName(selectedPatient))}
                </div>
                <div className="flex-1">
                  <p className="text-lg font-bold">{getFullName(selectedPatient)}</p>
                  <p className="text-sm text-gray-500">UHID: {selectedPatient.mrn}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => fetchRecords(selectedPatient.id)}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
                </Button>
              </div>

              <Tabs value={viewTab} onValueChange={setViewTab}>
                <TabsList className="grid w-full grid-cols-6 h-auto gap-1 p-1 bg-gray-100">
                  <TabsTrigger value="overview" className="flex items-center justify-center gap-1.5 py-2 data-[state=active]:shadow-sm data-[state=active]:text-blue-700">
                    <Users className="h-4 w-4" />
                    <span>Patient Details</span>
                  </TabsTrigger>
                  <TabsTrigger value="appointments" className="flex items-center justify-center gap-1.5 py-2 data-[state=active]:shadow-sm data-[state=active]:text-green-700">
                    <CalendarDays className="h-4 w-4" />
                    <span>Appointments</span>
                    {records.appointments.length > 0 && (
                      <Badge className="ml-0.5 bg-green-100 text-green-700 border-0 px-1.5 py-0 text-[10px]">{records.appointments.length}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="lab" className="flex items-center justify-center gap-1.5 py-2 data-[state=active]:shadow-sm data-[state=active]:text-teal-700">
                    <Microscope className="h-4 w-4" />
                    <span>Lab / Pathology</span>
                    {records.labOrders.length > 0 && (
                      <Badge className="ml-0.5 bg-cyan-100 text-cyan-700 border-0 px-1.5 py-0 text-[10px]">{records.labOrders.length}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="radiology" className="flex items-center justify-center gap-1.5 py-2 data-[state=active]:shadow-sm data-[state=active]:text-indigo-700">
                    <ScanLine className="h-4 w-4" />
                    <span>Radiology</span>
                    {records.radiologyOrders.length > 0 && (
                      <Badge className="ml-0.5 bg-indigo-100 text-indigo-700 border-0 px-1.5 py-0 text-[10px]">{records.radiologyOrders.length}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="ipd" className="flex items-center justify-center gap-1.5 py-2 data-[state=active]:shadow-sm data-[state=active]:text-rose-700">
                    <BedDouble className="h-4 w-4" />
                    <span>IPD</span>
                    {records.admissions.length > 0 && (
                      <Badge className="ml-0.5 bg-rose-100 text-rose-700 border-0 px-1.5 py-0 text-[10px]">{records.admissions.length}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="documents" className="flex items-center justify-center gap-1.5 py-2 data-[state=active]:shadow-sm data-[state=active]:text-sky-700">
                    <FileText className="h-4 w-4" />
                    <span>Documents</span>
                    {records.patientDocuments?.length > 0 && (
                      <Badge className="ml-0.5 bg-sky-100 text-sky-700 border-0 px-1.5 py-0 text-[10px]">{records.patientDocuments.length}</Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* Overview */}
                <TabsContent value="overview" className="mt-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      { label: 'Date of Birth', val: selectedPatient.dateOfBirth ? format(new Date(selectedPatient.dateOfBirth), 'dd MMM yyyy') : '—' },
                      { label: 'Age', val: selectedPatient.dateOfBirth ? `${calculateAge(selectedPatient.dateOfBirth)} years` : '—' },
                      { label: 'Gender', val: selectedPatient.gender },
                      { label: 'Blood Group', val: selectedPatient.bloodGroup || '—' },
                      { label: 'Phone', val: selectedPatient.phonePrimary || '—' },
                      { label: 'Email', val: selectedPatient.email || '—' },
                      { label: 'Region', val: selectedPatient.region || '—' },
                      { label: 'Insurance', val: selectedPatient.hasInsurance ? (selectedPatient.insuranceProvider || 'Yes') : 'No' },
                      { label: 'Emergency Contact', val: selectedPatient.emergencyContactName || '—' },
                      { label: 'Contact Phone', val: selectedPatient.emergencyContactPhone || '—' },
                    ].map(({ label, val }) => (
                      <div key={label}>
                        <p className="text-gray-500 text-xs font-medium uppercase">{label}</p>
                        <p className="font-medium capitalize">{val}</p>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                {/* Appointments & Billing */}
                <TabsContent value="appointments" className="mt-4">
                  {recordsLoading ? (
                    <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
                  ) : (() => {
                    const now = new Date()
                    const fmtMoney = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`
                    const isUpcoming = (a) => new Date(a.appointmentDate) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
                      && !['cancelled', 'completed', 'no_show'].includes(a.status)
                    const upcoming = records.appointments.filter(isUpcoming)
                    const history = records.appointments.filter(a => !isUpcoming(a))
                    const b = records.billing || { totalBilled: 0, totalPaid: 0, balanceDue: 0 }
                    const statusColor = {
                      scheduled: 'bg-blue-100 text-blue-700', confirmed: 'bg-indigo-100 text-indigo-700',
                      checked_in: 'bg-cyan-100 text-cyan-700', in_progress: 'bg-amber-100 text-amber-700',
                      completed: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700',
                      no_show: 'bg-gray-200 text-gray-600', rescheduled: 'bg-purple-100 text-purple-700',
                    }
                    const ApptRow = ({ a, cancellable }) => (
                      <div key={a.id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{format(new Date(a.appointmentDate), 'dd MMM yyyy')}{a.appointmentTime ? `, ${a.appointmentTime}` : ''}</span>
                            <Badge className={`border-0 capitalize ${statusColor[a.status] || 'bg-gray-100 text-gray-700'}`}>{a.status?.replace(/_/g, ' ')}</Badge>
                            <Badge className="bg-gray-100 text-gray-600 border-0 capitalize">{a.appointmentType?.replace(/_/g, ' ')}</Badge>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {a.doctor?.fullName || 'Doctor —'}{a.department?.name ? ` · ${a.department.name}` : ''}
                            {a.consultationFee != null ? ` · Fee ${fmtMoney(a.consultationFee)}` : ''}
                          </p>
                        </div>
                        {cancellable && (
                          <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700 shrink-0"
                            onClick={() => cancelAppointment(a)} disabled={cancellingId === a.id}>
                            {cancellingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><XCircle className="h-3.5 w-3.5 mr-1" />Cancel</>}
                          </Button>
                        )}
                      </div>
                    )
                    return (
                      <div className="space-y-4">
                        {/* Billing summary */}
                        <div className="grid grid-cols-3 gap-3">
                          <div className="rounded-lg border p-3 bg-gray-50">
                            <p className="text-xs text-gray-500 font-medium uppercase flex items-center gap-1"><IndianRupee className="h-3 w-3" />Total Billed</p>
                            <p className="text-lg font-bold text-gray-800">{fmtMoney(b.totalBilled)}</p>
                          </div>
                          <div className="rounded-lg border p-3 bg-green-50">
                            <p className="text-xs text-green-600 font-medium uppercase">Total Paid</p>
                            <p className="text-lg font-bold text-green-700">{fmtMoney(b.totalPaid)}</p>
                          </div>
                          <div className="rounded-lg border p-3 bg-amber-50">
                            <p className="text-xs text-amber-600 font-medium uppercase">Balance Due</p>
                            <p className="text-lg font-bold text-amber-700">{fmtMoney(b.balanceDue)}</p>
                          </div>
                        </div>

                        <ScrollArea className="h-[300px] pr-3">
                          {records.appointments.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                              <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-40" />
                              <p>No appointments yet</p>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Clock className="h-4 w-4 text-green-600" />Upcoming ({upcoming.length})</h4>
                                {upcoming.length === 0 ? (
                                  <p className="text-sm text-gray-400 italic px-1">No upcoming appointments</p>
                                ) : (
                                  <div className="space-y-2">{upcoming.map(a => <ApptRow key={a.id} a={a} cancellable />)}</div>
                                )}
                              </div>
                              <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-2">History ({history.length})</h4>
                                {history.length === 0 ? (
                                  <p className="text-sm text-gray-400 italic px-1">No past appointments</p>
                                ) : (
                                  <div className="space-y-2">{history.map(a => <ApptRow key={a.id} a={a} cancellable={false} />)}</div>
                                )}
                              </div>
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    )
                  })()}
                </TabsContent>

                {/* Lab / Pathology */}
                <TabsContent value="lab" className="mt-4">
                  <ScrollArea className="h-[360px] pr-3">
                    {recordsLoading ? (
                      <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
                    ) : records.labOrders.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">
                        <FlaskConical className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        <p>No lab or pathology reports yet</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {records.labOrders.map(order => (
                          <div key={order.id} className="rounded-lg border p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <FlaskConical className="h-4 w-4 text-cyan-600" />
                                <span className="font-mono text-sm font-medium">{order.orderNumber}</span>
                                <Badge className="bg-gray-100 text-gray-700 border-0 capitalize">{order.status?.replace(/_/g, ' ')}</Badge>
                                {order.priority && order.priority !== 'routine' && (
                                  <Badge className="bg-red-100 text-red-700 border-0 capitalize">{order.priority}</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">{format(new Date(order.createdAt), 'dd MMM yyyy, HH:mm')}</span>
                                {order.results?.length > 0 ? (
                                  <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => handlePrintLabReport(order)}>
                                    <Printer className="h-3 w-3 mr-1" />PDF
                                  </Button>
                                ) : (
                                  <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">Pending</Badge>
                                )}
                              </div>
                            </div>
                            {order.clinicalIndication && (
                              <p className="text-xs text-gray-500 mb-2">Indication: {order.clinicalIndication}</p>
                            )}
                            {order.results?.length > 0 ? (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="h-8">Test</TableHead>
                                    <TableHead className="h-8">Result</TableHead>
                                    <TableHead className="h-8">Flag</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {order.results.map(r => (
                                    <TableRow key={r.id}>
                                      <TableCell className="py-1.5">{r.test?.testName || '—'}</TableCell>
                                      <TableCell className={`py-1.5 font-medium ${r.isCritical ? 'text-red-600' : r.isAbnormal ? 'text-amber-600' : ''}`}>
                                        {r.resultValue} {r.resultUnit || r.test?.unit || ''}
                                      </TableCell>
                                      <TableCell className="py-1.5">
                                        {r.isCritical
                                          ? <Badge className="bg-red-100 text-red-700 border-0"><AlertCircle className="h-3 w-3 mr-1" />Critical</Badge>
                                          : r.isAbnormal
                                            ? <Badge className="bg-amber-100 text-amber-700 border-0">{r.flag || 'Abnormal'}</Badge>
                                            : <Badge className="bg-green-100 text-green-700 border-0">Normal</Badge>}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            ) : (
                              <p className="text-xs text-gray-400 italic">Results pending</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* Radiology */}
                <TabsContent value="radiology" className="mt-4">
                  <ScrollArea className="h-[360px] pr-3">
                    {recordsLoading ? (
                      <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
                    ) : records.radiologyOrders.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">
                        <Scan className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        <p>No radiology reports yet</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {records.radiologyOrders.map(order => (
                          <div key={order.id} className="rounded-lg border p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Scan className="h-4 w-4 text-indigo-600" />
                                <span className="font-medium text-sm">{order.exam?.examName || 'Exam'}</span>
                                <Badge className="bg-gray-100 text-gray-700 border-0 capitalize">{order.status?.replace(/_/g, ' ')}</Badge>
                                {order.report?.hasCriticalFindings && (
                                  <Badge className="bg-red-100 text-red-700 border-0"><AlertCircle className="h-3 w-3 mr-1" />Critical</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">{format(new Date(order.createdAt), 'dd MMM yyyy, HH:mm')}</span>
                                {order.report ? (
                                  <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => handlePrintRadReport(order)}>
                                    <Printer className="h-3 w-3 mr-1" />PDF
                                  </Button>
                                ) : (
                                  <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">Pending</Badge>
                                )}
                              </div>
                            </div>
                            {order.report ? (
                              <div className="space-y-1.5 text-sm">
                                {order.report.findings && (
                                  <div><span className="text-gray-500 text-xs font-medium uppercase">Findings: </span>{order.report.findings}</div>
                                )}
                                {order.report.impression && (
                                  <div><span className="text-gray-500 text-xs font-medium uppercase">Impression: </span><span className="font-medium">{order.report.impression}</span></div>
                                )}
                                {order.report.recommendations && (
                                  <div><span className="text-gray-500 text-xs font-medium uppercase">Recommendations: </span>{order.report.recommendations}</div>
                                )}
                                {!order.report.findings && !order.report.impression && (
                                  <p className="text-xs text-gray-400 italic flex items-center gap-1"><FileText className="h-3 w-3" />Report drafted, awaiting details</p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400 italic">Report pending</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* IPD / Admissions */}
                <TabsContent value="ipd" className="mt-4">
                  <ScrollArea className="h-[360px] pr-3">
                    {recordsLoading ? (
                      <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
                    ) : records.admissions.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">
                        <BedDouble className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        <p>No inpatient (IPD) admissions</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {records.admissions.map(adm => (
                          <div key={adm.id} className="rounded-lg border p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <BedDouble className="h-4 w-4 text-rose-600" />
                                <span className="font-medium text-sm">
                                  {adm.bed?.ward?.name || 'Ward'}{adm.bed?.bedNumber ? ` — Bed ${adm.bed.bedNumber}` : ''}
                                </span>
                                <Badge className={`capitalize border-0 ${adm.status === 'admitted' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                  {adm.status}
                                </Badge>
                                {adm.isCritical && (
                                  <Badge className="bg-red-100 text-red-700 border-0"><AlertCircle className="h-3 w-3 mr-1" />Critical</Badge>
                                )}
                              </div>
                              <span className="text-xs text-gray-500">{format(new Date(adm.admissionDate), 'dd MMM yyyy, HH:mm')}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                              {adm.admissionType && <div><span className="text-gray-500 text-xs font-medium uppercase">Type: </span><span className="capitalize">{adm.admissionType}</span></div>}
                              {adm.admissionDiagnosis && <div><span className="text-gray-500 text-xs font-medium uppercase">Diagnosis: </span>{adm.admissionDiagnosis}</div>}
                              {adm.admissionReason && <div className="col-span-2"><span className="text-gray-500 text-xs font-medium uppercase">Reason: </span>{adm.admissionReason}</div>}
                              {adm.chiefComplaint && <div className="col-span-2"><span className="text-gray-500 text-xs font-medium uppercase">Chief Complaint: </span>{adm.chiefComplaint}</div>}
                              {adm.dischargeDate && <div><span className="text-gray-500 text-xs font-medium uppercase">Discharged: </span>{format(new Date(adm.dischargeDate), 'dd MMM yyyy')}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* Documents / KYC */}
                <TabsContent value="documents" className="mt-4">
                  <ScrollArea className="h-[360px] pr-3">
                    {recordsLoading ? (
                      <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
                    ) : !records.patientDocuments || records.patientDocuments.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">
                        <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        <p>No uploaded documents or KYC files</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {records.patientDocuments.map(doc => (
                          <div key={doc.id} className="relative group rounded-lg border bg-white p-3 hover:shadow-md transition-shadow">
                            <div className="aspect-[4/3] rounded bg-gray-100 mb-2 overflow-hidden flex items-center justify-center relative">
                              {doc.fileType.startsWith('image/') ? (
                                <img src={`http://localhost:5000${doc.fileUrl}`} alt={doc.title} className="w-full h-full object-cover" />
                              ) : (
                                <FileText className="h-10 w-10 text-gray-400" />
                              )}
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <a href={`http://localhost:5000${doc.fileUrl}`} target="_blank" rel="noreferrer" className="bg-white text-blue-600 rounded-full p-2 hover:scale-110 transition-transform shadow-lg">
                                  <Eye className="h-4 w-4" />
                                </a>
                              </div>
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-sm truncate" title={doc.title}>{doc.title}</p>
                                <p className="text-xs text-gray-500 capitalize">{doc.documentType.replace('_', ' ')}</p>
                              </div>
                            </div>
                            <div className="text-[10px] text-gray-400 mt-2">
                              Uploaded: {format(new Date(doc.uploadedAt), 'dd MMM yyyy')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewDialog(false)}>Close</Button>
            <Button onClick={() => { setShowViewDialog(false); if (selectedPatient) openEdit(selectedPatient) }}>
              <Edit className="h-4 w-4 mr-2" />Edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Patient</DialogTitle>
            <DialogDescription>Update patient details for {selectedPatient ? getFullName(selectedPatient) : ''}</DialogDescription>
          </DialogHeader>
          <PatientForm form={form} isSubmitting={isSubmitting} onSubmitFn={onEdit} submitLabel="Save Changes" />
        </DialogContent>
      </Dialog>
    </div>
  )
}
