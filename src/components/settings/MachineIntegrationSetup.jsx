import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Cpu, Plus, Edit, RefreshCw, Loader2, Trash2, Server, Activity } from 'lucide-react'
import { toast } from 'sonner'
import machineIntegrationApi from '@/api/machineIntegrationApi'

const MACHINE_TYPES = [
  { value: 'lab_analyzer', label: 'Lab Analyzer (LIS)' },
  { value: 'radiology_equipment', label: 'Radiology Equipment' },
  { value: 'vital_signs_monitor', label: 'Vital Signs Monitor' },
]
const CONNECTION_TYPES = [
  { value: 'hl7', label: 'HL7 v2 (TCP/MLLP)' },
  { value: 'astm', label: 'ASTM E1394' },
  { value: 'rest_api', label: 'REST API' },
  { value: 'file_upload', label: 'File Upload' },
  { value: 'serial', label: 'Serial (RS232)' },
]

const emptyForm = {
  id: null,
  machineName: '',
  machineType: 'lab_analyzer',
  manufacturer: '',
  model: '',
  serialNumber: '',
  department: 'laboratory',
  connectionType: 'hl7',
  port: '',
  isActive: true,
  mappingRows: [{ code: '', testId: '' }],
}

function statusBadge(mi) {
  if (!mi.isActive) return <Badge variant="secondary">Inactive</Badge>
  const map = {
    connected: 'bg-green-100 text-green-700',
    disconnected: 'bg-gray-100 text-gray-600',
    error: 'bg-red-100 text-red-700',
  }
  return <Badge className={map[mi.connectionStatus] || undefined}>{mi.connectionStatus || 'unknown'}</Badge>
}

function queueBadge(status) {
  const map = {
    imported: 'bg-green-100 text-green-700',
    matched: 'bg-blue-100 text-blue-700',
    pending: 'bg-yellow-100 text-yellow-700',
    manual_review: 'bg-orange-100 text-orange-700',
    failed: 'bg-red-100 text-red-700',
  }
  return <Badge className={map[status] || undefined}>{status}</Badge>
}

