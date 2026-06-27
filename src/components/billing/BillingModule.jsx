import { useState, useEffect, useCallback, useRef } from 'react'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { toast } from 'sonner'
import { format } from 'date-fns'
import client from '@/api/client'
import PatientLookup from '@/components/common/PatientLookup'
import { Receipt, RefreshCw, Plus, Search, Trash2, Shield, Eye, Printer, Download, TrendingUp, Clock, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { printInvoice, printReceipt } from './utils/printBilling'

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

const CAT_META = {
  Consultation: { color: 'bg-cyan-100 text-cyan-800', dot: '#0097a7' },
  Lab: { color: 'bg-blue-100 text-blue-800', dot: '#185fa5' },
  Pharmacy: { color: 'bg-purple-100 text-purple-800', dot: '#7c3aed' },
  Procedure: { color: 'bg-amber-100 text-amber-800', dot: '#b45309' },
  Radiology: { color: 'bg-gray-100 text-gray-800', dot: '#374151' },
  Vaccine: { color: 'bg-green-100 text-green-800', dot: '#16a34a' },
}

const BILLING_ITEMS_PER_PAGE = 10

const DEMO_CLAIMS = [
  { id: 'CLM-001', patient: 'Rajesh Kumar',    insurer: 'Star Health Insurance',   policy: 'SH-4521-2025', amount: 28500, approved: 26000, status: 'Approved',  submitted: '02 Jun 2026', settled: '08 Jun 2026' },
  { id: 'CLM-002', patient: 'Sunita Verma',    insurer: 'HDFC ERGO',               policy: 'HE-8821-2025', amount: 15200, approved: null,  status: 'Pending',   submitted: '05 Jun 2026', settled: null },
  { id: 'CLM-003', patient: 'Mohd. Arif',      insurer: 'New India Assurance',     policy: 'NIA-2234-25',  amount: 42000, approved: 42000, status: 'Approved',  submitted: '28 May 2026', settled: '04 Jun 2026' },
  { id: 'CLM-004', patient: 'Priya Sharma',    insurer: 'Bajaj Allianz Health',    policy: 'BA-9900-2025', amount: 8700,  approved: null,  status: 'Under Review', submitted: '06 Jun 2026', settled: null },
  { id: 'CLM-005', patient: 'Deepak Singh',    insurer: 'ICICI Lombard',           policy: 'IL-3345-2025', amount: 19800, approved: null,  status: 'Rejected',  submitted: '20 May 2026', settled: null },
  { id: 'CLM-006', patient: 'Kavita Joshi',    insurer: 'Star Health Insurance',   policy: 'SH-7723-2025', amount: 33500, approved: 31000, status: 'Approved',  submitted: '01 Jun 2026', settled: '07 Jun 2026' },
  { id: 'CLM-007', patient: 'Anil Mehra',      insurer: 'United India Insurance',  policy: 'UI-5512-2025', amount: 11200, approved: null,  status: 'Pending',   submitted: '09 Jun 2026', settled: null },
]

const CLAIM_STATUS_STYLE = {
  'Approved':     'bg-green-100 text-green-800',
  'Pending':      'bg-yellow-100 text-yellow-800',
  'Under Review': 'bg-blue-100 text-blue-800',
  'Rejected':     'bg-red-100 text-red-800',
}

const DEFAULT_CLINIC = {
  doctorName: 'Dr. Abebe Kebede', qualification: 'MBBS, MD (General Medicine)',
  clinicName: 'Hospital', address: '', phone: '', regNo: '', gstNo: '',
  upiId: 'gudmed@upi', bankName: 'HDFC Bank', accountNo: 'XXXX XXXX 4523', ifsc: 'HDFC0001234',
  whatsappEnabled: true, countryCode: '91',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })
const todayStr = () => new Date().toISOString().slice(0, 10)
const newInvNo = () => 'INV-' + Date.now().toString().slice(-8)
const calcAge = (dob) => {
  if (!dob) return ''
  const d = new Date(dob); const t = new Date()
  let a = t.getFullYear() - d.getFullYear()
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--
  return a
}

