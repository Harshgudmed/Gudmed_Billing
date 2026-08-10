import { useState, useEffect, useCallback, useRef } from 'react'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { formatMoney as fmt, formatDateTime } from '@/lib/format'
import { calcAge, getFullName } from '@/lib/patient'
import { toast } from 'sonner'
import { format } from 'date-fns'
import client from '@/api/client'
import PatientLookup from '@/components/common/PatientLookup'
import RefundApprovalsTab from './RefundApprovalsTab'
import { Receipt, RefreshCw, Plus, Search, Trash2, Shield, Eye, Printer, Download, TrendingUp, Clock, AlertCircle, Pencil, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { printInvoice, printReceipt, printLabReceipt, printRadiologyReceipt, printPharmacyReceipt } from './utils/printBilling'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { appointmentSchema } from '@/components/appointments/appointmentSchema'
import AppointmentFormDialog from '@/components/appointments/AppointmentFormDialog'
import { useBookingSource } from '@/components/common/hooks/useBookingSource'
import { useDateFilter } from '@/components/common/DateFilter'

// ── Catalogue ─────────────────────────────────────────────────────────────────
const CATALOGUE = {
  Consultation: [
    { name: 'OPD Consultation', sub: 'General', amt: 500 },
    { name: 'Follow-up', sub: 'General', amt: 300 },
    { name: 'Emergency Consultation', sub: 'General', amt: 800 },
    { name: 'Video Consultation', sub: 'General', amt: 400 },
    { name: 'Home Visit', sub: 'General', amt: 1500 },
  ],
  Lab: [
    { name: 'CBC (Complete Blood Count)', sub: 'Haematology', amt: 250 },
    { name: 'HbA1c', sub: 'Biochemistry', amt: 320 },
    { name: 'Lipid Profile', sub: 'Biochemistry', amt: 500 },
    { name: 'Liver Function Test (LFT)', sub: 'Biochemistry', amt: 600 },
    { name: 'Kidney Function Test (KFT)', sub: 'Biochemistry', amt: 500 },
    { name: 'TSH', sub: 'Thyroid', amt: 250 },
    { name: 'Vitamin D (25-OH)', sub: 'Vitamin', amt: 700 },
    { name: 'Blood Glucose (Fasting)', sub: 'Biochemistry', amt: 80 },
    { name: 'Haemoglobin (Hb)', sub: 'Haematology', amt: 80 },
    { name: 'ESR', sub: 'Haematology', amt: 80 },
    { name: 'Blood Group & Rh Typing', sub: 'Haematology', amt: 120 },
    { name: 'CRP (C-Reactive Protein)', sub: 'Biochemistry', amt: 250 },
    { name: 'T3 T4 TSH (Thyroid Profile)', sub: 'Thyroid', amt: 550 },
    { name: 'Dengue NS1 Antigen', sub: 'Serology', amt: 600 },
    { name: 'HBsAg (Hepatitis B)', sub: 'Serology', amt: 250 },
    { name: 'Urine Routine & Microscopy', sub: 'Urine', amt: 120 },
    { name: 'Vitamin B12', sub: 'Vitamin', amt: 600 },
    { name: 'COVID-19 RT-PCR', sub: 'PCR', amt: 500 },
  ],
  Pharmacy: [
    { name: 'Paracetamol 500mg strip', sub: 'Analgesic', amt: 25 },
    { name: 'Amoxicillin 500mg strip', sub: 'Antibiotic', amt: 85 },
    { name: 'Pantoprazole 40mg strip', sub: 'Antacid/PPI', amt: 55 },
    { name: 'ORS Sachet x10', sub: 'Rehydration', amt: 30 },
    { name: 'Ibuprofen 400mg strip', sub: 'Analgesic', amt: 35 },
    { name: 'Metformin 500mg strip', sub: 'Antidiabetic', amt: 30 },
    { name: 'Amlodipine 5mg strip', sub: 'Antihypertensive', amt: 40 },
    { name: 'Cetirizine 10mg strip', sub: 'Antihistamine', amt: 25 },
    { name: 'Cough Syrup 100ml', sub: 'Expectorant', amt: 60 },
  ],
  Procedure: [
    { name: 'Dressing (Simple)', sub: 'Wound Care', amt: 200 },
    { name: 'Dressing (Complex)', sub: 'Wound Care', amt: 400 },
    { name: 'Suturing (per stitch)', sub: 'Wound Care', amt: 150 },
    { name: 'ECG', sub: 'Cardiac', amt: 200 },
    { name: 'IV Cannula Insertion', sub: 'Vascular', amt: 150 },
    { name: 'Injection (IM/IV/SC)', sub: 'Injection', amt: 100 },
    { name: 'Nebulisation Session', sub: 'Respiratory', amt: 200 },
    { name: 'POP Application', sub: 'Ortho', amt: 800 },
    { name: 'Minor OT Procedure', sub: 'Surgical', amt: 2000 },
  ],
  Radiology: [
    { name: 'X-Ray Chest PA View', sub: 'Chest', amt: 200 },
    { name: 'X-Ray Chest PA + Lateral', sub: 'Chest', amt: 350 },
    { name: 'USG Abdomen (Whole)', sub: 'Abdomen', amt: 800 },
    { name: 'USG Abdomen + Pelvis', sub: 'Abdomen/Pelvis', amt: 900 },
    { name: '2D Echocardiography', sub: 'Cardiac', amt: 1800 },
    { name: 'CT Head', sub: 'Head', amt: 3500 },
    { name: 'MRI Brain', sub: 'Brain', amt: 5500 },
    { name: 'USG Thyroid', sub: 'Thyroid', amt: 600 },
  ],
  Vaccine: [
    { name: 'Influenza Vaccine', sub: 'Adult/Child', amt: 850 },
    { name: 'Hepatitis B Vaccine', sub: 'Adult', amt: 350 },
    { name: 'Typhoid Vaccine', sub: 'Adult/Child', amt: 450 },
    { name: 'Tetanus Toxoid (TT)', sub: 'Adult/Child', amt: 80 },
    { name: 'MMR Vaccine', sub: 'Paediatric', amt: 350 },
    { name: 'Rabies Vaccine (PEP)', sub: 'PEP', amt: 700 },
    { name: 'HPV Vaccine', sub: 'Adolescent/Adult', amt: 3000 },
  ],
}

// Catalogue tabs whose items are real master-data rows. Billing one of these
// must also move the real record behind it (stock draw-down / clinical order),
// so the line is tagged with the module the backend should fulfil it against.
const SOURCE_TYPE = {
  Lab: 'lab',
  Radiology: 'radiology',
  Pharmacy: 'pharmacy',
}

const CAT_META = {
  Consultation: { color: 'bg-cyan-100 text-cyan-800', dot: '#0097a7' },
  Lab: { color: 'bg-blue-100 text-blue-800', dot: '#185fa5' },
  Pharmacy: { color: 'bg-purple-100 text-purple-800', dot: '#7c3aed' },
  Procedure: { color: 'bg-amber-100 text-amber-800', dot: '#b45309' },
  Radiology: { color: 'bg-gray-100 text-gray-800', dot: '#374151' },
  Vaccine: { color: 'bg-green-100 text-green-800', dot: '#16a34a' },
}

// Friendly department names shown in the department selector + on the printed
// invoice. Each department gets its OWN billing form (only its catalogue shows).
const DEPT_LABEL = {
  Consultation: 'OPD / Consultation',
  Lab: 'Laboratory',
  Pharmacy: 'Pharmacy',
  Procedure: 'Procedure',
  Radiology: 'Radiology',
  Vaccine: 'Vaccination',
}

const BILLING_ITEMS_PER_PAGE = 10

// Claim statuses as stored by the insurance module (InsuranceClaim.status).
const CLAIM_STATUS_STYLE = {
  approved:  'bg-green-100 text-green-800',
  settled:   'bg-emerald-100 text-emerald-800',
  pending:   'bg-yellow-100 text-yellow-800',
  submitted: 'bg-blue-100 text-blue-800',
  rejected:  'bg-red-100 text-red-800',
}

const DEFAULT_CLINIC = {
  doctorName: 'Dr. Abebe Kebede', qualification: 'MBBS, MD (General Medicine)',
  clinicName: 'Hospital', address: '', phone: '', regNo: '', gstNo: '',
  upiId: 'gudmed@upi', bankName: 'HDFC Bank', accountNo: 'XXXX XXXX 4523', ifsc: 'HDFC0001234',
  whatsappEnabled: true, countryCode: '91',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Money formatting lives in @/lib/format so every screen and receipt agrees.
const todayStr = () => new Date().toISOString().slice(0, 10)
const newInvNo = () => 'INV-' + Date.now().toString().slice(-8)

// What an invoice billed for, read off its line items. A consultation line is
// tagged `type`, while pharmacy/lab/radiology lines are tagged `sourceType`
// (the billing UI sets it so the invoice can draw down stock and raise orders).
// Both keys are checked because one invoice can legitimately carry several
// kinds of line — a consultation plus the tests ordered in it — and the row has
// to say so rather than pick one and hide the rest.
// Keep in step with INVOICE_TYPE_MATCH in backend/src/controllers/billingController.js,
// which filters on these same two keys server-side.
const BILL_TYPE_LABEL = {
  opd: { label: 'OPD', className: 'bg-purple-100 text-purple-700' },
  pharmacy: { label: 'Pharmacy', className: 'bg-teal-100 text-teal-700' },
  lab: { label: 'Laboratory', className: 'bg-blue-100 text-blue-700' },
  radiology: { label: 'Radiology', className: 'bg-amber-100 text-amber-700' },
  procedure: { label: 'Procedure', className: 'bg-orange-100 text-orange-700' },
  vaccine: { label: 'Vaccine', className: 'bg-green-100 text-green-700' },
}

// The cart's category (what the biller picked) → the `type` stored on the line.
// 'consultation' rather than 'opd' because that is the word appointmentController's
// auto-voucher has always written; one vocabulary, or the filter finds half the rows.
const CATEGORY_TYPE = {
  Consultation: 'consultation',
  Lab: 'lab',
  Pharmacy: 'pharmacy',
  Radiology: 'radiology',
  Procedure: 'procedure',
  Vaccine: 'vaccine',
}

// Two keys can mark a line: `sourceType` is set only for the three catalogues the
// invoice has to act on, while `type` is set for every line the billing screen
// writes. Both are read so a consultation/procedure/vaccine (which has no
// catalogue, and so no sourceType) is still typed, and so invoices written before
// `type` existed still resolve from sourceType alone.
function invoiceTypesOf(rawItems) {
  const found = new Set()
  for (const item of rawItems || []) {
    if (item?.type === 'consultation') found.add('opd')
    else if (BILL_TYPE_LABEL[item?.type]) found.add(item.type)
    if (BILL_TYPE_LABEL[item?.sourceType]) found.add(item.sourceType)
  }
  return [...found]
}

function TypeBadges({ types }) {
  if (!types?.length) return <span className="text-gray-400 text-xs">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((t) => (
        <Badge key={t} className={BILL_TYPE_LABEL[t].className}>{BILL_TYPE_LABEL[t].label}</Badge>
      ))}
    </div>
  )
}

