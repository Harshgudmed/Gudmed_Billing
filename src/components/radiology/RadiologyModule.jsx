import { useState, useEffect, useCallback, useRef } from 'react'
import { getOrgSettings } from '@/lib/orgSettings'
import { sendRadiologyNotification } from '@/lib/whatsapp'
import { format, differenceInYears } from 'date-fns'
import { toast } from 'sonner'
import { printRadiologyReceipt } from '@/components/billing/utils/printBilling'
import PaymentFields from '@/components/billing/PaymentFields'
import { createInvoiceWithPayment, fetchOrderInvoicePayments } from '@/lib/billing'
import {
  Scan, Plus, Edit, Trash2, Search, Eye, CheckCircle, XCircle,
  RefreshCw, FileText, Printer, AlertTriangle, Upload, X, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
// Tabs replaced with custom underline-style nav buttons
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import PatientLookup from '@/components/common/PatientLookup'
import BulkImportDialog from '@/components/common/BulkImportDialog'
import client from '@/api/client'

// ── Constants ─────────────────────────────────────────────────────────────────

const RADIOLOGY_ITEMS_PER_PAGE = 15
const EXAM_CATEGORIES = ['x-ray', 'ct', 'mri', 'ultrasound', 'mammography']
const URGENCY_LEVELS = ['routine', 'urgent', 'stat']
const REPORT_TEMPLATES = [
  { id: 't1', name: 'Chest X-Ray Normal', findings: 'The lungs are clear. No consolidation, effusion or pneumothorax identified. Heart size within normal limits. Mediastinum not widened. No bony abnormality.', impression: 'Normal chest radiograph.' },
  { id: 't2', name: 'CT Head Normal', findings: 'No intracranial hemorrhage. No focal cerebral infarction or diffusion restriction. Ventricles normal in size and position. No midline shift. No extra-axial collection.', impression: 'Normal CT brain. No acute intracranial abnormality.' },
  { id: 't3', name: 'Abdominal Ultrasound Normal', findings: 'Liver normal size and echotexture. No focal hepatic lesion. Portal vein patent. Gallbladder normal, no gallstones or wall thickening. Common bile duct not dilated. Spleen and pancreas unremarkable. Both kidneys normal. No free intraperitoneal fluid.', impression: 'Normal abdominal ultrasound.' },
  { id: 't4', name: 'Pelvic Ultrasound Normal', findings: 'Uterus normal size, shape and echotexture. Endometrial stripe within normal limits. No adnexal mass or tenderness. No free pelvic fluid.', impression: 'Normal pelvic ultrasound.' },
  { id: 't5', name: 'MRI Brain Normal', findings: 'No abnormal signal intensity in brain parenchyma. No mass, hemorrhage or diffusion restriction. Ventricles and sulci normal. Normal flow voids in major vessels. No enhancing lesion.', impression: 'Normal MRI brain.' },
]

const emptyExam = {
  examName: '', examCode: '', examCategory: 'x-ray', bodyPart: '', modality: 'DR',
  price: 0, estimatedDuration: 30, preparationInstructions: '', contrastRequired: false, isActive: true,
}
const emptyOrder = {
  patientId: '', examId: '', clinicalIndication: '', provisionalDiagnosis: '',
  relevantHistory: '', urgency: 'routine', scheduledDate: '', notes: '',
  amountPaid: '', paymentMethod: 'cash', // collected at booking → Payment record
}
const emptyReport = {
  technique: '', findings: '', impression: '', recommendations: '',
  hasCriticalFindings: false, criticalFindings: '',
  comparedWithPrevious: false, comparisonNotes: '',
  dicomStudyUid: '', templateUsed: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function printViaPopup(html) {
  const win = window.open('', '_blank', 'width=900,height=780')
  if (!win) { alert('Please allow pop-ups to print'); return }
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print() }, 500)
}

function statusBadge(status) {
  const map = {
    pending: 'bg-yellow-100 text-yellow-800',
    scheduled: 'bg-blue-100 text-blue-800',
    in_progress: 'bg-orange-100 text-orange-800',
    completed: 'bg-green-100 text-green-800',
    reported: 'bg-teal-100 text-teal-800',
    cancelled: 'bg-red-100 text-red-800',
    draft: 'bg-gray-100 text-gray-800',
    final: 'bg-emerald-100 text-emerald-800',
    amended: 'bg-amber-100 text-amber-800',
  }
  return <Badge className={map[status] || 'bg-gray-100 text-gray-800'}>{(status || '').replace('_', ' ')}</Badge>
}

function urgencyBadge(urgency) {
  const map = { routine: 'bg-green-100 text-green-800', urgent: 'bg-orange-500 text-white', stat: 'bg-red-500 text-white' }
  return <Badge className={map[urgency] || 'bg-gray-100 text-gray-800'}>{urgency || '—'}</Badge>
}