// ── Status badge helper ───────────────────────────────────────────────────────
function PayBadge({ paid }) {
  return paid
    ? <Badge className="bg-green-100 text-green-800">Paid</Badge>
    : <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function BillingModule({ onBack }) {
  const [activeTab, setActiveTab] = useState('dashboard')
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
  const [payments, setPayments] = useState([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [services, setServices] = useState([])
  const [servicesLoading, setServicesLoading] = useState(false)
  const [stats, setStats] = useState({ todayRevenue: 0, pendingCount: 0, collectedToday: 0, outstanding: 0 })

  // New invoice form
  const newForm = () => ({
    patientName: '', patientId: '', phone: '', age: '', gender: '', uhid: '',
    date: todayStr(), invoiceNo: newInvNo(), notes: '', payMode: 'Cash',
    paid: false, items: [], discount: 0, gstPct: 0, sendWhatsApp: true,
  })
  const [form, setForm] = useState(newForm())
  const [activeCat, setActiveCat] = useState('Consultation')
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
  const [showPayModal, setShowPayModal] = useState(null)
  const [payMethod, setPayMethod] = useState('Cash')

  // Invoice search/filter
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [invoiceFilter, setInvoiceFilter] = useState('all')

  // Service catalog
  const [showAddServiceDialog, setShowAddServiceDialog] = useState(false)
  const [newService, setNewService] = useState({ name: '', category: 'Consultation', price: '', description: '' })
  const [savingService, setSavingService] = useState(false)

  // Pagination
  const [invoicesPage, setInvoicesPage] = useState(1)
  const [paymentsPage, setPaymentsPage] = useState(1)
  const [servicesPage, setServicesPage] = useState(1)

  // Derived cart totals
  const subtotal = form.items.reduce((a, i) => a + i.qty * i.amt, 0)
  const discountAmt = Math.round(subtotal * form.discount / 100)
  const gstAmt = Math.round((subtotal - discountAmt) * form.gstPct / 100)
  const total = subtotal - discountAmt + gstAmt

  // ── Fetch all ─────────────────────────────────────────────────────────────
  const fetchBills = useCallback(async () => {
    setBillsLoading(true)
    try {
      const offset = (invoicesPage - 1) * BILLING_ITEMS_PER_PAGE
      const res = await client.get('/billing', { params: { resource: 'invoices', limit: BILLING_ITEMS_PER_PAGE, offset } })
      if (res.success) {
        const mapped = res.data.map((inv) => {
          let items = []
          try { items = typeof inv.items === 'string' ? JSON.parse(inv.items) : (inv.items || []) } catch { items = [] }
          const patName = inv.patient ? `${inv.patient.firstName} ${inv.patient.lastName}` : 'Unknown'
          return {
            id: inv.invoiceNumber, dbId: inv.id,
            patientName: patName, patientId: inv.patientId,
            phone: inv.patient?.phonePrimary || '',
            age: '', gender: '', uhid: inv.patient?.mrn || '',
            date: format(new Date(inv.invoiceDate), 'dd MMM yyyy'),
            invoiceNo: inv.invoiceNumber, notes: inv.notes || '',
            payMode: 'Cash', paid: inv.paymentStatus === 'paid',
            items, discount: inv.discountPercentage || 0, gstPct: 0,
            subtotal: inv.subtotal, discountAmt: inv.discountAmount,
            gstAmt: inv.taxAmount || 0, total: inv.totalAmount,
            createdAt: inv.invoiceDate || inv.createdAt,
          }
        })
        setBills(mapped)
      }
    } catch { /* silent */ }
    finally { setBillsLoading(false) }
  }, [invoicesPage])

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

  const fetchPayments = useCallback(async () => {
    setPaymentsLoading(true)
    try {
      const offset = (paymentsPage - 1) * BILLING_ITEMS_PER_PAGE
      const res = await client.get('/billing', { params: { resource: 'payments', limit: BILLING_ITEMS_PER_PAGE, offset } })
      if (res.success) setPayments(res.data || [])
    } catch { /* silent */ }
    finally { setPaymentsLoading(false) }
  }, [paymentsPage])

  const fetchServices = useCallback(async () => {
    setServicesLoading(true)
    try {
      const offset = (servicesPage - 1) * BILLING_ITEMS_PER_PAGE
      const res = await client.get('/billing', { params: { resource: 'services', limit: BILLING_ITEMS_PER_PAGE, offset } })
      if (res.success) setServices(res.data || [])
    } catch { /* silent */ }
    finally { setServicesLoading(false) }
  }, [servicesPage])

  const fetchAll = useCallback(() => {
    fetchBills()
    fetchPayments()
    fetchServices()
    fetchStats()
  }, [fetchBills, fetchPayments, fetchServices, fetchStats])

  useEffect(() => { fetchAll() }, [fetchAll])

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
  useEffect(() => {
    if (!patientSearch || patientSearch.length < 2) { setPatientResults([]); return }
    const t = setTimeout(async () => {
      setPatSearchLoading(true)
      try {
        const res = await client.get('/patients', { params: { search: patientSearch, limit: 8 } })
        if (res.success) setPatientResults(res.data || [])
      } catch { /* silent */ }
      finally { setPatSearchLoading(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [patientSearch])

  useEffect(() => {
    const h = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setPatientDropdown(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  function selectPatient(p) {
    const age = calcAge(p.dateOfBirth)
    setForm(f => ({
      ...f, patientName: `${p.firstName} ${p.lastName}`, patientId: p.id,
      phone: p.phonePrimary, age: String(age),
      gender: p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'O',
      uhid: p.mrn,
    }))
    setPatientSearch(`${p.firstName} ${p.lastName}`)
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
      return { ...f, items: [...f.items, { name: item.name, sub: item.sub || '', cat, qty: 1, amt: item.amt }] }
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
    if (!form.patientId && !form.patientName) { toast.error('Select a patient'); return }
    if (form.items.length === 0) { toast.error('Add at least one service'); return }
    setSaving(true)
    const bill = { ...form, subtotal, discountAmt, gstAmt, total, createdAt: new Date().toISOString(), id: form.invoiceNo }
    try {
      if (form.patientId) {
        const apiItems = form.items.map(it => ({
          serviceName: it.name,
          quantity:    it.qty,
          unitPrice:   it.amt,
          total:       it.qty * it.amt,
          tax:         0,
        }))
        const result = await client.post('/billing', {
          resource: 'invoice', patientId: form.patientId, items: apiItems,
          discountAmount: discountAmt, discountPercentage: form.discount, notes: form.notes,
        })
        if (result.success) {
          bill.dbId = result.data.id
          bill.id = result.data.invoiceNumber
          bill.invoiceNo = result.data.invoiceNumber
          if (form.paid) {
            await client.post('/billing', {
              resource: 'payment', invoiceId: result.data.id,
              patientId: form.patientId, amount: total, paymentMethod: form.payMode,
            })
          }
          await fetchBills()
          await fetchPayments()
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
        window.open(`https://wa.me/${cc}${phone}?text=${encodeURIComponent(msgText)}`, '_blank')
      }
      setShowInvoiceModal(bill)
      setForm(newForm())
      setPatientSearch('')
      setActiveTab('invoices')
    } catch { toast.error('Failed to save invoice') }
    finally { setSaving(false) }
  }

  // ── Razorpay payment ───────────────────────────────────────────────────────
  async function payWithRazorpay(bill) {
    try {
      // 1. Create order on backend
      const order = await client.post('/payments/create-order', {
        invoiceId:   bill.dbId,
        amount:      bill.total,
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
    try {
      toast.loading('Generating payment link...')
      const res = await client.post('/payments/create-link', {
        invoiceId:   bill.dbId,
        amount:      bill.total,
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
  async function recordPayment(bill, method) {
    try {
      if (bill.dbId) {
        await client.post('/billing', {
          resource: 'payment', invoiceId: bill.dbId,
          patientId: bill.patientId, amount: bill.total, paymentMethod: method,
        })
      }
      setBills(bs => bs.map(b => b.id === bill.id ? { ...b, paid: true } : b))
      setShowPayModal(null)
      toast.success('Payment recorded!')
      fetchBills()
      fetchPayments()
      fetchStats()
    } catch { toast.error('Failed to record payment') }
  }



  // ── Add service to catalog ─────────────────────────────────────────────────
  async function handleAddService() {
    if (!newService.name || !newService.price) { toast.error('Name and price are required'); return }
    setSavingService(true)
    try {
      const res = await client.post('/billing', {
        resource: 'service',
        name: newService.name,
        category: newService.category,
        price: parseFloat(newService.price),
        description: newService.description,
      })
      if (res.success) {
        setServices(prev => [res.data, ...prev])
        toast.success('Service added to catalog')
      }
      setShowAddServiceDialog(false)
      setNewService({ name: '', category: 'Consultation', price: '', description: '' })
    } catch { toast.error('Failed to add service') }
    finally { setSavingService(false) }
  }

  // ── Filtered invoices ──────────────────────────────────────────────────────
  const filteredBills = bills.filter(b => {
    const q = invoiceSearch.toLowerCase()
    const matchSearch = !q || b.patientName.toLowerCase().includes(q) || b.invoiceNo.toLowerCase().includes(q)
    const matchFilter = invoiceFilter === 'all' || (invoiceFilter === 'paid' && b.paid) || (invoiceFilter === 'pending' && !b.paid)
    return matchSearch && matchFilter
  })

  // ── Recent transactions (last 10) ─────────────────────────────────────────
  const recentBills = [...bills].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10)

  // ── Catalogue items filtered ───────────────────────────────────────────────
  const catItems = (CATALOGUE[activeCat] || []).filter(i =>
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
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({bills.length})</TabsTrigger>
          <TabsTrigger value="new-invoice">New Invoice</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="catalog">Service Catalog</TabsTrigger>
          <TabsTrigger value="insurance">Insurance</TabsTrigger>
        </TabsList>

        {/* ── DASHBOARD ── */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Today Revenue', value: fmt(stats.todayRevenue), color: 'text-green-600', bg: 'bg-green-50' },
              { label: 'Pending Invoices', value: stats.pendingCount, color: 'text-yellow-600', bg: 'bg-yellow-50' },
              // { label: 'Collected Today', value: fmt(stats.collectedToday), color: 'text-blue-600', bg: 'bg-blue-50' },
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

          {/* Recent transactions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {billsLoading ? (
                <div className="text-center py-10 text-gray-400">Loading...</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentBills.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-400">No transactions yet</TableCell></TableRow>
                    ) : recentBills.map(b => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-sm text-blue-600">{b.invoiceNo}</TableCell>
                        <TableCell className="font-medium">{b.patientName}</TableCell>
                        <TableCell className="text-sm text-gray-500">{b.date}</TableCell>
                        <TableCell className="font-semibold">{fmt(b.total)}</TableCell>
                        <TableCell><PayBadge paid={b.paid} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── INVOICES ── */}
        <TabsContent value="invoices" className="space-y-4">
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
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
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
                        <TableHead>Phone</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBills.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="text-center py-10 text-gray-400">No invoices found</TableCell></TableRow>
                      ) : filteredBills.slice((invoicesPage - 1) * BILLING_ITEMS_PER_PAGE, invoicesPage * BILLING_ITEMS_PER_PAGE).map(b => (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-sm text-blue-600">{b.invoiceNo}</TableCell>
                          <TableCell className="font-medium">{b.patientName}</TableCell>
                          <TableCell className="text-sm text-gray-500">{b.phone || '—'}</TableCell>
                          <TableCell className="text-sm text-gray-500">{b.items.length}</TableCell>
                          <TableCell className="font-semibold">{fmt(b.total)}</TableCell>
                          <TableCell className="text-sm text-gray-500">{b.date}</TableCell>
                          <TableCell><PayBadge paid={b.paid} /></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => setShowInvoiceModal(b)}>View</Button>
                              {!b.paid && (
                                <Button size="sm" onClick={() => { setShowPayModal(b); setPayMethod('Cash') }}>Pay</Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredBills.length > BILLING_ITEMS_PER_PAGE && (
                    <div className="px-4">
                      <PaginationControls currentPage={invoicesPage} setCurrentPage={setInvoicesPage} totalItems={filteredBills.length} />
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
                  <CardTitle className="text-sm font-semibold">Service Catalogue <span className="font-normal text-gray-400 text-xs ml-1">— click to add</span></CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Category tabs */}
                  <div className="flex flex-wrap gap-1.5">
                    {Object.keys(CATALOGUE).map(cat => (
                      <button key={cat} onClick={() => { setActiveCat(cat); setCatSearch('') }}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${activeCat === cat ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                  {/* Search within category */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <Input className="pl-8 h-8 text-sm" placeholder={`Search ${activeCat}...`} value={catSearch} onChange={e => setCatSearch(e.target.value)} />
                  </div>
                  {/* Items grid */}
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {catItems.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-4">No items found</p>
                    ) : catItems.map(it => (
                      <div key={it.name} onClick={() => addToCart(it, activeCat)}
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
                          <Input type="number" min="0" max="100" className="h-7 w-20 text-sm text-center" value={Number.isNaN(form.discount) ? '' : form.discount} onChange={e => { const v = parseFloat(e.target.value); setForm(f => ({ ...f, discount: Number.isNaN(v) ? 0 : v })) }} />
                          {discountAmt > 0 && <span className="text-sm text-green-600 font-medium">− {fmt(discountAmt)}</span>}
                        </div>
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

                      <div className="space-y-2">
                        <Label className="text-xs">Notes</Label>
                        <Input className="h-8 text-sm" placeholder="Optional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <Button className="flex-1" onClick={saveInvoice} disabled={saving}>
                          {saving ? 'Saving...' : 'Save Invoice'}
                        </Button>
                        <Button variant="outline" onClick={() => { setForm(newForm()); setPatientSearch('') }}>Clear</Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── PAYMENTS ── */}
        <TabsContent value="payments" className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Payments', value: payments.length, color: 'text-gray-900' },
              { label: 'Total Collected', value: fmt(payments.reduce((a, p) => a + (p.amount || 0), 0)), color: 'text-green-600' },
              { label: 'Avg. Payment', value: payments.length ? fmt(Math.round(payments.reduce((a, p) => a + (p.amount || 0), 0) / payments.length)) : '₹0.00', color: 'text-blue-600' },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-gray-500 uppercase font-medium">{s.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="p-0">
              {paymentsLoading ? (
                <div className="text-center py-10 text-gray-400">Loading payments...</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Receipt #</TableHead>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Patient</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Print</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="text-center py-10 text-gray-400">No payment records yet</TableCell></TableRow>
                      ) : payments.slice((paymentsPage - 1) * BILLING_ITEMS_PER_PAGE, paymentsPage * BILLING_ITEMS_PER_PAGE).map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-sm text-blue-600">{p.receiptNumber}</TableCell>
                          <TableCell className="text-sm text-gray-500">{p.invoice?.invoiceNumber || '—'}</TableCell>
                          <TableCell className="font-medium">{p.invoice?.patient ? `${p.invoice.patient.firstName} ${p.invoice.patient.lastName}` : '—'}</TableCell>
                          <TableCell className="font-bold text-green-700">{fmt(p.amount)}</TableCell>
                          <TableCell><Badge className="bg-blue-100 text-blue-800">{p.paymentMethod}</Badge></TableCell>
                          <TableCell className="text-sm text-gray-500">{p.paymentDate ? format(new Date(p.paymentDate), 'dd MMM yyyy') : '—'}</TableCell>
                          <TableCell><Badge className="bg-green-100 text-green-800">Received</Badge></TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => printReceipt(p, orgInfo, clinic)}>
                              <Printer className="h-3.5 w-3.5 mr-1" />Receipt
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {payments.length > BILLING_ITEMS_PER_PAGE && (
                    <div className="px-4">
                      <PaginationControls currentPage={paymentsPage} setCurrentPage={setPaymentsPage} totalItems={payments.length} />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SERVICE CATALOG ── */}
        <TabsContent value="catalog" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{services.length} services in catalog</p>
            <Button onClick={() => setShowAddServiceDialog(true)}><Plus className="h-4 w-4 mr-1" />Add Service</Button>
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
                        <TableHead>Category</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {services.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-10 text-gray-400">No services added yet</TableCell></TableRow>
                      ) : services.slice((servicesPage - 1) * BILLING_ITEMS_PER_PAGE, servicesPage * BILLING_ITEMS_PER_PAGE).map(s => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.name}</TableCell>
                          <TableCell><Badge variant="outline">{s.category || '—'}</Badge></TableCell>
                          <TableCell className="font-semibold">₹{Number(s.price || 0).toLocaleString('en-IN')}</TableCell>
                          <TableCell className="text-sm text-gray-500">{s.description || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {services.length > BILLING_ITEMS_PER_PAGE && (
                    <div className="px-4">
                      <PaginationControls currentPage={servicesPage} setCurrentPage={setServicesPage} totalItems={services.length} />
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
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-blue-600 font-medium">Total Claims</p>
                  <p className="text-3xl font-bold text-blue-700">{DEMO_CLAIMS.length}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-green-600 font-medium">Approved</p>
                  <p className="text-3xl font-bold text-green-700">{DEMO_CLAIMS.filter(c => c.status === 'Approved').length}</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-yellow-600 font-medium">Pending / Review</p>
                  <p className="text-3xl font-bold text-yellow-700">{DEMO_CLAIMS.filter(c => c.status === 'Pending' || c.status === 'Under Review').length}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-red-600 font-medium">Rejected</p>
                  <p className="text-3xl font-bold text-red-700">{DEMO_CLAIMS.filter(c => c.status === 'Rejected').length}</p>
                </div>
              </div>
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
                  {DEMO_CLAIMS.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-sm text-blue-600">{c.id}</TableCell>
                      <TableCell className="font-medium">{c.patient}</TableCell>
                      <TableCell className="text-sm">{c.insurer}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{c.policy}</TableCell>
                      <TableCell className="text-right font-semibold">{fmt(c.amount)}</TableCell>
                      <TableCell className="text-right font-semibold text-green-700">{c.approved ? fmt(c.approved) : '—'}</TableCell>
                      <TableCell className="text-sm text-gray-500">{c.submitted}</TableCell>
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
                <div><span className="text-gray-500">Status: </span><PayBadge paid={showInvoiceModal.paid} /></div>
              </div>
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
                  {(showInvoiceModal.items || []).map((it, i) => (
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
              <div className="flex justify-end">
                <div className="w-64 space-y-1 border rounded-lg p-3">
                  <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmt(showInvoiceModal.subtotal || 0)}</span></div>
                  {(showInvoiceModal.discountAmt || 0) > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>−{fmt(showInvoiceModal.discountAmt)}</span></div>}
                  <div className="flex justify-between font-bold text-base border-t pt-1 mt-1"><span>Total</span><span>{fmt(showInvoiceModal.total)}</span></div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {showInvoiceModal && !showInvoiceModal.paid && (
              <Button onClick={() => { setShowPayModal(showInvoiceModal); setPayMethod('Cash'); setShowInvoiceModal(null) }}>Collect Payment</Button>
            )}
            <Button variant="outline" onClick={() => showInvoiceModal && printInvoice(showInvoiceModal, orgInfo, clinic)}>Print / PDF</Button>
            <Button variant="outline" onClick={() => setShowInvoiceModal(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Pay Dialog ── */}
      <Dialog open={!!showPayModal} onOpenChange={() => setShowPayModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Collect Payment</DialogTitle></DialogHeader>
          {showPayModal && (
            <div className="space-y-4">
              {/* Invoice summary */}
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                <p className="font-semibold text-gray-900">{showPayModal.patientName}</p>
                <p className="text-sm text-gray-500">Invoice: {showPayModal.invoiceNo}</p>
                <p className="text-2xl font-bold text-blue-700 mt-1">{fmt(showPayModal.total)}</p>
              </div>

              {/* Online payment via Razorpay */}
              <div className="border rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-700">💳 Online Payment (Razorpay)</p>
                <p className="text-xs text-gray-500">Accepts UPI, Cards, Net Banking, Wallets</p>
                <div className="flex gap-2">
                  <Button className="flex-1 bg-[#2563EB] hover:bg-[#1d4ed8]"
                    onClick={() => payWithRazorpay(showPayModal)}>
                    Pay ₹{showPayModal.total?.toLocaleString('en-IN')} Online
                  </Button>
                  <Button variant="outline" className="flex-1"
                    onClick={() => sharePaymentLink(showPayModal)}>
                    📤 Share Link
                  </Button>
                </div>
              </div>

              {/* Offline payment */}
              <div className="border rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-700">🏦 Offline Payment</p>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Cash', 'UPI (Manual)', 'Card (Swipe)', 'Bank Transfer', 'Insurance', 'Cheque'].map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" className="w-full"
                  onClick={() => showPayModal && recordPayment(showPayModal, payMethod)}>
                  Mark as Paid ({payMethod})
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPayModal(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Service Dialog ── */}
      <Dialog open={showAddServiceDialog} onOpenChange={setShowAddServiceDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Service to Catalog</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Service Name *</Label>
              <Input value={newService.name} onChange={e => setNewService(s => ({ ...s, name: e.target.value }))} placeholder="e.g. CBC Test" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={newService.category} onValueChange={v => setNewService(s => ({ ...s, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(CATALOGUE).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Price (₹) *</Label>
              <Input type="number" min="0" value={newService.price} onChange={e => setNewService(s => ({ ...s, price: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={newService.description} onChange={e => setNewService(s => ({ ...s, description: e.target.value }))} placeholder="Optional description..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddServiceDialog(false)}>Cancel</Button>
            <Button onClick={handleAddService} disabled={savingService}>{savingService ? 'Saving...' : 'Add Service'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