// ── Status badge helper ───────────────────────────────────────────────────────
function PayBadge({ invoice }) {
  if (!invoice) return null
  // Checked before paid/partial: a cancelled bill is void whatever was collected
  // on it, and must never read as money still owed.
  if (invoice.cancelled) return <Badge className="bg-gray-200 text-gray-700">Cancelled</Badge>
  if (invoice.paid) return <Badge className="bg-green-100 text-green-800">Paid</Badge>
  const total = Number(invoice.total || 0)
  const paidAmt = Number(invoice.amountPaid || 0)
  const balance = invoice.balanceDue ?? (total - paidAmt)
  if (paidAmt > 0 && balance > 0) return <Badge className="bg-orange-100 text-orange-800">Partial</Badge>
  return <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function BillingModule({ onBack }) {
  const user = JSON.parse(localStorage.getItem('gudmed-user') || '{}')
  const [activeTab, setActiveTab] = useState('invoices')
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [clinic, setClinic] = useState(() => {
    if (typeof window !== 'undefined') {
      const s = localStorage.getItem('gudmed-clinic-profile')
      return s ? JSON.parse(s) : DEFAULT_CLINIC
    }
    return DEFAULT_CLINIC
  })

  // Data
  const [bills, setBills] = useState([])
  const [billsLoading, setBillsLoading] = useState(false)

  const [services, setServices] = useState([])
  const [servicesLoading, setServicesLoading] = useState(false)
  const [stats, setStats] = useState({ todayRevenue: 0, pendingCount: 0, collectedToday: 0, outstanding: 0 })

  // Real Lab/Radiology/Pharmacy catalogues (was hardcoded dummy CATALOGUE data).
  // Lab tests + Radiology exams are small enough to load in full and filter
  // client-side; Pharmacy has ~2 lakh drugs so it's searched server-side instead.
  const [labTests, setLabTests] = useState([])
  const [radiologyExams, setRadiologyExams] = useState([])
  const [pharmacyDrugs, setPharmacyDrugs] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(false)

  // Real insurance claims (was a hardcoded DEMO_CLAIMS array of fake patients).
  // GET /insurance returns cases, each with its nested claims — flatten to rows.
  const [claims, setClaims] = useState([])
  const [claimsLoading, setClaimsLoading] = useState(false)
  const [claimSearch, setClaimSearch] = useState('')
  const [claimStatusFilter, setClaimStatusFilter] = useState('all')

  // New invoice form
  const newForm = () => ({
    patientName: '', patientId: '', phone: '', age: '', gender: '', uhid: '',
    date: todayStr(), invoiceNo: newInvNo(), notes: '', payMode: 'Cash',
    paid: false, amountReceived: '', items: [], discount: '', gstPct: '', homeCollection: '', sendWhatsApp: true,
  })
  const [form, setForm] = useState(newForm())
  // Department drives the whole New Bill form — no department chosen = nothing shown.
  const [department, setDepartment] = useState('')
  const [activeCat, setActiveCat] = useState('')

  // ── Booking a consultation from the counter ─────────────────────────────────
  // Choosing "Consultation" used to add a line from a hardcoded list — OPD ₹500,
  // Follow-up ₹300 — with no department, no doctor, no slot and no appointment
  // behind it. The counter took money and the doctor never learned a patient was
  // coming: no queue token, no commission, and a fee that had nothing to do with
  // the doctor's slab.
  //
  // So it opens the real booking form instead, and books through
  // POST /appointments — which writes appointment, queue entry, invoice (number
  // from the atomic counter) and doctorCommission in ONE transaction. Billing must
  // NOT also create an invoice here: that would produce two bills for one visit,
  // and leave the queue and the commission out entirely.
  const [showBooking, setShowBooking] = useState(false)
  const [bookingPatient, setBookingPatient] = useState(null)
  const [bookingSubmitting, setBookingSubmitting] = useState(false)

  const bookingForm = useForm({
    resolver: zodResolver(appointmentSchema),
    mode: 'onBlur',
    defaultValues: {
      patientId: '', departmentId: '', doctorId: '',
      appointmentDate: new Date(), appointmentTime: '',
      appointmentType: 'new_patient', priority: 'normal',
      consultationFee: '', notes: '',
    },
  })

  const bookingDeptId = bookingForm.watch('departmentId')
  const bookingDoctorId = bookingForm.watch('doctorId')
  const bookingPatientId = bookingForm.watch('patientId')
  const bookingDate = bookingForm.watch('appointmentDate')

  // Departments, the doctors IN that department, that doctor's slabs, and what
  // this patient is actually charged — the same source Appointments books from.
  const booking = useBookingSource({
    departmentId: bookingDeptId,
    doctorId: bookingDoctorId,
    patientId: bookingPatientId,
    date: bookingDate instanceof Date ? bookingDate.toISOString() : bookingDate,
  })

  const submitBooking = async (data) => {
    setBookingSubmitting(true)
    try {
      // The server resolves the fee from the doctor's slab and REFUSES a
      // client-supplied one (appointmentController.js:401), so the number shown in
      // the form is for the user, never for the request.
      const { consultationFee, ...payload } = data
      const res = await client.post('/appointments', {
        ...payload,
        appointmentDate: payload.appointmentDate instanceof Date
          ? payload.appointmentDate.toISOString()
          : payload.appointmentDate,
      })
      const appt = res?.data ?? res
      toast.success(
        appt?.invoice?.invoiceNumber
          ? `Appointment booked · invoice ${appt.invoice.invoiceNumber}`
          : 'Appointment booked',
      )
      setShowBooking(false)
      setBookingPatient(null)
      bookingForm.reset()
      // The booking created an invoice inside its own transaction, so the list and
      // the stat cards are stale until this refetches — the same gap that left a
      // completed lab order still reading "In Progress" on the Orders tab.
      // `fetchAll` is declared further down; this only runs on submit, long after.
      fetchAll()
    } catch (e) {
      toast.error(e?.response?.data?.error || e?.message || 'Could not book the appointment')
    } finally {
      setBookingSubmitting(false)
    }
  }
  const [catSearch, setCatSearch] = useState('')
  const [saving, setSaving] = useState(false)

  // Patient search
  const [patientSearch, setPatientSearch] = useState('')
  const [patientDropdown, setPatientDropdown] = useState(false)
  const [patientResults, setPatientResults] = useState([])
  const [patSearchLoading, setPatSearchLoading] = useState(false)
  const dropRef = useRef(null)

  // Modals
  const [showInvoiceModal, setShowInvoiceModal] = useState(null)
  
  // Refund state
  const [refundDialog, setRefundDialog] = useState(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [showPayModal, setShowPayModal] = useState(null)
  const [payMethod, setPayMethod] = useState('Cash')
  // Re-entrancy lock for payments: the ref blocks a double-click synchronously
  // (before React re-renders the disabled button), so no duplicate charge is posted.
  const paymentLock = useRef(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [payAmount, setPayAmount] = useState('') // supports partial payments
  // Idempotency token for the CURRENT payment intent. Stable across manual retries
  // of the same installment (so a network-timeout retry is deduped by the backend),
  // regenerated whenever the modal opens or the balance changes after a payment.
  const payIdemKey = useRef(null)

  // When the pay modal opens (or the balance changes after a payment), default the
  // amount to the remaining balance and mint a fresh idempotency key for that intent.
  useEffect(() => {
    if (showPayModal) {
      const bal = showPayModal.balanceDue ?? (Number(showPayModal.total || 0) - Number(showPayModal.amountPaid || 0))
      setPayAmount(bal > 0 ? String(bal) : '')
      payIdemKey.current = (crypto?.randomUUID?.() || `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    }
  }, [showPayModal])

  // Invoice search/filter
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [debouncedInvoiceSearch, setDebouncedInvoiceSearch] = useState('')
  const [invoiceFilter, setInvoiceFilter] = useState('all')
  const [invoiceType, setInvoiceType] = useState('all')
  const [totalBills, setTotalBills] = useState(0)

  // The shared date filter every other module already uses (Patients, Pre-Triage,
  // Consultations). It owns the six modes, the two date inputs, its own Clear
  // button, and `range` — the { startDate, endDate } the server understands.
  //
  // It also refuses to send a HALF-filled range: picking "Custom Range" switches
  // the mode before either date is typed, and typing the start lands a render
  // before the end exists. Sending those would have fired two throwaway queries
  // per use, one an open-ended scan of every invoice ever raised.
  // showClear: false — this tab has four filters and one "Clear all" below that
  // resets every one of them. Letting the date control render its own Clear too
  // put two buttons a step apart, the left one resetting only the date.
  const dateFilter = useDateFilter('all', { showClear: false })

  // One button that clears EVERY filter on this tab, not just the dates. The
  // shared control has its own Clear for the date alone; this is the one a
  // receptionist reaches for after narrowing by search, status, type AND date and
  // wanting the full list back — otherwise that is four separate resets, and
  // forgetting one is how "the invoice is missing" gets reported.
  const invoiceFiltersActive =
    invoiceSearch !== '' || invoiceFilter !== 'all' || invoiceType !== 'all' || dateFilter.active

  const clearInvoiceFilters = () => {
    setInvoiceSearch('')
    setInvoiceFilter('all')
    setInvoiceType('all')
    dateFilter.reset()
  }

  // Service catalog — mirrors the backend BillingService schema exactly
  // (serviceName/serviceCode/serviceCategory/department/unitPrice/isTaxable/
  // taxPercentage/isCoveredByInsurance/insuranceCopayPercentage/description).
  const emptyService = () => ({
    name: '', serviceCode: '', category: 'Consultation', department: 'Consultation',
    price: '', description: '', isTaxable: false, taxPercentage: '',
    isCoveredByInsurance: true, insuranceCopayPercentage: '',
  })
  const [showAddServiceDialog, setShowAddServiceDialog] = useState(false)
  const [newService, setNewService] = useState(emptyService())
  const [savingService, setSavingService] = useState(false)
  const [editingServiceId, setEditingServiceId] = useState(null)
  const [deletingService, setDeletingService] = useState(null)

  // Pagination
  const [invoicesPage, setInvoicesPage] = useState(1)
  const [servicesPage, setServicesPage] = useState(1)
  const [totalServices, setTotalServices] = useState(0)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedInvoiceSearch(invoiceSearch), 400)
    return () => clearTimeout(handler)
  }, [invoiceSearch])

  // Any filter change snaps back to page 1. Narrowing while on page 4 otherwise
  // leaves the table blank: "Today" has two invoices, page 4 of two rows does not
  // exist, and the screen shows nothing while the header claims a count.
  useEffect(() => {
    setInvoicesPage(1)
  }, [debouncedInvoiceSearch, invoiceFilter, invoiceType, dateFilter.key])

  // Derived cart totals
  const subtotal = form.items.reduce((a, i) => a + i.qty * i.amt, 0)
  const discountAmt = Math.round(subtotal * form.discount / 100)
  const gstAmt = Math.round((subtotal - discountAmt) * form.gstPct / 100)
  const homeCharge = Number(form.homeCollection) || 0
  const total = subtotal - discountAmt + gstAmt + homeCharge

  // ── Fetch all ─────────────────────────────────────────────────────────────
  const fetchBills = useCallback(async () => {
    setBillsLoading(true)
    try {
      const offset = (invoicesPage - 1) * BILLING_ITEMS_PER_PAGE
      const res = await client.get('/billing', { 
        params: { 
          resource: 'invoices', 
          limit: BILLING_ITEMS_PER_PAGE, 
          offset,
          search: debouncedInvoiceSearch || undefined,
          status: invoiceFilter === 'all' ? undefined : invoiceFilter,
          type: invoiceType === 'all' ? undefined : invoiceType,
          // Filtered in the DATABASE, not in the browser. A page-local filter
          // would only ever search the ten rows already on screen and would
          // report "no invoices in March" while March sat on page four.
          startDate: dateFilter.range.startDate || undefined,
          endDate: dateFilter.range.endDate || undefined,
        }
      })
      if (res.success) {
        setTotalBills(res.meta?.total || 0)
        const mapped = res.data.map((inv) => {
          let items = []
          try { items = typeof inv.items === 'string' ? JSON.parse(inv.items) : (inv.items || []) } catch { items = [] }
          const patName = getFullName(inv.patient) || 'Unknown'
          // Normalise DB items to the print shape ({name,qty,amt}). Invoice items
          // are written in two shapes and BOTH must be read here:
          //   {serviceName,quantity,unitPrice}                — billing/lab/radiology
          //   {type,description,quantity,unitPrice,total,...} — appointment booking
          // Missing `description` is why every appointment invoice printed its
          // line as the literal fallback "Item".
          // gstRate/batchNumber/expiryDate ride along when present (Pharmacy
          // items only) so printPharmacyReceipt can show the real GST breakdown.
          const normItems = (items || []).map(it => ({
            name: it.name || it.serviceName || it.description || 'Item',
            qty: it.qty || it.quantity || 1,
            amt: it.amt ?? it.unitPrice ?? 0,
            sub: it.sub || '',
            gstRate: it.gstRate,
            batchNumber: it.batchNumber,
            expiryDate: it.expiryDate,
          }))
          // Department is tagged into notes as "[Laboratory] ..." at creation.
          const deptMatch = (inv.notes || '').match(/^\[([^\]]+)\]\s*/)
          return {
            id: inv.invoiceNumber, dbId: inv.id,
            patientName: patName, patientId: inv.patientId,
            phone: inv.patient?.phonePrimary || '',
            age: '', gender: '', uhid: inv.patient?.mrn || '',
            date: format(new Date(inv.invoiceDate), 'dd MMM yyyy'),
            invoiceNo: inv.invoiceNumber,
            notes: (inv.notes || '').replace(/^\[[^\]]+\]\s*/, ''),
            department: deptMatch ? deptMatch[1] : '',
            payMode: 'Cash', paid: inv.paymentStatus === 'paid',
            // Carried through so the row can read as void. Without it the list
            // had no way to tell a cancelled bill apart from an unpaid one, so
            // it rendered "Pending" with a live Pay button — the cashier took
            // the money at the counter and only then hit the server's refusal.
            cancelled: inv.status === 'cancelled' || inv.paymentStatus === 'cancelled',
            // From the RAW items: normItems drops type/sourceType.
            billTypes: invoiceTypesOf(items),
            items: normItems, discount: inv.discountPercentage || 0, gstPct: 0,
            subtotal: inv.subtotal, discountAmt: inv.discountAmount,
            gstAmt: inv.taxAmount || 0, total: inv.totalAmount,
            amountPaid: inv.amountPaid || 0, balanceDue: inv.balanceDue ?? (inv.totalAmount - (inv.amountPaid || 0)),
            createdAt: inv.invoiceDate || inv.createdAt,
            // Payment ledger (date/time + receipt + method) for the receipt's Payment
            // table. Stamp each row with this invoice's number for the Invoice No column.
            payments: (inv.payments || []).map((p) => ({ ...p, invoiceNumber: inv.invoiceNumber })),
          }
        })
        setBills(mapped)
      }
    } catch { /* silent */ }
    finally { setBillsLoading(false) }
    // `dateFilter.key` and not the range object: a fresh { startDate, endDate } is
    // built on every render, so depending on it would refetch forever. The key is
    // a plain string that only changes when the user actually changes a date.
  }, [invoicesPage, debouncedInvoiceSearch, invoiceFilter, invoiceType, dateFilter.key])

  const fetchStats = useCallback(async () => {
    try {
      const res = await client.get('/billing', { params: { resource: 'stats' } })
      if (res.success) {
        const s = res.data
        setStats({
          todayRevenue:  s.todayRevenue       || 0,
          pendingCount:  s.pendingInvoices    || 0,
          collectedToday: s.collectedToday    || 0,
          outstanding:   s.outstandingBalance || 0,
        })
      }
    } catch { /* silent */ }
  }, [])

  const fetchServices = useCallback(async () => {
    setServicesLoading(true)
    try {
      const offset = (servicesPage - 1) * BILLING_ITEMS_PER_PAGE
      const res = await client.get('/billing', { params: { resource: 'services', limit: BILLING_ITEMS_PER_PAGE, offset } })
      if (res.success) {
        setServices(res.data || [])
        setTotalServices(res.meta?.total || 0)
      }
    } catch { /* silent */ }
    finally { setServicesLoading(false) }
  }, [servicesPage])

  const fetchClaims = useCallback(async () => {
    setClaimsLoading(true)
    try {
      const res = await client.get('/insurance')
      if (res.success) {
        const rows = (res.data || []).flatMap((c) =>
          (c.claims || []).map((cl) => ({
            id: cl.id,
            claimNumber: cl.claimNumber,
            patient: getFullName(c.patient) || '—',
            insurer: c.insurerName,
            policy: c.policyNumber,
            amount: cl.claimAmount,
            approved: cl.approvedAmount,
            status: cl.status,
            submitted: cl.submittedAt || cl.createdAt,
          }))
        )
        setClaims(rows)
      }
    } catch { /* silent — the insurance module owns this data */ }
    finally { setClaimsLoading(false) }
  }, [])

  // Real Lab test catalog search
  // isCancelled() lets the caller disown a reply whose search term is already stale.
  const searchLabTests = useCallback(async (query, isCancelled = () => false) => {
    setCatalogLoading(true)
    try {
      const res = await client.get('/laboratory', { params: { resource: 'tests', search: query.trim(), limit: 500 } })
      if (!isCancelled() && res.success) setLabTests(res.data || [])
    } catch { if (!isCancelled()) toast.error('Failed to search lab tests') }
    finally { if (!isCancelled()) setCatalogLoading(false) }
  }, [])

  // Real Radiology exam catalog search
  const searchRadiologyExams = useCallback(async (query, isCancelled = () => false) => {
    setCatalogLoading(true)
    try {
      const res = await client.get('/radiology', { params: { resource: 'exams', search: query.trim(), limit: 500 } })
      if (!isCancelled() && res.success) setRadiologyExams(res.data || [])
    } catch { if (!isCancelled()) toast.error('Failed to search radiology exams') }
    finally { if (!isCancelled()) setCatalogLoading(false) }
  }, [])

  // Real Pharmacy drug catalog — ~2 lakh drugs, so searched server-side (same
  // /pharmacy/drugs endpoint the Pharmacy module itself uses) rather than loaded whole.
  const searchPharmacyDrugs = useCallback(async (query, isCancelled = () => false) => {
    setCatalogLoading(true)
    try {
      const res = await client.get('/pharmacy/drugs', { params: { search: query.trim(), limit: 500 } })
      if (!isCancelled() && res.success) setPharmacyDrugs(res.data || [])
    } catch { if (!isCancelled()) toast.error('Failed to search pharmacy inventory') }
    finally { if (!isCancelled()) setCatalogLoading(false) }
  }, [])

  const fetchAll = useCallback(() => {
    fetchBills()
    fetchServices()
    fetchStats()
    fetchClaims()
  }, [fetchBills, fetchServices, fetchStats, fetchClaims])

  // The invoice list is the only one of the four that reads what the user types.
  // Bundled with the other three in one effect, its changing identity — it closes
  // over page, search, status, type and date — re-ran all four, so a single
  // keystroke in the invoice search also re-pulled the service catalogue, the stat
  // cards and the insurance claims. Measured: four requests, one of them wanted,
  // on every keystroke, every filter change and every page turn.
  useEffect(() => { fetchBills() }, [fetchBills])

  // These three read nothing the user types. They are the module's opening state;
  // Refresh and every write path still call fetchAll, which re-reads all four.
  useEffect(() => {
    fetchServices()
    fetchStats()
    fetchClaims()
  }, [fetchServices, fetchStats, fetchClaims])

  const { orgInfo: hookOrgInfo } = useOrgSettings()

  useEffect(() => {
    setOrgInfo(hookOrgInfo)
    const stored = typeof window !== 'undefined' ? localStorage.getItem('gudmed-clinic-profile') : null
    if (!stored) {
      setClinic(c => ({
        ...c,
        clinicName: hookOrgInfo.name || c.clinicName,
        address: [hookOrgInfo.address, hookOrgInfo.city].filter(Boolean).join(', ') || c.address,
        phone: hookOrgInfo.phone || c.phone,
      }))
    }
  }, [hookOrgInfo])

  // ── Patient search ─────────────────────────────────────────────────────────
  // clearTimeout only stops a debounce that hasn't fired — a request already in flight
  // still returns, so a slow reply for an earlier prefix could repaint the dropdown and
  // let the cashier click a patient who no longer matches the box. Drop late replies.
  useEffect(() => {
    if (!patientSearch || patientSearch.length < 2) { setPatientResults([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      setPatSearchLoading(true)
      try {
        const res = await client.get('/patients', { params: { search: patientSearch, limit: 8 } })
        if (!cancelled && res.success) setPatientResults(res.data || [])
      } catch { /* silent */ }
      finally { if (!cancelled) setPatSearchLoading(false) }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [patientSearch])

  useEffect(() => {
    const h = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setPatientDropdown(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── Unified server-side catalog search (Lab, Radiology, Pharmacy) ────────
  // A slow reply for an earlier keystroke (or for the department the user just switched
  // away from) can land after a newer one and repaint the catalogue, so the cashier adds
  // a test/drug that no longer matches what they typed. isCancelled discards those.
  useEffect(() => {
    let cancelled = false
    const isCancelled = () => cancelled
    const t = setTimeout(() => {
      if (department === 'Lab') searchLabTests(catSearch, isCancelled)
      else if (department === 'Radiology') searchRadiologyExams(catSearch, isCancelled)
      else if (department === 'Pharmacy') searchPharmacyDrugs(catSearch, isCancelled)
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [department, catSearch, searchLabTests, searchRadiologyExams, searchPharmacyDrugs])

  function selectPatient(p) {
    const age = calcAge(p.dateOfBirth)
    setForm(f => ({
      ...f, patientName: getFullName(p), patientId: p.id,
      phone: p.phonePrimary, age: String(age),
      gender: p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'O',
      uhid: p.mrn,
    }))
    setPatientSearch(getFullName(p))
    setPatientDropdown(false)
  }

  // ── Cart helpers ───────────────────────────────────────────────────────────
  function addToCart(item, cat) {
    setForm(f => {
      const ex = f.items.findIndex(i => i.name === item.name && i.cat === cat)
      if (ex >= 0) {
        const items = [...f.items]
        items[ex] = { ...items[ex], qty: items[ex].qty + 1 }
        return { ...f, items }
      }
      // Keep the master-data id: the backend uses it to draw the drug out of
      // stock / raise the lab-radiology order this line implies. gstRate rides
      // along for pharmacy lines so the receipt can show the CGST/SGST split.
      return { ...f, items: [...f.items, { id: item.id, name: item.name, sub: item.sub || '', cat, qty: 1, amt: item.amt, gstRate: item.gstRate }] }
    })
  }
  function removeItem(i) { setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) })) }
  function updateItemQty(i, delta) {
    setForm(f => ({
      ...f, items: f.items.map((it, idx) => idx === i ? { ...it, qty: Math.max(1, it.qty + delta) } : it)
    }))
  }
  function updateItemAmt(i, val) {
    setForm(f => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, amt: Number(val) } : it) }))
  }

  // ── Save invoice ───────────────────────────────────────────────────────────
  async function saveInvoice() {
    if (!department) { toast.error('Select a department first'); return }
    if (!form.patientId && !form.patientName) { toast.error('Select a patient'); return }
    if (form.items.length === 0) { toast.error('Add at least one service'); return }
    const amtReceived = Number(form.amountReceived) || 0
    if (amtReceived < 0) { toast.error('Amount received cannot be negative'); return }
    if (amtReceived > total + 0.01) { toast.error(`Amount received cannot exceed total ₹${total.toLocaleString('en-IN')}`); return }
    setSaving(true)
    const deptLabel = DEPT_LABEL[department] || department
    // Build item array for the backend. The backend enforces structure and
    // computes its own subtotal.
    const apiItems = form.items.map(it => {
      const itemTotal = it.qty * it.amt
      const itemDiscount = subtotal > 0 ? (itemTotal / subtotal) * discountAmt : 0
      const itemTax = Math.round((itemTotal - itemDiscount) * (form.gstPct || 0) / 100)
      
      return {
        serviceName: it.name,
        quantity:    it.qty,
        unitPrice:   it.amt,
        total:       itemTotal,
        tax:         itemTax,
        discount:    itemDiscount,
        // Only the three clinical catalogues carry a master-data id; billing it
        // decrements pharmacy stock / raises the lab-radiology order.
        ...(it.id && SOURCE_TYPE[it.cat] ? { sourceType: SOURCE_TYPE[it.cat], sourceId: it.id } : {}),
        // What kind of service this is, for the invoice list's Type column and
        // filter. sourceType cannot serve: it only exists for the three lines
        // with a catalogue to act on, so a consultation, procedure or vaccine
        // reached the list untyped and could only be shown as "—".
        ...(CATEGORY_TYPE[it.cat] ? { type: CATEGORY_TYPE[it.cat] } : {}),
        // gstRate/batchNumber/expiryDate pass through for Pharmacy receipts
        ...(it.gstRate ? { gstRate: Number(it.gstRate) } : {}),
        ...(it.batchNumber ? { batchNumber: it.batchNumber } : {}),
        ...(it.expiryDate ? { expiryDate: it.expiryDate } : {}),
      }
    })
    const bill = {
      ...form, department: deptLabel, subtotal, discountAmt, gstAmt, total, createdAt: new Date().toISOString(), id: form.invoiceNo,
      // Mirror the [HCC:] tag onto the local bill so the invoice modal shown right after
      // save (before fetchBills reloads it from the DB) also displays the home collection line.
      notes: `[${deptLabel}] ${form.notes || ''}${department === 'Lab' && homeCharge > 0 ? ` [HCC:${homeCharge}]` : ''}`.trim(),
    }
    try {
      if (form.patientId) {
        // Home collection charge → its own line so the invoice total is correct.
        // Lab-only (see the department gate on the input above) — checked again
        // here so a stale value can never reach a non-Lab bill either.
        // tax/discount are NUMBERS here, not the form's empty-string placeholders:
        // the API validates each line with z.number() (billingController's
        // invoiceItemSchema), which rejects '' outright — so a Lab bill carrying a
        // home-collection line would fail to save at all.
        if (department === 'Lab' && homeCharge > 0) apiItems.push({ serviceName: 'Home Collection Charges', quantity: 1, unitPrice: homeCharge, total: homeCharge, tax: 0, discount: 0 })
        const result = await client.post('/billing', {
          resource: 'invoice', patientId: form.patientId, items: apiItems,
          discountAmount: discountAmt, discountPercentage: Number(form.discount) || 0,
          taxPercentage: Number(form.gstPct) || 0,
          // Tag the invoice with its department + home-collection so the receipt shows it.
          notes: `[${deptLabel}] ${form.notes || ''}${department === 'Lab' && homeCharge > 0 ? ` [HCC:${homeCharge}]` : ''}`.trim(),
        })
        if (result.success) {
          bill.dbId = result.data.id
          bill.id = result.data.invoiceNumber
          bill.invoiceNo = result.data.invoiceNumber
          if (amtReceived > 0) {
            await client.post('/billing', {
              resource: 'payment', invoiceId: result.data.id,
              patientId: form.patientId, amount: amtReceived, paymentMethod: form.payMode,
            })
            bill.amountPaid = amtReceived
            bill.balanceDue = Math.max(0, total - amtReceived)
            bill.paid = bill.balanceDue <= 0.009
          }
          await fetchBills()
        }
      } else {
        setBills(b => [bill, ...b])
      }
      toast.success('Invoice saved!')
      // WhatsApp notification
      if ((clinic.whatsappEnabled ?? true) && form.sendWhatsApp && form.phone) {
        const itemLines = form.items.map(it => `  • ${it.name} x${it.qty} = ₹${(it.qty * it.amt).toLocaleString('en-IN')}`).join('\n')
        const msgText = [
          `Dear ${form.patientName},`,
          ``,
          `Your invoice *${bill.invoiceNo}* from *${clinic.clinicName}* has been generated.`,
          ``,
          `*Services:*`, itemLines, ``,
          form.discount > 0 ? `Discount: -₹${discountAmt.toLocaleString('en-IN')}` : null,
          `*Total: ₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}*`,
          `Payment Mode: ${form.payMode}`,
          ``,
          `Thank you for visiting ${clinic.clinicName}!`,
        ].filter(Boolean).join('\n')
        const cc = (clinic.countryCode || '91').replace(/\D/g, '')
        const phone = form.phone.replace(/\D/g, '').slice(-10)
        // window.open(`https://wa.me/${cc}${phone}?text=${encodeURIComponent(msgText)}`, '_blank')
      }
      setShowInvoiceModal(bill)
      setForm(newForm())
      setDepartment(''); setActiveCat('')
      setPatientSearch('')
      setActiveTab('invoices')
    } catch { toast.error('Failed to save invoice') }
    finally { setSaving(false) }
  }

  // ── Razorpay payment ───────────────────────────────────────────────────────
  async function payWithRazorpay(bill) {
    // The OUTSTANDING balance, not the invoice total — a patient who already paid
    // ₹800 cash against a ₹1,859.50 bill must be charged the remaining ₹1,059.50
    // online, not the full total again. Same balance math as recordPayment() below.
    const bal = bill.balanceDue ?? (Number(bill.total || 0) - Number(bill.amountPaid || 0))
    if (bal <= 0) { toast.info('This invoice is already fully paid'); return }
    try {
      // 1. Create order on backend
      const order = await client.post('/payments/create-order', {
        invoiceId:   bill.dbId,
        amount:      bal,
        patientName: bill.patientName,
        description: `Invoice ${bill.invoiceNo}`,
      })

      // 2. Load Razorpay script if not loaded
      if (!window.Razorpay) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://checkout.razorpay.com/v1/checkout.js'
          s.onload = resolve
          s.onerror = reject
          document.body.appendChild(s)
        })
      }

      // 3. Open Razorpay checkout
      const rzp = new window.Razorpay({
        key:         order.keyId,
        amount:      order.amount,
        currency:    order.currency,
        order_id:    order.orderId,
        name:        orgInfo.name || 'Hospital',
        description: `Invoice ${bill.invoiceNo}`,
        prefill: {
          name:    bill.patientName,
          contact: bill.phone || '',
        },
        theme: { color: '#2E4168' },
        handler: async (response) => {
          // 4. Verify payment on backend
          const verify = await client.post('/payments/verify', {
            razorpay_order_id:   response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature:  response.razorpay_signature,
            invoiceId:           bill.dbId,
          })
          if (verify.success) {
            setBills(bs => bs.map(b => b.id === bill.id ? { ...b, paid: true } : b))
            setShowPayModal(null)
            toast.success(`✅ Payment successful! ID: ${response.razorpay_payment_id}`)
            fetchBills()
          }
        },
        modal: {
          ondismiss: () => toast.info('Payment cancelled'),
        },
      })
      rzp.open()
    } catch (err) {
      toast.error(err.message || 'Razorpay failed')
    }
  }

  // ── Share payment link ─────────────────────────────────────────────────────
  async function sharePaymentLink(bill) {
    // Same balance-not-total fix as payWithRazorpay — the shared link must ask for
    // what's actually still owed.
    const bal = bill.balanceDue ?? (Number(bill.total || 0) - Number(bill.amountPaid || 0))
    if (bal <= 0) { toast.info('This invoice is already fully paid'); return }
    try {
      toast.loading('Generating payment link...')
      const res = await client.post('/payments/create-link', {
        invoiceId:   bill.dbId,
        amount:      bal,
        patientName: bill.patientName,
        phone:       bill.phone,
        description: `Invoice ${bill.invoiceNo} — ${orgInfo.name || 'Hospital'}`,
      })
      toast.dismiss()
      if (res.shortUrl) {
        try {
          await navigator.clipboard.writeText(res.shortUrl)
          toast.success('Payment link copied! Share with patient via WhatsApp')
        } catch (clipboardErr) {
          console.warn('Clipboard copy failed:', clipboardErr)
          toast.success('Payment link generated. Share with patient via WhatsApp')
        }

        // Also open WhatsApp with the link
        if (bill.phone) {
          const phone = bill.phone.replace(/\D/g, '').slice(-10)
          const msg = `Dear ${bill.patientName}, your payment link for Invoice ${bill.invoiceNo} (₹${bill.total.toLocaleString('en-IN')}) is: ${res.shortUrl}`
          window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`, '_blank')
        }
      }
    } catch (err) {
      toast.dismiss()
      toast.error(err.message || 'Failed to create payment link')
    }
  }

  // ── Record payment ─────────────────────────────────────────────────────────
  // Records ONE payment (supports partial + multiple methods). Pass the amount;
  // an invoice can take many payments (₹500 Cash + ₹700 UPI …) until balance = 0.
  async function recordPayment(bill, method, amount) {
    const bal = bill.balanceDue ?? (Number(bill.total || 0) - Number(bill.amountPaid || 0))
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Enter a valid amount'); return }
    if (amt > bal + 0.01) { toast.error(`Amount cannot exceed balance ₹${bal.toLocaleString('en-IN')}`); return }
    // Hard guard against double-click / double-submit → duplicate payment.
    if (paymentLock.current) return
    paymentLock.current = true
    setSavingPayment(true)
    try {
      if (bill.dbId) {
        await client.post('/billing', {
          resource: 'payment', invoiceId: bill.dbId,
          patientId: bill.patientId, amount: amt, paymentMethod: method,
          idempotencyKey: payIdemKey.current, // retry-safe: backend charges once per key
        })
      }
      const newPaid = Number(bill.amountPaid || 0) + amt
      const newBal = Math.max(0, bal - amt)
      const updated = { ...bill, amountPaid: newPaid, balanceDue: newBal, paid: newBal <= 0.009 }
      setBills(bs => bs.map(b => b.id === bill.id ? updated : b))
      fetchBills(); fetchStats()
      if (newBal <= 0.009) {
        setShowPayModal(null)
        toast.success('Invoice fully paid ✓')
      } else {
        // Keep the modal open so the next installment / method can be collected.
        setShowPayModal(updated)
        setPayAmount(String(newBal))
        toast.success(`₹${amt.toLocaleString('en-IN')} received via ${method}. Balance ₹${newBal.toLocaleString('en-IN')}`)
      }
    } catch { toast.error('Failed to record payment') }
    finally { paymentLock.current = false; setSavingPayment(false) }
  }

  // ── Refund / Credit note ───────────────────────────────────────────────────
  async function handleRefund(p) {
    if (p.isRefund) return
    
    // Calculate how much of THIS SPECIFIC receipt has already been refunded
    const relatedRefunds = (showInvoiceModal?.payments || []).filter(pay => pay.isRefund && pay.originalPaymentId === p.id && pay.status !== 'REJECTED')
    const refundedSoFar = relatedRefunds.reduce((sum, r) => sum + r.amount, 0)
    const maxPaid = Math.max(0, p.amount - refundedSoFar)
    
    if (maxPaid <= 0) { toast.error('This receipt has already been fully refunded'); return }

    setRefundDialog({ ...p, maxPaid, refundedSoFar })
    setRefundAmount(String(maxPaid))
    setRefundReason('')
  }

  async function submitRefund() {
    if (!refundDialog) return
    const amount = Number(refundAmount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > refundDialog.maxPaid) {
      toast.error('Enter a valid amount within the available limit')
      return
    }
    if (!refundReason.trim()) {
      toast.error('A reason is required for the audit trail')
      return
    }

    try {
      const res = await client.post('/billing', {
        resource: 'refund',
        invoiceId: refundDialog.invoiceId || refundDialog.invoice?.id,
        amount,
        refundReason: refundReason.trim(),
        paymentMethod: refundDialog.paymentMethod || 'cash',
        originalPaymentId: refundDialog.id,
      })
      if (res.success) {
        toast.success('Refund request sent for approval')
        setRefundDialog(null)
        fetchAll()
        fetchBills()
        fetchStats()
        if (showInvoiceModal) {
          const updatedInvoice = await client.get('/billing', { params: { resource: 'invoices', invoiceId: showInvoiceModal.dbId } })
          if (updatedInvoice.success && updatedInvoice.data[0]) {
            setShowInvoiceModal({ ...showInvoiceModal, payments: updatedInvoice.data[0].payments })
          }
        }
      } else {
        toast.error(res.error || 'Failed to process refund')
      }
    } catch (err) {
      toast.error(err.message || 'Failed to record refund')
    }
  }

  // ── Add / edit / remove service in catalog ─────────────────────────────────
  function openAddServiceDialog() {
    setEditingServiceId(null)
    setNewService(emptyService())
    setShowAddServiceDialog(true)
  }

  function openEditServiceDialog(s) {
    setEditingServiceId(s.id)
    setNewService({
      name: s.serviceName || '',
      serviceCode: s.serviceCode || '',
      category: s.serviceCategory || 'Consultation',
      department: s.department || 'Consultation',
      price: s.unitPrice != null ? String(s.unitPrice) : '',
      description: s.description || '',
      isTaxable: !!s.isTaxable,
      taxPercentage: s.taxPercentage != null ? String(s.taxPercentage) : '',
      isCoveredByInsurance: s.isCoveredByInsurance !== false,
      insuranceCopayPercentage: s.insuranceCopayPercentage != null ? String(s.insuranceCopayPercentage) : '',
    })
    setShowAddServiceDialog(true)
  }

  async function handleSaveService() {
    if (!newService.name || !newService.serviceCode || !newService.price) {
      toast.error('Name, service code and price are required'); return
    }
    setSavingService(true)
    const payload = {
      serviceName: newService.name,
      serviceCode: newService.serviceCode,
      serviceCategory: newService.category,
      department: newService.department,
      unitPrice: parseFloat(newService.price),
      isTaxable: newService.isTaxable,
      taxPercentage: newService.isTaxable ? (parseFloat(newService.taxPercentage) || 0) : 0,
      isCoveredByInsurance: newService.isCoveredByInsurance,
      insuranceCopayPercentage: newService.isCoveredByInsurance ? (parseFloat(newService.insuranceCopayPercentage) || 0) : 0,
      description: newService.description || undefined,
    }
    try {
      if (editingServiceId) {
        const res = await client.patch('/billing', { resource: 'service', id: editingServiceId, updates: payload })
        if (res.success) {
          setServices(prev => prev.map(s => s.id === editingServiceId ? res.data : s))
          toast.success('Service updated')
        }
      } else {
        const res = await client.post('/billing', { resource: 'service', ...payload })
        if (res.success) {
          setServices(prev => [res.data, ...prev])
          setTotalServices(t => t + 1)
          toast.success('Service added to catalog')
        }
      }
      setShowAddServiceDialog(false)
      setEditingServiceId(null)
      setNewService(emptyService())
    } catch (err) {
      toast.error(typeof err?.message === 'string' && err.message !== '[object Object]' ? err.message : 'Failed to save service')
    } finally { setSavingService(false) }
  }

  async function handleDeleteService() {
    if (!deletingService) return
    try {
      const res = await client.patch('/billing', { resource: 'service', id: deletingService.id, updates: { isActive: false } })
      if (res.success) {
        setServices(prev => prev.filter(s => s.id !== deletingService.id))
        setTotalServices(t => Math.max(0, t - 1))
        toast.success('Service removed from catalog')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to remove service')
    } finally { setDeletingService(null) }
  }

  // ── Filtered invoices ──────────────────────────────────────────────────────
  const filteredBills = bills // Backend handles pagination and filtering now

  // ── Filtered insurance claims (client-side; claims list is fetched in full) ─
  const filteredClaims = claims.filter(c => {
    const matchesStatus = claimStatusFilter === 'all' || c.status === claimStatusFilter
    const q = claimSearch.trim().toLowerCase()
    const matchesSearch = !q ||
      (c.claimNumber || '').toLowerCase().includes(q) ||
      (c.patient || '').toLowerCase().includes(q) ||
      (c.insurer || '').toLowerCase().includes(q) ||
      (c.policy || '').toLowerCase().includes(q)
    return matchesStatus && matchesSearch
  })

  // ── Recent transactions (last 10) ─────────────────────────────────────────
  const recentBills = [...bills].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10)

  // ── Catalogue items filtered ───────────────────────────────────────────────
  // Lab/Radiology/Pharmacy come from real backend master data, not the hardcoded
  // CATALOGUE — normalized to the same {name, sub, amt} shape addToCart expects.
  const rawCatItems =
    activeCat === 'Lab' ? labTests.map(t => ({ id: t.id, name: t.testName, sub: t.testCategory || t.department || '', amt: Number(t.price || 0) })) :
    activeCat === 'Radiology' ? radiologyExams.map(e => ({ id: e.id, name: e.examName, sub: e.examCategory || e.bodyPart || '', amt: Number(e.price || 0) })) :
    activeCat === 'Pharmacy' ? pharmacyDrugs.map(d => ({ id: d.id, name: d.drugName + (d.strength ? ` ${d.strength}` : ''), sub: d.drugCategory || d.genericName || '', amt: Number(d.sellingPrice || d.mrp || 0), gstRate: Number(d.gstRate || 0) })) :
    (CATALOGUE[activeCat] || [])

  // Pharmacy is already filtered server-side (search param); Lab/Radiology/other
  // catalogues are filtered client-side against the cached full list.
  const catItems = activeCat === 'Pharmacy' ? rawCatItems : rawCatItems.filter(i =>
    !catSearch || i.name.toLowerCase().includes(catSearch.toLowerCase()) || (i.sub || '').toLowerCase().includes(catSearch.toLowerCase())
  )

  // ── Pagination helper ──────────────────────────────────────────────────────
  function PaginationControls({ currentPage, setCurrentPage, totalItems }) {
    const totalPages = Math.ceil(totalItems / BILLING_ITEMS_PER_PAGE)
    if (totalPages <= 1) return null
    return (
      <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t">
        <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Receipt className="h-7 w-7 text-blue-600" />Billing &amp; Payments
          </h1>
          <p className="text-gray-500">Invoice management and payment collection</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchAll}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          <Button variant="outline" onClick={() => setActiveTab('new-invoice')}><Plus className="h-4 w-4 mr-1" />New Invoice</Button>
          <Button onClick={() => setActiveTab('catalog')} className="bg-gray-900 hover:bg-gray-800"><Plus className="h-4 w-4 mr-1" />Add Service</Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-6 mb-6">
          <TabsTrigger value="invoices">Dashboard & Invoices</TabsTrigger>
          <TabsTrigger value="new-invoice">New Invoice</TabsTrigger>
          <TabsTrigger value="catalog">Service Catalog</TabsTrigger>
          <TabsTrigger value="insurance">Insurance</TabsTrigger>
          <TabsTrigger value="approvals">Refund Approvals</TabsTrigger>
        </TabsList>

        {/* ── INVOICES (Merged with Dashboard) ── */}
        <TabsContent value="invoices" className="space-y-6">
          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Today Revenue', value: fmt(stats.todayRevenue), color: 'text-green-600', bg: 'bg-green-50' },
              { label: 'Pending Invoices', value: stats.pendingCount, color: 'text-yellow-600', bg: 'bg-yellow-50' },
              { label: 'Outstanding Balance', value: fmt(stats.outstanding), color: 'text-red-600', bg: 'bg-red-50' },
            ].map(s => (
              <Card key={s.label} className={s.bg}>
                <CardContent className="pt-5 pb-4">
                  <p className="text-xs text-gray-500 uppercase font-medium tracking-wide">{s.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input className="pl-9" placeholder="Search patient or invoice #..." value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} />
            </div>
            <Select value={invoiceFilter} onValueChange={setInvoiceFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
              </SelectContent>
            </Select>
            <Select value={invoiceType} onValueChange={setInvoiceType}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="opd">OPD</SelectItem>
                <SelectItem value="pharmacy">Pharmacy</SelectItem>
                <SelectItem value="lab">Laboratory</SelectItem>
                <SelectItem value="radiology">Radiology</SelectItem>
                <SelectItem value="procedure">Procedure</SelectItem>
                <SelectItem value="vaccine">Vaccine</SelectItem>
              </SelectContent>
            </Select>
            {dateFilter.control}
            {invoiceFiltersActive && (
              <Button variant="ghost" size="sm" className="text-gray-500" onClick={clearInvoiceFilters}>
                <X className="h-4 w-4 mr-1" />Clear all
              </Button>
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              {billsLoading ? (
                <div className="text-center py-10 text-gray-400">Loading invoices...</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Patient</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Paid</TableHead>
                        <TableHead>Balance</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBills.length === 0 ? (
                        <TableRow><TableCell colSpan={9} className="text-center py-10 text-gray-400">No invoices found</TableCell></TableRow>
                      ) : filteredBills.map(b => (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-sm text-blue-600">{b.invoiceNo}</TableCell>
                          <TableCell className="font-medium">{b.patientName}</TableCell>
                          <TableCell><TypeBadges types={b.billTypes} /></TableCell>
                          <TableCell className="text-sm text-gray-500">{b.phone || '—'}</TableCell>
                          <TableCell className="font-semibold">{fmt(b.total)}</TableCell>
                          <TableCell className="text-sm text-green-700">{fmt(b.amountPaid || 0)}</TableCell>
                          <TableCell className="text-sm text-red-600">{fmt(b.balanceDue ?? (b.total - (b.amountPaid || 0)))}</TableCell>
                          <TableCell className="text-sm text-gray-500">{b.date}</TableCell>
                          <TableCell><PayBadge invoice={b} /></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => setShowInvoiceModal(b)}>View</Button>
                              {!b.cancelled && (!b.paid || (b.balanceDue ?? (b.total - (b.amountPaid || 0))) > 0) && (
                                <Button size="sm" onClick={() => { setShowPayModal(b); setPayMethod('Cash') }}>Pay</Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {totalBills > BILLING_ITEMS_PER_PAGE && (
                    <div className="px-4">
                      <PaginationControls currentPage={invoicesPage} setCurrentPage={setInvoicesPage} totalItems={totalBills} />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── NEW INVOICE ── */}
        <TabsContent value="new-invoice">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Patient + Catalogue */}
            <div className="space-y-4">
              {/* Patient search */}
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Patient</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <PatientLookup
                    showHint={false}
                    selectedPatient={null}
                    onSelect={selectPatient}
                  />
                  {form.patientName && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium">{form.patientName}</span>
                      {form.phone && <span className="text-gray-500 ml-2">· {form.phone}</span>}
                      {form.uhid && <span className="text-gray-400 ml-2">· {form.uhid}</span>}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Invoice #</Label>
                      <Input className="h-8 text-sm" value={form.invoiceNo} onChange={e => setForm(f => ({ ...f, invoiceNo: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Date</Label>
                      <Input className="h-8 text-sm" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Service catalogue */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">
                    {department ? `${DEPT_LABEL[department]} Billing` : 'Department Billing'}
                    <span className="font-normal text-gray-400 text-xs ml-1">— click to add</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Department selector — radio buttons (client requirement). Each
                      department has its OWN form/catalogue; switching clears the cart. */}
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-gray-500 whitespace-nowrap mt-1.5">Department</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                      {Object.keys(CATALOGUE).map(cat => (
                        <label key={cat} className="flex items-center gap-1.5 cursor-pointer text-sm">
                          <input
                            type="radio"
                            name="billing-department"
                            value={cat}
                            checked={department === cat}
                            onChange={() => {
                              // A consultation is not a catalogue line — it is an
                              // appointment with a doctor, a slot and a fee that
                              // comes from that doctor's slab. Book it properly
                              // instead of adding ₹500 to a cart.
                              if (cat === 'Consultation') { setShowBooking(true); return }
                              // Switching department = a fresh, department-specific bill.
                              if (department && cat !== department && form.items.length > 0) {
                                if (!window.confirm('Switching department will clear the current cart. Continue?')) return
                              }
                              setDepartment(cat); setActiveCat(cat); setCatSearch('')
                              // Home Collection only applies to Lab — clear any leftover value so
                              // switching away from Lab can't silently carry it onto another bill.
                              setForm(f => ({ ...f, items: [], homeCollection: cat === 'Lab' ? f.homeCollection : '' }))
                            }}
                            className="accent-blue-600 h-3.5 w-3.5"
                          />
                          {DEPT_LABEL[cat] || cat}
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Search within the selected department */}
                  {department && (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <Input className="pl-8 h-8 text-sm" placeholder={`Search ${DEPT_LABEL[department]}...`} value={catSearch} onChange={e => setCatSearch(e.target.value)} />
                    </div>
                  )}
                  {/* Items grid */}
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {!department ? (
                      <p className="text-sm text-gray-400 text-center py-6"></p>
                    ) : catalogLoading ? (
                      <p className="text-sm text-gray-400 text-center py-4">Loading...</p>
                    ) : catItems.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-4">No items found</p>
                    ) : catItems.map(it => (
                      <div key={it.id || it.name} onClick={() => addToCart(it, activeCat)}
                        className="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors">
                        <div>
                          <span className="text-sm font-medium">{it.name}</span>
                          {it.sub && <span className="text-xs text-gray-400 ml-1.5">{it.sub}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-blue-700">{fmt(it.amt)}</span>
                          <span className="h-5 w-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">+</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right: Cart */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">Cart ({form.items.length} items)</CardTitle>
                    {form.items.length > 0 && (
                      <Button size="sm" variant="ghost" className="text-red-500 h-7 text-xs" onClick={() => setForm(f => ({ ...f, items: [] }))}>Clear All</Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {form.items.length === 0 ? (
                    <div className="text-center py-10 text-gray-400">
                      <div className="text-3xl mb-2">🛒</div>
                      <p className="text-sm">Add items from the catalogue</p>
                    </div>
                  ) : (
                    <>
                      <div className="max-h-60 overflow-y-auto space-y-2">
                        {form.items.map((it, i) => (
                          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{it.name}</div>
                              <Badge variant="outline" className={`text-xs mt-0.5 ${CAT_META[it.cat]?.color || 'bg-gray-100 text-gray-700'}`}>{it.cat}</Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={() => updateItemQty(i, -1)} className="h-6 w-6 rounded border border-gray-300 flex items-center justify-center text-sm font-bold hover:bg-gray-100">−</button>
                              <span className="w-6 text-center text-sm font-medium">{it.qty}</span>
                              <button onClick={() => updateItemQty(i, 1)} className="h-6 w-6 rounded border border-gray-300 flex items-center justify-center text-sm font-bold hover:bg-gray-100">+</button>
                            </div>
                            <div className="text-sm font-semibold w-20 text-right">{fmt(it.qty * it.amt)}</div>
                            <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 ml-1">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Totals */}
                      <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
                        <div className="flex justify-between text-sm text-gray-600"><span>Subtotal</span><span className="font-medium">{fmt(subtotal)}</span></div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600 w-24">Discount %</span>
                          <Input type="number" min="0" max="100" className="h-7 w-20 text-sm text-center" placeholder= "0" value={form.discount} onChange={e => { const v = parseFloat(e.target.value); setForm(f => ({ ...f, discount: e.target.value === '' ? '' : (Number.isNaN(v) ? 0 : v) })) }} />
                          {discountAmt > 0 && <span className="text-sm text-green-600 font-medium">− {fmt(discountAmt)}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600 w-24">GST %</span>
                          <Input type="number" min="0" max="100" className="h-7 w-20 text-sm text-center" placeholder="0" value={form.gstPct} onChange={e => { const v = parseFloat(e.target.value); setForm(f => ({ ...f, gstPct: e.target.value === '' ? '' : (Number.isNaN(v) ? 0 : v) })) }} />
                          {gstAmt > 0 && <span className="text-sm text-gray-600 font-medium">+ {fmt(gstAmt)}</span>}
                        </div>
                        {/* Home collection — Laboratory only (sample pickup). Doesn't apply
                            to Pharmacy/Radiology/etc., so it no longer shows for them —
                            it was leaking a "Home Collection Charges" line onto bills for
                            departments where that charge makes no sense. */}
                        {department === 'Lab' && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600 w-24">Home Coll. ₹</span>
                            <Input type="number" min="0" className="h-7 w-24 text-sm text-center"
                              placeholder={String(orgInfo.homeCollectionCharge || 0)}
                              value={form.homeCollection}
                              onChange={e => setForm(f => ({ ...f, homeCollection: e.target.value }))} />
                            {homeCharge > 0 && <span className="text-sm text-gray-600">+ {fmt(homeCharge)}</span>}
                          </div>
                        )}
                        <div className="flex justify-between text-base font-bold border-t border-gray-300 pt-2 mt-1"><span>Total</span><span className="text-gray-900">{fmt(total)}</span></div>
                      </div>

                      {/* Payment method */}
                      <div className="space-y-2">
                        <Label className="text-xs">Payment Method</Label>
                        <Select value={form.payMode} onValueChange={v => setForm(f => ({ ...f, payMode: v }))}>
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {['Cash', 'UPI', 'Card', 'Bank Transfer', 'Insurance'].map(m => (
                              <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Optional: collect payment right now, in full or in part.
                          Left blank/0 → invoice saves as Pending (pay later), which
                          is the common case for insurance/credit patients. */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Amount Received Now</Label>
                          <button type="button" className="text-xs text-blue-600 hover:underline"
                            onClick={() => setForm(f => ({ ...f, amountReceived: String(total) }))}>
                            Full amount ({fmt(total)})
                          </button>
                        </div>
                        <Input type="number" min="0" max={total} className="h-9" placeholder="0 (leave blank if unpaid)"
                          value={form.amountReceived}
                          onChange={e => setForm(f => ({ ...f, amountReceived: e.target.value }))} />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Notes</Label>
                        <Input className="h-8 text-sm" placeholder="Optional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <Button className="flex-1" onClick={saveInvoice} disabled={saving}>
                          {saving ? 'Saving...' : 'Save Invoice'}
                        </Button>
                        <Button variant="outline" onClick={() => { setForm(newForm()); setDepartment(''); setActiveCat(''); setPatientSearch('') }}>Clear</Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── PAYMENTS ── */}


        {/* ── SERVICE CATALOG ── */}
        <TabsContent value="catalog" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{totalServices || services.length} services in catalog</p>
            <Button onClick={openAddServiceDialog}><Plus className="h-4 w-4 mr-1" />Add Service</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {servicesLoading ? (
                <div className="text-center py-10 text-gray-400">Loading services...</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {services.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-10 text-gray-400">No services added yet</TableCell></TableRow>
                      ) : services.map(s => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.serviceName}</TableCell>
                          <TableCell className="text-sm text-gray-500">{s.serviceCode || '—'}</TableCell>
                          <TableCell><Badge variant="outline">{s.serviceCategory || '—'}</Badge></TableCell>
                          <TableCell className="text-sm text-gray-500">{s.department || '—'}</TableCell>
                          <TableCell className="font-semibold">₹{Number(s.unitPrice || 0).toLocaleString('en-IN')}</TableCell>
                          <TableCell className="text-sm text-gray-500">{s.description || '—'}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditServiceDialog(s)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => setDeletingService(s)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {totalServices > BILLING_ITEMS_PER_PAGE && (
                    <div className="px-4">
                      <PaginationControls currentPage={servicesPage} setCurrentPage={setServicesPage} totalItems={totalServices} />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── INSURANCE ── */}
        <TabsContent value="insurance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-blue-600" />Insurance Claims</CardTitle>
              <CardDescription>Track and manage insurance claims and reimbursements</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                <div
                  className={`bg-blue-50 rounded-lg p-4 text-center cursor-pointer transition-shadow hover:shadow-md ${claimStatusFilter === 'all' ? 'ring-2 ring-blue-400' : ''}`}
                  onClick={() => setClaimStatusFilter('all')}
                >
                  <p className="text-sm text-blue-600 font-medium">Total Claims</p>
                  <p className="text-3xl font-bold text-blue-700">{claims.length}</p>
                </div>
                <div
                  className={`bg-green-50 rounded-lg p-4 text-center cursor-pointer transition-shadow hover:shadow-md ${claimStatusFilter === 'approved' ? 'ring-2 ring-green-400' : ''}`}
                  onClick={() => setClaimStatusFilter('approved')}
                >
                  <p className="text-sm text-green-600 font-medium">Approved / Settled</p>
                  <p className="text-3xl font-bold text-green-700">{claims.filter(c => c.status === 'approved' || c.status === 'settled').length}</p>
                </div>
                <div
                  className={`bg-yellow-50 rounded-lg p-4 text-center cursor-pointer transition-shadow hover:shadow-md ${claimStatusFilter === 'pending' ? 'ring-2 ring-yellow-400' : ''}`}
                  onClick={() => setClaimStatusFilter('pending')}
                >
                  <p className="text-sm text-yellow-600 font-medium">Pending / Submitted</p>
                  <p className="text-3xl font-bold text-yellow-700">{claims.filter(c => c.status === 'pending' || c.status === 'submitted').length}</p>
                </div>
                <div
                  className={`bg-red-50 rounded-lg p-4 text-center cursor-pointer transition-shadow hover:shadow-md ${claimStatusFilter === 'rejected' ? 'ring-2 ring-red-400' : ''}`}
                  onClick={() => setClaimStatusFilter('rejected')}
                >
                  <p className="text-sm text-red-600 font-medium">Rejected</p>
                  <p className="text-3xl font-bold text-red-700">{claims.filter(c => c.status === 'rejected').length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input className="pl-9" placeholder="Search claim #, patient, insurer or policy..." value={claimSearch} onChange={e => setClaimSearch(e.target.value)} />
            </div>
            <Select value={claimStatusFilter} onValueChange={setClaimStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="settled">Settled</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim #</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Insurance Company</TableHead>
                    <TableHead>Policy No.</TableHead>
                    <TableHead className="text-right">Claimed</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claimsLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">Loading claims…</TableCell></TableRow>
                  ) : filteredClaims.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-500">{claims.length === 0 ? 'No insurance claims yet. Add a policy and raise a claim from the Insurance module.' : 'No claims match your search/filter.'}</TableCell></TableRow>
                  ) : filteredClaims.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-sm text-blue-600">{c.claimNumber}</TableCell>
                      <TableCell className="font-medium">{c.patient}</TableCell>
                      <TableCell className="text-sm">{c.insurer}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{c.policy || '—'}</TableCell>
                      <TableCell className="text-right font-semibold">{fmt(c.amount)}</TableCell>
                      <TableCell className="text-right font-semibold text-green-700">{c.approved != null ? fmt(c.approved) : '—'}</TableCell>
                      <TableCell className="text-sm text-gray-500">{c.submitted ? format(new Date(c.submitted), 'dd MMM yyyy') : '—'}</TableCell>
                      <TableCell>
                        <Badge className={CLAIM_STATUS_STYLE[c.status] || 'bg-gray-100 text-gray-800'}>{c.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="approvals" className="space-y-4">
          <RefundApprovalsTab userRole={user?.role} onProcess={fetchAll} />
        </TabsContent>
      </Tabs>

      {/* ── Invoice View Dialog ── */}
      <Dialog open={!!showInvoiceModal} onOpenChange={() => setShowInvoiceModal(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Invoice — {showInvoiceModal?.invoiceNo}</DialogTitle></DialogHeader>
          {showInvoiceModal && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 bg-gray-50 rounded-lg p-3">
                <div><span className="text-gray-500">Patient: </span><span className="font-medium">{showInvoiceModal.patientName}</span></div>
                <div><span className="text-gray-500">Date: </span><span>{showInvoiceModal.date}</span></div>
                {showInvoiceModal.phone && <div><span className="text-gray-500">Phone: </span><span>{showInvoiceModal.phone}</span></div>}
                {showInvoiceModal.uhid && <div><span className="text-gray-500">UHID: </span><span className="font-mono">{showInvoiceModal.uhid}</span></div>}
                <div><span className="text-gray-500">Status: </span><PayBadge invoice={showInvoiceModal} /></div>
              </div>
              {(() => {
                const hccTag = String(showInvoiceModal.notes || '').match(/\[HCC:(\d+(?:\.\d+)?)\]/)
                const hcc = hccTag ? Number(hccTag[1]) : 0
                const displayItems = (showInvoiceModal.items || []).filter(it => !/home collection/i.test(it.name || ''))
                const displaySubtotal = displayItems.reduce((s, it) => s + (it.amt || 0) * (it.qty || 1), 0)

                return (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-center">Qty</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayItems.map((it, i) => (
                          <TableRow key={i}>
                            <TableCell>{i + 1}</TableCell>
                            <TableCell>
                              <div>{it.name}</div>
                              {it.sub && <div className="text-xs text-gray-400">{it.sub}</div>}
                            </TableCell>
                            <TableCell className="text-center">{it.qty}</TableCell>
                            <TableCell className="text-right">{fmt(it.amt)}</TableCell>
                            <TableCell className="text-right font-medium">{fmt(it.qty * it.amt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="flex flex-col items-end gap-4">
                      <div className="w-64 space-y-1 border rounded-lg p-3">
                        <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmt(displaySubtotal)}</span></div>
                        {hcc > 0 && <div className="flex justify-between text-green-600"><span>Home Collection</span><span>+{fmt(hcc)}</span></div>}
                        {(showInvoiceModal.discountAmt || 0) > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><span>−{fmt(showInvoiceModal.discountAmt)}</span></div>}
                        {(showInvoiceModal.gstAmt || 0) > 0 && <div className="flex justify-between text-green-600"><span>GST</span><span>+{fmt(showInvoiceModal.gstAmt)}</span></div>}
                        <div className="flex justify-between font-bold text-base border-t pt-1 mt-1"><span>Total</span><span>{fmt(showInvoiceModal.total)}</span></div>
                        <div className="flex justify-between text-green-700 text-sm"><span>Amount Paid</span><span>{fmt(showInvoiceModal.amountPaid || 0)}</span></div>
                        <div className="flex justify-between font-semibold text-red-600 text-sm"><span>Balance Due</span><span>{fmt(showInvoiceModal.balanceDue ?? (showInvoiceModal.total - (showInvoiceModal.amountPaid || 0)))}</span></div>
                      </div>
                      {/* Payment History */}
                      {(showInvoiceModal.payments || []).length > 0 && (
                        <div className="w-full mt-2">
                          <h4 className="text-sm font-semibold mb-2 text-gray-700">Payment History</h4>
                          <Table>
                            <TableHeader className="bg-gray-50">
                              <TableRow>
                                <TableHead className="h-8 py-1 text-xs">Date</TableHead>
                                <TableHead className="h-8 py-1 text-xs">Receipt No</TableHead>
                                <TableHead className="h-8 py-1 text-xs">Mode</TableHead>
                                <TableHead className="h-8 py-1 text-xs text-right">Amount</TableHead>
                                <TableHead className="h-8 py-1 text-xs text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {[...showInvoiceModal.payments].sort((a, b) => new Date(b.date || b.paymentDate || new Date()) - new Date(a.date || a.paymentDate || new Date())).map((p, i) => (
                                <TableRow key={i}>
                                  {/* Payments arrive as raw ISO from the API and were rendered
                                      verbatim ("2026-07-20T06:50:01.555Z") — see lib/format.js.
                                      `showInvoiceModal.date` is already formatted, so it is only
                                      passed through when there is no payment timestamp at all. */}
                                  <TableCell className="py-2 text-xs text-gray-500">{formatDateTime(p.date || p.paymentDate) || showInvoiceModal.date}</TableCell>
                                  <TableCell className="py-2 text-xs font-mono">{p.receiptNo || p.receiptNumber || `RCPT-${i+1}`}</TableCell>
                                  <TableCell className="py-2 text-xs">
                                    {p.method || p.paymentMethod || showInvoiceModal.payMode || 'Cash'}
                                    {p.isRefund && (
                                      <Badge variant="outline" className="ml-2 text-[10px] text-red-600 bg-red-50 border-red-200">
                                        Refund{p.status && p.status !== 'APPROVED' ? ` (${p.status === 'PENDING_APPROVAL' ? 'Pending' : 'Rejected'})` : ''}
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="py-2 text-xs text-right font-medium">{fmt(p.amount)}</TableCell>
                                  <TableCell className="py-2 text-xs text-right">
                                    <div className="flex gap-1 justify-end">
                                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => printReceipt({ ...p, invoice: showInvoiceModal }, orgInfo, clinic)}>
                                        <Printer className="h-3 w-3 mr-1" />Print
                                      </Button>
                                      {(() => {
                                        if (p.isRefund) return null;
                                        const relatedRefunds = (showInvoiceModal?.payments || []).filter(pay => pay.isRefund && pay.originalPaymentId === p.id && pay.status !== 'REJECTED');
                                        const refundedSoFar = relatedRefunds.reduce((sum, r) => sum + r.amount, 0);
                                        if (refundedSoFar >= p.amount) {
                                          return <Badge variant="outline" className="h-6 px-2 text-[10px] text-gray-500 bg-gray-100 border-gray-200">Fully Refunded</Badge>;
                                        }
                                        return (
                                          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleRefund({ ...p, invoiceId: showInvoiceModal.dbId })}>
                                            Refund {refundedSoFar > 0 ? `(Bal ₹${p.amount - refundedSoFar})` : ''}
                                          </Button>
                                        );
                                      })()}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
          )}
          <DialogFooter className="gap-2">
            {showInvoiceModal && (!showInvoiceModal.paid || (showInvoiceModal.balanceDue ?? (showInvoiceModal.total - (showInvoiceModal.amountPaid || 0))) > 0) && (
              <Button onClick={() => { setShowPayModal(showInvoiceModal); setPayMethod('Cash'); setShowInvoiceModal(null) }}>Collect Payment</Button>
            )}
            {(() => {
              const doPrint = (format) => {
                if (!showInvoiceModal) return
                const b = showInvoiceModal
                const options = { format }
                // Laboratory and Radiology invoices print the SHARED Dr-Lal-style
                // diagnostic receipt (identical layout for both — see printBilling.js);
                // every other department uses the standard invoice format.
                if (/^lab/i.test(b.department || '')) {
                  // Home-collection is tagged in notes; show it as a separate total
                  // line (not a test row) — same as the Laboratory module receipt.
                  const hccTag = String(b.notes || '').match(/\[HCC:(\d+(?:\.\d+)?)\]/)
                  const hcc = hccTag ? Number(hccTag[1]) : 0
                  const testItems = (b.items || []).filter(it => !/home collection/i.test(it.name || ''))
                  const testTotal = testItems.reduce((s, it) => s + (it.amt || 0) * (it.qty || 1), 0)
                  printLabReceipt({
                    invoiceNo: b.invoiceNo, labId: b.uhid, patientName: b.patientName, uhid: b.uhid,
                    age: b.age ? `${b.age} year(s)` : '', sex: b.gender, contact: b.phone,
                    dateTime: b.date, refDoctor: b.refDoctor || 'self', mode: b.payMode,
                    items: testItems.map(it => ({ code: (it.name || 'TEST').substring(0, 6).toUpperCase(), name: it.name, price: (it.amt || 0) * (it.qty || 1), eta: '' })),
                    orderValue: testTotal, homeCollection: hcc, discount: b.discountAmt || 0, gstAmt: b.gstAmt || 0,
                    netPayable: b.total, paid: b.amountPaid || 0, balance: b.balanceDue ?? (b.total - (b.amountPaid || 0)),
                    payments: b.payments
                  }, orgInfo, clinic, options)
                } else if (/^radiology/i.test(b.department || '')) {
                  const examItems = b.items || []
                  const examTotal = examItems.reduce((s, it) => s + (it.amt || 0) * (it.qty || 1), 0)
                  printRadiologyReceipt({
                    invoiceNo: b.invoiceNo, labId: b.uhid, patientName: b.patientName, uhid: b.uhid,
                    age: b.age ? `${b.age} year(s)` : '', sex: b.gender, contact: b.phone,
                    dateTime: b.date, refDoctor: b.refDoctor || 'self', mode: b.payMode,
                    items: examItems.map(it => ({ code: (it.name || 'EXAM').substring(0, 6).toUpperCase(), name: it.name, price: (it.amt || 0) * (it.qty || 1), eta: '' })),
                    orderValue: examTotal, homeCollection: 0, discount: b.discountAmt || 0, gstAmt: b.gstAmt || 0,
                    netPayable: b.total, paid: b.amountPaid || 0, balance: b.balanceDue ?? (b.total - (b.amountPaid || 0)),
                    payments: b.payments
                  }, orgInfo, clinic, options)
                } else if (/^pharmacy/i.test(b.department || '')) {
                  // Same GST-invoice format as the pharmacy counter receipt — GST%/
                  // batch/expiry ride on each item when the sale carried them through
                  // (see PrescriptionPurchaseModal.jsx); otherwise those columns show "—".
                  printPharmacyReceipt({
                    receiptNumber: b.invoiceNo, patientName: b.patientName,
                    saleDate: b.createdAt || b.date, paymentMethod: b.payMode,
                    discountAmount: b.discountAmt || 0, amountPaid: b.amountPaid || 0, totalAmount: b.total,
                    payments: b.payments,
                    items: (b.items || []).map(it => ({
                      drugName: it.name, quantity: it.qty, unitPrice: it.amt, total: (it.amt || 0) * (it.qty || 1),
                      gstRate: it.gstRate, batchNumber: it.batchNumber, expiryDate: it.expiryDate,
                    })),
                  }, orgInfo, clinic, options)
                } else {
                  const hccTag = String(b.notes || '').match(/\[HCC:(\d+(?:\.\d+)?)\]/)
                  const filteredItems = (b.items || []).filter(it => !/home collection/i.test(it.name || ''))
                  const bPayload = { 
                    ...b, 
                    items: filteredItems,
                    subtotal: filteredItems.reduce((s, it) => s + (it.amt || 0) * (it.qty || 1), 0),
                    homeCollection: hccTag ? Number(hccTag[1]) : 0, 
                    discount: b.discountAmt || 0 
                  }
                  printInvoice(bPayload, orgInfo, clinic, options)
                }
              }
              return (
                <div className="flex gap-2">
                  <Button variant="outline" className="border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => doPrint('detailed')}>Print Payment History</Button>
                  <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => doPrint('invoice')}>Print Invoice</Button>
                </div>
              )
            })()}
            <Button variant="outline" onClick={() => setShowInvoiceModal(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Pay Dialog ── */}
      <Dialog open={!!showPayModal} onOpenChange={() => setShowPayModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Collect Payment</DialogTitle></DialogHeader>
          {showPayModal && (() => {
            // Hoisted so the summary AND the Razorpay button agree on one number —
            // the button used to show/charge the invoice TOTAL regardless of what
            // was already paid, which would double-charge a partially-paid patient.
            const paidSoFar = Number(showPayModal.amountPaid || 0)
            const balance = showPayModal.balanceDue ?? (Number(showPayModal.total || 0) - paidSoFar)
            return (
            <div className="space-y-4">
              {/* Invoice summary — Total / Paid / Balance */}
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                <p className="font-semibold text-gray-900">{showPayModal.patientName}</p>
                <p className="text-sm text-gray-500">Invoice: {showPayModal.invoiceNo}</p>
                <div className="flex justify-between mt-2 text-sm">
                  <span className="text-gray-500">Total</span><span className="font-semibold">{fmt(showPayModal.total)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Paid so far</span><span className="font-semibold text-green-700">{fmt(paidSoFar)}</span>
                </div>
                <div className="flex justify-between text-base border-t border-blue-200 mt-1 pt-1">
                  <span className="font-semibold">Balance Due</span><span className="font-bold text-red-600">{fmt(balance)}</span>
                </div>
              </div>

              {/* Online payment via Razorpay */}
              <div className="border rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-700">💳 Online Payment (Razorpay)</p>
                <p className="text-xs text-gray-500">Accepts UPI, Cards, Net Banking, Wallets</p>
                <div className="flex gap-2">
                  <Button className="flex-1 bg-[#2563EB] hover:bg-[#1d4ed8]" disabled={balance <= 0}
                    onClick={() => payWithRazorpay(showPayModal)}>
                    Pay {fmt(balance)} Online
                  </Button>
                  <Button variant="outline" className="flex-1"
                    onClick={() => sharePaymentLink(showPayModal)}>
                    📤 Share Link
                  </Button>
                </div>
              </div>

              {/* Offline payment — supports PARTIAL amounts & multiple methods */}
              <div className="border rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-700">🏦 Collect Payment (Cash / UPI / Card…)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">Amount (₹)</Label>
                    <Input type="number" min="0" step="0.01" value={payAmount}
                      onChange={e => setPayAmount(e.target.value)} placeholder="Enter amount" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-gray-500">Method</Label>
                    <Select value={payMethod} onValueChange={setPayMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['Cash', 'UPI (Manual)', 'Card (Swipe)', 'Bank Transfer', 'Insurance', 'Cheque'].map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button className="w-full" disabled={savingPayment}
                  onClick={() => showPayModal && recordPayment(showPayModal, payMethod, payAmount)}>
                  {savingPayment ? 'Recording…' : `Record ${payAmount ? '₹' + Number(payAmount).toLocaleString('en-IN') : ''} (${payMethod})`}
                </Button>
                <p className="text-xs text-gray-400 text-center">Tip: pay part now (e.g. ₹500 Cash), then add another method for the rest — balance updates automatically.</p>
              </div>
            </div>
            )
          })()}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPayModal(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add / Edit Service Dialog ── */}
      <Dialog open={showAddServiceDialog} onOpenChange={(o) => { setShowAddServiceDialog(o); if (!o) setEditingServiceId(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingServiceId ? 'Edit Service' : 'Add Service to Catalog'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Service Name *</Label>
              <Input value={newService.name} onChange={e => setNewService(s => ({ ...s, name: e.target.value }))} placeholder="e.g. CBC Test" />
            </div>
            <div>
              <Label>Service Code *</Label>
              <Input value={newService.serviceCode} onChange={e => setNewService(s => ({ ...s, serviceCode: e.target.value }))} placeholder="e.g. LAB-CBC-001" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Department *</Label>
                <Select value={newService.department} onValueChange={v => setNewService(s => ({ ...s, department: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(CATALOGUE).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Category *</Label>
                <Input value={newService.category} onChange={e => setNewService(s => ({ ...s, category: e.target.value }))} placeholder="e.g. Haematology" />
              </div>
            </div>
            <div>
              <Label>Price (₹) *</Label>
              <Input type="number" min="0" value={newService.price} onChange={e => setNewService(s => ({ ...s, price: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={newService.description} onChange={e => setNewService(s => ({ ...s, description: e.target.value }))} placeholder="Optional description..." />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="svc-taxable" checked={newService.isTaxable} onCheckedChange={v => setNewService(s => ({ ...s, isTaxable: !!v }))} />
              <Label htmlFor="svc-taxable" className="font-normal">Taxable</Label>
              {newService.isTaxable && (
                <Input className="ml-2 h-8 w-24" type="number" min="0" placeholder="Tax %" value={newService.taxPercentage} onChange={e => setNewService(s => ({ ...s, taxPercentage: e.target.value }))} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="svc-insurance" checked={newService.isCoveredByInsurance} onCheckedChange={v => setNewService(s => ({ ...s, isCoveredByInsurance: !!v }))} />
              <Label htmlFor="svc-insurance" className="font-normal">Covered by insurance</Label>
              {newService.isCoveredByInsurance && (
                <Input className="ml-2 h-8 w-24" type="number" min="0" placeholder="Copay %" value={newService.insuranceCopayPercentage} onChange={e => setNewService(s => ({ ...s, insuranceCopayPercentage: e.target.value }))} />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAddServiceDialog(false); setEditingServiceId(null) }}>Cancel</Button>
            <Button onClick={handleSaveService} disabled={savingService}>{savingService ? 'Saving...' : (editingServiceId ? 'Save Changes' : 'Add Service')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Service Confirm ── */}
      <Dialog open={!!deletingService} onOpenChange={(o) => !o && setDeletingService(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remove Service</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-500">
            Remove <span className="font-medium text-gray-800">{deletingService?.serviceName}</span> from the catalog? It will no longer appear when billing new items.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingService(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteService}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Refund Dialog */}
      <Dialog open={!!refundDialog} onOpenChange={(o) => !o && setRefundDialog(null)}>
        <DialogContent className="max-w-md bg-white border-0 shadow-2xl rounded-2xl overflow-hidden">
          <div className="bg-red-500 p-6 text-white flex flex-col items-center justify-center text-center">
            <div className="bg-white/20 p-4 rounded-full mb-4">
              <Shield className="h-10 w-10 text-white" />
            </div>
            <DialogTitle className="text-2xl font-bold">Issue Refund</DialogTitle>
            <p className="text-red-100 text-sm mt-2 opacity-90">
              Receipt: {refundDialog?.receiptNumber || refundDialog?.receiptNo}
            </p>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="bg-gray-50 rounded-xl p-4 flex justify-between items-center border border-gray-100">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Available to Refund</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">₹{refundDialog?.maxPaid?.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Original Payment</p>
                <p className="text-sm font-medium text-gray-700 mt-1">₹{refundDialog?.amount?.toLocaleString()}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-gray-700 font-semibold">Refund Amount (₹)</Label>
                <Input 
                  type="number" 
                  value={refundAmount} 
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="text-lg font-medium bg-white h-12 focus-visible:ring-red-500"
                  max={refundDialog?.maxPaid}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-gray-700 font-semibold">Reason for Refund</Label>
                <Input 
                  value={refundReason} 
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="e.g. Patient cancelled service"
                  className="bg-white h-12 focus-visible:ring-red-500"
                />
              </div>
            </div>
          </div>
          
          <div className="p-6 bg-gray-50/50 border-t border-gray-100 flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setRefundDialog(null)} className="h-11 rounded-lg">
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={submitRefund}
              className="h-11 px-8 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium shadow-sm"
              disabled={!refundAmount || !refundReason.trim()}
            >
              Process Refund
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Booking a consultation from the counter. Same dialog Appointments uses —
          same department list, same doctor slots from the doctor's timetable, same
          slab-derived fee — so a bill raised here is the bill the doctor's slab
          says, not a hardcoded ₹500. */}
      <AppointmentFormDialog
        open={showBooking}
        onOpenChange={setShowBooking}
        form={bookingForm}
        onSubmit={submitBooking}
        selectedPatient={bookingPatient}
        setSelectedPatient={setBookingPatient}
        setPatients={() => {}}
        uniqueDepartments={booking.departments}
        availableDoctors={booking.doctors}
        doctors={booking.doctors}
        feeCalculation={booking.fee}
        feeCalculationLoading={booking.loading.fee}
        isSubmitting={bookingSubmitting}
        onCancel={() => { setShowBooking(false); setBookingPatient(null); bookingForm.reset() }}
        getPatient={() => bookingPatient}
        showTrigger={false}
      />
    </div>
  )
}
