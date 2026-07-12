import { useState, useEffect, useCallback } from 'react'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { sendLabResultNotification } from '@/lib/whatsapp'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  FlaskConical, Plus, Eye, Edit, Trash2, Calendar, Clock, User, FileText,
  AlertTriangle, CheckCircle, XCircle, Filter, Search, Printer, Send,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Save, AlertCircle, Activity, TestTube,
  X, RefreshCw, Microscope, Beaker, Droplet, ClipboardList, FileBarChart,
  ArrowUpDown, ArrowUp, ArrowDown, Ban, Play, Pause, CheckSquare, Loader2, Receipt, Upload
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import BulkImportDialog from '@/components/common/BulkImportDialog'
import { Progress } from '@/components/ui/progress'
import client from '@/api/client'
import { useServerPagination } from '@/lib/useServerPagination'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { drName } from '@/lib/utils'
import PatientLookup from '@/components/common/PatientLookup'
import { printLabReceipt } from '@/components/billing/utils/printBilling'
import PaymentFields from '@/components/billing/PaymentFields'
import { createInvoiceWithPayment, fetchOrderInvoicePayments } from '@/lib/billing'

// ============================================
// API HELPERS
// ============================================

async function fetchApi(endpoint, options = {}) {
  const method = (options.method || 'GET').toLowerCase()
  const body = options.body ? JSON.parse(options.body) : undefined
  const res = method === 'get'
    ? await client.get(endpoint)
    : await client[method](endpoint, body)
  if (!res.success) throw new Error(res.error || 'API request failed')
  return res.data
}

// Transform API LabTest to local UI type
function transformApiTest(apiTest) {
  return {
    id: apiTest.id,
    testName: apiTest.testName || '',
    testCode: apiTest.testCode || '',
    testCategory: apiTest.testCategory || 'hematology',
    testType: apiTest.testType || 'quantitative',
    specimenType: apiTest.specimenType || 'Blood',
    specimenVolume: apiTest.specimenVolume || '',
    specimenContainer: apiTest.specimenContainer || '',
    unit: apiTest.unit || '',
    referenceRanges: [],
    price: apiTest.price || 0,
    turnaroundTime: apiTest.turnaroundTime || 2,
    department: apiTest.department || '',
    preparationInstructions: apiTest.preparationInstructions || '',
    clinicalSignificance: apiTest.clinicalSignificance || '',
    isActive: apiTest.isActive ?? true,
  }
}

// Transform API LabOrder to local UI type
function transformApiOrder(apiOrder) {
  const patient = apiOrder.patient
  const testsJson = apiOrder.tests
  let parsedTests = []

  try {
    if (testsJson) {
      parsedTests = JSON.parse(testsJson)
    }
  } catch {
    parsedTests = []
  }

  // Calculate patient age from date of birth
  const dob = patient?.dateOfBirth ? new Date(patient.dateOfBirth) : null
  const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 0

  return {
    id: apiOrder.id,
    orderNumber: apiOrder.orderNumber || '',
    patientId: apiOrder.patientId || '',
    patientName: patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() : 'Unknown',
    patientMrn: patient?.mrn || '',
    patientAge: age,
    patientGender: patient?.gender || 'male',
    patientPhone: patient?.phonePrimary || '',
    tests: parsedTests.map(t => ({
      testId: t.testId,
      testName: t.testName,
      testCode: t.testName?.substring(0, 4).toUpperCase() || '',
      testCategory: 'hematology',
      specimenType: 'Blood',
      urgency: t.urgency || 'routine',
      status: 'pending',
    })),
    clinicalIndication: apiOrder.clinicalIndication || '',
    provisionalDiagnosis: apiOrder.provisionalDiagnosis || '',
    priority: apiOrder.priority || 'routine',
    status: apiOrder.status || 'pending',
    orderDate: new Date(apiOrder.orderDate),
    requestingDoctor: '',
    sampleCollectedAt: apiOrder.sampleCollectedAt ? new Date(apiOrder.sampleCollectedAt) : null,
    sampleCollectedBy: apiOrder.sampleCollectedBy || null,
    accessionNumber: apiOrder.accessionNumber || null,
    notes: apiOrder.notes || '',
  }
}

// Transform API LabResult to local UI type
function transformApiResult(apiResult) {
  const test = apiResult.test
  return {
    id: apiResult.id,
    orderId: apiResult.orderId,
    testId: apiResult.testId,
    testName: test?.testName || '',
    resultValue: apiResult.resultValue || '',
    resultUnit: apiResult.resultUnit || test?.unit || '',
    isAbnormal: apiResult.isAbnormal || false,
    isCritical: apiResult.isCritical || false,
    flag: apiResult.flag || '',
    referenceRangeMin: apiResult.referenceRangeMin || null,
    referenceRangeMax: apiResult.referenceRangeMax || null,
    referenceRangeText: apiResult.referenceRangeMin && apiResult.referenceRangeMax
      ? `${apiResult.referenceRangeMin}-${apiResult.referenceRangeMax} ${apiResult.resultUnit || ''}`
      : '',
    enteredBy: '',
    enteredAt: new Date(),
    verifiedBy: null,
    verifiedAt: apiResult.verifiedAt ? new Date(apiResult.verifiedAt) : null,
    comment: apiResult.comment || '',
    status: apiResult.verifiedAt ? 'verified' : 'draft',
  }
}

// ============================================
// FORM SCHEMAS
// ============================================

const testSchema = z.object({
  testName: z.string().min(3, 'Test name is required'),
  testCode: z.string().min(2, 'Test code is required'),
  testCategory: z.enum(['hematology', 'chemistry', 'urinalysis', 'microbiology', 'parasitology', 'serology', 'immunology', 'endocrinology']),
  testType: z.enum(['quantitative', 'qualitative']),
  specimenType: z.enum(['Blood', 'Urine', 'Stool', 'Sputum', 'CSF', 'Swab', 'Tissue', 'Fluid']),
  specimenVolume: z.string().min(1, 'Specimen volume is required'),
  specimenContainer: z.string().min(1, 'Specimen container is required'),
  unit: z.string().optional(),
  price: z.number().min(0, 'Price must be positive'),
  turnaroundTime: z.number().min(1, 'Turnaround time is required'),
  department: z.string().min(1, 'Department is required'),
  preparationInstructions: z.string().optional(),
  clinicalSignificance: z.string().optional(),
  isActive: z.boolean().default(true)
})

const orderSchema = z.object({
  patientId: z.string().min(1, 'Patient is required'),
  tests: z.array(z.string()).min(1, 'At least one test is required'),
  clinicalIndication: z.string().min(5, 'Clinical indication is required'),
  provisionalDiagnosis: z.string().optional(),
  priority: z.enum(['routine', 'urgent', 'stat']),
  notes: z.string().optional()
})

const resultSchema = z.object({
  resultValue: z.string().min(1, 'Result value is required'),
  isAbnormal: z.boolean().default(false),
  isCritical: z.boolean().default(false),
  comment: z.string().optional()
})

// ============================================
// HELPER FUNCTIONS
// ============================================

const getCategoryBadgeColor = (category) => {
  switch (category) {
    case 'hematology': return 'bg-red-100 text-red-800 border-red-200'
    case 'chemistry': return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'urinalysis': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'microbiology': return 'bg-purple-100 text-purple-800 border-purple-200'
    case 'parasitology': return 'bg-green-100 text-green-800 border-green-200'
    case 'serology': return 'bg-orange-100 text-orange-800 border-orange-200'
    case 'immunology': return 'bg-pink-100 text-pink-800 border-pink-200'
    case 'endocrinology': return 'bg-indigo-100 text-indigo-800 border-indigo-200'
    default: return 'bg-gray-100 text-gray-800 border-gray-200'
  }
}

const getStatusBadgeColor = (status) => {
  switch (status) {
    case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'sample_collected': return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'in_progress': return 'bg-orange-100 text-orange-800 border-orange-200'
    case 'completed': return 'bg-green-100 text-green-800 border-green-200'
    case 'cancelled': return 'bg-red-100 text-red-800 border-red-200'
    case 'draft': return 'bg-gray-100 text-gray-800 border-gray-200'
    case 'verified': return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'final': return 'bg-green-600 text-white'
    default: return 'bg-gray-100 text-gray-800 border-gray-200'
  }
}