export default function MachineIntegrationSetup() {
  const [machines, setMachines] = useState([])
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [mi, q] = await Promise.all([
        machineIntegrationApi.listIntegrations(),
        machineIntegrationApi.listQueue({ limit: 20 }).catch(() => ({ data: [] })),
      ])
      setMachines(mi.data || [])
      setQueue(q.data || [])
    } catch (e) {
      toast.error('Could not load machine integrations', { description: e.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => { setForm(emptyForm); setDialogOpen(true) }

  const openEdit = (mi) => {
    let port = ''
    try { port = JSON.parse(mi.connectionDetails || '{}').port ?? '' } catch { /* ignore */ }
    let mappingRows = [{ code: '', testId: '' }]
    try {
      const m = JSON.parse(mi.testMapping || '{}')
      const rows = Object.entries(m).map(([code, testId]) => ({ code, testId }))
      if (rows.length) mappingRows = rows
    } catch { /* ignore */ }
    setForm({
      id: mi.id,
      machineName: mi.machineName || '',
      machineType: mi.machineType || 'lab_analyzer',
      manufacturer: mi.manufacturer || '',
      model: mi.model || '',
      serialNumber: mi.serialNumber || '',
      department: mi.department || '',
      connectionType: mi.connectionType || 'hl7',
      port: String(port),
      isActive: mi.isActive,
      mappingRows,
    })
    setDialogOpen(true)
  }

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setMapRow = (i, k, v) => setForm((f) => {
    const rows = [...f.mappingRows]; rows[i] = { ...rows[i], [k]: v }; return { ...f, mappingRows: rows }
  })
  const addMapRow = () => setForm((f) => ({ ...f, mappingRows: [...f.mappingRows, { code: '', testId: '' }] }))
  const removeMapRow = (i) => setForm((f) => ({ ...f, mappingRows: f.mappingRows.filter((_, idx) => idx !== i) }))

  const save = async () => {
    if (!form.machineName.trim()) return toast.error('Machine name is required')
    if (form.connectionType === 'hl7' && !form.port) return toast.error('Port is required for an HL7 machine')

    const testMapping = {}
    for (const r of form.mappingRows) {
      if (r.code.trim() && r.testId.trim()) testMapping[r.code.trim()] = r.testId.trim()
    }
    const payload = {
      machineName: form.machineName.trim(),
      machineType: form.machineType,
      manufacturer: form.manufacturer || undefined,
      model: form.model || undefined,
      serialNumber: form.serialNumber || undefined,
      department: form.department || undefined,
      connectionType: form.connectionType,
      connectionDetails: JSON.stringify(form.port ? { port: Number(form.port) } : {}),
      testMapping: JSON.stringify(testMapping),
      isActive: form.isActive,
    }
    setSaving(true)
    try {
      if (form.id) await machineIntegrationApi.update({ id: form.id, ...payload })
      else await machineIntegrationApi.create(payload)
      toast.success(form.id ? 'Machine updated' : 'Machine added')
      setDialogOpen(false)
      load()
    } catch (e) {
      toast.error('Save failed', { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const reprocess = async (id) => {
    try {
      const r = await machineIntegrationApi.reprocess(id)
      toast.success(`Reprocessed: ${r.data?.status || 'done'}`)
      load()
    } catch (e) {
      toast.error('Reprocess failed', { description: e.message })
    }
  }

  return (
    <>
      {/* ── Machines ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Cpu className="h-5 w-5" />Lab & Device Machines</CardTitle>
              <CardDescription>
                Connect analyzers / equipment for this hospital. Results flow in automatically — no manual typing.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />Refresh
              </Button>
              <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" />Add Machine</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-gray-500 py-6"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
          ) : machines.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
              No machines yet. Click <b>Add Machine</b> to connect your first analyzer.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Machine</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Port</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Result</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {machines.map((mi) => {
                  let port = '—'
                  try { port = JSON.parse(mi.connectionDetails || '{}').port ?? '—' } catch { /* ignore */ }
                  return (
                    <TableRow key={mi.id}>
                      <TableCell>
                        <div className="font-medium">{mi.machineName}</div>
                        <div className="text-xs text-gray-500">{[mi.manufacturer, mi.model].filter(Boolean).join(' ')}</div>
                      </TableCell>
                      <TableCell className="text-sm">{MACHINE_TYPES.find(t => t.value === mi.machineType)?.label || mi.machineType}</TableCell>
                      <TableCell className="text-sm uppercase">{mi.connectionType}</TableCell>
                      <TableCell className="font-mono text-sm">{port}</TableCell>
                      <TableCell>{statusBadge(mi)}</TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {mi.lastResultReceivedAt ? new Date(mi.lastResultReceivedAt).toLocaleString() : 'never'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(mi)}><Edit className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Incoming result queue ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Incoming Result Queue</CardTitle>
          <CardDescription>
            Live feed of messages received from machines. "manual_review" = order not matched or an analyzer
            code isn't mapped yet — open it to see the code, add it to the machine's mapping, then Reprocess.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <div className="text-center py-6 text-gray-500 text-sm">No messages received yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead>Patient / Msg</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="text-xs">{new Date(q.receivedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{q.machineIntegration?.machineName || '—'}</TableCell>
                    <TableCell className="text-xs">{q.patientIdentifier || '—'}</TableCell>
                    <TableCell>{queueBadge(q.status)}</TableCell>
                    <TableCell className="text-xs text-orange-700 max-w-[220px] truncate" title={q.errorMessage || ''}>
                      {q.errorMessage || ''}
                    </TableCell>
                    <TableCell className="text-right">
                      {(q.status === 'manual_review' || q.status === 'failed' || q.status === 'pending') && (
                        <Button variant="outline" size="sm" onClick={() => reprocess(q.id)}>
                          <RefreshCw className="h-3 w-3 mr-1" />Reprocess
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Add / Edit dialog ─────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Machine' : 'Add Machine'}</DialogTitle>
            <DialogDescription>Configure how this analyzer/device connects and how its test codes map to your tests.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="space-y-1">
              <Label>Machine Name *</Label>
              <Input value={form.machineName} onChange={(e) => setField('machineName', e.target.value)} placeholder="e.g. Cobas c311" />
            </div>
            <div className="space-y-1">
              <Label>Machine Type</Label>
              <Select value={form.machineType} onValueChange={(v) => setField('machineType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MACHINE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Manufacturer</Label>
              <Input value={form.manufacturer} onChange={(e) => setField('manufacturer', e.target.value)} placeholder="e.g. Roche / Sysmex / Mindray" />
            </div>
            <div className="space-y-1">
              <Label>Model</Label>
              <Input value={form.model} onChange={(e) => setField('model', e.target.value)} placeholder="e.g. BC-5150" />
            </div>
            <div className="space-y-1">
              <Label>Serial Number</Label>
              <Input value={form.serialNumber} onChange={(e) => setField('serialNumber', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Department</Label>
              <Input value={form.department} onChange={(e) => setField('department', e.target.value)} placeholder="laboratory" />
            </div>
            <div className="space-y-1">
              <Label>Connection Type</Label>
              <Select value={form.connectionType} onValueChange={(v) => setField('connectionType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONNECTION_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Port {form.connectionType === 'hl7' && '*'}</Label>
              <Input type="number" value={form.port} onChange={(e) => setField('port', e.target.value)} placeholder="e.g. 6661" />
              <p className="text-xs text-gray-500">Machine ki LIS setting mein: Host = server IP, Port = yahi.</p>
            </div>
          </div>

          {/* Test code mapping */}
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Test Code Mapping</Label>
              <Button variant="ghost" size="sm" onClick={addMapRow}><Plus className="h-3 w-3 mr-1" />Add row</Button>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Analyzer ka test code → aapke LabTest ki ID. (Code na pata ho to khali chhod do — pehla result aane par
              queue mein "manual_review" dikhega jisme code mil jayega.)
            </p>
            <div className="space-y-2">
              {form.mappingRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input className="flex-1" value={row.code} onChange={(e) => setMapRow(i, 'code', e.target.value)} placeholder="Analyzer code (e.g. 718-7)" />
                  <span className="text-gray-400">→</span>
                  <Input className="flex-1" value={row.testId} onChange={(e) => setMapRow(i, 'testId', e.target.value)} placeholder="Your LabTest id" />
                  <Button variant="ghost" size="icon" onClick={() => removeMapRow(i)}><Trash2 className="h-4 w-4 text-gray-400" /></Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Switch checked={form.isActive} onCheckedChange={(v) => setField('isActive', v)} id="mi-active" />
            <Label htmlFor="mi-active">Active (listen for results)</Label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{form.id ? 'Update' : 'Add'} Machine
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