function categoryBadge(category) {
  const map = { 'ct': 'bg-orange-500 text-white', 'mri': 'bg-purple-500 text-white', 'ultrasound': 'bg-blue-500 text-white', 'x-ray': 'bg-green-500 text-white', 'mammography': 'bg-pink-500 text-white' }
  return <Badge className={map[category] || 'bg-gray-500 text-white'}>{(category || '').toUpperCase()}</Badge>
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RadiologyModule() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [exams, setExams] = useState([])
  const [orders, setOrders] = useState([])
  const [patients, setPatients] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ pending: 0, inProgress: 0, completedToday: 0, criticalFindings: 0, totalExams: 0 })

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modalityFilter, setModalityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')

  // Pagination
  const [examsPage, setExamsPage] = useState(1)
  const [ordersPage, setOrdersPage] = useState(1)
  const [reportsPage, setReportsPage] = useState(1)

  // Pagination metadata from backend
  const [examsMeta, setExamsMeta] = useState({ total: 0, limit: 10, offset: 0 })
  const [ordersMeta, setOrdersMeta] = useState({ total: 0, limit: 10, offset: 0 })
  const [reportsMeta, setReportsMeta] = useState({ total: 0, limit: 10, offset: 0 })

  // Exam dialog
  const [showExamDialog, setShowExamDialog] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [examForm, setExamForm] = useState(emptyExam)
  const [editingExamId, setEditingExamId] = useState(null)
  const [savingExam, setSavingExam] = useState(false)
  const [deleteExamConfirm, setDeleteExamConfirm] = useState(null)

  // Order dialogs
  const [showOrderDialog, setShowOrderDialog] = useState(false)
  const [orderForm, setOrderForm] = useState(emptyOrder)
  const [savingOrder, setSavingOrder] = useState(false)

  const [showViewOrder, setShowViewOrder] = useState(false)
  const [viewOrder, setViewOrder] = useState(null)

  const [showEditOrderDialog, setShowEditOrderDialog] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)
  const [editOrderForm, setEditOrderForm] = useState({ urgency: 'routine', clinicalIndication: '', notes: '' })
  const [savingEditOrder, setSavingEditOrder] = useState(false)

  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancellingOrder, setCancellingOrder] = useState(null)
  const [cancelReason, setCancelReason] = useState('')

  // Report dialog
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [reportForm, setReportForm] = useState(emptyReport)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [savingReport, setSavingReport] = useState(false)
  const [reportImages, setReportImages] = useState([])
  const imageInputRef = useRef(null)

  // Report notes dialog (quick print)
  const [showReportNotesDialog, setShowReportNotesDialog] = useState(false)
  const [reportNotesOrder, setReportNotesOrder] = useState(null)
  const [reportNotes, setReportNotes] = useState('')
  const [reportAccession, setReportAccession] = useState('')
  const [reportRadiologist, setReportRadiologist] = useState('')

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const examsOffset = (examsPage - 1) * RADIOLOGY_ITEMS_PER_PAGE
      const ordersOffset = (ordersPage - 1) * RADIOLOGY_ITEMS_PER_PAGE
      const reportsOffset = (reportsPage - 1) * RADIOLOGY_ITEMS_PER_PAGE

      const [eRes, oRes, pRes, rRes] = await Promise.all([
        client.get(`/radiology?resource=exams&limit=${RADIOLOGY_ITEMS_PER_PAGE}&offset=${examsOffset}`),
        client.get(`/radiology?resource=orders&limit=${RADIOLOGY_ITEMS_PER_PAGE}&offset=${ordersOffset}`),
        client.get('/patients?limit=1000'),
        client.get(`/radiology?resource=reports&limit=${RADIOLOGY_ITEMS_PER_PAGE}&offset=${reportsOffset}`),
      ])
      if (eRes.success) {
        setExams(eRes.data || [])
        if (eRes.meta) setExamsMeta(eRes.meta)
      }
      if (oRes.success) {
        setOrders(oRes.data || [])
        if (oRes.meta) setOrdersMeta(oRes.meta)
      }
      if (pRes.success) setPatients(pRes.data || [])
      if (rRes.success) {
        setReports(rRes.data || [])
        if (rRes.meta) setReportsMeta(rRes.meta)
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [examsPage, ordersPage, reportsPage])

  const fetchStats = useCallback(async () => {
    try {
      const res = await client.get('/radiology?resource=stats')
      if (res.success) setStats(res.data)
    } catch { /* silent */ }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { getOrgSettings().then(setOrgInfo) }, [])
  useEffect(() => { fetchStats() }, [fetchStats])

  // ── Exam handlers ─────────────────────────────────────────────────────────

  const handleSaveExam = async () => {
    if (!examForm.examName || !examForm.examCode || !examForm.bodyPart) { toast.error('Fill required fields: Name, Code, Body Part'); return }
    setSavingExam(true)
    try {
      const payload = {
        resource: 'exam',
        ...examForm,
        price: parseFloat(examForm.price) || 0,
        estimatedDuration: parseInt(examForm.estimatedDuration) || 30,
      }
      if (editingExamId) {
        const res = await client.patch('/radiology', { ...payload, id: editingExamId })
        if (res.success) {
          setExams(prev => prev.map(e => e.id === editingExamId ? { ...e, ...payload } : e))
          toast.success('Exam updated')
        }
      } else {
        const res = await client.post('/radiology', payload)
        if (res.success) {
          setExams(prev => [res.data, ...prev])
          toast.success('Exam added to catalog')
        }
      }
      setShowExamDialog(false)
      setExamForm(emptyExam)
      setEditingExamId(null)
    } catch (e) { toast.error(e.message || 'Failed to save exam') }
    setSavingExam(false)
  }

  const handleDeleteExam = async (exam) => {
    try {
      const res = await client.patch('/radiology', { resource: 'exam', id: exam.id, isActive: false })
      if (res.success) {
        setExams(prev => prev.filter(e => e.id !== exam.id))
        toast.success('Exam removed from catalog')
        setDeleteExamConfirm(null)
      }
    } catch (e) { toast.error(e.message || 'Failed to remove exam') }
  }

  // ── Order handlers ────────────────────────────────────────────────────────

  const handleSaveOrder = async () => {
    if (!orderForm.patientId || !orderForm.examId || !orderForm.clinicalIndication) {
      toast.error('Patient, exam, and clinical indication are required')
      return
    }
    setSavingOrder(true)
    try {
      const res = await client.post('/radiology', { resource: 'order', ...orderForm })
      if (res.success) {
        setOrders(prev => [res.data, ...prev])
        toast.success(`Order ${res.data.orderNumber} created`)
        setShowOrderDialog(false)
        setOrderForm(emptyOrder)
        fetchStats()

        // Auto-billing (non-fatal). Item must use `serviceName` (not `description`) —
        // that's what invoiceItemSchema on the backend requires; the old shape here
        // failed validation on every order, so no invoice was ever actually created.
        // `notes` is tagged `[Radiology]` so the Billing module recognizes the
        // department, same as Laboratory's auto-invoice (LaboratoryModule.jsx).
        const exam = exams.find(e => e.id === orderForm.examId)
        if (exam && exam.price > 0) {
          // Shared helper: create the invoice + record what was paid at booking.
          try {
            await createInvoiceWithPayment({
              patientId: orderForm.patientId,
              items: [{
                serviceName: `${exam.examName} (${(exam.examCategory || '').toUpperCase()})`,
                quantity: 1, unitPrice: exam.price, tax: 0, total: exam.price,
              }],
              notes: `[Radiology] Radiology Order ${res.data.orderNumber || ''}`.trim(),
              amountPaid: orderForm.amountPaid,
              paymentMethod: orderForm.paymentMethod,
            })
          } catch { /* non-fatal — order is created regardless of billing */ }
        }
      }
    } catch (e) { toast.error(e.message || 'Failed to create order') }
    setSavingOrder(false)
  }

  const handleUpdateStatus = async (id, status, extra = {}) => {
    try {
      const res = await client.patch('/radiology', { resource: 'order', id, status, ...extra })
      if (res.success) {
        setOrders(prev => prev.map(o => o.id === id ? { ...o, status, ...extra } : o))
        toast.success(`Status updated to ${status}`)
        fetchStats()
      }
    } catch (e) { toast.error(e.message || 'Failed to update status') }
  }

  const handleEditOrderSubmit = async () => {
    if (!editingOrder || !editOrderForm.clinicalIndication) { toast.error('Clinical indication required'); return }
    setSavingEditOrder(true)
    try {
      const res = await client.patch('/radiology', { resource: 'order', id: editingOrder.id, ...editOrderForm })
      if (res.success) {
        setOrders(prev => prev.map(o => o.id === editingOrder.id ? { ...o, ...editOrderForm } : o))
        toast.success('Order updated')
        setShowEditOrderDialog(false)
        setEditingOrder(null)
      }
    } catch (e) { toast.error(e.message || 'Failed to update order') }
    setSavingEditOrder(false)
  }

  const handleCancelOrder = async () => {
    if (!cancellingOrder) return
    try {
      await handleUpdateStatus(cancellingOrder.id, 'cancelled', cancelReason ? { cancellationReason: cancelReason } : {})
    } catch { /* already toasted */ }
    setShowCancelDialog(false)
    setCancellingOrder(null)
    setCancelReason('')
  }

  // ── Report handlers ───────────────────────────────────────────────────────

  const handleSaveReport = async () => {
    if (!reportForm.findings || !reportForm.impression) { toast.error('Findings and impression are required'); return }
    if (!selectedOrder) return
    setSavingReport(true)
    try {
      const payload = { resource: 'report', orderId: selectedOrder.id, ...reportForm }
      if (reportImages.length > 0) {
        payload.images = JSON.stringify(reportImages.map(img => ({ url: img.url, caption: img.name, view: '' })))
      }
      const res = await client.post('/radiology', payload)
      if (res.success) {
        setReports(prev => [res.data, ...prev])
        setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, status: 'reported', report: res.data } : o))
        toast.success('Report saved (Draft)')
        setShowReportDialog(false)
        setReportForm(emptyReport)
        setReportImages([])
        setSelectedOrder(null)
        fetchStats()
      }
    } catch (e) { toast.error(e.message || 'Failed to save report') }
    setSavingReport(false)
  }

  const handleVerifyReport = async (reportId) => {
    try {
      const res = await client.patch('/radiology', {
        resource: 'report', id: reportId,
        status: 'final', verifiedAt: new Date().toISOString(),
      })
      if (res.success) {
        setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'final', verifiedAt: new Date().toISOString() } : r))
        // Find the orderId for WhatsApp notification
        const report = reports.find(r => r.id === reportId)
        const orderId = report?.orderId || selectedOrder?.id
        if (orderId) {
          toast.success('Report finalized', {
            description: 'Would you like to notify the patient?',
            action: {
              label: '📲 Notify via WhatsApp',
              onClick: async () => {
                const result = await sendRadiologyNotification(orderId)
                if (result?.sent) toast.success('Notification sent via WhatsApp API')
                else if (result?.waLink) toast.success('WhatsApp opened — click Send')
                else toast.error('Could not send notification')
              },
            },
            duration: 8000,
          })
        } else {
          toast.success('Report verified and finalized')
        }
      }
    } catch (e) { toast.error(e.message || 'Failed to verify report') }
  }

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || [])
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => setReportImages(prev => [...prev, { url: ev.target.result, name: file.name }])
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const applyTemplate = (templateId) => {
    const tmpl = REPORT_TEMPLATES.find(t => t.id === templateId)
    if (!tmpl) return
    setReportForm(prev => ({ ...prev, findings: tmpl.findings, impression: tmpl.impression, templateUsed: tmpl.name }))
    toast.success(`Template "${tmpl.name}" applied`)
  }

  // ── Print handlers ────────────────────────────────────────────────────────

  // Radiology receipt uses the SHARED printRadiologyReceipt so the Billing module
  // and the Radiology module render an IDENTICAL bill — same format as Laboratory
  // (see handlePrintLabInvoice in LaboratoryModule.jsx).
  const handlePrintInvoice = async (order, payInfo = {}) => {
    let clinic = {}
    try { clinic = JSON.parse(localStorage.getItem('gudmed-clinic-profile') || '{}') } catch { clinic = {} }
    const now = new Date()
    const exam = order.exam || exams.find(e => e.id === order.examId)
    const price = exam?.price || 0
    const items = [{
      code: exam?.examCode || 'EXAM',
      name: exam?.examName || 'Exam',
      price,
      eta: order.scheduledDate ? format(new Date(order.scheduledDate), 'dd-MM-yyyy HH:mm') : '',
    }]
    const orderValue = items.reduce((s, i) => s + i.price, 0)

    // Payments live on the auto-created Invoice (tagged with this order number in
    // its notes), not on the radiology order. Shared helper fetches that invoice's
    // payment ledger so the receipt's Payment table shows date/time, receipt & method.
    const { payments, amountPaid: invoicePaid, discountAmount: invoiceDisc } =
      await fetchOrderInvoicePayments({
        patientId: order.patientId || order.patient?.id,
        orderNumber: order.orderNumber,
      })

    const disc = payInfo.discount !== undefined ? Number(payInfo.discount) : (invoiceDisc || 0)
    const net = orderValue - disc
    const paid = payInfo.paid !== undefined ? Number(payInfo.paid)
      : (invoicePaid !== undefined ? invoicePaid : payments.reduce((s, p) => s + Number(p.amount || 0), 0))
    printRadiologyReceipt({
      invoiceNo: order.orderNumber,
      labId: order.orderNumber,
      patientName: order.patient ? `${order.patient.firstName} ${order.patient.lastName}` : '—',
      uhid: order.patient?.mrn,
      age: order.patient?.dateOfBirth ? `${differenceInYears(now, new Date(order.patient.dateOfBirth))} year(s)` : '',
      sex: order.patient?.gender ? order.patient.gender.charAt(0).toUpperCase() + order.patient.gender.slice(1) : '',
      contact: order.patient?.phonePrimary,
      dateTime: format(now, 'dd MMM yyyy, hh:mm aa'),
      refDoctor: 'self',
      mode: payInfo.mode,
      items, orderValue, homeCollection: 0, discount: disc, netPayable: net, paid, balance: net - paid,
      payments,
    }, orgInfo, clinic)
  }

  const handlePrintFullReport = (report, order) => {
    if (!report || !order) return
    const patientName = order.patient ? `${order.patient.firstName} ${order.patient.lastName}` : '—'
    const printDate = format(new Date(), 'dd MMM yyyy HH:mm')
    const reportedDate = report.reportedAt ? format(new Date(report.reportedAt), 'dd MMM yyyy HH:mm') : '—'
    const verifiedDate = report.verifiedAt ? format(new Date(report.verifiedAt), 'dd MMM yyyy HH:mm') : null
    const html = `<!DOCTYPE html><html><head><title>Radiology Report — ${order.orderNumber}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Times New Roman',Times,serif;font-size:11pt;color:#000}
.page{max-width:210mm;margin:0 auto;padding:14mm 14mm 10mm 14mm}
.hosp-header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px double #1e3a5f;padding-bottom:10px;margin-bottom:10px}
.hosp-name{font-size:20pt;font-weight:bold;color:#1e3a5f}
.banner{background:#1e3a5f;color:#fff;text-align:center;padding:5px 0;font-size:13pt;font-weight:bold;letter-spacing:3px;margin-bottom:10px}
.status-badge{display:inline-block;padding:2px 10px;border-radius:3px;font-size:9pt;font-weight:bold}
.status-final{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}
.status-draft{background:#fef9c3;color:#854d0e;border:1px solid #fde047}
.critical-banner{background:#fef2f2;border:2px solid #dc2626;padding:8px 12px;margin-bottom:10px;border-radius:3px}
.info-box{border:1px solid #333;margin-bottom:10px}
.info-box-hdr{background:#1e3a5f;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;text-transform:uppercase}
.info-box-hdr2{background:#4a7099;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold}
.info-grid{display:grid;grid-template-columns:repeat(4,1fr)}
.info-cell{padding:5px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.info-cell:last-child{border-right:none}
.info-label{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase}
.info-value{font-size:10pt;margin-top:1px}
.section{margin-bottom:12px}
.section-header{font-weight:bold;font-size:10pt;color:#1e3a5f;border-bottom:1.5px solid #1e3a5f;padding-bottom:2px;margin-bottom:5px;text-transform:uppercase}
.section-body{font-size:10.5pt;line-height:1.6;white-space:pre-wrap;padding-left:4px}
.impression-box{border:2px solid #1e3a5f;padding:12px;background:#f0f4f8;margin-bottom:12px}
.sig-section{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:18px;padding-top:10px;border-top:2px solid #000}
.sig-line{border-bottom:1px solid #000;height:42px;margin-bottom:5px}
.sig-label{font-size:9pt;color:#444;line-height:1.6}
.footer{margin-top:14px;border-top:1px solid #ccc;padding-top:5px;font-size:8pt;color:#888;text-align:center}
@media print{.page{padding:8mm}}
</style></head><body><div class="page">
<div class="hosp-header">
  <div><div class="hosp-name">${orgInfo.name}</div><div style="font-size:9pt;color:#555">Radiology &amp; Imaging Department</div></div>
  <div style="font-size:8.5pt;color:#555;text-align:right">Order #: <strong>${order.orderNumber}</strong><br/>Report Date: ${reportedDate}<br/>Print: ${printDate}</div>
</div>
<div class="banner">RADIOLOGY REPORT</div>
<div style="margin-bottom:8px">
  <span class="status-badge ${report.status === 'final' ? 'status-final' : 'status-draft'}">${(report.status || 'draft').toUpperCase()}</span>
  ${report.hasCriticalFindings ? '&nbsp;&nbsp;<span style="color:#dc2626;font-weight:bold">&#9888; CRITICAL VALUES PRESENT</span>' : ''}
</div>
${report.hasCriticalFindings ? `<div class="critical-banner"><div style="font-weight:bold;color:#dc2626">&#9888; CRITICAL FINDINGS — IMMEDIATE NOTIFICATION REQUIRED</div><div style="font-size:10.5pt;margin-top:4px">${report.criticalFindings || 'See findings section'}</div></div>` : ''}
<div class="info-box">
  <div class="info-box-hdr">Patient Information</div>
  <div class="info-grid">
    <div class="info-cell"><div class="info-label">Patient Name</div><div class="info-value"><strong>${patientName}</strong></div></div>
    <div class="info-cell"><div class="info-label">UHID</div><div class="info-value">${order.patient?.mrn || '—'}</div></div>
    <div class="info-cell"><div class="info-label">Urgency</div><div class="info-value" style="text-transform:uppercase">${order.urgency || 'routine'}</div></div>
    <div class="info-cell"><div class="info-label">Order Date</div><div class="info-value">${order.orderDate ? format(new Date(order.orderDate), 'dd MMM yyyy') : '—'}</div></div>
  </div>
  <div class="info-box-hdr2">Study Details</div>
  <div class="info-grid">
    <div class="info-cell"><div class="info-label">Exam</div><div class="info-value"><strong>${order.exam?.examName || '—'}</strong></div></div>
    <div class="info-cell"><div class="info-label">Category</div><div class="info-value" style="text-transform:uppercase">${order.exam?.examCategory || '—'}</div></div>
    <div class="info-cell"><div class="info-label">Reported By</div><div class="info-value">Dr. Radiologist</div></div>
    <div class="info-cell"><div class="info-label">Verified By</div><div class="info-value">${verifiedDate ? 'Dr. Verifier' : '—'}</div></div>
  </div>
</div>
${order.clinicalIndication ? `<div class="section"><div class="section-header">Clinical Indication</div><div class="section-body">${order.clinicalIndication}</div></div>` : ''}
${report.technique ? `<div class="section"><div class="section-header">Technique</div><div class="section-body">${report.technique}</div></div>` : ''}
${report.comparedWithPrevious ? `<div class="section"><div class="section-header">Comparison</div><div class="section-body">Compared with previous study. ${report.comparisonNotes || ''}</div></div>` : ''}
<div class="section"><div class="section-header">Findings</div><div class="section-body">${report.findings || '—'}</div></div>
<div class="impression-box">
  <div style="font-weight:bold;font-size:11pt;color:#1e3a5f;text-transform:uppercase;margin-bottom:6px">Impression</div>
  <div style="font-size:11pt;line-height:1.7">${report.impression || '—'}</div>
</div>
${report.recommendations ? `<div style="border-left:4px solid #1e3a5f;padding:8px 12px;background:#f8fafc;margin-bottom:12px"><strong style="color:#1e3a5f">Recommendations:</strong><div style="margin-top:4px">${report.recommendations}</div></div>` : ''}
<div class="sig-section">
  <div><div class="sig-line"></div><div class="sig-label"><strong>Reported By:</strong> Dr. Radiologist<br/>Date &amp; Time: ${reportedDate}</div></div>
  <div><div class="sig-line"></div><div class="sig-label"><strong>Verified By:</strong> ${verifiedDate ? 'Dr. Verifier' : '—'}<br/>Date &amp; Time: ${verifiedDate || 'Not yet verified'}</div></div>
</div>
<div class="footer">${orgInfo.name} — Radiology &amp; Imaging Department &nbsp;|&nbsp; Confidential — for requesting physician only &nbsp;|&nbsp; Printed: ${printDate}</div>
</div></body></html>`
    printViaPopup(html)
  }

  const openReportNotes = (order) => {
    setReportNotesOrder(order)
    setReportNotes('')
    setReportAccession('')
    setReportRadiologist('')
    setShowReportNotesDialog(true)
  }

  const handlePrintReportSheet = () => {
    if (!reportNotesOrder) return
    const order = reportNotesOrder
    const patientName = order.patient ? `${order.patient.firstName} ${order.patient.lastName}` : '—'
    const printDate = format(new Date(), 'dd MMM yyyy HH:mm')
    const orderDate = order.orderDate ? format(new Date(order.orderDate), 'dd MMM yyyy HH:mm') : '—'
    const html = `<!DOCTYPE html><html><head><title>Radiology Report — ${order.orderNumber}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Times New Roman',Times,serif;font-size:11pt;padding:30px}
.hosp-header{display:flex;justify-content:space-between;border-bottom:3px double #1e3a5f;padding-bottom:10px;margin-bottom:10px}
.hosp-name{font-size:20pt;font-weight:bold;color:#1e3a5f}
.banner{background:#1e3a5f;color:#fff;text-align:center;padding:5px 0;font-size:13pt;font-weight:bold;letter-spacing:3px;margin-bottom:10px}
.info-box{border:1px solid #333;margin-bottom:10px}
.info-box-hdr{background:#1e3a5f;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;text-transform:uppercase}
.info-grid{display:grid;grid-template-columns:repeat(4,1fr)}
.info-cell{padding:5px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.info-cell:last-child{border-right:none}
.info-label{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase}
.info-value{font-size:10pt;margin-top:1px}
.section{margin-bottom:12px}
.section-header{font-weight:bold;font-size:10pt;color:#1e3a5f;border-bottom:1.5px solid #1e3a5f;padding-bottom:2px;margin-bottom:5px;text-transform:uppercase}
.section-body{font-size:10.5pt;line-height:1.6;white-space:pre-wrap;padding:4px;min-height:70px}
.blank-line{border-bottom:1px solid #aaa;height:24px;margin-bottom:8px}
.impression-box{border:2px solid #1e3a5f;padding:12px;background:#f0f4f8;margin-bottom:12px;min-height:70px}
.sig-section{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:24px;border-top:2px solid #000;padding-top:10px}
.sig-line{border-bottom:1px solid #000;height:42px;margin-bottom:5px}
.sig-label{font-size:9pt;color:#444}
.footer{margin-top:14px;border-top:1px solid #ccc;padding-top:5px;font-size:8pt;color:#888;text-align:center}
@media print{body{padding:10px}}
</style></head><body>
<div class="hosp-header">
  <div><div class="hosp-name">${orgInfo.name}</div><div style="font-size:9pt;color:#555">Radiology &amp; Imaging Department</div></div>
  <div style="font-size:8.5pt;color:#555;text-align:right">Order #: <strong>${order.orderNumber}</strong><br/>Accession: ${reportAccession || '—'}<br/>Date: ${orderDate}<br/>Print: ${printDate}</div>
</div>
<div class="banner">RADIOLOGY REPORT</div>
<div class="info-box">
  <div class="info-box-hdr">Patient &amp; Study Information</div>
  <div class="info-grid">
    <div class="info-cell"><div class="info-label">Patient Name</div><div class="info-value"><strong>${patientName}</strong></div></div>
    <div class="info-cell"><div class="info-label">UHID</div><div class="info-value">${order.patient?.mrn || '—'}</div></div>
    <div class="info-cell"><div class="info-label">Exam</div><div class="info-value">${order.exam?.examName || '—'}</div></div>
    <div class="info-cell"><div class="info-label">Radiologist</div><div class="info-value">${reportRadiologist || '—'}</div></div>
  </div>
</div>
${order.clinicalIndication ? `<div class="section"><div class="section-header">Clinical Indication</div><div class="section-body">${order.clinicalIndication}</div></div>` : ''}
<div class="section">
  <div class="section-header">Findings</div>
  <div class="section-body">${reportNotes || ''}</div>
  ${!reportNotes ? '<div class="blank-line"></div><div class="blank-line"></div><div class="blank-line"></div>' : ''}
</div>
<div class="impression-box">
  <div style="font-weight:bold;font-size:11pt;color:#1e3a5f;text-transform:uppercase;margin-bottom:6px">Impression</div>
  ${!reportNotes ? '<div class="blank-line"></div><div class="blank-line"></div>' : ''}
</div>
<div class="sig-section">
  <div><div class="sig-line"></div><div class="sig-label"><strong>Radiologist:</strong> ${reportRadiologist || '—'}<br/>Date &amp; Time: ___________________________</div></div>
  <div><div class="sig-line"></div><div class="sig-label"><strong>Verified By:</strong> ___________________________<br/>Date &amp; Time: ___________________________</div></div>
</div>
<div class="footer">${orgInfo.name} — Radiology &amp; Imaging &nbsp;|&nbsp; Confidential — for requesting physician only &nbsp;|&nbsp; Printed: ${printDate}</div>
</body></html>`
    printViaPopup(html)
    setShowReportNotesDialog(false)
  }

  // ── Filtered data ─────────────────────────────────────────────────────────

  const filteredOrders = orders.filter(o => {
    const q = searchQuery.toLowerCase()
    const patName = `${o.patient?.firstName || ''} ${o.patient?.lastName || ''}`.toLowerCase()
    const matchSearch = !q || patName.includes(q) || (o.patient?.mrn || '').toLowerCase().includes(q) || (o.orderNumber || '').toLowerCase().includes(q)
    const matchStatus = statusFilter === 'all' || o.status === statusFilter
    const matchModality = modalityFilter === 'all' || o.exam?.examCategory === modalityFilter
    let matchDate = true
    if (dateFilter === 'today') matchDate = o.orderDate && new Date(o.orderDate).toDateString() === new Date().toDateString()
    else if (dateFilter === 'week') { const w = new Date(); w.setDate(w.getDate() - 7); matchDate = o.orderDate && new Date(o.orderDate) >= w }
    return matchSearch && matchStatus && matchModality && matchDate
  })

  const filteredExams = exams.filter(e => {
    const q = searchQuery.toLowerCase()
    const matchSearch = !q || (e.examName || '').toLowerCase().includes(q) || (e.examCode || '').toLowerCase().includes(q) || (e.bodyPart || '').toLowerCase().includes(q)
    const matchCat = categoryFilter === 'all' || e.examCategory === categoryFilter
    return matchSearch && matchCat
  })

  const reportedCount = orders.filter(o => o.status === 'reported').length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Scan className="h-6 w-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold">Radiology &amp; Imaging</h1>
            <p className="text-sm text-gray-500">Imaging orders, exam catalog and reports</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchAll}>
            <RefreshCw className="h-4 w-4 mr-1" />Refresh
          </Button>
          <Button onClick={() => setShowOrderDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />New Order
          </Button>
            <Button variant="outline" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4 mr-1" />Import Excel/CSV
            </Button>
                        <Button onClick={() => { setEditingExamId(null); setExamForm(emptyExam); setShowExamDialog(true) }}>
              <Plus className="h-4 w-4 mr-1" />Add test
            </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Pending', value: stats.pending || orders.filter(o => o.status === 'pending').length, color: 'text-yellow-600', bg: 'bg-yellow-50' },
          { label: 'In Progress', value: stats.inProgress || orders.filter(o => o.status === 'in_progress').length, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Reported', value: reportedCount, color: 'text-teal-600', bg: 'bg-teal-50' },
          { label: 'Critical Findings', value: stats.criticalFindings || 0, color: 'text-red-600', bg: 'bg-red-50' },
        ].map(s => (
          <Card key={s.label} className={s.bg}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-gray-500 uppercase font-medium tracking-wide">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs - full width underline style */}
      <div className="border-b mb-4">
        <div className="flex">
          {[
            { value: 'dashboard', label: 'Dashboard' },
            { value: 'worklist', label: 'Worklist' },
            { value: 'orders', label: 'Orders' },
            { value: 'exams', label: 'Exam Catalog' },
            { value: 'reports', label: 'Reports' },
          ].map(tab => (
            <button key={tab.value} onClick={() => setActiveTab(tab.value)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.value ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Worklist ── */}
      {activeTab === 'worklist' && <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input className="pl-9" placeholder="Search patient, order #..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <Select value={modalityFilter} onValueChange={setModalityFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Modality" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modality</SelectItem>
                {EXAM_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {['pending', 'scheduled', 'in_progress', 'completed', 'reported', 'cancelled'].map(s =>
                  <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Date" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Exam</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
                ) : filteredOrders.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">No orders found</TableCell></TableRow>
                ) : orders.map(o => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-sm">{o.orderNumber}</TableCell>
                    <TableCell>
                      <div className="font-medium">{o.patient?.firstName} {o.patient?.lastName}</div>
                      <div className="text-xs text-gray-500">{o.patient?.mrn}</div>
                    </TableCell>
                    <TableCell>
                      <div>{o.exam?.examName || '—'}</div>
                      {o.exam?.examCategory && <div className="mt-0.5">{categoryBadge(o.exam.examCategory)}</div>}
                    </TableCell>
                    <TableCell>{urgencyBadge(o.urgency)}</TableCell>
                    <TableCell className="text-sm">{o.orderDate ? format(new Date(o.orderDate), 'dd MMM yyyy') : '—'}</TableCell>
                    <TableCell>{statusBadge(o.status)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" title="View" onClick={() => { setViewOrder(o); setShowViewOrder(true) }}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {o.status === 'pending' && <>
                          <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(o.id, 'in_progress')}>Start</Button>
                          <Button size="sm" variant="ghost" title="Edit" onClick={() => { setEditingOrder(o); setEditOrderForm({ urgency: o.urgency || 'routine', clinicalIndication: o.clinicalIndication || '', notes: o.notes || '' }); setShowEditOrderDialog(true) }}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-500" title="Cancel" onClick={() => { setCancellingOrder(o); setShowCancelDialog(true) }}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </>}
                        {o.status === 'in_progress' && (
                          <Button size="sm" variant="outline" onClick={() => handleUpdateStatus(o.id, 'completed')}>Complete</Button>
                        )}
                        {(o.status === 'completed' || o.status === 'in_progress') && !o.report && (
                          <Button size="sm" onClick={() => { setSelectedOrder(o); setReportForm(emptyReport); setReportImages([]); setShowReportDialog(true) }}>
                            <FileText className="h-4 w-4 mr-1" />Report
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" title="Print Invoice" onClick={() => handlePrintInvoice(o)}>
                          <Printer className="h-4 w-4" />
                        </Button>
                        {(o.status === 'reported' || o.status === 'completed') && (
                          <Button size="sm" variant="ghost" title="Print Report Sheet" onClick={() => openReportNotes(o)}>
                            <FileText className="h-4 w-4 text-blue-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>

          {ordersMeta.total > RADIOLOGY_ITEMS_PER_PAGE && (
            <div className="border-t pt-4 flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>
                <ChevronLeft className="h-4 w-4 mr-1" />Previous
              </Button>
              <span className="text-sm text-gray-500">Page {ordersPage} of {Math.ceil(ordersMeta.total / RADIOLOGY_ITEMS_PER_PAGE)}</span>
              <Button variant="outline" size="sm" onClick={() => setOrdersPage(p => p + 1)} disabled={!ordersMeta.hasMore}>
                Next<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>}

      {/* ── Exam Catalog ── */}
      {activeTab === 'exams' && <div className="space-y-4">
          <div className="flex gap-3 justify-between">
            <div className="flex gap-3 flex-1">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input className="pl-9" placeholder="Search exams..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-44"><SelectValue placeholder="All Categories" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {EXAM_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => { setEditingExamId(null); setExamForm(emptyExam); setShowExamDialog(true) }}>
              <Plus className="h-4 w-4 mr-1" />Add Test
            </Button>
          </div>

          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Exam Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Body Part</TableHead>
                  <TableHead>Price (₹)</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Contrast</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExams.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">No exams in catalog</TableCell></TableRow>
                ) : exams.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-sm">{e.examCode || '—'}</TableCell>
                    <TableCell className="font-medium">{e.examName}</TableCell>
                    <TableCell>{categoryBadge(e.examCategory)}</TableCell>
                    <TableCell>{e.bodyPart || '—'}</TableCell>
                    <TableCell>₹{(e.price || 0).toLocaleString()}</TableCell>
                    <TableCell>{e.estimatedDuration || '—'} min</TableCell>
                    <TableCell>
                      {e.contrastRequired
                        ? <Badge className="bg-orange-100 text-orange-800">Required</Badge>
                        : <span className="text-gray-400 text-sm">None</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => {
                          setExamForm({
                            examName: e.examName, examCode: e.examCode || '', examCategory: e.examCategory || 'x-ray',
                            bodyPart: e.bodyPart || '', modality: e.modality || 'DR', price: e.price || 0,
                            estimatedDuration: e.estimatedDuration || 30, preparationInstructions: e.preparationInstructions || '',
                            contrastRequired: e.contrastRequired || false, isActive: e.isActive !== false,
                          })
                          setEditingExamId(e.id)
                          setShowExamDialog(true)
                        }}><Edit className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDeleteExamConfirm(e)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>

          {examsMeta.total > RADIOLOGY_ITEMS_PER_PAGE && (
            <div className="border-t pt-4 flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setExamsPage(p => Math.max(1, p - 1))} disabled={examsPage === 1}>
                <ChevronLeft className="h-4 w-4 mr-1" />Previous
              </Button>
              <span className="text-sm text-gray-500">Page {examsPage} of {Math.ceil(examsMeta.total / RADIOLOGY_ITEMS_PER_PAGE)}</span>
              <Button variant="outline" size="sm" onClick={() => setExamsPage(p => p + 1)} disabled={!examsMeta.hasMore}>
                Next<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>}

      {/* ── Reports ── */}
      {activeTab === 'reports' && <div className="space-y-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Exam</TableHead>
                  <TableHead>Reported At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Critical</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">No reports yet</TableCell></TableRow>
                ) : reports.map(r => {
                  const ord = r.order || orders.find(o => o.id === r.orderId)
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{ord?.orderNumber || '—'}</TableCell>
                      <TableCell>{ord?.patient ? `${ord.patient.firstName} ${ord.patient.lastName}` : '—'}</TableCell>
                      <TableCell>{ord?.exam?.examName || '—'}</TableCell>
                      <TableCell className="text-sm">{r.reportedAt ? format(new Date(r.reportedAt), 'dd MMM yyyy HH:mm') : '—'}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell>
                        {r.hasCriticalFindings
                          ? <Badge className="bg-red-100 text-red-800"><AlertTriangle className="h-3 w-3 mr-1 inline" />Critical</Badge>
                          : <span className="text-gray-400 text-sm">None</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {r.status !== 'final' && (
                            <Button size="sm" variant="outline" className="text-green-600" onClick={() => handleVerifyReport(r.id)}>
                              <CheckCircle className="h-4 w-4 mr-1" />Verify
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" title="Print Report" onClick={() => handlePrintFullReport(r, ord)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent></Card>

          {reportsMeta.total > RADIOLOGY_ITEMS_PER_PAGE && (
            <div className="border-t pt-4 flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setReportsPage(p => Math.max(1, p - 1))} disabled={reportsPage === 1}>
                <ChevronLeft className="h-4 w-4 mr-1" />Previous
              </Button>
              <span className="text-sm text-gray-500">Page {reportsPage} of {Math.ceil(reportsMeta.total / RADIOLOGY_ITEMS_PER_PAGE)}</span>
              <Button variant="outline" size="sm" onClick={() => setReportsPage(p => p + 1)} disabled={!reportsMeta.hasMore}>
                Next<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>}

      {/* ── Orders Tab ── */}
      {activeTab === 'orders' && <div className="space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input className="pl-9" placeholder="Search orders..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {['pending','scheduled','in_progress','completed','reported','cancelled'].map(s => <SelectItem key={s} value={s}>{s.replace('_',' ')}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Order #</TableHead><TableHead>Patient</TableHead>
              <TableHead>Exam</TableHead><TableHead>Urgency</TableHead>
              <TableHead>Scheduled</TableHead><TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">No orders found</TableCell></TableRow>
              ) : orders.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.orderNumber}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{o.patient?.firstName} {o.patient?.lastName}</div>
                    <div className="text-xs text-gray-500">{o.patient?.mrn}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{o.exam?.examName}</div>
                    <div className="text-xs text-gray-500">{o.exam?.examCategory?.toUpperCase()}</div>
                  </TableCell>
                  <TableCell>{urgencyBadge(o.urgency)}</TableCell>
                  <TableCell className="text-sm">{o.scheduledDate ? format(new Date(o.scheduledDate),'dd MMM yyyy') : '—'}</TableCell>
                  <TableCell>{statusBadge(o.status)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setViewOrder(o); setShowViewOrder(true) }}><Eye className="h-4 w-4" /></Button>
                      {o.status === 'completed' && !reports.find(r => r.orderId === o.id) && (
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => { setSelectedOrder(o); setReportForm(emptyReport); setShowReportDialog(true) }}>
                          <FileText className="h-3.5 w-3.5 mr-1" />Report
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>

        {ordersMeta.total > RADIOLOGY_ITEMS_PER_PAGE && (
          <div className="border-t pt-4 flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>
              <ChevronLeft className="h-4 w-4 mr-1" />Previous
            </Button>
            <span className="text-sm text-gray-500">Page {ordersPage} of {Math.ceil(ordersMeta.total / RADIOLOGY_ITEMS_PER_PAGE)}</span>
            <Button variant="outline" size="sm" onClick={() => setOrdersPage(p => p + 1)} disabled={!ordersMeta.hasMore}>
              Next<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>}

      {/* ── Dashboard Tab ── */}
      {activeTab === 'dashboard' && <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-gray-500 mb-1">Total Orders</p>
              <p className="text-3xl font-bold text-blue-600">{orders.length}</p>
              <p className="text-xs text-gray-400 mt-1">{orders.filter(o => o.status === 'pending').length} pending</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-gray-500 mb-1">Reports Generated</p>
              <p className="text-3xl font-bold text-teal-600">{reports.length}</p>
              <p className="text-xs text-gray-400 mt-1">{reports.filter(r => r.status === 'final').length} finalized</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-gray-500 mb-1">Exam Catalog</p>
              <p className="text-3xl font-bold text-purple-600">{stats.totalExams || 0}</p>
              <p className="text-xs text-gray-400 mt-1">{stats.totalExams || 0} active</p>
            </CardContent>
          </Card>
        </div>

        {/* Orders by modality */}
        <Card>
          <CardHeader><CardTitle className="text-base">Orders by Modality</CardTitle></CardHeader>
          <CardContent>
            {['x-ray','ct','mri','ultrasound','mammography'].map(cat => {
              const count = orders.filter(o => o.exam?.examCategory === cat).length
              const pct = orders.length > 0 ? Math.round((count / orders.length) * 100) : 0
              return (
                <div key={cat} className="flex items-center gap-3 mb-3">
                  <span className="text-xs font-medium w-20 uppercase text-gray-600">{cat}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-10 text-right">{count}</span>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Orders by status */}
        <Card>
          <CardHeader><CardTitle className="text-base">Order Status Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Pending', status: 'pending', color: 'bg-yellow-100 text-yellow-800' },
                { label: 'In Progress', status: 'in_progress', color: 'bg-orange-100 text-orange-800' },
                { label: 'Completed', status: 'completed', color: 'bg-green-100 text-green-800' },
                { label: 'Reported', status: 'reported', color: 'bg-teal-100 text-teal-800' },
                { label: 'Scheduled', status: 'scheduled', color: 'bg-blue-100 text-blue-800' },
                { label: 'Cancelled', status: 'cancelled', color: 'bg-red-100 text-red-800' },
              ].map(({ label, status, color }) => (
                <div key={status} className={`rounded-lg p-4 text-center ${color}`}>
                  <p className="text-2xl font-bold">{orders.filter(o => o.status === status).length}</p>
                  <p className="text-xs font-medium mt-1">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent reports */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Reports</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Patient</TableHead><TableHead>Exam</TableHead>
                <TableHead>Reported</TableHead><TableHead>Status</TableHead>
                <TableHead>Critical</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {reports.slice(0, 5).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-gray-400">No reports yet</TableCell></TableRow>
                ) : reports.slice(0, 5).map(r => {
                  const order = orders.find(o => o.id === r.orderId)
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{order?.patient?.firstName} {order?.patient?.lastName}</TableCell>
                      <TableCell className="text-sm">{order?.exam?.examName || '—'}</TableCell>
                      <TableCell className="text-sm">{r.reportedAt ? format(new Date(r.reportedAt), 'dd MMM yyyy') : '—'}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell>{r.hasCriticalFindings ? <Badge className="bg-red-100 text-red-800 text-xs">Critical</Badge> : <span className="text-xs text-gray-400">None</span>}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>}

      {/* ── New Order Dialog ── */}
      <Dialog open={showOrderDialog} onOpenChange={setShowOrderDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Radiology Order</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Patient *</Label>
              <PatientLookup
                className="mt-1"
                showHint={false}
                selectedPatient={patients.find(p => p.id === orderForm.patientId) || null}
                onSelect={(p) => { setPatients(prev => prev.some(x => x.id === p.id) ? prev : [p, ...prev]); setOrderForm(f => ({ ...f, patientId: p.id })) }}
                onClear={() => setOrderForm(f => ({ ...f, patientId: '' }))}
              />
            </div>
            <div>
              <Label>Exam *</Label>
              <Select value={orderForm.examId} onValueChange={v => setOrderForm(p => ({ ...p, examId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select exam" /></SelectTrigger>
                <SelectContent>{exams.map(e => <SelectItem key={e.id} value={e.id}>{e.examName} — ₹{e.price || 0}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Clinical Indication *</Label>
              <Textarea value={orderForm.clinicalIndication} onChange={e => setOrderForm(p => ({ ...p, clinicalIndication: e.target.value }))} placeholder="Reason for exam..." rows={3} />
            </div>
            <div>
              <Label>Provisional Diagnosis</Label>
              <Input value={orderForm.provisionalDiagnosis} onChange={e => setOrderForm(p => ({ ...p, provisionalDiagnosis: e.target.value }))} />
            </div>
            <div>
              <Label>Relevant History</Label>
              <Textarea value={orderForm.relevantHistory} onChange={e => setOrderForm(p => ({ ...p, relevantHistory: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Urgency *</Label>
                <Select value={orderForm.urgency} onValueChange={v => setOrderForm(p => ({ ...p, urgency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{URGENCY_LEVELS.map(u => <SelectItem key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Scheduled Date</Label>
                <Input type="date" value={orderForm.scheduledDate} onChange={e => setOrderForm(p => ({ ...p, scheduledDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={orderForm.notes} onChange={e => setOrderForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>

            <PaymentFields
              amount={orderForm.amountPaid}
              method={orderForm.paymentMethod}
              onAmountChange={(v) => setOrderForm(p => ({ ...p, amountPaid: v }))}
              onMethodChange={(v) => setOrderForm(p => ({ ...p, paymentMethod: v }))}
              charge={exams.find(e => e.id === orderForm.examId)?.price || 0}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOrderDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveOrder} disabled={savingOrder}>{savingOrder ? 'Creating...' : 'Create Order'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Order Dialog ── */}
      <Dialog open={showEditOrderDialog} onOpenChange={setShowEditOrderDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Order</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Urgency</Label>
              <Select value={editOrderForm.urgency} onValueChange={v => setEditOrderForm(p => ({ ...p, urgency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{URGENCY_LEVELS.map(u => <SelectItem key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Clinical Indication *</Label>
              <Textarea value={editOrderForm.clinicalIndication} onChange={e => setEditOrderForm(p => ({ ...p, clinicalIndication: e.target.value }))} rows={3} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={editOrderForm.notes} onChange={e => setEditOrderForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditOrderDialog(false)}>Cancel</Button>
            <Button onClick={handleEditOrderSubmit} disabled={savingEditOrder}>{savingEditOrder ? 'Saving...' : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel Order Dialog ── */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Cancel Order?</DialogTitle></DialogHeader>
          <p className="text-gray-600 text-sm">Cancel order <strong className="font-mono">{cancellingOrder?.orderNumber}</strong>?</p>
          <div>
            <Label>Reason (optional)</Label>
            <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} placeholder="Reason for cancellation..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>Keep Order</Button>
            <Button variant="destructive" onClick={handleCancelOrder}>Cancel Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Report Dialog ── */}
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Write Radiology Report{selectedOrder ? ` — ${selectedOrder.orderNumber}` : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Apply Template</Label>
              <Select onValueChange={applyTemplate}>
                <SelectTrigger><SelectValue placeholder="Select a template (optional)..." /></SelectTrigger>
                <SelectContent>{REPORT_TEMPLATES.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Technique</Label>
              <Textarea value={reportForm.technique} onChange={e => setReportForm(p => ({ ...p, technique: e.target.value }))} placeholder="Describe technical parameters of the study..." rows={2} />
            </div>
            <div>
              <Label>Findings *</Label>
              <Textarea value={reportForm.findings} onChange={e => setReportForm(p => ({ ...p, findings: e.target.value }))} placeholder="Detailed imaging findings..." rows={6} />
            </div>
            <div>
              <Label>Impression *</Label>
              <Textarea value={reportForm.impression} onChange={e => setReportForm(p => ({ ...p, impression: e.target.value }))} placeholder="Radiologist's conclusion..." rows={3} />
            </div>
            <div>
              <Label>Recommendations</Label>
              <Textarea value={reportForm.recommendations} onChange={e => setReportForm(p => ({ ...p, recommendations: e.target.value }))} rows={2} />
            </div>
            <div>
              <Label>DICOM Study UID</Label>
              <Input value={reportForm.dicomStudyUid} onChange={e => setReportForm(p => ({ ...p, dicomStudyUid: e.target.value }))} placeholder="1.2.840..." />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="compared" checked={reportForm.comparedWithPrevious} onChange={e => setReportForm(p => ({ ...p, comparedWithPrevious: e.target.checked }))} className="h-4 w-4" />
              <Label htmlFor="compared">Compared with previous study</Label>
            </div>
            {reportForm.comparedWithPrevious && (
              <div>
                <Label>Comparison Notes</Label>
                <Textarea value={reportForm.comparisonNotes} onChange={e => setReportForm(p => ({ ...p, comparisonNotes: e.target.value }))} rows={2} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <input type="checkbox" id="critical" checked={reportForm.hasCriticalFindings} onChange={e => setReportForm(p => ({ ...p, hasCriticalFindings: e.target.checked }))} className="h-4 w-4" />
              <Label htmlFor="critical" className="text-red-600 font-medium">Critical Findings</Label>
            </div>
            {reportForm.hasCriticalFindings && (
              <div>
                <Label>Critical Finding Details</Label>
                <Textarea value={reportForm.criticalFindings} onChange={e => setReportForm(p => ({ ...p, criticalFindings: e.target.value }))} rows={3} className="border-red-300" placeholder="Describe critical findings requiring immediate attention..." />
              </div>
            )}
            <div>
              <Label>Attach Images</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button type="button" variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" />Upload Images
                </Button>
                <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                {reportImages.length > 0 && <span className="text-sm text-gray-500">{reportImages.length} image(s) attached</span>}
              </div>
              {reportImages.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {reportImages.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img.url} alt={img.name} className="h-16 w-16 object-cover rounded border" />
                      <button className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white rounded-full hidden group-hover:flex items-center justify-center text-xs" onClick={() => setReportImages(prev => prev.filter((_, j) => j !== i))}>
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReportDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveReport} disabled={savingReport}>{savingReport ? 'Saving...' : 'Save Report (Draft)'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Report Notes / Quick Print Dialog ── */}
      <Dialog open={showReportNotesDialog} onOpenChange={setShowReportNotesDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Print Report — {reportNotesOrder?.orderNumber}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Accession / Reference No.</Label>
              <Input value={reportAccession} onChange={e => setReportAccession(e.target.value)} placeholder="e.g. ACC-2025-001" />
            </div>
            <div>
              <Label>Radiologist Name</Label>
              <Input value={reportRadiologist} onChange={e => setReportRadiologist(e.target.value)} placeholder="Dr. ..." />
            </div>
            <div>
              <Label>Findings (optional — leave blank for manual completion)</Label>
              <Textarea value={reportNotes} onChange={e => setReportNotes(e.target.value)} rows={4} placeholder="Preliminary findings..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReportNotesDialog(false)}>Cancel</Button>
            <Button onClick={handlePrintReportSheet}><Printer className="h-4 w-4 mr-1" />Print Report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Order Dialog ── */}
      <Dialog open={showViewOrder} onOpenChange={setShowViewOrder}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Order Details</DialogTitle></DialogHeader>
          {viewOrder && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Order #: </span><span className="font-mono font-medium">{viewOrder.orderNumber}</span></div>
                <div><span className="text-gray-500">Date: </span><span>{viewOrder.orderDate ? format(new Date(viewOrder.orderDate), 'dd MMM yyyy') : '—'}</span></div>
                <div><span className="text-gray-500">Patient: </span><span className="font-medium">{viewOrder.patient?.firstName} {viewOrder.patient?.lastName}</span></div>
                <div><span className="text-gray-500">UHID: </span><span className="font-mono">{viewOrder.patient?.mrn}</span></div>
                <div><span className="text-gray-500">Exam: </span><span>{viewOrder.exam?.examName || '—'}</span></div>
                <div><span className="text-gray-500">Category: </span>{categoryBadge(viewOrder.exam?.examCategory)}</div>
                <div><span className="text-gray-500">Urgency: </span>{urgencyBadge(viewOrder.urgency)}</div>
                <div><span className="text-gray-500">Status: </span>{statusBadge(viewOrder.status)}</div>
              </div>
              {viewOrder.clinicalIndication && <div><p className="text-gray-500 mb-1">Clinical Indication:</p><p className="bg-gray-50 p-2 rounded">{viewOrder.clinicalIndication}</p></div>}
              {viewOrder.provisionalDiagnosis && <div><p className="text-gray-500 mb-1">Provisional Diagnosis:</p><p className="bg-gray-50 p-2 rounded">{viewOrder.provisionalDiagnosis}</p></div>}
              {viewOrder.notes && <div><p className="text-gray-500 mb-1">Notes:</p><p className="bg-gray-50 p-2 rounded">{viewOrder.notes}</p></div>}
              {viewOrder.report && (
                <div className="border rounded-lg p-3 space-y-2 bg-blue-50">
                  <p className="font-medium text-blue-800 flex items-center gap-1"><FileText className="h-4 w-4" />Report {statusBadge(viewOrder.report.status)}</p>
                  {viewOrder.report.findings && <div><p className="text-gray-500 text-xs">Findings:</p><p>{viewOrder.report.findings}</p></div>}
                  {viewOrder.report.impression && <div><p className="text-gray-500 text-xs">Impression:</p><p className="font-medium">{viewOrder.report.impression}</p></div>}
                  {viewOrder.report.hasCriticalFindings && <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1 inline" />Critical Findings</Badge>}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {viewOrder && <Button variant="outline" onClick={() => handlePrintInvoice(viewOrder)}><Printer className="h-4 w-4 mr-1" />Print Invoice</Button>}
            <Button variant="outline" onClick={() => setShowViewOrder(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={fetchAll}
        title="Import Radiology Exams from Excel / CSV"
        description="Upload your radiology exam list — each row becomes an exam in the catalog. No manual typing per exam."
        endpoint="/radiology/import"
        itemNoun="exams"
        templateFileName="radiology-exams-template.xlsx"
        templateColumns={["Exam Name", "Code", "Category", "Body Part", "Modality", "Price", "Duration (min)", "Contrast", "Preparation", "Description"]}
        sampleRows={[
          { "Exam Name": "Chest X-Ray PA View", Code: "CXR-PA", Category: "x-ray", "Body Part": "chest", Modality: "CR", Price: 400, "Duration (min)": 10, Contrast: "No", Preparation: "Remove metal objects", Description: "Routine chest radiograph" },
          { "Exam Name": "MRI Brain", Code: "MRI-BR", Category: "mri", "Body Part": "brain", Modality: "MRI", Price: 5000, "Duration (min)": 30, Contrast: "Yes", Preparation: "No metal implants", Description: "Brain MRI with contrast" },
        ]}
      />

      {/* ── Add/Edit Exam Dialog ── */}
      <Dialog open={showExamDialog} onOpenChange={setShowExamDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingExamId ? 'Edit Exam' : 'Add Exam to Catalog'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Exam Name *</Label>
                <Input value={examForm.examName} onChange={e => setExamForm(p => ({ ...p, examName: e.target.value }))} />
              </div>
              <div>
                <Label>Exam Code *</Label>
                <Input value={examForm.examCode} onChange={e => setExamForm(p => ({ ...p, examCode: e.target.value }))} placeholder="e.g. CXR01" />
              </div>
              <div>
                <Label>Category *</Label>
                <Select value={examForm.examCategory} onValueChange={v => setExamForm(p => ({ ...p, examCategory: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EXAM_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Body Part *</Label>
                <Input value={examForm.bodyPart} onChange={e => setExamForm(p => ({ ...p, bodyPart: e.target.value }))} placeholder="e.g. Chest" />
              </div>
              <div>
                <Label>Modality</Label>
                <Input value={examForm.modality} onChange={e => setExamForm(p => ({ ...p, modality: e.target.value }))} placeholder="e.g. CR, CT, MRI, US" />
              </div>
              <div>
                <Label>Price (₹)</Label>
                <Input type="number" min={0} step="0.01" value={examForm.price} onChange={e => setExamForm(p => ({ ...p, price: e.target.value }))} />
              </div>
              <div>
                <Label>Duration (min)</Label>
                <Input type="number" min={1} value={examForm.estimatedDuration} onChange={e => setExamForm(p => ({ ...p, estimatedDuration: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Preparation Instructions</Label>
              <Textarea value={examForm.preparationInstructions} onChange={e => setExamForm(p => ({ ...p, preparationInstructions: e.target.value }))} rows={2} placeholder="Any preparation required before the exam..." />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="contrast" checked={examForm.contrastRequired} onChange={e => setExamForm(p => ({ ...p, contrastRequired: e.target.checked }))} className="h-4 w-4" />
              <Label htmlFor="contrast">Contrast Agent Required</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExamDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveExam} disabled={savingExam}>{savingExam ? 'Saving...' : (editingExamId ? 'Update Exam' : 'Add Exam')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Exam Confirm ── */}
      <Dialog open={!!deleteExamConfirm} onOpenChange={() => setDeleteExamConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remove Exam?</DialogTitle></DialogHeader>
          <p className="text-gray-600">Remove <strong>{deleteExamConfirm?.examName}</strong> from the catalog? It will be marked inactive.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteExamConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleDeleteExam(deleteExamConfirm)}>Remove Exam</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