const getPriorityBadgeColor = (priority) => {
  switch (priority) {
    case 'stat': return 'bg-red-500 text-white animate-pulse'
    case 'urgent': return 'bg-orange-500 text-white'
    case 'routine': return 'bg-green-100 text-green-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

const getSampleTypeIcon = (type) => {
  switch (type) {
    case 'Blood': return <Droplet className="h-4 w-4 text-red-500" />
    case 'Urine': return <Beaker className="h-4 w-4 text-yellow-500" />
    case 'Stool': return <TestTube className="h-4 w-4 text-amber-700" />
    case 'Sputum': return <TestTube className="h-4 w-4 text-green-500" />
    case 'CSF': return <Droplet className="h-4 w-4 text-blue-500" />
    default: return <FlaskConical className="h-4 w-4 text-gray-500" />
  }
}

const generateAccessionNumber = () => {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `ACC-${year}-${random}`
}

const formatStatus = (status) => {
  return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

// ============================================
// CONSTANTS
// ============================================

const LAB_ITEMS_PER_PAGE = 10

// ============================================
// MAIN COMPONENT
// ============================================

export default function LaboratoryModule() {
  // State
  const [activeTab, setActiveTab] = useState('dashboard')
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [tests, setTests] = useState([])
  const [orders, setOrders] = useState([])
  const [results, setResults] = useState([])
  const [selectedTest, setSelectedTest] = useState(null)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [selectedResult, setSelectedResult] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [showTestDialog, setShowTestDialog] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [orderTestSearch, setOrderTestSearch] = useState('')
  // Patient search for New Order dialog
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [orderHcc, setOrderHcc] = useState('') // home-collection charge for this order
  const [orderAmountPaid, setOrderAmountPaid] = useState('') // paid at booking → Payment record
  const [orderPayMethod, setOrderPayMethod] = useState('cash')
  const [showOrderDialog, setShowOrderDialog] = useState(false)
  const [showResultDialog, setShowResultDialog] = useState(false)
  const [showViewOrderDialog, setShowViewOrderDialog] = useState(false)
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [invoiceOrder, setInvoiceOrder] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [testsLoading, setTestsLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [stats, setStats] = useState({
    pendingOrders: 0,
    sampleCollected: 0,
    inProgress: 0,
    completedToday: 0,
    criticalResults: 0,
    totalTests: 0
  })

  // Pagination state for tests catalog
  const [testsPage, setTestsPage] = useState(1)
  // Pagination state for results
  const [resultsPage, setResultsPage] = useState(1)

  // The Orders TABLE pages on the server (search/status/priority filter in the DB).
  // The overview dashboard keeps its own capped `orders` fetch for its aggregates,
  // so this only drives the table — the two don't interfere.
  const ordersTable = useServerPagination('/laboratory', {
    perPage: LAB_ITEMS_PER_PAGE,
    params: {
      resource: 'orders',
      search: searchQuery,
      status: statusFilter === 'all' ? '' : statusFilter,
      priority: priorityFilter === 'all' ? '' : priorityFilter,
    },
  })

  // Forms
  const testForm = useForm({
    resolver: zodResolver(testSchema),
    defaultValues: {
      testName: '',
      testCode: '',
      testCategory: 'hematology',
      testType: 'quantitative',
      specimenType: 'Blood',
      specimenVolume: '',
      specimenContainer: '',
      unit: '',
      price: 0,
      turnaroundTime: 2,
      department: '',
      preparationInstructions: '',
      clinicalSignificance: '',
      isActive: true
    }
  })

  const orderForm = useForm({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      patientId: '',
      tests: [],
      clinicalIndication: '',
      provisionalDiagnosis: '',
      priority: 'routine',
      notes: ''
    }
  })

  const resultForm = useForm({
    resolver: zodResolver(resultSchema),
    defaultValues: {
      resultValue: '',
      isAbnormal: false,
      isCritical: false,
      comment: ''
    }
  })

  // Fetch tests
  const fetchTests = useCallback(async () => {
    try {
      setTestsLoading(true)
      const data = await fetchApi('/laboratory?resource=tests&limit=2000')
      const testsArray = Array.isArray(data) ? data : (data?.data || [])
      setTests(testsArray.map(transformApiTest))
    } catch (error) {
      console.error('Failed to fetch tests:', error)
      toast.error(error.message || 'Failed to load test catalog')
    } finally {
      setTestsLoading(false)
    }
  }, [])

  // Fetch orders
  const fetchOrders = useCallback(async () => {
    try {
      setOrdersLoading(true)
      const data = await fetchApi('/laboratory?resource=orders&limit=2000')
      const ordersArray = Array.isArray(data) ? data : (data?.data || [])
      setOrders(ordersArray.map(transformApiOrder))
    } catch (error) {
      console.error('Failed to fetch orders:', error)
      toast.error(error.message || 'Failed to load lab orders')
    } finally {
      setOrdersLoading(false)
    }
  }, [])

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true)
      const data = await fetchApi('/laboratory?resource=stats')
      setStats({
        pendingOrders: data.pending,
        sampleCollected: data.sampleCollected,
        inProgress: data.inProgress,
        completedToday: data.completedToday,
        criticalResults: data.criticalResults,
        totalTests: data.totalTests
      })
    } catch (error) {
      console.error('Failed to fetch stats:', error)
      toast.error(error.message || 'Failed to load lab statistics')
    } finally {
      setStatsLoading(false)
    }
  }, [])

  // Fetch results
  const fetchResults = useCallback(async () => {
    try {
      const data = await fetchApi('/laboratory?resource=results&limit=2000')
      const resultsArray = Array.isArray(data) ? data : (data?.data || [])
      setResults(resultsArray.map(transformApiResult))
    } catch (error) {
      console.error('Failed to fetch results:', error)
      toast.error(error.message || 'Failed to load lab results')
    }
  }, [])

  // Initial data fetch
  useEffect(() => {
    fetchTests()
    fetchOrders()
    fetchStats()
    fetchResults()
  }, [fetchTests, fetchOrders, fetchStats, fetchResults])
  const { orgInfo: hookOrgInfo } = useOrgSettings()
  useEffect(() => { setOrgInfo(hookOrgInfo) }, [hookOrgInfo])

  // Filtered data
  // Orders now filter + page on the server (see ordersTable above).
  const filteredTests = tests.filter(test => {
    const matchesSearch = test.testName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      test.testCode.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || test.testCategory === categoryFilter
    return matchesSearch && matchesCategory
  })

  // Recent orders requiring attention
  const recentOrdersAttention = orders.filter(o =>
    o.status === 'pending' || o.status === 'sample_collected' || o.priority === 'stat'
  ).slice(0, 5)

  // Handlers
  const handleCreateTest = async (data) => {
    try {
      setIsLoading(true)
      const newTest = await fetchApi('/laboratory', {
        method: 'POST',
        body: JSON.stringify({
          resource: 'test',
          ...data,
          price: Number(data.price),
          turnaroundTime: Number(data.turnaroundTime)
        }),
      })
      setTests(prev => [transformApiTest(newTest), ...prev])
      toast.success('Test added to catalog successfully')
      setShowTestDialog(false)
      testForm.reset()
    } catch (error) {
      console.error('Failed to create test:', error)
      toast.error('Failed to add test')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateOrder = async (data) => {
    try {
      setIsLoading(true)
      const selectedTests = tests.filter(t => data.tests.includes(t.id))
      const hcc = Number(orderHcc) || 0

      const newOrder = await fetchApi('/laboratory', {
        method: 'POST',
        body: JSON.stringify({
          resource: 'order',
          patientId: data.patientId,
          tests: selectedTests.map(t => ({
            testId: t.id,
            testName: t.testName,
            urgency: data.priority
          })),
          clinicalIndication: data.clinicalIndication,
          provisionalDiagnosis: data.provisionalDiagnosis,
          priority: data.priority,
          // Home-collection charge is tagged into notes so the receipt can show it.
          notes: `${data.notes || ''}${hcc > 0 ? ` [HCC:${hcc}]` : ''}`.trim()
        }),
      })

      setOrders(prev => [transformApiOrder(newOrder), ...prev])

      // Auto-create ONE billing invoice for all tests in this visit.
      // NOTE: billing requires `serviceName` on each item (not `description`),
      // else the invoice silently fails validation and no bill is created.
      const billItems = selectedTests.map(t => ({
        serviceName: t.testName,
        quantity: 1,
        unitPrice: t.price || 0,
        tax: 0,
        total: t.price || 0,
      }))
      // Add home-collection as a billable line so the invoice total is correct.
      if (hcc > 0) billItems.push({ serviceName: 'Home Collection Charges', quantity: 1, unitPrice: hcc, tax: 0, total: hcc })
      const billTotal = billItems.reduce((s, i) => s + i.total, 0)
      if (billTotal > 0 && data.patientId) {
        try {
          // Shared helper: create the invoice + record what was paid at booking.
          await createInvoiceWithPayment({
            patientId: data.patientId,
            items: billItems,
            notes: `[Laboratory] Lab Order ${newOrder.orderNumber || ''}`.trim(),
            amountPaid: orderAmountPaid,
            paymentMethod: orderPayMethod,
          })
          toast.success('Invoice generated for this lab order')
        } catch (e) {
          toast.error('Order created, but invoice generation failed: ' + (e.message || ''))
        }
      }

      toast.success('Lab order created successfully')
      ordersTable.refresh()
      setShowOrderDialog(false)
      orderForm.reset()
      setSelectedPatient(null)
      setOrderHcc('')
      setOrderAmountPaid('')
      setOrderPayMethod('cash')
      fetchStats()
    } catch (error) {
      console.error('Failed to create order:', error)
      toast.error('Failed to create lab order')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCollectSample = async (orderId) => {
    try {
      await fetchApi('/laboratory', {
        method: 'PATCH',
        body: JSON.stringify({
          resource: 'order',
          id: orderId,
          status: 'sample_collected',
          sampleCollectedAt: new Date().toISOString(),
          accessionNumber: generateAccessionNumber()
        }),
      })

      setOrders(prev => prev.map(order =>
        order.id === orderId
          ? {
            ...order,
            status: 'sample_collected',
            sampleCollectedAt: new Date(),
            accessionNumber: generateAccessionNumber(),
            tests: order.tests.map(t => ({ ...t, status: 'collected' }))
          }
          : order
      ))
      toast.success('Sample collected successfully')
      fetchStats()
      ordersTable.refresh()
    } catch (error) {
      console.error('Failed to update order:', error)
      toast.error('Failed to update order status')
    }
  }

  const handleStartProcessing = async (orderId) => {
    try {
      await fetchApi('/laboratory', {
        method: 'PATCH',
        body: JSON.stringify({
          resource: 'order',
          id: orderId,
          status: 'in_progress'
        }),
      })

      setOrders(prev => prev.map(order =>
        order.id === orderId
          ? {
            ...order,
            status: 'in_progress',
            tests: order.tests.map(t => ({ ...t, status: 'in_progress' }))
          }
          : order
      ))
      toast.success('Processing started')
      fetchStats()
      ordersTable.refresh()
    } catch (error) {
      console.error('Failed to update order:', error)
      toast.error('Failed to update order status')
    }
  }

  const handleEnterResults = async (data) => {
    if (!selectedOrder || !selectedTest) return

    try {
      setIsLoading(true)
      const newResult = await fetchApi('/laboratory', {
        method: 'POST',
        body: JSON.stringify({
          resource: 'result',
          orderId: selectedOrder.id,
          testId: selectedTest.id,
          resultValue: data.resultValue,
          resultUnit: selectedTest.unit,
          isAbnormal: data.isAbnormal,
          isCritical: data.isCritical,
          flag: data.isCritical ? 'A' : data.isAbnormal ? 'H' : 'N',
          comment: data.comment
        }),
      })

      setResults(prev => [transformApiResult(newResult), ...prev])
      toast.success('Results entered successfully')
      setShowResultDialog(false)
      resultForm.reset()
      setSelectedTest(null)
      fetchStats()
    } catch (error) {
      console.error('Failed to save results:', error)
      toast.error('Failed to save results')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyResult = async (resultId) => {
    try {
      await fetchApi('/laboratory', {
        method: 'PATCH',
        body: JSON.stringify({
          resource: 'result',
          id: resultId,
          verifiedAt: new Date().toISOString()
        }),
      })

      setResults(prev => prev.map(result =>
        result.id === resultId
          ? { ...result, status: 'verified', verifiedAt: new Date() }
          : result
      ))

      // Find the orderId for this result and offer WhatsApp notification
      const result = results.find(r => r.id === resultId)
      const orderId = result?.orderId || selectedOrder?.id
      if (orderId) {
        toast.success('Result verified', {
          description: 'Would you like to notify the patient?',
          action: {
            label: '📲 Notify via WhatsApp',
            onClick: async () => {
              const res = await sendLabResultNotification(orderId)
              if (res?.sent) toast.success('Notification sent via WhatsApp API')
              else if (res?.waLink) toast.success('WhatsApp opened — click Send')
              else toast.error('Could not send notification')
            },
          },
          duration: 8000,
        })
      } else {
        toast.success('Result verified successfully')
      }
    } catch (error) {
      console.error('Failed to verify result:', error)
      toast.error('Failed to verify result')
    }
  }

  const handleCompleteOrder = async (orderId) => {
    try {
      await fetchApi('/laboratory', {
        method: 'PATCH',
        body: JSON.stringify({
          resource: 'order',
          id: orderId,
          status: 'completed'
        }),
      })

      setOrders(prev => prev.map(order =>
        order.id === orderId
          ? {
            ...order,
            status: 'completed',
            tests: order.tests.map(t => ({ ...t, status: 'completed' }))
          }
          : order
      ))
      toast.success('Order completed')
      fetchStats()
    } catch (error) {
      console.error('Failed to complete order:', error)
      toast.error('Failed to complete order')
    }
  }

  const handlePrintLabReport = (order) => {
    const win = window.open('', '_blank', 'width=900,height=780')
    if (!win) { toast.error('Please allow pop-ups to print'); return }
    const printDate = format(new Date(), 'dd MMM yyyy HH:mm')
    const orderDate = format(new Date(order.orderDate), 'dd MMM yyyy HH:mm')
    const collectedDate = order.sampleCollectedAt ? format(new Date(order.sampleCollectedAt), 'dd MMM yyyy HH:mm') : '—'
    const orderResults = results.filter(r => r.orderId === order.id)
    const hasResults = orderResults.length > 0
    const hasAbnormal = orderResults.some(r => r.isAbnormal || r.isCritical)

    const resultRows = hasResults
      ? orderResults.map(r => {
          const refRange = r.referenceRangeText || (r.referenceRangeMin !== null && r.referenceRangeMax !== null ? `${r.referenceRangeMin} – ${r.referenceRangeMax}` : '—')
          const rowClass = r.isCritical ? 'result-critical' : r.isAbnormal ? 'result-abnormal' : ''
          const flagStyle = r.flag === 'H' ? 'color:#b45309;font-weight:bold' : r.flag === 'L' ? 'color:#1d4ed8;font-weight:bold' : r.isCritical ? 'color:#dc2626;font-weight:bold' : ''
          const valStyle = r.isAbnormal || r.isCritical ? 'font-weight:bold;color:' + (r.isCritical ? '#dc2626' : '#b45309') : 'font-weight:bold'
          return `<tr class="${rowClass}">
            <td>${r.testName}</td>
            <td style="${valStyle}">${r.resultValue}</td>
            <td>${r.resultUnit || '—'}</td>
            <td>${refRange}</td>
            <td style="${flagStyle}">${r.isCritical ? '⚠ CRITICAL' : r.flag || 'N'}</td>
            <td>${r.status === 'verified' ? '✓ Verified' : r.status === 'final' ? '✓ Final' : 'Reported'}</td>
          </tr>`
        }).join('')
      : order.tests.map(t => `<tr>
            <td>${t.testName}</td>
            <td colspan="4" style="color:#888;font-style:italic">Result pending</td>
            <td>—</td>
          </tr>`).join('')

    const verifiedResults = orderResults.filter(r => r.verifiedBy)
    const verifiedBy = verifiedResults.length > 0 ? verifiedResults[0].verifiedBy : null
    const verifiedAt = verifiedResults.length > 0 && verifiedResults[0].verifiedAt ? format(new Date(verifiedResults[0].verifiedAt), 'dd MMM yyyy HH:mm') : null
    const enteredBy = orderResults.length > 0 ? orderResults[0].enteredBy : null

    const html = `<!DOCTYPE html><html><head><title>Laboratory Report — ${order.orderNumber}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;background:#fff}
.page{max-width:210mm;margin:0 auto;padding:12mm 14mm 10mm 14mm}
.hosp-header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:10px}
.hosp-name{font-size:19pt;font-weight:bold;color:#1e3a5f;line-height:1}
.hosp-sub{font-size:9pt;color:#555;margin-top:2px}
.hosp-contact{font-size:8.5pt;color:#555;text-align:right;line-height:1.6}
.report-banner{background:#1e3a5f;color:#fff;text-align:center;padding:5px 0;font-size:13pt;font-weight:bold;letter-spacing:3px;margin-bottom:10px}
.info-box{border:1px solid #333;margin-bottom:10px}
.info-box-hdr{background:#1e3a5f;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;letter-spacing:1px;text-transform:uppercase}
.info-box-hdr2{background:#4a7099;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold}
.info-grid{display:grid;grid-template-columns:repeat(4,1fr)}
.info-cell{padding:5px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.info-cell:last-child{border-right:none}
.info-label{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase;letter-spacing:0.3px}
.info-value{font-size:10pt;margin-top:1px}
.clinical-bar{padding:7px 12px;background:#f0f4f8;border-left:4px solid #1e3a5f;margin-bottom:10px;font-size:10pt}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:9.5pt}
thead th{background:#1e3a5f;color:#fff;padding:6px 8px;text-align:left;font-size:9pt;font-weight:600}
td{padding:5px 8px;border-bottom:1px solid #e8e8e8;vertical-align:middle}
tr:nth-child(even) td{background:#f9f9f9}
.result-abnormal td{background:#fffbeb!important}
.result-critical td{background:#fef2f2!important}
.abnormal-legend{font-size:8.5pt;color:#666;padding:5px 8px;background:#f8f9fa;border:1px solid #e0e0e0;margin-bottom:10px;border-radius:3px}
.critical-note{background:#fef2f2;border:1px solid #dc2626;padding:8px 12px;margin-bottom:10px;font-size:9.5pt;color:#991b1b;border-radius:3px}
.sig-section{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:16px;padding-top:10px;border-top:2px solid #000}
.sig-line{border-bottom:1px solid #000;height:40px;margin-bottom:5px}
.sig-label{font-size:9pt;color:#444;line-height:1.6}
.footer{margin-top:12px;border-top:1px solid #ccc;padding-top:5px;font-size:8pt;color:#888;text-align:center}
@media print{body{padding:0}.page{padding:8mm}}
</style></head><body>
<div class="page">
  <div class="hosp-header">
    <div>
      ${orgInfo.logoUrl ? `<img src="${orgInfo.logoUrl}" alt="" style="height:46px;max-width:170px;object-fit:contain;margin-bottom:4px"/>` : ''}
      <div class="hosp-name">${orgInfo.name}</div>
      <div class="hosp-sub">Laboratory &amp; Pathology Department</div>
      <div class="hosp-sub">Accredited Clinical Laboratory Services</div>
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
     <div class="info-cell"><div class="info-label">UHID</div><div class="info-value">${order.patientMrn}</div></div>
    
      <div class="info-cell"><div class="info-label">Patient Name</div><div class="info-value"><strong>${order.patientName}</strong></div></div>
       <div class="info-cell"><div class="info-label">Age / Sex</div><div class="info-value">${order.patientAge} yrs / ${order.patientGender.charAt(0).toUpperCase() + order.patientGender.slice(1)}</div></div>
      <div class="info-cell"><div class="info-label">Requesting Physician</div><div class="info-value">${order.requestingDoctor ? drName(order.requestingDoctor) : '—'}</div></div>
    </div>
    <div class="info-box-hdr2">Order Details</div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-label">Order Date</div><div class="info-value">${orderDate}</div></div>
      <div class="info-cell"><div class="info-label">Collection Date</div><div class="info-value">${collectedDate}</div></div>
      <div class="info-cell"><div class="info-label">Priority</div><div class="info-value" style="text-transform:uppercase;color:${order.priority==='stat'?'#dc2626':order.priority==='urgent'?'#d97706':'#333'};font-weight:bold">${order.priority}</div></div>
      <div class="info-cell"><div class="info-label">Report Status</div><div class="info-value" style="color:#065f46;font-weight:bold">COMPLETED</div></div>
    </div>
  </div>

  ${order.clinicalIndication ? `<div class="clinical-bar"><strong>Clinical Indication:</strong> ${order.clinicalIndication}</div>` : ''}
  ${order.provisionalDiagnosis ? `<div class="clinical-bar"><strong>Provisional Diagnosis:</strong> ${order.provisionalDiagnosis}</div>` : ''}

  ${hasAbnormal ? `<div class="critical-note">⚠ This report contains abnormal/critical values. Please review highlighted results and contact the laboratory for clarification if needed.</div>` : ''}

  <table>
    <thead>
      <tr>
        <th style="width:28%">TEST NAME</th>
        <th style="width:13%">RESULT</th>
        <th style="width:10%">UNIT</th>
        <th style="width:22%">REFERENCE RANGE</th>
        <th style="width:12%">FLAG</th>
        <th style="width:15%">STATUS</th>
      </tr>
    </thead>
    <tbody>${resultRows}</tbody>
  </table>

  ${hasAbnormal ? `<div class="abnormal-legend"><strong>Flag Legend:</strong> &nbsp; H = High &nbsp; L = Low &nbsp; N = Normal &nbsp; A = Abnormal &nbsp; ⚠ CRITICAL = Requires immediate attention</div>` : ''}

  ${order.notes ? `<div class="clinical-bar" style="margin-bottom:10px"><strong>Notes:</strong> ${order.notes}</div>` : ''}

  <div class="sig-section">
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">
        <strong>Reported By:</strong> ${enteredBy || 'Lab Technologist'}<br/>
        Report Date: ${printDate}
      </div>
    </div>
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">
        <strong>Verified By:</strong> ${verifiedBy || '—'}<br/>
        ${verifiedAt ? `Verification Date: ${verifiedAt}` : 'Not yet verified'}
      </div>
    </div>
  </div>

  <div class="footer">
    ${orgInfo.name} — Laboratory &amp; Pathology Department &nbsp;|&nbsp;
    This report is confidential and intended solely for the requesting physician &nbsp;|&nbsp;
    Printed: ${printDate}
  </div>
</div>
</body></html>`
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 600)
  }

  const handleDeleteTest = async (testId) => {
    try {
      await fetchApi('/laboratory', {
        method: 'PATCH',
        body: JSON.stringify({
          resource: 'test',
          id: testId,
          isActive: false
        }),
      })

      setTests(prev => prev.filter(t => t.id !== testId))
      toast.success('Test removed from catalog')
    } catch (error) {
      console.error('Failed to delete test:', error)
      toast.error('Failed to remove test')
    }
  }

  const handleRefresh = () => {
    fetchTests()
    fetchOrders()
    fetchStats()
    fetchResults()
    ordersTable.refresh()
    toast.success('Data refreshed')
  }

  // Lab receipt uses the SHARED printLabReceipt so the Billing module and the
  // Laboratory module render an IDENTICAL Dr-Lal-style bill.
  const handlePrintLabInvoice = async (order, payInfo = {}) => {
    let clinic = {}
    try { clinic = JSON.parse(localStorage.getItem('gudmed-clinic-profile') || '{}') } catch { clinic = {} }
    const now = new Date()
    const items = order.tests.map(t => {
      const def = tests.find(td => td.id === t.testId)
      const price = def?.price || 0
      const tat = def?.turnaroundTime || 24
      return {
        code: def?.testCode || t.testCode || (t.testName || 'TEST').substring(0, 6).toUpperCase(),
        name: t.testName || 'Test',
        price,
        eta: format(new Date(now.getTime() + tat * 3600 * 1000), 'dd-MM-yyyy HH:mm'),
      }
    })
    const orderValue = items.reduce((s2, i) => s2 + i.price, 0)
    // Home-collection: from the order (tagged as [HCC:150] in notes when the order
    // was booked) → else the hospital's default from Settings → else 0.
    const hccTag = String(order.notes || '').match(/\[HCC:(\d+(?:\.\d+)?)\]/)
    const home = payInfo.homeCollection !== undefined
      ? Number(payInfo.homeCollection)
      : (hccTag ? Number(hccTag[1]) : Number(orgInfo.homeCollectionCharge || 0))
    // Payments live on the auto-created Invoice (tagged with this order number in
    // its notes), not on the lab order. Shared helper fetches that invoice's payment
    // ledger so the receipt's Payment table shows date/time, receipt & method.
    const { payments, amountPaid: invoicePaid } = await fetchOrderInvoicePayments({
      patientId: order.patientId || order.patient?.id,
      orderNumber: order.orderNumber,
    })

    const disc = Number(payInfo.discount || 0)
    const net = orderValue + home - disc
    const paid = payInfo.paid !== undefined ? Number(payInfo.paid)
      : (invoicePaid !== undefined ? invoicePaid : payments.reduce((s, p) => s + Number(p.amount || 0), 0))
    printLabReceipt({
      invoiceNo: order.orderNumber,
      labId: order.accessionNumber || order.patientMrn,
      patientName: order.patientName,
      uhid: order.patientMrn,
      age: `${order.patientAge} year(s)`,
      sex: order.patientGender ? order.patientGender.charAt(0).toUpperCase() + order.patientGender.slice(1) : '',
      contact: order.patientPhone,
      dateTime: format(now, 'dd MMM yyyy, hh:mm aa'),
      refDoctor: order.requestingDoctor ? drName(order.requestingDoctor) : 'self',
      mode: payInfo.mode,
      items, orderValue, homeCollection: home, discount: disc, netPayable: net, paid, balance: net - paid,
      payments,
    }, orgInfo, clinic)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FlaskConical className="h-8 w-8 text-blue-600" />
            Laboratory Department
          </h1>
          <p className="text-gray-500">Complete laboratory management - tests, orders, results, and reports</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => setShowOrderDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Order
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import Excel/CSV
          </Button>
          <Button onClick={() => setShowTestDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Test
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="catalog">Test Catalog</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="results">Results Entry</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* Stats Cards */}
          {statsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <Card className="bg-yellow-50 border-yellow-200">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold text-yellow-700">{stats.pendingOrders}</p>
                      <p className="text-xs text-yellow-600">Pending Orders</p>
                    </div>
                    <Clock className="h-8 w-8 text-yellow-500" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold text-blue-700">{stats.sampleCollected}</p>
                      <p className="text-xs text-blue-600">Sample Collected</p>
                    </div>
                    <TestTube className="h-8 w-8 text-blue-500" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-orange-50 border-orange-200">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold text-orange-700">{stats.inProgress}</p>
                      <p className="text-xs text-orange-600">In Progress</p>
                    </div>
                    <Activity className="h-8 w-8 text-orange-500" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold text-green-700">{stats.completedToday}</p>
                      <p className="text-xs text-green-600">Completed Today</p>
                    </div>
                    <CheckCircle className="h-8 w-8 text-green-500" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-red-50 border-red-200">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold text-red-700">{stats.criticalResults}</p>
                      <p className="text-xs text-red-600">Critical Results</p>
                    </div>
                    <AlertTriangle className="h-8 w-8 text-red-500" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-purple-50 border-purple-200">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold text-purple-700">{stats.totalTests}</p>
                      <p className="text-xs text-purple-600">Total Tests</p>
                    </div>
                    <Microscope className="h-8 w-8 text-purple-500" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Quick Actions and Recent Orders */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Common laboratory tasks</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <Button
                  className="h-20 flex flex-col gap-1"
                  onClick={() => setShowOrderDialog(true)}
                >
                  <ClipboardList className="h-6 w-6" />
                  <span>New Order</span>
                </Button>
                <Button
                  className="h-20 flex flex-col gap-1"
                  variant="secondary"
                  onClick={() => setActiveTab('results')}
                >
                  <FileText className="h-6 w-6" />
                  <span>Enter Results</span>
                </Button>
                <Button
                  className="h-20 flex flex-col gap-1"
                  variant="outline"
                  onClick={() => setActiveTab('orders')}
                >
                  <TestTube className="h-6 w-6" />
                  <span>Sample Collection</span>
                </Button>
                <Button
                  className="h-20 flex flex-col gap-1"
                  variant="outline"
                  onClick={() => setActiveTab('reports')}
                >
                  <FileBarChart className="h-6 w-6" />
                  <span>View Reports</span>
                </Button>
              </CardContent>
            </Card>

            {/* Recent Orders Requiring Attention */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-orange-500" />
                  Orders Requiring Attention
                </CardTitle>
                <CardDescription>Pending and urgent orders</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px]">
                  {ordersLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                  ) : recentOrdersAttention.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No orders requiring attention</p>
                  ) : (
                    <div className="space-y-3">
                      {recentOrdersAttention.map(order => (
                        <div
                          key={order.id}
                          className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 cursor-pointer"
                          onClick={() => {
                            setSelectedOrder(order)
                            setShowViewOrderDialog(true)
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-10 rounded-full ${order.priority === 'stat' ? 'bg-red-500 animate-pulse' :
                              order.priority === 'urgent' ? 'bg-orange-500' : 'bg-yellow-500'
                              }`} />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm">{order.orderNumber}</span>
                                <Badge className={getStatusBadgeColor(order.status)} variant="outline">
                                  {formatStatus(order.status)}
                                </Badge>
                              </div>
                              <p className="text-sm font-medium">{order.patientName}</p>
                              <p className="text-xs text-gray-500">
                                {order.tests.length} test(s) &bull; {formatDistanceToNow(new Date(order.orderDate), { addSuffix: true })}
                              </p>
                            </div>
                          </div>
                          <ChevronDown className="h-4 w-4 text-gray-400 rotate-[-90deg]" />
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Pending vs Completed Dashboard */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Pending vs Completed &mdash; Today&apos;s Workflow</CardTitle>
                  <CardDescription>Live status of all lab orders</CardDescription>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-green-600">
                    {orders.length > 0 ? Math.round((orders.filter(o => o.status === 'completed').length / orders.length) * 100) : 0}%
                  </p>
                  <p className="text-xs text-gray-500">Completion Rate</p>
                </div>
              </div>
              <div className="mt-2">
                <Progress
                  value={orders.length > 0 ? (orders.filter(o => o.status === 'completed').length / orders.length) * 100 : 0}
                  className="h-2"
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {/* Pending / In-Progress */}
                <div>
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                    <span className="font-semibold text-sm text-gray-700">Pending / In Progress</span>
                    <span className="ml-auto text-xs font-bold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                      {orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length}
                    </span>
                  </div>
                  <ScrollArea className="h-[260px]">
                    {ordersLoading ? (
                      <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                    ) : orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <CheckCircle className="h-10 w-10 mx-auto mb-2 text-green-400" />
                        <p className="text-sm">All orders completed!</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').map(order => (
                          <div key={order.id} className="flex items-start gap-3 p-3 rounded-lg border border-yellow-100 bg-yellow-50 hover:bg-yellow-100 cursor-pointer transition" onClick={() => { setSelectedOrder(order); setShowViewOrderDialog(true) }}>
                            <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${order.priority === 'stat' ? 'bg-red-500 animate-pulse' : order.priority === 'urgent' ? 'bg-orange-500' : 'bg-yellow-400'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-gray-500">{order.orderNumber}</span>
                                <Badge className={`text-xs ${getPriorityBadgeColor(order.priority)}`}>{order.priority.toUpperCase()}</Badge>
                              </div>
                              <p className="font-medium text-sm truncate">{order.patientName}</p>
                              <p className="text-xs text-gray-500">{order.tests.length} test(s) &middot; {formatStatus(order.status)}</p>
                              <p className="text-xs text-gray-400">{formatDistanceToNow(new Date(order.orderDate), { addSuffix: true })}</p>
                            </div>
                            <Badge className={getStatusBadgeColor(order.status)} variant="outline">{formatStatus(order.status)}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>

                {/* Completed */}
                <div>
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="font-semibold text-sm text-gray-700">Completed</span>
                    <span className="ml-auto text-xs font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      {orders.filter(o => o.status === 'completed').length}
                    </span>
                  </div>
                  <ScrollArea className="h-[260px]">
                    {ordersLoading ? (
                      <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                    ) : orders.filter(o => o.status === 'completed').length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <FlaskConical className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No completed orders yet</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {orders.filter(o => o.status === 'completed').map(order => (
                          <div key={order.id} className="flex items-start gap-3 p-3 rounded-lg border border-green-100 bg-green-50 hover:bg-green-100 cursor-pointer transition" onClick={() => { setSelectedOrder(order); setShowViewOrderDialog(true) }}>
                            <CheckCircle className="mt-1 h-4 w-4 text-green-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-gray-500">{order.orderNumber}</span>
                              </div>
                              <p className="font-medium text-sm truncate">{order.patientName}</p>
                              <p className="text-xs text-gray-500">{order.tests.length} test(s)</p>
                              <p className="text-xs text-gray-400">{formatDistanceToNow(new Date(order.orderDate), { addSuffix: true })}</p>
                            </div>
                            <div className="flex flex-col gap-1">
                              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={(e) => { e.stopPropagation(); handlePrintLabReport(order) }}>
                                <Printer className="h-3 w-3 mr-1" />Report
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={(e) => { e.stopPropagation(); handlePrintLabInvoice(order) }}>
                                <FileText className="h-3 w-3 mr-1" />Invoice
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Test Catalog Tab */}
        <TabsContent value="catalog" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle>Test Catalog</CardTitle>
                  <CardDescription>Manage laboratory test definitions</CardDescription>
                </div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search tests..."
                      className="pl-10 w-64"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value)
                        setTestsPage(1)
                      }}
                    />
                  </div>
                  <Select value={categoryFilter} onValueChange={(value) => {
                    setCategoryFilter(value)
                    setTestsPage(1)
                  }}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="hematology">Hematology</SelectItem>
                      <SelectItem value="chemistry">Chemistry</SelectItem>
                      <SelectItem value="urinalysis">Urinalysis</SelectItem>
                      <SelectItem value="microbiology">Microbiology</SelectItem>
                      <SelectItem value="parasitology">Parasitology</SelectItem>
                      <SelectItem value="serology">Serology</SelectItem>
                      <SelectItem value="immunology">Immunology</SelectItem>
                      <SelectItem value="endocrinology">Endocrinology</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {testsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
              ) : (
                <>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Test Name</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Sample Type</TableHead>
                          <TableHead>TAT (hrs)</TableHead>
                          <TableHead>Price (&#8377;)</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="w-24">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTests.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                              No tests found. Add a test to get started.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredTests.slice((testsPage - 1) * LAB_ITEMS_PER_PAGE, testsPage * LAB_ITEMS_PER_PAGE).map((test) => (
                            <TableRow key={test.id} className="hover:bg-gray-50">
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {getSampleTypeIcon(test.specimenType)}
                                  <div>
                                    <p className="font-medium">{test.testName}</p>
                                    <p className="text-xs text-gray-500">{test.specimenContainer || 'No container specified'}</p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="font-mono">{test.testCode}</TableCell>
                              <TableCell>
                                <Badge className={getCategoryBadgeColor(test.testCategory)} variant="outline">
                                  {test.testCategory}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {getSampleTypeIcon(test.specimenType)}
                                  <span className="text-sm">{test.specimenType}</span>
                                </div>
                              </TableCell>
                              <TableCell>{test.turnaroundTime}</TableCell>
                              <TableCell className="font-medium">{test.price?.toLocaleString() || '0'}</TableCell>
                              <TableCell>
                                <Badge className={test.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                                  {test.isActive ? 'Active' : 'Inactive'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setSelectedTest(test)
                                      testForm.reset({
                                        testName: test.testName,
                                        testCode: test.testCode,
                                        testCategory: test.testCategory,
                                        testType: test.testType,
                                        specimenType: test.specimenType,
                                        specimenVolume: test.specimenVolume,
                                        specimenContainer: test.specimenContainer,
                                        unit: test.unit,
                                        price: test.price,
                                        turnaroundTime: test.turnaroundTime,
                                        department: test.department,
                                        preparationInstructions: test.preparationInstructions,
                                        clinicalSignificance: test.clinicalSignificance,
                                        isActive: test.isActive
                                      })
                                      setShowTestDialog(true)
                                    }}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-500 hover:text-red-700"
                                    onClick={() => handleDeleteTest(test.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination controls for tests */}
                  {filteredTests.length > LAB_ITEMS_PER_PAGE && (
                    <div className="flex items-center justify-end gap-4 pt-4 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTestsPage(prev => Math.max(1, prev - 1))}
                        disabled={testsPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />Previous
                      </Button>
                      <span className="text-sm text-gray-600">
                        Page {testsPage} of {Math.ceil(filteredTests.length / LAB_ITEMS_PER_PAGE)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTestsPage(prev => Math.min(Math.ceil(filteredTests.length / LAB_ITEMS_PER_PAGE), prev + 1))}
                        disabled={testsPage === Math.ceil(filteredTests.length / LAB_ITEMS_PER_PAGE)}
                      >
                        Next<ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Orders Tab */}
        <TabsContent value="orders" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search by patient, UHID, order #..."
                      className="pl-10 w-64"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="sample_collected">Sample Collected</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="routine">Routine</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="stat">STAT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={handleRefresh}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border">
                <PaginatedTable
                  pagination={ordersTable}
                  transform={transformApiOrder}
                  empty="No orders found. Create a new order to get started."
                  columns={[
                    { header: 'Order #', className: 'w-32' },
                    { header: 'Patient' },
                    { header: 'Tests' },
                    { header: 'Priority' },
                    { header: 'Status' },
                    { header: 'Order Time' },
                    { header: 'Actions', className: 'w-40' },
                  ]}
                  renderRow={(order) => (
                            <TableRow key={order.id} className="hover:bg-gray-50">
                              <TableCell className="font-mono text-sm">{order.orderNumber}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-8 w-8">
                                    <AvatarFallback className="bg-blue-100 text-blue-700">
                                      {order.patientName.split(' ').map(n => n[0]).join('')}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div>
                                    <p className="font-medium">{order.patientName}</p>
                                    <p className="text-xs text-gray-500">{order.patientMrn}</p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {order.tests.slice(0, 2).map((test, idx) => (
                                    <Badge key={idx} className={getCategoryBadgeColor(test.testCategory)} variant="outline">
                                      {test.testCode || test.testName?.substring(0, 4) || 'Test'}
                                    </Badge>
                                  ))}
                                  {order.tests.length > 2 && (
                                    <Badge variant="outline">+{order.tests.length - 2}</Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge className={getPriorityBadgeColor(order.priority)}>
                                  {order.priority.toUpperCase()}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge className={getStatusBadgeColor(order.status)} variant="outline">
                                  {formatStatus(order.status)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">
                                <span>{format(new Date(order.orderDate), 'dd MMM yyyy')}</span>
                                <p className="text-xs text-gray-500">{format(new Date(order.orderDate), 'HH:mm')}</p>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setSelectedOrder(order)
                                      setShowViewOrderDialog(true)
                                    }}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  {order.status === 'pending' && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleCollectSample(order.id)}
                                    >
                                      <TestTube className="h-4 w-4 mr-1" />
                                      Collect
                                    </Button>
                                  )}
                                  {order.status === 'sample_collected' && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={() => handleStartProcessing(order.id)}
                                    >
                                      <Play className="h-4 w-4 mr-1" />
                                      Process
                                    </Button>
                                  )}
                                  {order.status === 'in_progress' && (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => {
                                        setSelectedOrder(order)
                                        setActiveTab('results')
                                      }}
                                    >
                                      <FileText className="h-4 w-4 mr-1" />
                                      Results
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title="Print Invoice"
                                    onClick={() => handlePrintLabInvoice(order)}
                                  >
                                    <Receipt className="h-4 w-4" />
                                  </Button>
                                  {order.status === 'completed' && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      title="Print Lab Report"
                                      onClick={() => handlePrintLabReport(order)}
                                    >
                                      <Printer className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                  )}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Results Entry Tab */}
        <TabsContent value="results" className="space-y-4">
          {/* Critical results alert banner */}
          {results.filter(r => r.isCritical).length > 0 && (
            <Alert className="border-red-500 bg-red-50">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              <AlertTitle className="text-red-700 font-bold">
                {results.filter(r => r.isCritical).length} Critical Result{results.filter(r => r.isCritical).length > 1 ? 's' : ''} &mdash; Immediate Attention Required
              </AlertTitle>
              <AlertDescription className="text-red-600">
                {results.filter(r => r.isCritical).map(r => (
                  <span key={r.id} className="inline-block mr-3 font-semibold">
                    &#9888; {r.testName}: {r.resultValue} {r.resultUnit}
                  </span>
                ))}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid md:grid-cols-3 gap-6">
            {/* Order Selection */}
            <Card className="md:col-span-1">
              <CardHeader>
                <CardTitle>Select Order</CardTitle>
                <CardDescription>Choose an order to enter results</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ScrollArea className="h-[400px]">
                  {ordersLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                  ) : orders.filter(o => o.status === 'in_progress' || o.status === 'sample_collected').length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No orders ready for results</p>
                  ) : (
                    <div className="space-y-2">
                      {orders.filter(o => o.status === 'in_progress' || o.status === 'sample_collected').slice((resultsPage - 1) * LAB_ITEMS_PER_PAGE, resultsPage * LAB_ITEMS_PER_PAGE).map(order => (
                        <div
                          key={order.id}
                          className={`p-3 rounded-lg border cursor-pointer transition ${selectedOrder?.id === order.id ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                            }`}
                          onClick={() => setSelectedOrder(order)}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-sm">{order.orderNumber}</span>
                            <Badge className={getPriorityBadgeColor(order.priority)}>
                              {order.priority}
                            </Badge>
                          </div>
                          <p className="font-medium text-sm">{order.patientName}</p>
                          <p className="text-xs text-gray-500">{order.tests.length} test(s)</p>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>

                {/* Pagination for results orders selection */}
                {orders.filter(o => o.status === 'in_progress' || o.status === 'sample_collected').length > LAB_ITEMS_PER_PAGE && (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setResultsPage(prev => Math.max(1, prev - 1))}
                      disabled={resultsPage === 1}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-gray-600">
                      Page {resultsPage} of {Math.ceil(orders.filter(o => o.status === 'in_progress' || o.status === 'sample_collected').length / LAB_ITEMS_PER_PAGE)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setResultsPage(prev => Math.min(Math.ceil(orders.filter(o => o.status === 'in_progress' || o.status === 'sample_collected').length / LAB_ITEMS_PER_PAGE), prev + 1))}
                      disabled={resultsPage === Math.ceil(orders.filter(o => o.status === 'in_progress' || o.status === 'sample_collected').length / LAB_ITEMS_PER_PAGE)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Results Entry Form */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Enter Results</CardTitle>
                <CardDescription>
                  {selectedOrder ? `Order: ${selectedOrder.orderNumber} - ${selectedOrder.patientName}` : 'Select an order to enter results'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedOrder ? (
                  <div className="text-center py-12 text-gray-500">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Select an order from the left to enter results</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedOrder.tests.map(test => {
                      const existingResult = results.find(r => r.orderId === selectedOrder.id && r.testId === test.testId)
                      return (
                        <Card key={test.testId}>
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <Badge className={getCategoryBadgeColor(test.testCategory)}>
                                  {test.testCode || test.testName.substring(0, 4)}
                                </Badge>
                                <span className="font-medium">{test.testName}</span>
                              </div>
                              {existingResult && (
                                <Badge className={getStatusBadgeColor(existingResult.status)}>
                                  {existingResult.status}
                                </Badge>
                              )}
                            </div>

                            {existingResult ? (
                              <div className="space-y-2">
                                <div className="flex items-center gap-4">
                                  <div className="flex-1">
                                    <Label className="text-sm text-gray-500">Result</Label>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xl font-bold">{existingResult.resultValue}</span>
                                      <span className="text-gray-500">{existingResult.resultUnit}</span>
                                      {existingResult.flag && (
                                        <Badge className={
                                          existingResult.isCritical ? 'bg-red-500 text-white' :
                                            existingResult.flag === 'H' ? 'bg-orange-100 text-orange-800' :
                                              existingResult.flag === 'L' ? 'bg-blue-100 text-blue-800' :
                                                'bg-gray-100'
                                        }>
                                          {existingResult.flag === 'H' ? 'HIGH' : existingResult.flag === 'L' ? 'LOW' : existingResult.flag}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-sm text-gray-500">
                                    Reference: {existingResult.referenceRangeText || 'N/A'}
                                  </div>
                                </div>
                                {existingResult.comment && (
                                  <p className="text-sm text-gray-600"><span className="font-medium">Note:</span> {existingResult.comment}</p>
                                )}
                                {existingResult.status === 'draft' && (
                                  <div className="flex gap-2 mt-2">
                                    <Button size="sm" onClick={() => handleVerifyResult(existingResult.id)}>
                                      <CheckCircle className="h-4 w-4 mr-1" />
                                      Verify
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => {
                                      setSelectedTest(tests.find(t => t.id === test.testId) || null)
                                      setSelectedResult(existingResult)
                                      resultForm.setValue('resultValue', existingResult.resultValue)
                                      resultForm.setValue('isAbnormal', existingResult.isAbnormal)
                                      resultForm.setValue('isCritical', existingResult.isCritical)
                                      resultForm.setValue('comment', existingResult.comment)
                                      setShowResultDialog(true)
                                    }}>
                                      <Edit className="h-4 w-4 mr-1" />
                                      Edit
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <Button
                                onClick={() => {
                                  setSelectedTest(tests.find(t => t.id === test.testId) || null)
                                  resultForm.reset()
                                  setShowResultDialog(true)
                                }}
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Enter Result
                              </Button>
                            )}
                          </CardContent>
                        </Card>
                      )
                    })}

                    {selectedOrder.tests.every(test =>
                      results.find(r => r.orderId === selectedOrder.id && r.testId === test.testId && r.status === 'verified')
                    ) && (
                        <Button
                          className="w-full"
                          onClick={() => handleCompleteOrder(selectedOrder.id)}
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Complete Order
                        </Button>
                      )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="space-y-4">
          <div className="grid md:grid-cols-3 gap-6">
            {/* Report Types */}
            <Card className="md:col-span-1">
              <CardHeader>
                <CardTitle>Report Types</CardTitle>
                <CardDescription>Select report type to generate</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { name: 'Patient Report', icon: User, desc: 'Individual lab report for patient' },
                  { name: 'Summary Report', icon: FileBarChart, desc: 'Daily/weekly summary' },
                  { name: 'Quality Control', icon: CheckSquare, desc: 'QC and compliance reports' },
                  { name: 'Critical Values', icon: AlertTriangle, desc: 'Critical results log' },
                  { name: 'Turnaround Time', icon: Clock, desc: 'TAT analysis report' }
                ].map((report, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg border hover:bg-gray-50 cursor-pointer transition"
                    onClick={() => setShowReportDialog(true)}
                  >
                    <div className="flex items-center gap-3">
                      <report.icon className="h-5 w-5 text-blue-600" />
                      <div>
                        <p className="font-medium">{report.name}</p>
                        <p className="text-xs text-gray-500">{report.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Completed Orders for Report */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Completed Orders</CardTitle>
                <CardDescription>Generate reports for completed orders</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  {ordersLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                  ) : orders.filter(o => o.status === 'completed').length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <FileBarChart className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No completed orders to report</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {orders.filter(o => o.status === 'completed').map(order => (
                        <Card key={order.id}>
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-mono text-sm">{order.orderNumber}</span>
                                  <Badge className="bg-green-100 text-green-800">Completed</Badge>
                                </div>
                                <p className="font-medium">{order.patientName}</p>
                                <p className="text-sm text-gray-500">{order.tests.map(t => t.testName).join(', ')}</p>
                                <p className="text-xs text-gray-400 mt-1">
                                  Completed: <span>{format(new Date(order.orderDate), 'dd MMM yyyy')}</span>
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedOrder(order)
                                    setShowViewOrderDialog(true)
                                  }}
                                >
                                  <Eye className="h-4 w-4 mr-1" />
                                  View
                                </Button>
                                <Button size="sm" onClick={() => handlePrintLabReport(order)}>
                                  <Printer className="h-4 w-4 mr-1" />
                                  Print
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <BulkImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={fetchTests}
        title="Import Lab Tests from Excel / CSV"
        description="Upload your pathology test list — each row becomes a test in the catalog. No manual typing per test."
        endpoint="/laboratory/import"
        itemNoun="tests"
        templateFileName="lab-tests-template.xlsx"
        templateColumns={["Test Name", "Code", "Category", "Test Type", "Sample Type", "Container", "Unit", "Reference Range", "Price", "TAT (hours)", "Department", "Preparation"]}
        sampleRows={[
          { "Test Name": "Complete Blood Count (CBC)", Code: "CBC", Category: "hematology", "Test Type": "quantitative", "Sample Type": "blood", Container: "EDTA", Unit: "cells/uL", "Reference Range": "4000-11000", Price: 300, "TAT (hours)": 24, Department: "Pathology", Preparation: "None" },
          { "Test Name": "Lipid Profile", Code: "LIPID", Category: "biochemistry", "Test Type": "quantitative", "Sample Type": "blood", Container: "Plain", Unit: "mg/dL", "Reference Range": "Varies", Price: 600, "TAT (hours)": 12, Department: "Pathology", Preparation: "12 hr fasting" },
        ]}
      />

      {/* Add Test Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Test</DialogTitle>
            <DialogDescription>Add a new laboratory test to the catalog</DialogDescription>
          </DialogHeader>
          <Form {...testForm}>
            <form onSubmit={testForm.handleSubmit(handleCreateTest)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={testForm.control}
                  name="testName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Test Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Complete Blood Count" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={testForm.control}
                  name="testCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Test Code *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., CBC" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={testForm.control}
                  name="testCategory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="hematology">Hematology</SelectItem>
                          <SelectItem value="chemistry">Chemistry</SelectItem>
                          <SelectItem value="urinalysis">Urinalysis</SelectItem>
                          <SelectItem value="microbiology">Microbiology</SelectItem>
                          <SelectItem value="parasitology">Parasitology</SelectItem>
                          <SelectItem value="serology">Serology</SelectItem>
                          <SelectItem value="immunology">Immunology</SelectItem>
                          <SelectItem value="endocrinology">Endocrinology</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={testForm.control}
                  name="testType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Result Type *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="quantitative">Quantitative</SelectItem>
                          <SelectItem value="qualitative">Qualitative</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={testForm.control}
                  name="specimenType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sample Type *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Blood">Blood</SelectItem>
                          <SelectItem value="Urine">Urine</SelectItem>
                          <SelectItem value="Stool">Stool</SelectItem>
                          <SelectItem value="Sputum">Sputum</SelectItem>
                          <SelectItem value="CSF">CSF</SelectItem>
                          <SelectItem value="Swab">Swab</SelectItem>
                          <SelectItem value="Tissue">Tissue</SelectItem>
                          <SelectItem value="Fluid">Fluid</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={testForm.control}
                  name="specimenVolume"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Volume *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 2 mL" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={testForm.control}
                  name="specimenContainer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Container *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., EDTA Tube" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={testForm.control}
                  name="unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., mg/dL" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={testForm.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price (&#8377;) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="0"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={testForm.control}
                  name="turnaroundTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>TAT (hours) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="2"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={testForm.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Hematology" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={testForm.control}
                name="preparationInstructions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preparation Instructions</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Patient preparation instructions..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={testForm.control}
                name="clinicalSignificance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Clinical Significance</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Clinical significance of this test..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowTestDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? 'Adding...' : 'Add Test'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* New Order Dialog */}
      <Dialog
        open={showOrderDialog}
        onOpenChange={(open) => {
          setShowOrderDialog(open)
          if (!open) {
            setSelectedPatient(null)
            orderForm.reset()
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Lab Order</DialogTitle>
            <DialogDescription>Create a new laboratory order</DialogDescription>
          </DialogHeader>
          <Form {...orderForm}>
            <form onSubmit={orderForm.handleSubmit(handleCreateOrder)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={orderForm.control}
                  name="patientId"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Patient *</FormLabel>
                      <PatientLookup
                        selectedPatient={selectedPatient}
                        onSelect={(patient) => {
                          field.onChange(patient.id)
                          setSelectedPatient(patient)
                        }}
                        onClear={() => {
                          field.onChange('')
                          setSelectedPatient(null)
                        }}
                        placeholder="Search registered patient by UHID, name, or phone..."
                        showHint={false}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={orderForm.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="routine">Routine</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                          <SelectItem value="stat">STAT</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={orderForm.control}
                name="tests"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tests *</FormLabel>
                    <Input 
                      placeholder="Search tests..." 
                      value={orderTestSearch}
                      onChange={e => setOrderTestSearch(e.target.value)}
                      className="mb-2"
                    />
                    <div className="border rounded-lg p-4 max-h-60 overflow-y-auto">
                      {testsLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        </div>
                      ) : tests.filter(t => t.isActive).length === 0 ? (
                        <p className="text-center text-gray-500 py-4">No tests available. Add tests to the catalog first.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                          {tests.filter(t => t.isActive && (t.testName.toLowerCase().includes(orderTestSearch.toLowerCase()) || t.testCode.toLowerCase().includes(orderTestSearch.toLowerCase()))).slice(0, 50).map(test => (
                            <label
                              key={test.id}
                              htmlFor={test.id}
                              className="flex items-center gap-2 min-w-0 cursor-pointer rounded-md px-1.5 py-1 hover:bg-gray-50"
                            >
                              <Checkbox
                                id={test.id}
                                className="shrink-0"
                                checked={field.value?.includes(test.id)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    field.onChange([...(field.value || []), test.id])
                                  } else {
                                    field.onChange(field.value?.filter((v) => v !== test.id))
                                  }
                                }}
                              />
                              <Badge className={`${getCategoryBadgeColor(test.testCategory)} shrink-0`} variant="outline">
                                {test.testCode}
                              </Badge>
                              <span className="text-sm truncate" title={test.testName}>{test.testName}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={orderForm.control}
                name="clinicalIndication"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Clinical Indication *</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Clinical reason for ordering tests..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={orderForm.control}
                name="provisionalDiagnosis"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provisional Diagnosis</FormLabel>
                    <FormControl>
                      <Input placeholder="Working diagnosis" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={orderForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Additional Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Any additional notes..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Home collection charge — optional, added to the bill & shown on receipt */}
              <div className="space-y-2">
                <Label>Home Collection Charge (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder={`e.g. ${orgInfo.homeCollectionCharge || 150} (leave blank if collected at lab)`}
                  value={orderHcc}
                  onChange={e => setOrderHcc(e.target.value)}
                />
              </div>

              {/* Payment collected at booking — recorded as a Payment on the invoice */}
              <PaymentFields
                amount={orderAmountPaid}
                method={orderPayMethod}
                onAmountChange={setOrderAmountPaid}
                onMethodChange={setOrderPayMethod}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowOrderDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? 'Creating...' : 'Create Order'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Enter Result Dialog */}
      <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Result</DialogTitle>
            <DialogDescription>
              {selectedTest?.testName} ({selectedTest?.testCode})
            </DialogDescription>
          </DialogHeader>
          <Form {...resultForm}>
            <form onSubmit={resultForm.handleSubmit(handleEnterResults)} className="space-y-4">
              {selectedTest && selectedTest.referenceRanges && selectedTest.referenceRanges.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Reference Range</AlertTitle>
                  <AlertDescription>
                    {selectedTest.referenceRanges[0].minValue} - {selectedTest.referenceRanges[0].maxValue} {selectedTest.referenceRanges[0].unit}
                    {selectedTest.referenceRanges[0].criticalLow && (
                      <span className="ml-2 text-red-600">Critical Low: {selectedTest.referenceRanges[0].criticalLow}</span>
                    )}
                    {selectedTest.referenceRanges[0].criticalHigh && (
                      <span className="ml-2 text-red-600">Critical High: {selectedTest.referenceRanges[0].criticalHigh}</span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <FormField
                control={resultForm.control}
                name="resultValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Result Value *</FormLabel>
                    <div className="flex items-center gap-2">
                      <FormControl>
                        <Input placeholder="Enter result" {...field} />
                      </FormControl>
                      {selectedTest?.unit && <span className="text-gray-500">{selectedTest.unit}</span>}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={resultForm.control}
                  name="isAbnormal"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Abnormal Result</FormLabel>
                    </FormItem>
                  )}
                />
                <FormField
                  control={resultForm.control}
                  name="isCritical"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Critical Value</FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={resultForm.control}
                name="comment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comment</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Add any comments..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowResultDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? 'Saving...' : 'Save Result'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* View Order Dialog */}
      <Dialog open={showViewOrderDialog} onOpenChange={setShowViewOrderDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
            <DialogDescription>
              {selectedOrder?.orderNumber}
            </DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-gray-500">Patient</Label>
                  <p className="font-medium">{selectedOrder.patientName}</p>
                  <p className="text-sm text-gray-500">UHID: {selectedOrder.patientMrn}</p>
                </div>
                <div>
                  <Label className="text-sm text-gray-500">Order Date</Label>
                  <div className="font-medium">{format(new Date(selectedOrder.orderDate), 'dd MMM yyyy')}</div>
                </div>
              </div>

              <div>
                <Label className="text-sm text-gray-500">Clinical Indication</Label>
                <p className="text-sm">{selectedOrder.clinicalIndication || 'Not specified'}</p>
              </div>

              <div>
                <Label className="text-sm text-gray-500">Tests Ordered</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {selectedOrder.tests.map((test, idx) => (
                    <Badge key={idx} className={getCategoryBadgeColor(test.testCategory)}>
                      {test.testName}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm text-gray-500">Priority</Label>
                  <p><Badge className={getPriorityBadgeColor(selectedOrder.priority)}>{selectedOrder.priority.toUpperCase()}</Badge></p>
                </div>
                <div>
                  <Label className="text-sm text-gray-500">Status</Label>
                  <p><Badge className={getStatusBadgeColor(selectedOrder.status)}>{formatStatus(selectedOrder.status)}</Badge></p>
                </div>
              </div>

              {selectedOrder.accessionNumber && (
                <div>
                  <Label className="text-sm text-gray-500">Accession Number</Label>
                  <p className="font-mono">{selectedOrder.accessionNumber}</p>
                </div>
              )}

              {selectedOrder.notes && (
                <div>
                  <Label className="text-sm text-gray-500">Notes</Label>
                  <p className="text-sm">{selectedOrder.notes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewOrderDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Dialog Placeholder */}
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Report</DialogTitle>
            <DialogDescription>
              Report generation feature coming soon
            </DialogDescription>
          </DialogHeader>
          <div className="py-8 text-center text-gray-500">
            <FileBarChart className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Report generation will be available in a future update.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReportDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
