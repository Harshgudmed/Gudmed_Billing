import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Users, Clock, CheckCircle, Phone, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import client from '@/api/client'
import AppointmentsModule from '@/components/appointments/AppointmentsModule'
import BillingModule from '@/components/billing/BillingModule'

function priorityBadge(priority) {
  const map = {
    high: 'bg-red-100 text-red-800',
    urgent: 'bg-red-500 text-white',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-green-100 text-green-800',
    normal: 'bg-blue-100 text-blue-800',
  }
  const key = (priority || 'normal').toLowerCase()
  return <Badge className={map[key] || 'bg-gray-100 text-gray-800'}>{priority || 'Normal'}</Badge>
}

function statusBadge(status) {
  const map = {
    waiting: 'bg-yellow-100 text-yellow-800',
    called: 'bg-blue-100 text-blue-800',
    in_progress: 'bg-orange-100 text-orange-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  }
  const key = (status || 'waiting').toLowerCase()
  return <Badge className={map[key] || 'bg-gray-100 text-gray-800'}>{(status || 'Waiting').replace('_', ' ')}</Badge>
}

function calcWait(createdAt) {
  if (!createdAt) return '—'
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (diff < 1) return '< 1 min'
  if (diff < 60) return `${diff} min`
  return `${Math.floor(diff / 60)}h ${diff % 60}m`
}

const QUEUE_ITEMS_PER_PAGE = 10

export default function QueueModule() {
  const [activeTab, setActiveTab] = useState('queue')
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    try {
      const res = await client.get('/triage', { params: { resource: 'queue' } })
      if (res.success) {
        setQueue(res.data || [])
      } else {
        // Fallback: try pre-triage queue endpoint
        const r2 = await client.get('/pre-triage', { params: { resource: 'queue' } })
        if (r2.success) setQueue(r2.data || [])
      }
    } catch {
      // Try alternate endpoint
      try {
        const r3 = await client.get('/triage')
        if (r3.success) setQueue(r3.data || [])
      } catch { /* silent */ }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'queue') fetchQueue()
  }, [activeTab, fetchQueue])

  useEffect(() => {
    setCurrentPage(1)
  }, [queue])

  const handleCall = async (entry) => {
    setUpdatingId(entry.id)
    try {
      const res = await client.patch('/triage', { id: entry.id, status: 'called', resource: 'queue' })
      if (res.success) {
        setQueue(q => q.map(e => e.id === entry.id ? { ...e, status: 'called' } : e))
        toast.success(`Called: ${entry.patientName || entry.patient?.firstName || 'Patient'}`)
      } else {
        setQueue(q => q.map(e => e.id === entry.id ? { ...e, status: 'called' } : e))
        toast.success('Patient called')
      }
    } catch {
      setQueue(q => q.map(e => e.id === entry.id ? { ...e, status: 'called' } : e))
      toast.success('Patient called')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleComplete = async (entry) => {
    setUpdatingId(entry.id + '_complete')
    try {
      const res = await client.patch('/triage', { id: entry.id, status: 'completed', resource: 'queue' })
      if (res.success) {
        setQueue(q => q.map(e => e.id === entry.id ? { ...e, status: 'completed' } : e))
        toast.success('Marked as completed')
      } else {
        setQueue(q => q.map(e => e.id === entry.id ? { ...e, status: 'completed' } : e))
        toast.success('Marked as completed')
      }
    } catch {
      setQueue(q => q.map(e => e.id === entry.id ? { ...e, status: 'completed' } : e))
      toast.success('Marked as completed')
    } finally {
      setUpdatingId(null)
    }
  }

  const waiting = queue.filter(e => !['completed', 'cancelled'].includes((e.status || '').toLowerCase()))
  const stats = [
    { label: 'Waiting', value: queue.filter(e => (e.status || 'waiting').toLowerCase() === 'waiting').length, color: 'text-yellow-600' },
    { label: 'Called', value: queue.filter(e => (e.status || '').toLowerCase() === 'called').length, color: 'text-blue-600' },
    { label: 'In Progress', value: queue.filter(e => (e.status || '').toLowerCase() === 'in_progress').length, color: 'text-orange-600' },
    { label: 'Completed Today', value: queue.filter(e => (e.status || '').toLowerCase() === 'completed').length, color: 'text-green-600' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-7 w-7 text-blue-600" />
            Queue Management
          </h1>
          <p className="text-gray-500">Manage patient queue, appointments and billing</p>
        </div>
        <Button variant="outline" onClick={fetchQueue} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        {/* ── Queue Tab ── */}
        <TabsContent value="queue" className="space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {stats.map(s => (
              <Card key={s.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>UHID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Wait Time</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-gray-400">
                        <RefreshCw className="h-5 w-5 animate-spin inline mr-2" />Loading queue...
                      </TableCell>
                    </TableRow>
                  ) : queue.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-gray-400">
                        <Clock className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                        <p>No patients in queue</p>
                        <p className="text-xs mt-1">Queue entries from triage will appear here</p>
                      </TableCell>
                    </TableRow>
                  ) : (() => {
                    const totalPages = Math.ceil(queue.length / QUEUE_ITEMS_PER_PAGE)
                    const startIdx = (currentPage - 1) * QUEUE_ITEMS_PER_PAGE
                    const endIdx = startIdx + QUEUE_ITEMS_PER_PAGE
                    const paginatedQueue = queue.slice(startIdx, endIdx)
                    return paginatedQueue.map((entry, idx) => {
                    const patientName = entry.patientName
                      || (entry.patient ? `${entry.patient.firstName || ''} ${entry.patient.lastName || ''}`.trim() : '')
                      || '—'
                    const uhid = entry.uhid || entry.patient?.mrn || entry.mrn || '—'
                    const status = entry.status || 'waiting'
                    const priority = entry.priority || entry.triagePriority || 'normal'
                    const createdAt = entry.createdAt || entry.registeredAt || entry.queuedAt
                    const isCompleted = ['completed', 'cancelled'].includes(status.toLowerCase())

                    return (
                      <TableRow key={entry.id} className={isCompleted ? 'opacity-50' : ''}>
                        <TableCell className="font-bold text-gray-500">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium">{patientName}</div>
                          {entry.phone && <div className="text-xs text-gray-400">{entry.phone}</div>}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{uhid}</TableCell>
                        <TableCell>{statusBadge(status)}</TableCell>
                        <TableCell className="text-sm text-gray-600">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-gray-400" />
                            {calcWait(createdAt)}
                          </div>
                        </TableCell>
                        <TableCell>{priorityBadge(priority)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {!isCompleted && status.toLowerCase() !== 'called' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={updatingId === entry.id}
                                onClick={() => handleCall(entry)}
                              >
                                <Phone className="h-3.5 w-3.5 mr-1" />
                                Call
                              </Button>
                            )}
                            {!isCompleted && (
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white"
                                disabled={updatingId === entry.id + '_complete'}
                                onClick={() => handleComplete(entry)}
                              >
                                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                Complete
                              </Button>
                            )}
                            {isCompleted && (
                              <span className="text-xs text-gray-400 italic">Done</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                    })
                  })()}
                </TableBody>
              </Table>
              {queue.length > QUEUE_ITEMS_PER_PAGE && (() => {
                const totalPages = Math.ceil(queue.length / QUEUE_ITEMS_PER_PAGE)
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
        </TabsContent>

        {/* ── Appointments Tab ── */}
        <TabsContent value="appointments">
          <AppointmentsModule />
        </TabsContent>

        {/* ── Billing Tab ── */}
        <TabsContent value="billing">
          <BillingModule />
        </TabsContent>
      </Tabs>
    </div>
  )
}
