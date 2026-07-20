import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { PatientTimeline } from '@/components/inpatient/PatientTimeline'
import { getOrgSettings } from '@/lib/orgSettings'
import { toast } from 'sonner'
import {
  BedDouble, ArrowRight, Printer, FileText, ClipboardList, IndianRupee, UserPlus, History
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import client from '@/api/client'
import inpatientApi from '@/api/inpatientApi'
import NursingStation from '@/components/inpatient/NursingStation'
import NotesAndOrders from '@/components/inpatient/NotesAndOrders'
import BillingWorkspace from '@/components/inpatient/BillingWorkspace'
import BillScreen from '@/components/inpatient/BillScreen'
import CollectionsReport from '@/components/inpatient/CollectionsReport'
import MovementTab from '@/components/inpatient/tabs/MovementTab'
import DischargeTab from '@/components/inpatient/tabs/DischargeTab'
import PatientHistoryTab from '@/components/inpatient/tabs/PatientHistoryTab'
import DashboardTab from '@/components/inpatient/tabs/DashboardTab'
import AdmissionsTab from '@/components/inpatient/tabs/AdmissionsTab'
import WardsBedsTab from '@/components/inpatient/tabs/WardsBedsTab'
import NewAdmissionTab from '@/components/inpatient/tabs/NewAdmissionTab'
import { printAdmissionSlip, printDischargeSummary } from '@/lib/inpatientPrint'
import {
  admissionLabel, getWardName,
  WARD_TYPES, BED_TYPES, DISCHARGE_CONDITIONS, NOTE_TYPES,
  emptyWard, emptyAdmission, emptyDischarge, emptyNote, emptyAddBed,
} from '@/lib/inpatientHelpers'
import { getFullName } from "@/lib/patient";

function admissionStatusBadge(status) {
  const map = { admitted:'bg-green-100 text-green-800', discharged:'bg-gray-100 text-gray-800', transferred:'bg-blue-100 text-blue-800' }
  return <Badge className={map[status]||'bg-gray-100 text-gray-800'}>{status}</Badge>
}

export default function InpatientModule() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [doctors, setDoctors] = useState([])
  const [departments, setDepartments] = useState([])
  const [wards, setWards] = useState([])
  const [admissions, setAdmissions] = useState([])      // paginated list (Admissions + Patient History tabs)
  const [admittedAll, setAdmittedAll] = useState([])    // ALL currently-admitted (Nursing/Discharge/Dashboard/Billing/Movement)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [admitPatient, setAdmitPatient] = useState(null)
  const [statusFilter, setStatusFilter] = useState('admitted')
  const [wardFilter, setWardFilter] = useState('all')

  const [showWardDialog, setShowWardDialog] = useState(false)
  const [wardForm, setWardForm] = useState(emptyWard)
  const [buildingFilter, setBuildingFilter] = useState('all')
  const [editingWardId, setEditingWardId] = useState(null)
  const [savingWard, setSavingWard] = useState(false)

  const [admitForm, setAdmitForm] = useState(emptyAdmission)
  const [availableBeds, setAvailableBeds] = useState([])
  const [savingAdmission, setSavingAdmission] = useState(false)

  const [showDischargeDialog, setShowDischargeDialog] = useState(false)
  const [dischargeForm, setDischargeForm] = useState(emptyDischarge)
  const [selectedAdmission, setSelectedAdmission] = useState(null)
  const [savingDischarge, setSavingDischarge] = useState(false)

  const [showTransferDialog, setShowTransferDialog] = useState(false)
  const [transferForm, setTransferForm] = useState({ toWardId:'', toBedId:'', transferReason:'' })
  const [transferBeds, setTransferBeds] = useState([])
  const [savingTransfer, setSavingTransfer] = useState(false)

  const [showViewAdmission, setShowViewAdmission] = useState(false)
  const [viewAdmission, setViewAdmission] = useState(null)
  const [viewTab, setViewTab] = useState('details')

  const [clinicalNotes, setClinicalNotes] = useState([])
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [noteForm, setNoteForm] = useState({ text: '', type: 'Nursing admission assessment', bp: '', temp: '', pulse: '', spo2: '', weight: '' })
  const [savingNote, setSavingNote] = useState(false)


  const [showAddBedDialog, setShowAddBedDialog] = useState(false)
  const [addBedForm, setAddBedForm] = useState(emptyAddBed)
  const [savingBed, setSavingBed] = useState(false)

  const [deleteWardConfirm, setDeleteWardConfirm] = useState(null)
  const [patientHistoryPage, setPatientHistoryPage] = useState(1)
  const [admissionsMeta, setAdmissionsMeta] = useState({ total: 0, limit: 10, offset: 0, page: 1, totalPages: 1, hasMore: false })
  const [transferHistoryPage, setTransferHistoryPage] = useState(1)

  const ADMISSIONS_PER_PAGE = 10

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const admissionsOffset = (patientHistoryPage - 1) * ADMISSIONS_PER_PAGE
      // Fetch all admissions (admitted + discharged) so history tab works
      // AND separately fetch only admitted to guarantee Discharge/Dashboard tabs stay clean
      const [wardsResult, admittedResult, pageResult, hospitalStaffResult, departmentsResult] = await Promise.all([
        inpatientApi.getWards(),
        // ALL currently-admitted patients (no pagination) — the live tabs (Nursing,
        // Discharge, Dashboard, Billing, Movement, bed map) must see every one.
        inpatientApi.getAdmissions({ status: 'admitted', limit: 1000 }),
        // Paginated list of ALL statuses — only for the Admissions + Patient History tabs.
        inpatientApi.getAdmissions({ limit: ADMISSIONS_PER_PAGE, offset: admissionsOffset }),
        client.get('/settings?resource=users'),
        client.get('/settings?resource=departments'),
      ])
      if (wardsResult.success) {
        setWards(wardsResult.data || [])
      }
      if (admittedResult.success) setAdmittedAll(admittedResult.data || [])
      if (pageResult.success) {
        setAdmissions(pageResult.data || [])
        if (pageResult.meta) setAdmissionsMeta(pageResult.meta)
      }
      if (hospitalStaffResult.success) setDoctors((hospitalStaffResult.data || []).filter(user => user.role === 'doctor' && user.isActive !== false))
      if (departmentsResult.success) setDepartments(departmentsResult.data || [])
    } catch (err) {
      toast.error(err.message || 'Failed to load inpatient data')
    } finally {
      setLoading(false)
    }
  }, [patientHistoryPage])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { getOrgSettings().then(setOrgInfo) }, [])
  useEffect(() => {
    const interval = setInterval(fetchAll, 60000)
    return () => clearInterval(interval)
  }, [fetchAll])

  useEffect(() => {
    setPatientHistoryPage(1)
  }, [activeTab])

  const fetchBedsForWard = async (wardId) => {
    if (!wardId) { setAvailableBeds([]); return }
    try {
      const res = await inpatientApi.getBeds({ wardId, status: 'available' })
      if (res.success) setAvailableBeds(res.data || [])
    } catch {
      setAvailableBeds([])
      toast.error('Could not load beds for this ward')
    }
  }

  const fetchTransferBeds = async (wardId) => {
    if (!wardId) { setTransferBeds([]); return }
    try {
      const res = await inpatientApi.getBeds({ wardId, status: 'available' })
      if (res.success) setTransferBeds(res.data || [])
    } catch { setTransferBeds([]) }
  }

  const fetchClinicalNotes = async (admissionId) => {
    setLoadingNotes(true)
    try {
      const res = await inpatientApi.getNotes(admissionId)
      if (res.success) setClinicalNotes(res.data || [])
    } catch { setClinicalNotes([]) }
    finally { setLoadingNotes(false) }
  }

  const openViewAdmission = (a) => {
    setViewAdmission(a)
    setViewTab('details')
    setClinicalNotes([])
    setNoteForm(emptyNote)
    setShowViewAdmission(true)
  }

  const handleViewTabChange = (tab) => {
    setViewTab(tab)
    if (!viewAdmission) return
    if (tab === 'notes') fetchClinicalNotes(viewAdmission.id)
    // billing tab loads its own data via <BillScreen>
  }

  const handleSaveWard = async () => {
    if (!wardForm.name || !wardForm.code) { toast.error('Name and code required'); return }
    setSavingWard(true)
    try {
      const fields = { ...wardForm, capacity: parseInt(wardForm.capacity) || 10 }
      const res = editingWardId
        ? await inpatientApi.updateWard(editingWardId, fields)
        : await inpatientApi.createWard(fields)
      if (res.success) { toast.success(editingWardId?'Ward updated':'Ward created'); 
        setShowWardDialog(false); 
        setWardForm(emptyWard);
        setEditingWardId(null);
        fetchAll() }
      else toast.error(res.error||'Failed')
    } catch { toast.error('Failed to save ward') }
    setSavingWard(false)
  }

  const handleDeleteWard = async (ward) => {
    try {
      const res = await inpatientApi.removeWard(ward.id)
      if (res.success) { toast.success('Ward deleted'); setDeleteWardConfirm(null); fetchAll() }
      else toast.error(res.error||'Failed')
    } catch { toast.error('Failed to delete') }
  }

  const handleAdmit = async () => {
    if (!admitForm.patientId || !admitForm.wardId || !admitForm.bedId || !admitForm.departmentId || !admitForm.doctorId || !admitForm.admissionDiagnosis) { toast.error('Fill all required fields'); return }
    setSavingAdmission(true)
    try {
      const res = await inpatientApi.createAdmission({ ...admitForm, attendingDoctorId: admitForm.doctorId || undefined, admittingDoctorId: admitForm.doctorId || undefined, expectedLengthOfStay: parseInt(admitForm.expectedLengthOfStay) || 3, depositAmount: parseFloat(admitForm.depositAmount) || 0 })
      if (res.success) { toast.success('Patient admitted'); setAdmitForm(emptyAdmission); fetchAll() }
      else toast.error(res.error||'Failed to admit')
    } catch { toast.error('Failed to admit patient') }
    setSavingAdmission(false)
  }

  const handleDischarge = async () => {
    if (!dischargeForm.dischargeDiagnosis || !dischargeForm.dischargeCondition) { toast.error('Fill discharge diagnosis and condition'); return }
    if (!selectedAdmission) return
    setSavingDischarge(true)
    try {
      // Clearance-gated finalize (Phase 3): server returns 409 if any dept not cleared.
      const res = await inpatientApi.dischargeFinalize({ admissionId: selectedAdmission.id, dischargeType: 'NORMAL', ...dischargeForm })
      if (res.success) { toast.success('Patient discharged · bed freed'); setShowDischargeDialog(false); setDischargeForm(emptyDischarge); setSelectedAdmission(null); fetchAll() }
      else toast.error(res.error || 'Failed')
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to discharge patient'
      toast.error(msg)
    }
    setSavingDischarge(false)
  }

  // LAMA / Absconded / Expired — bypasses the billing gate
  const handleMarkExit = async (dischargeType) => {
    if (!selectedAdmission) return
    setSavingDischarge(true)
    try {
      const res = await inpatientApi.markExit({ admissionId: selectedAdmission.id, dischargeType, reason: dischargeForm.dischargeNotes })
      if (res.success) { toast.success(`Marked ${dischargeType}`); setShowDischargeDialog(false); setDischargeForm(emptyDischarge); setSelectedAdmission(null); fetchAll() }
      else toast.error(res.error || 'Failed')
    } catch { toast.error(`Failed to mark ${dischargeType}`) }
    setSavingDischarge(false)
  }

  const handleTransfer = async () => {
    if (!transferForm.toWardId || !transferForm.toBedId) { toast.error('Select target ward and bed'); return }
    if (!selectedAdmission) return
    setSavingTransfer(true)
    try {
      const res = await inpatientApi.createTransfer({ admissionId: selectedAdmission.id, ...transferForm })
      if (res.success) { toast.success('Patient transferred'); setShowTransferDialog(false); setTransferForm({ toWardId:'', toBedId:'', transferReason:'' }); setSelectedAdmission(null); fetchAll() }
      else toast.error(res.error||'Failed')
    } catch { toast.error('Failed to transfer patient') }
    setSavingTransfer(false)
  }

  const handleAddNote = async () => {
    if (!noteForm.text) { toast.error('Note text required'); return }
    setSavingNote(true)
    try {
      const res = await inpatientApi.createNote({
        admissionId: viewAdmission.id,
        type: noteForm.type, text: noteForm.text,
        vitals: { bp: noteForm.bp, temp: noteForm.temp, pulse: noteForm.pulse, spo2: noteForm.spo2, weight: noteForm.weight }
      })
      if (res.success) { toast.success('Note added'); setNoteForm(emptyNote); fetchClinicalNotes(viewAdmission.id) }
      else toast.error(res.error || 'Failed to add note')
    } catch { toast.error('Failed to add note') }
    setSavingNote(false)
  }

  const handleAddBed = async () => {
    if (!addBedForm.wardId || !addBedForm.bedNumber) { toast.error('Ward and bed number required'); return }
    setSavingBed(true)
    try {
      const res = await inpatientApi.createBed({ ...addBedForm })
      if (res.success) { toast.success('Bed added'); setShowAddBedDialog(false); setAddBedForm(emptyAddBed); fetchAll() }
      else toast.error(res.error || 'Failed to add bed')
    } catch { toast.error('Failed to add bed') }
    setSavingBed(false)
  }

  // Compute the print context (org + ward name + admission number) once, then
  // delegate the actual HTML to lib/inpatientPrint (kept out of this component).
  const printCtx = (adm) => ({ orgInfo, wardName: getWardName(wards, adm), admissionNo: admissionLabel(adm) })
  const handlePrintAdmissionSlip = (adm) => printAdmissionSlip(adm, printCtx(adm))

  const handlePrintDischargeSummary = (adm) => printDischargeSummary(adm, printCtx(adm))

  const allBeds = wards.flatMap((w) => w.beds || [])
  const stats = {
    totalBeds: allBeds.length || wards.reduce((s, w) => s + (w.capacity || 0), 0),
    occupiedBeds: allBeds.filter((b) => b.status === 'occupied').length,
    admitted: admittedAll.length,
    criticalPatients: admittedAll.filter((a) => a.isCritical).length,
  }
  const occupancyPct = stats.totalBeds > 0 ? Math.round((stats.occupiedBeds / stats.totalBeds) * 100) : 0

  const TABS = [
    { value: 'dashboard', label: 'Dashboard' },
    { value: 'wards-beds', label: 'Wards & Beds' },
    { value: 'admissions', label: 'Admissions' },
    { value: 'nursing', label: 'Nursing Station' },
    { value: 'notes-orders', label: 'Doctor Notes & Orders' },
    { value: 'discharge', label: 'Discharge' },
    { value: 'movement', label: 'Movement' },
    { value: 'billing', label: 'IPD Billing' },
    { value: 'patient-history', label: 'Patient History' },
    { value: 'collections', label: 'Collections' },
  ]

  // Bed map grouped by building → floor (multi-building hospitals)
  const buildingOptions = [...new Set(wards.map(w => w.building || 'Main Building'))]
  const bedMapGroups = (() => {
    const list = buildingFilter === 'all' ? wards : wards.filter(w => (w.building || 'Main Building') === buildingFilter)
    const groups = {}
    list.forEach(w => {
      const b = w.building || 'Main Building'
      const f = w.floor || 'Ground Floor'
      groups[b] = groups[b] || {}
      groups[b][f] = groups[b][f] || []
      groups[b][f].push(w)
    })
    return Object.entries(groups)
  })()

  // Currently-admitted = the dedicated full fetch (NOT the paginated `admissions`,
  // which only holds one 10-row page). This feeds Nursing/Discharge/Dashboard/etc.
  const currentAdmitted = admittedAll.filter(a => (a.status || '').toLowerCase() === 'admitted')
  // Discharged list stays on the paginated `admissions` (drives the Patient History page).
  const dischargedList = admissions.filter(a => (a.status || '').toLowerCase() === 'discharged')

  // Transfers keep status='admitted'. Movement comes from the backend `transferNotes`
  // (ClinicalNote table, noteType='transfer') — no more JSON parsing on the client.
  const transferEventList = admittedAll.flatMap(a =>
    (a.transferNotes || []).map(n => ({
      admissionId: a.id,
      patient: a.patient,
      currentWard: a.bed?.ward?.name || getWardName(wards, a),
      currentBed: a.bed?.bedNumber || '—',
      note: n.note || '',
      date: n.date,
      authorName: n.authorName || '—',
      status: a.status,
    }))
  )

  return (
    <div className="-m-6 min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BedDouble className="h-5 w-5 text-blue-600" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Inpatient Management</h1>
            <p className="text-xs text-gray-500">Ward and bed management, admissions, and patient tracking</p>
          </div>
        </div>
        <div className="flex gap-2 ">
          <Button className="bg-blue-600 text-white hover:bg-blue-700 hover:text-white" size="sm" onClick={() => { setActiveTab('new-admission'); setAdmitPatient(null); setAdmitForm(emptyAdmission); setAvailableBeds([]) }}>
            <UserPlus className="h-4 w-4 mr-1" />New Admission
          </Button>
        
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="bg-white border-b flex">
        {TABS.map(t => (
          <button key={t.value} onClick={() => setActiveTab(t.value)}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.value ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div className="p-6 space-y-6">

        {/* ════════════════════ DASHBOARD ════════════════════ */}
        {activeTab === 'dashboard' && (
          <DashboardTab
            stats={stats}
            occupancyPct={occupancyPct}
            currentAdmitted={currentAdmitted}
            wards={wards}
            setEditingWardId={setEditingWardId}
            setWardForm={setWardForm}
            setShowWardDialog={setShowWardDialog}
          />
        )}

        {/* ════════════════════ WARDS & BEDS ════════════════════ */}
        {activeTab === 'wards-beds' && (
          <WardsBedsTab
            wards={wards}
            admissions={admittedAll}
            buildingFilter={buildingFilter}
            setBuildingFilter={setBuildingFilter}
            buildingOptions={buildingOptions}
            bedMapGroups={bedMapGroups}
            setEditingWardId={setEditingWardId}
            setWardForm={setWardForm}
            setShowWardDialog={setShowWardDialog}
            setAddBedForm={setAddBedForm}
            setShowAddBedDialog={setShowAddBedDialog}
            setActiveTab={setActiveTab}
            setAdmitPatient={setAdmitPatient}
            setAdmitForm={setAdmitForm}
            fetchBedsForWard={fetchBedsForWard}
          />
        )}

        {/* ════════════════════ ADMISSIONS ════════════════════ */}
        {activeTab === 'admissions' && (
          <AdmissionsTab
            admissions={admissions}
            loading={loading}
            wards={wards}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            wardFilter={wardFilter}
            setWardFilter={setWardFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            admissionsMeta={admissionsMeta}
            patientHistoryPage={patientHistoryPage}
            setPatientHistoryPage={setPatientHistoryPage}
            ADMISSIONS_PER_PAGE={ADMISSIONS_PER_PAGE}
            openViewAdmission={openViewAdmission}
            setSelectedAdmission={setSelectedAdmission}
            setDischargeForm={setDischargeForm}
            setShowDischargeDialog={setShowDischargeDialog}
          />
        )}

        {/* ════════════════════ NEW ADMISSION (inline form) ════════════════════ */}
        {activeTab === 'new-admission' && (
          <NewAdmissionTab
            admitPatient={admitPatient}
            setAdmitPatient={setAdmitPatient}
            admitForm={admitForm}
            setAdmitForm={setAdmitForm}
            wards={wards}
            availableBeds={availableBeds}
            setAvailableBeds={setAvailableBeds}
            departments={departments}
            doctors={doctors}
            fetchBedsForWard={fetchBedsForWard}
            handleAdmit={handleAdmit}
            savingAdmission={savingAdmission}
          />
        )}

        {/* ════════════════════ NURSING STATION ════════════════════ */}
        {activeTab === 'nursing' && (
          <NursingStation admitted={currentAdmitted} />
        )}

        {/* ═══════════ NOTES & ORDERS (notes on top, orders below) ═══════════ */}
        {activeTab === 'notes-orders' && (
          <NotesAndOrders admitted={currentAdmitted} />
        )}

        {/* ════════════════════ HOUSEKEEPING ════════════════════ */}

        {/* ════════════════════ DISCHARGE ════════════════════ */}
        {activeTab === 'discharge' && (
          <DischargeTab
            currentAdmitted={currentAdmitted}
            wards={wards}
            openViewAdmission={openViewAdmission}
            setSelectedAdmission={setSelectedAdmission}
            setDischargeForm={setDischargeForm}
            setShowDischargeDialog={setShowDischargeDialog}
            setShowTransferDialog={setShowTransferDialog}
            setTransferForm={setTransferForm}
          />
        )}

        {/* ════════════════════ MOVEMENT ════════════════════ */}
        {activeTab === 'movement' && (
          <MovementTab
            transferEventList={transferEventList}
            admissions={admittedAll}
            transferHistoryPage={transferHistoryPage}
            setTransferHistoryPage={setTransferHistoryPage}
            fetchAll={fetchAll}
          />
        )}

        {/* ════════════════════ BILLING ════════════════════ */}
        {activeTab === 'billing' && (
          <BillingWorkspace 
            admissions={currentAdmitted} 
            orgInfo={orgInfo} 
          />
        )}

        {/* ════════════════════ PATIENT HISTORY ════════════════════ */}
        {activeTab === 'patient-history' && (
          <PatientHistoryTab
            dischargedList={dischargedList}
            wards={wards}
            patientHistoryPage={patientHistoryPage}
            setPatientHistoryPage={setPatientHistoryPage}
            openViewAdmission={openViewAdmission}
            handlePrintDischargeSummary={handlePrintDischargeSummary}
          />
        )}

        {/* ════════════════════ COLLECTIONS ════════════════════ */}
        {activeTab === 'collections' && (
          <CollectionsReport orgInfo={orgInfo} />
        )}

      </div>

      {/* ════════════ DIALOGS (shared across all tabs) ════════════ */}

      {/* Discharge Dialog */}
      <Dialog open={showDischargeDialog} onOpenChange={setShowDischargeDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Discharge Patient{selectedAdmission ? ` — ${getFullName(selectedAdmission.patient)}` : ''}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Discharge Diagnosis *</Label><Input value={dischargeForm.dischargeDiagnosis} onChange={e => setDischargeForm(p => ({ ...p, dischargeDiagnosis: e.target.value }))} /></div>
            <div><Label>Discharge Condition *</Label><Select value={dischargeForm.dischargeCondition} onValueChange={v => setDischargeForm(p => ({ ...p, dischargeCondition: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DISCHARGE_CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Treatment Summary</Label><Textarea value={dischargeForm.treatmentSummary} onChange={e => setDischargeForm(p => ({ ...p, treatmentSummary: e.target.value }))} rows={3} /></div>
            <div><Label>Medications on Discharge</Label><Textarea value={dischargeForm.medicationsOnDischarge} onChange={e => setDischargeForm(p => ({ ...p, medicationsOnDischarge: e.target.value }))} rows={2} /></div>
            <div><Label>Follow-up Instructions</Label><Textarea value={dischargeForm.followUpInstructions} onChange={e => setDischargeForm(p => ({ ...p, followUpInstructions: e.target.value }))} rows={2} /></div>
            <div><Label>Follow-up Date</Label><Input type="date" value={dischargeForm.followUpDate} onChange={e => setDischargeForm(p => ({ ...p, followUpDate: e.target.value }))} /></div>
            <div><Label>Discharge Notes</Label><Textarea value={dischargeForm.dischargeNotes} onChange={e => setDischargeForm(p => ({ ...p, dischargeNotes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex gap-2 mr-auto">
              <Button variant="outline" size="sm" className="text-amber-700 border-amber-300" onClick={() => handleMarkExit('LAMA')} disabled={savingDischarge}>LAMA</Button>
              <Button variant="outline" size="sm" className="text-gray-700" onClick={() => handleMarkExit('EXPIRED')} disabled={savingDischarge}>Expired</Button>
            </div>
            <Button variant="outline" onClick={() => setShowDischargeDialog(false)}>Cancel</Button>
            <Button onClick={handleDischarge} disabled={savingDischarge}>
              {savingDischarge ? 'Discharging...' : 'Discharge Patient'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Transfer Patient{selectedAdmission ? ` — ${getFullName(selectedAdmission.patient)}` : ''}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Target Ward *</Label><Select value={transferForm.toWardId} onValueChange={v => { setTransferForm(p => ({ ...p, toWardId: v, toBedId: '' })); fetchTransferBeds(v) }}><SelectTrigger><SelectValue placeholder="Select ward" /></SelectTrigger><SelectContent>{wards.filter(w => w.id !== selectedAdmission?.wardId).map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Target Bed *</Label><Select value={transferForm.toBedId} onValueChange={v => setTransferForm(p => ({ ...p, toBedId: v }))} disabled={!transferForm.toWardId}><SelectTrigger><SelectValue placeholder="Select bed" /></SelectTrigger><SelectContent>{transferBeds.map(b => <SelectItem key={b.id} value={b.id}>Bed {b.bedNumber}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Transfer Reason</Label><Textarea value={transferForm.transferReason} onChange={e => setTransferForm(p => ({ ...p, transferReason: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowTransferDialog(false)}>Cancel</Button><Button onClick={handleTransfer} disabled={savingTransfer}>{savingTransfer ? 'Transferring...' : 'Transfer Patient'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Ward Dialog (simplified) */}
      <Dialog open={showWardDialog} onOpenChange={setShowWardDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingWardId ? 'Edit Ward' : 'Add New Ward'}</DialogTitle>
            <p className="text-xs text-gray-500">{editingWardId ? 'Update ward details' : 'Create a new ward in the hospital'}</p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Ward Name *</Label><Input className="mt-1" value={wardForm.name} onChange={e => setWardForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. General Ward A" /></div>
              <div><Label>Ward Code *</Label><Input className="mt-1" value={wardForm.code} onChange={e => setWardForm(p => ({ ...p, code: e.target.value }))} placeholder="e.g. GWA" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Ward Type *</Label>
                <Select value={wardForm.type} onValueChange={v => setWardForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{WARD_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Bed Capacity *</Label><Input type="number" min={1} className="mt-1" value={wardForm.capacity} onChange={e => setWardForm(p => ({ ...p, capacity: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Building / Block</Label><Input className="mt-1" value={wardForm.building} onChange={e => setWardForm(p => ({ ...p, building: e.target.value }))} placeholder="e.g. A Block" /></div>
              <div><Label>Floor</Label><Input className="mt-1" value={wardForm.floor} onChange={e => setWardForm(p => ({ ...p, floor: e.target.value }))} placeholder="e.g. 3rd Floor" /></div>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={wardForm.departmentId || ''} onValueChange={v => setWardForm(p => ({ ...p, departmentId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Link to a department (optional)" /></SelectTrigger>
                <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWardDialog(false)}>Cancel</Button>
            <Button className="bg-gray-900 hover:bg-gray-800" onClick={handleSaveWard} disabled={savingWard}>{savingWard ? 'Saving...' : 'Save Ward'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Bed Dialog */}
      <Dialog open={showAddBedDialog} onOpenChange={setShowAddBedDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Bed</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Ward *</Label><Select value={addBedForm.wardId} onValueChange={v => setAddBedForm(p => ({ ...p, wardId: v }))}><SelectTrigger><SelectValue placeholder="Select ward" /></SelectTrigger><SelectContent>{wards.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Bed Number *</Label><Input value={addBedForm.bedNumber} onChange={e => setAddBedForm(p => ({ ...p, bedNumber: e.target.value }))} placeholder="e.g. 101" /></div>
            <div><Label>Bed Type</Label><Select value={addBedForm.type} onValueChange={v => setAddBedForm(p => ({ ...p, type: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BED_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowAddBedDialog(false)}>Cancel</Button><Button onClick={handleAddBed} disabled={savingBed}>{savingBed ? 'Adding...' : 'Add Bed'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Admission Dialog */}
      <Dialog open={showViewAdmission} onOpenChange={setShowViewAdmission}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Admission Details — {viewAdmission ? admissionLabel(viewAdmission) : ''}</span>
              {viewAdmission && (
                <div className="flex gap-2 mr-6">
                  <Button size="sm" variant="outline" onClick={() => handlePrintAdmissionSlip(viewAdmission)}><Printer className="h-4 w-4 mr-1" />Slip</Button>
                  {viewAdmission.status === 'discharged' && <Button size="sm" variant="outline" onClick={() => handlePrintDischargeSummary(viewAdmission)}><FileText className="h-4 w-4 mr-1" />Summary</Button>}
                </div>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex border-b mb-4">
            {[{ id: 'details', label: 'Details', Icon: FileText }, { id: 'notes', label: 'Clinical Notes', Icon: ClipboardList }, { id: 'timeline', label: 'Timeline Logs', Icon: History }, { id: 'billing', label: 'IPD Billing', Icon: IndianRupee }].map(({ id, label, Icon }) => (
              <button key={id} onClick={() => handleViewTabChange(id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${viewTab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
          {viewAdmission && viewTab === 'details' && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Adm #: </span><span className="font-mono font-medium">{admissionLabel(viewAdmission)}</span></div>
                <div><span className="text-gray-500">Status: </span>{admissionStatusBadge(viewAdmission.status)}</div>
                <div><span className="text-gray-500">Patient: </span><span className="font-medium">{getFullName(viewAdmission.patient)}</span></div>
                <div><span className="text-gray-500">UHID: </span><span className="font-mono">{viewAdmission.patient?.mrn}</span></div>
                <div><span className="text-gray-500">Ward / Bed: </span><span>{getWardName(wards, viewAdmission)} · Bed {viewAdmission.bed?.bedNumber || '—'}</span></div>
                <div><span className="text-gray-500">Admitted: </span><span>{viewAdmission.admissionDate ? format(new Date(viewAdmission.admissionDate), 'dd MMM yyyy') : '—'}</span></div>
                <div><span className="text-gray-500">Type: </span><span>{viewAdmission.admissionType}</span></div>
                <div><span className="text-gray-500">Deposit: </span><span>₹{(viewAdmission.depositAmount || 0).toLocaleString()}</span></div>
              </div>
              <div><p className="text-gray-500 mb-1">Diagnosis:</p><p className="bg-gray-50 p-2 rounded">{viewAdmission.admissionDiagnosis}</p></div>
              {viewAdmission.isCritical && <Badge className={viewAdmission.criticalLevel === 'blue' ? 'bg-blue-500' : 'bg-yellow-500 hover:bg-yellow-600'}>Critical: Code {viewAdmission.criticalLevel === 'blue' ? 'Blue' : 'Yellow'}</Badge>}
              {viewAdmission.status === 'admitted' && (
                <Button onClick={() => { setShowViewAdmission(false); setSelectedAdmission(viewAdmission); setTransferForm({ toWardId: '', toBedId: '', transferReason: '' }); setShowTransferDialog(true) }} variant="outline" size="sm">
                  <ArrowRight className="h-4 w-4 mr-1" />Transfer Patient
                </Button>
              )}
            </div>
          )}
          {viewAdmission && viewTab === 'notes' && (
            <div className="space-y-4">
              <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
                <p className="font-medium text-sm">Add Clinical Note</p>
                <div><Label className="text-xs">Note Type</Label><Select value={noteForm.type} onValueChange={v => setNoteForm(p => ({ ...p, type: v }))}><SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger><SelectContent>{NOTE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
                <div><Label className="text-xs">Note *</Label><Textarea value={noteForm.text} onChange={e => setNoteForm(p => ({ ...p, text: e.target.value }))} rows={3} className="mt-1" placeholder="Enter clinical note..." /></div>
                <Button size="sm" onClick={handleAddNote} disabled={savingNote}>{savingNote ? 'Saving...' : 'Add Note'}</Button>
              </div>
              <div className="space-y-2">
                {loadingNotes ? <p className="text-center text-gray-400 py-4">Loading notes...</p>
                  : clinicalNotes.length === 0 ? <p className="text-center text-gray-400 py-4">No clinical notes yet</p>
                    : clinicalNotes.map((n, i) => (
                      <div key={n.id || i} className="border rounded-lg p-3 text-sm space-y-1">
                        <div className="flex items-center justify-between">
                          <Badge className="text-xs">{n.type || 'Note'}</Badge>
                          <span className="text-xs text-gray-400">{n.createdAt ? format(new Date(n.createdAt), 'dd MMM yyyy, hh:mm a') : ''}</span>
                        </div>
                        <p>{n.text}</p>
                      </div>
                    ))}
              </div>
            </div>
          )}
          {viewAdmission && viewTab === 'timeline' && (
            <div className="max-h-[60vh] overflow-y-auto">
              <PatientTimeline patientId={viewAdmission.patientId} />
            </div>
          )}
          {viewAdmission && viewTab === 'billing' && (
            <BillScreen admission={viewAdmission} orgInfo={orgInfo} />
          )}

          <DialogFooter><Button variant="outline" onClick={() => setShowViewAdmission(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Ward Confirm */}
      <Dialog open={!!deleteWardConfirm} onOpenChange={() => setDeleteWardConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Ward?</DialogTitle></DialogHeader>
          <p className="text-gray-600">Delete <strong>{deleteWardConfirm?.name}</strong>? This cannot be undone.</p>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteWardConfirm(null)}>Cancel</Button><Button variant="destructive" onClick={() => handleDeleteWard(deleteWardConfirm)}>Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}