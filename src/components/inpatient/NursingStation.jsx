import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { format, addDays, subDays, isSameDay } from 'date-fns'
import { Activity, HeartPulse, ClipboardList, Pill, Loader2, Plus, AlertTriangle, ChevronLeft, ChevronRight, Calendar, CheckCircle2, FlaskConical, Scan, Stethoscope, XCircle, Clock, ClipboardCheck, Circle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import client from '@/api/client'
import { useAuth } from '@/lib/auth'
import { cToF, fToC } from '@/lib/utils'
import { getFullName } from "@/lib/patient";

const NOTE_TYPES = ['Nursing admission assessment', 'Shift handover note', 'Other notes']
const MAR_STATUSES = ['GIVEN', 'MISSED', 'HELD', 'REFUSED']
const DRUG_FORMS = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Cream",
  "Ointment",
  "Drops",
  "Inhaler",
  "Suppository",
  "Solution",
  "Suspension",
];
const CONSCIOUSNESS = ['ALERT', 'CONFUSION', 'VOICE', 'PAIN', 'UNRESPONSIVE']

const MAR_SLOTS = [
  { id: 'morning', label: 'Morning', time: '08:00' },
  { id: 'afternoon', label: 'Afternoon', time: '14:00' },
  { id: 'evening', label: 'Evening', time: '20:00' },
  { id: 'night', label: 'Night', time: '22:00' },
]

const getRequiredSlots = (freq) => {
  const f = (freq || '').toUpperCase()
  if (f.includes('OD') || f.includes('QD')) return ['morning']
  if (f.includes('BD') || f.includes('BID')) return ['morning', 'evening']
  if (f.includes('TDS') || f.includes('TID')) return ['morning', 'afternoon', 'evening']
  if (f.includes('QID')) return ['morning', 'afternoon', 'evening', 'night']
  if (f.includes('HS')) return ['night']
  return [] // Empty means SOS/Ad-Hoc
}

// Client-side NEWS2 for instant feedback (server recomputes authoritatively).
function news2(v) {
  const n = (x) => (x === '' || x == null ? null : Number(x))
  const rr = n(v.respiratoryRate), sp = n(v.spo2), sbp = n(v.systolicBp), hr = n(v.heartRate), t = n(v.tempC)
  const pts = []
  pts.push(rr == null ? 0 : rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3)
  pts.push(sp == null ? 0 : sp >= 96 ? 0 : sp >= 94 ? 1 : sp >= 92 ? 2 : 3)
  pts.push(sbp == null ? 0 : sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3)
  pts.push(hr == null ? 0 : hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3)
  pts.push(t == null ? 0 : t <= 35 ? 3 : t <= 36 ? 1 : t <= 38 ? 0 : t <= 39 ? 1 : 2)
  pts.push(!v.consciousness || v.consciousness === 'ALERT' ? 0 : 3)
  const score = pts.reduce((a, b) => a + b, 0)
  const any3 = pts.some((p) => p === 3)
  const risk = score >= 7 ? 'HIGH' : score >= 5 || any3 ? 'MEDIUM' : 'LOW'
  return { score, risk }
}

const riskStyle = { LOW: 'bg-green-100 text-green-800', MEDIUM: 'bg-amber-100 text-amber-800', HIGH: 'bg-red-100 text-red-800' }

const emptyVitals = { systolicBp: '', diastolicBp: '', heartRate: '', respiratoryRate: '', spo2: '', tempC: '', painScore: '', consciousness: 'ALERT', bloodSugar: '', notes: '' }

export default function NursingStation({ admitted = [] }) {
  const { user } = useAuth()
  // Vitals are nurse-only to record/correct (doctors view). In demo mode (no
  // logged-in user) the form stays available so the demo keeps working.
  const canRecordVitals = !user || ['nurse', 'admin', 'super_admin'].includes(user.role)
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState('vitals')
  const [vitals, setVitals] = useState([])
  const [notes, setNotes] = useState([])
  const [mar, setMar] = useState([])
  const [orders, setOrders] = useState([])
  const [orderTasks, setOrderTasks] = useState([])
  const [chartDate, setChartDate] = useState(new Date())
  const [loading, setLoading] = useState(false)

  const [vForm, setVForm] = useState(emptyVitals)
  const [nForm, setNForm] = useState({ noteType: 'Nursing admission assessment', body: '' })
  const [mForm, setMForm] = useState({ drugName: '', dosage: '', route: 'Oral', status: 'GIVEN', reason: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!selectedId && admitted.length) setSelectedId(admitted[0].id)
  }, [admitted, selectedId])

  const load = useCallback(async (id) => {
    if (!id) return
    setLoading(true)
    try {
      const [v, n, m, o, t] = await Promise.all([
        client.get(`/inpatient?resource=vitals&admissionId=${id}`),
        client.get(`/inpatient?resource=clinical-notes-v2&admissionId=${id}`),
        client.get(`/inpatient?resource=medication-administration&admissionId=${id}`),
        client.get(`/inpatient?resource=orders&admissionId=${id}`),
        client.get(`/inpatient?resource=order-tasks&admissionId=${id}`),
      ])
      setVitals(v.data || [])
      setNotes(n.data || [])
      setMar(m.data || [])
      setOrders(o.data || [])
      setOrderTasks(t.data || [])
    } catch (e) { toast.error('Failed to load nursing data') }
    setLoading(false)
  }, [])

  useEffect(() => { if (selectedId) load(selectedId) }, [selectedId, load])

  // Form holds Fahrenheit (what staff type); NEWS2 is Celsius-based → convert for scoring.
  const livePreview = news2({ ...vForm, tempC: fToC(vForm.tempC) })

  const saveVitals = async () => {
    setSaving(true)
    try {
      // Convert the typed Fahrenheit back to Celsius for storage + NEWS2 scoring.
      const res = await client.post('/inpatient', { resource: 'vitals', admissionId: selectedId, ...vForm, tempC: fToC(vForm.tempC) })
      if (res.success) {
        toast.success(`Vitals recorded · NEWS ${res.data.newsScore} (${res.data.newsRisk})`)
        if (res.data.newsRisk === 'HIGH') toast.error('⚠ HIGH early-warning score — escalate to doctor')
        setVForm(emptyVitals); load(selectedId)
      } else toast.error(res.error || 'Failed')
    } catch { toast.error('Failed to record vitals') }
    setSaving(false)
  }

  const saveNote = async () => {
    if (!nForm.body.trim()) { toast.error('Note text required'); return }
    setSaving(true)
    try {
      const res = await client.post('/inpatient', { resource: 'note-v2', admissionId: selectedId, ...nForm })
      if (res.success) { toast.success('Note added'); setNForm({ noteType: 'NURSING', body: '' }); load(selectedId) }
      else toast.error(res.error || 'Failed')
    } catch { toast.error('Failed to add note') }
    setSaving(false)
  }

  const saveMar = async () => {
    if (!mForm.drugName.trim()) { toast.error('Drug name required'); return }
    setSaving(true)
    try {
      const res = await client.post('/inpatient', { resource: 'medication-administration', admissionId: selectedId, ...mForm })
      if (res.success) { toast.success(`Medication ${mForm.status.toLowerCase()}`); setMForm({ drugName: '', dosage: '', route: 'Oral', status: 'GIVEN', reason: '' }); load(selectedId) }
      else toast.error(res.error || 'Failed')
    } catch { toast.error('Failed to record administration') }
    setSaving(false)
  }

  const markGivenSlot = async (order, slotTime = null) => {
    setSaving(true)
    try {
      let schedIso = undefined;
      if (slotTime) {
        const [hh, mm] = slotTime.split(':')
        const sched = new Date(chartDate)
        sched.setHours(Number(hh), Number(mm), 0, 0)
        schedIso = sched.toISOString()
      }
      const payload = { 
        resource: 'medication-administration', 
        admissionId: selectedId, 
        drugName: order.itemName, 
        dosage: order.dosage || String(order.quantity), 
        route: order.route || 'Oral', 
        status: 'GIVEN', 
        reason: '',
        scheduledAt: schedIso
      }
      const res = await client.post('/inpatient', payload)
      if (res.success) { 
        toast.success(`Dose given: ${order.itemName}`)
        load(selectedId) 
      } else {
        toast.error(res.error || 'Failed')
      }
    } catch { toast.error('Failed to record administration') }
    setSaving(false)
  }

  const markTask = async (task, status = 'DONE') => {
    setSaving(true)
    try {
      const res = await client.patch('/inpatient', { resource: 'order-task', id: task.id, status })
      if (res.success) {
        toast.success(status === 'DONE' ? `Done: ${task.itemName}` : `${task.itemName} marked ${status.toLowerCase()}`)
        load(selectedId)
      } else toast.error(res.error || 'Failed')
    } catch { toast.error('Failed to update task') }
    setSaving(false)
  }

  // Group this patient's scheduled tasks by order, then keep only the selected day's
  // occurrences for the chart. Each row = one order; each cell = one occurrence.
  const tasksForDay = orderTasks.filter((t) => isSameDay(new Date(t.scheduledAt), chartDate))
  const chartRows = Object.values(
    tasksForDay.reduce((acc, t) => {
      const key = t.orderId
      if (!acc[key]) acc[key] = { orderId: key, orderType: t.orderType, itemName: t.itemName, tasks: [] }
      acc[key].tasks.push(t)
      return acc
    }, {})
  ).map((row) => ({
    ...row,
    tasks: row.tasks.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)),
    doneCount: row.tasks.filter((t) => t.status === 'DONE').length,
  }))

  // Day-level summary for the chart header strip.
  const dayStats = {
    total: tasksForDay.length,
    done: tasksForDay.filter((t) => t.status === 'DONE').length,
    due: tasksForDay.filter((t) => t.status === 'DUE').length,
    missed: tasksForDay.filter((t) => ['MISSED', 'HELD', 'SKIPPED'].includes(t.status)).length,
  }

  const TASK_TYPE = {
    LAB: { label: 'Pathology', Icon: FlaskConical, badge: 'bg-sky-100 text-sky-700', tile: 'bg-sky-50 text-sky-600' },
    RADIOLOGY: { label: 'Radiology', Icon: Scan, badge: 'bg-indigo-100 text-indigo-700', tile: 'bg-indigo-50 text-indigo-600' },
    PHARMACY: { label: 'Meds', Icon: Pill, badge: 'bg-violet-100 text-violet-700', tile: 'bg-violet-50 text-violet-600' },
    PROCEDURE: { label: 'Procedure', Icon: Stethoscope, badge: 'bg-teal-100 text-teal-700', tile: 'bg-teal-50 text-teal-600' },
  }

  const activePrescriptions = orders.filter((o) => o.orderType === 'PHARMACY' && !['COMPLETED', 'CANCELLED'].includes(o.status))

  const patient = admitted.find((a) => a.id === selectedId)?.patient

  if (!admitted.length) {
    return (
      <Card><CardContent className="py-14 text-center text-gray-400">
        <HeartPulse className="h-10 w-10 mx-auto mb-3 text-gray-200" />
        No admitted patients. Admit a patient to use the Nursing Station.
      </CardContent></Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Patient picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <Label className="text-sm font-medium">Patient:</Label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-80"><SelectValue placeholder="Select admitted patient" /></SelectTrigger>
          <SelectContent>
            {admitted.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {getFullName(a.patient)} · {a.patient?.mrn} · {a.bed?.ward?.name || 'Ward'}/{a.bed?.bedNumber || '—'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {patient && <Badge variant="outline" className="text-xs">{patient.gender}</Badge>}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b">
        {[{ id: 'vitals', label: 'Vitals & NEWS', Icon: Activity }, { id: 'notes', label: 'Clinical Notes', Icon: ClipboardList }, { id: 'mar', label: 'Medications (eMAR)', Icon: Pill }, { id: 'chart', label: 'Treatment Chart', Icon: CheckCircle2 }].map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {/* VITALS */}
      {tab === 'vitals' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {canRecordVitals ? (
          <Card><CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-blue-600" />Record Vitals</p>
              <Badge className={riskStyle[livePreview.risk]}>Live NEWS {livePreview.score} · {livePreview.risk}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[['systolicBp', 'Systolic BP'], ['diastolicBp', 'Diastolic BP'], ['heartRate', 'Heart Rate'], ['respiratoryRate', 'Resp Rate'], ['spo2', 'SpO₂ %'], ['tempC', 'Temp °F'], ['painScore', 'Pain 0-10'], ['bloodSugar', 'Blood Sugar']].map(([k, label]) => (
                <div key={k}>
                  <Label className="text-[11px] text-gray-500">{label}</Label>
                  <Input className="mt-0.5 h-9" type="number" value={vForm[k]} onChange={(e) => setVForm((p) => ({ ...p, [k]: e.target.value }))} />
                </div>
              ))}
              <div className="col-span-1">
                <Label className="text-[11px] text-gray-500">Consciousness</Label>
                <Select value={vForm.consciousness} onValueChange={(v) => setVForm((p) => ({ ...p, consciousness: v }))}>
                  <SelectTrigger className="mt-0.5 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONSCIOUSNESS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {livePreview.risk === 'HIGH' && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />High score — escalate to doctor on submit.</p>}
            <Button onClick={saveVitals} disabled={saving} className="w-full">{saving ? 'Saving…' : 'Record Vitals'}</Button>
          </CardContent></Card>
          ) : (
          <Card><CardContent className="pt-4">
            <p className="font-semibold text-sm flex items-center gap-2 mb-2"><Activity className="h-4 w-4 text-gray-400" />Vitals</p>
            <p className="text-sm text-gray-500">Vitals are recorded by nursing staff. You have <span className="font-medium">view-only</span> access — review the recorded readings and NEWS trend on the right.</p>
          </CardContent></Card>
          )}

          <Card><CardContent className="pt-4">
            <p className="font-semibold text-sm mb-2">Recent Vitals</p>
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {vitals.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No vitals recorded</p> : vitals.map((v) => (
                <div key={v.id} className="border rounded-lg p-2.5 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <Badge className={riskStyle[v.newsRisk] + ' text-[10px]'}>NEWS {v.newsScore} · {v.newsRisk}</Badge>
                    <span className="text-gray-400">{v.recordedAt ? format(new Date(v.recordedAt), 'dd MMM HH:mm') : ''}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-600">
                    {v.systolicBp != null && <span>BP {v.systolicBp}/{v.diastolicBp ?? '—'}</span>}
                    {v.heartRate != null && <span>HR {v.heartRate}</span>}
                    {v.respiratoryRate != null && <span>RR {v.respiratoryRate}</span>}
                    {v.spo2 != null && <span>SpO₂ {v.spo2}%</span>}
                    {v.tempC != null && <span>{cToF(v.tempC)}°F</span>}
                    {v.bloodSugar != null && <span>Sugar {v.bloodSugar}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent></Card>
        </div>
      )}

      {/* NOTES */}
      {tab === 'notes' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card><CardContent className="pt-4 space-y-3">
            <p className="font-semibold text-sm">Add Clinical Note</p>
            <Select value={nForm.noteType} onValueChange={(v) => setNForm((p) => ({ ...p, noteType: v }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{NOTE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea rows={4} placeholder="Enter note…" value={nForm.body} onChange={(e) => setNForm((p) => ({ ...p, body: e.target.value }))} />
            <Button onClick={saveNote} disabled={saving} className="w-full"><Plus className="h-4 w-4 mr-1" />Add Note</Button>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <p className="font-semibold text-sm mb-2">Notes Timeline</p>
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {notes.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No notes</p> : notes.map((n) => (
                <div key={n.id} className="border rounded-lg p-2.5 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[10px]">{n.noteType}</Badge>
                    <span className="text-xs text-gray-400">{n.authoredAt ? format(new Date(n.authoredAt), 'dd MMM HH:mm') : ''}{n.authorName ? ` · ${n.authorName}` : ''}</span>
                  </div>
                  <p className="text-gray-700">{n.body}</p>
                </div>
              ))}
            </div>
          </CardContent></Card>
        </div>
      )}

      {/* eMAR */}
      {tab === 'mar' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 p-0">
              {/* Chart Header (Date Navigation) */}
              <div className="flex items-center justify-between border-b px-4 py-3 bg-gray-50/50">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-violet-600" />
                  <h3 className="font-semibold text-gray-900">Medication Administration Record (MAR)</h3>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setChartDate(subDays(chartDate, 1))}><ChevronLeft className="h-4 w-4" /></Button>
                  <div className="flex items-center gap-2 font-medium text-sm text-gray-700 w-32 justify-center">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    {isSameDay(chartDate, new Date()) ? 'Today' : format(chartDate, 'dd MMM yyyy')}
                  </div>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setChartDate(addDays(chartDate, 1))}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 border-b text-gray-600 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 font-medium">Medication Details</th>
                      {MAR_SLOTS.map(s => <th key={s.id} className="px-4 py-3 font-medium text-center">{s.label} <span className="block text-[10px] text-gray-400 normal-case">{s.time}</span></th>)}
                      <th className="px-4 py-3 font-medium text-center">Ad-Hoc / SOS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activePrescriptions.length === 0 ? (
                      <tr><td colSpan={6} className="py-10 text-center text-gray-400">No active prescriptions for this patient.</td></tr>
                    ) : activePrescriptions.map(o => {
                      const req = getRequiredSlots(o.frequency)
                      
                      return (
                        <tr key={o.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-violet-900">{o.itemName}</p>
                              {o.priority === 'STAT' && <Badge className="bg-red-100 text-red-800 text-[10px]">STAT</Badge>}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {o.dosage || o.quantity} · {o.route || 'Oral'} · {o.frequency || 'SOS'} {o.duration ? `· for ${o.duration}` : ''}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-1">Prescribed by {o.orderedByName || 'Doctor'}</p>
                          </td>
                          {MAR_SLOTS.map(s => {
                            const isReq = req.includes(s.id)
                            if (!isReq) return <td key={s.id} className="px-4 py-3 text-center bg-gray-50/30"><span className="text-gray-300">-</span></td>
                            
                            const schedTime = s.time
                            const existing = mar.find(m => {
                              if (m.drugName !== o.itemName) return false
                              const d = new Date(m.scheduledAt || m.administeredAt || m.createdAt)
                              return isSameDay(d, chartDate) && format(d, 'HH:mm') === schedTime
                            })

                            return (
                              <td key={s.id} className="px-4 py-3 text-center">
                                {existing ? (
                                  <Badge className={existing.status === 'GIVEN' ? 'bg-emerald-100 text-emerald-800 flex items-center gap-1 w-fit mx-auto' : 'bg-red-100 text-red-800 w-fit mx-auto'}>
                                    {existing.status === 'GIVEN' ? <CheckCircle2 className="h-3 w-3" /> : null}
                                    {format(new Date(existing.administeredAt || existing.createdAt), 'HH:mm')}
                                  </Badge>
                                ) : (
                                  <Button size="sm" variant="outline" onClick={() => markGivenSlot(o, s.time)} disabled={saving} className="h-8 text-xs text-violet-700 border-violet-200 hover:bg-violet-50">Tick</Button>
                                )}
                              </td>
                            )
                          })}
                          <td className="px-4 py-3 text-center border-l border-gray-100">
                            <Button size="sm" variant="ghost" onClick={() => markGivenSlot(o, null)} disabled={saving} className="h-8 w-8 p-0 text-violet-600"><Plus className="h-4 w-4" /></Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <p className="font-semibold text-sm flex items-center gap-2 text-gray-700">Manual / Ad-hoc Record</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-[11px] text-gray-500">Drug</Label><Input className="mt-0.5 h-8 text-sm" placeholder="e.g. Paracetamol 650mg" value={mForm.drugName} onChange={(e) => setMForm((p) => ({ ...p, drugName: e.target.value }))} /></div>
                  <div><Label className="text-[11px] text-gray-500">Dosage</Label><Input className="mt-0.5 h-8 text-sm" value={mForm.dosage} onChange={(e) => setMForm((p) => ({ ...p, dosage: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] text-gray-500">Route / Form</Label>
                    <Select value={mForm.route} onValueChange={(val) => setMForm((p) => ({ ...p, route: val }))}>
                      <SelectTrigger className="mt-0.5 h-8 bg-white"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {DRUG_FORMS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-[11px] text-gray-500">Status</Label>
                    <Select value={mForm.status} onValueChange={(v) => setMForm((p) => ({ ...p, status: v }))}>
                      <SelectTrigger className="mt-0.5 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{MAR_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                {mForm.status !== 'GIVEN' && <div><Label className="text-[11px] text-gray-500">Reason</Label><Input className="mt-0.5 h-8 text-sm" placeholder="Reason not given" value={mForm.reason} onChange={(e) => setMForm((p) => ({ ...p, reason: e.target.value }))} /></div>}
                <Button onClick={saveMar} disabled={saving} variant="outline" className="w-full h-8 text-sm">Record Manually</Button>
              </CardContent>
            </Card>

            <Card className="h-full">
              <CardContent className="pt-4">
                <p className="font-semibold text-sm mb-3">All Administration Logs</p>
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2">
                  {mar.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No records</p> : mar.map((m) => (
                    <div key={m.id} className="border rounded-lg p-2.5 text-sm flex justify-between items-start bg-white">
                      <div>
                        <p className="font-medium leading-tight">{m.drugName} {m.dosage && <span className="text-gray-400 text-xs font-normal">· {m.dosage}</span>}</p>
                        <p className="text-xs text-gray-500 mt-1">{m.route}{m.reason ? ` · ${m.reason}` : ''}</p>
                        <p className="text-[10px] text-gray-400 mt-1">By {m.nurseName || 'Nurse'} · {(m.administeredAt || m.createdAt) ? format(new Date(m.administeredAt || m.createdAt), 'dd MMM HH:mm') : ''}</p>
                      </div>
                      <Badge className={`ml-2 whitespace-nowrap ${m.status === 'GIVEN' ? 'bg-emerald-100 text-emerald-800' : m.status === 'REFUSED' || m.status === 'MISSED' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{m.status}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TREATMENT CHART — scheduled lab/radiology/procedure occurrences */}
      {tab === 'chart' && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {/* Header + date navigation */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5 bg-gradient-to-r from-blue-50/60 to-transparent">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm"><ClipboardCheck className="h-5 w-5" /></span>
                <div>
                  <h3 className="font-semibold text-gray-900 leading-tight">Treatment Chart</h3>
                  <p className="text-[11px] text-gray-400">Pathology · Radiology · Procedures — medicines are in the eMAR tab</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setChartDate(subDays(chartDate, 1))}><ChevronLeft className="h-4 w-4" /></Button>
                <div className="flex items-center gap-2 font-medium text-sm text-gray-700 w-32 justify-center rounded-lg border bg-white py-1.5">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  {isSameDay(chartDate, new Date()) ? 'Today' : format(chartDate, 'dd MMM yyyy')}
                </div>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setChartDate(addDays(chartDate, 1))}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>

            {/* Day summary strip */}
            {dayStats.total > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b bg-gray-50/60 px-5 py-2.5 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-2.5 py-1 font-medium text-gray-600"><Clock className="h-3.5 w-3.5 text-gray-400" />{dayStats.total} scheduled</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{dayStats.done} done</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 font-medium text-amber-700"><Circle className="h-3.5 w-3.5" />{dayStats.due} due</span>
                {dayStats.missed > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 px-2.5 py-1 font-medium text-red-700"><XCircle className="h-3.5 w-3.5" />{dayStats.missed} missed</span>}
              </div>
            )}

            {chartRows.length === 0 ? (
              <div className="py-16 text-center">
                <ClipboardCheck className="h-10 w-10 mx-auto mb-3 text-gray-200" />
                <p className="text-sm font-medium text-gray-500">No scheduled tasks for this day</p>
                <p className="text-xs text-gray-400 mt-1">Repeating orders (e.g. “ABG 3×/day for 2 days”) appear here automatically.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="px-5 py-2.5 font-medium">Order</th>
                      <th className="px-5 py-2.5 font-medium">Scheduled times</th>
                      <th className="px-5 py-2.5 font-medium text-center w-28">Progress</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {chartRows.map((row) => {
                      const cfg = TASK_TYPE[row.orderType] || { label: row.orderType, Icon: ClipboardList, badge: 'bg-gray-100 text-gray-700', tile: 'bg-gray-50 text-gray-500' }
                      const TIcon = cfg.Icon
                      const pct = Math.round((row.doneCount / row.tasks.length) * 100)
                      return (
                        <tr key={row.orderId} className="hover:bg-gray-50/50 align-top">
                          {/* Order */}
                          <td className="px-5 py-3.5 w-64">
                            <div className="flex items-start gap-2.5">
                              <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${cfg.tile}`}><TIcon className="h-4 w-4" /></span>
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-900 text-sm leading-tight">{row.itemName}</p>
                                <Badge className={`${cfg.badge} text-[10px] mt-1`} variant="secondary">{cfg.label}</Badge>
                              </div>
                            </div>
                          </td>
                          {/* Scheduled time tiles */}
                          <td className="px-5 py-3.5">
                            <div className="flex flex-wrap gap-2">
                              {row.tasks.map((t) => {
                                const done = t.status === 'DONE'
                                const missed = ['MISSED', 'HELD', 'SKIPPED'].includes(t.status)
                                return (
                                  <div key={t.id}
                                    className={`w-[84px] rounded-lg border px-2 py-1.5 text-center transition-colors ${done ? 'border-emerald-200 bg-emerald-50' : missed ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
                                    <div className="text-[11px] font-semibold text-gray-500">{format(new Date(t.scheduledAt), 'HH:mm')}</div>
                                    {done ? (
                                      <div className="mt-1 flex flex-col items-center text-emerald-700">
                                        <CheckCircle2 className="h-4 w-4" />
                                        <span className="text-[10px] font-medium mt-0.5">{t.doneAt ? format(new Date(t.doneAt), 'HH:mm') : 'Done'}</span>
                                      </div>
                                    ) : missed ? (
                                      <div className="mt-1 flex flex-col items-center text-red-600">
                                        <XCircle className="h-4 w-4" />
                                        <span className="text-[10px] font-medium mt-0.5 capitalize">{t.status.toLowerCase()}</span>
                                      </div>
                                    ) : (
                                      <div className="mt-1 space-y-1">
                                        <Button size="sm" onClick={() => markTask(t, 'DONE')} disabled={saving} className="h-6 w-full px-0 text-[11px] bg-blue-600 hover:bg-blue-700">Tick</Button>
                                        <button onClick={() => markTask(t, 'MISSED')} disabled={saving} className="w-full text-[10px] text-gray-400 hover:text-red-600 transition-colors">Miss</button>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                          {/* Progress */}
                          <td className="px-5 py-3.5 text-center w-28">
                            <div className="text-sm font-semibold text-gray-800">{row.doneCount}<span className="text-gray-400 font-normal">/{row.tasks.length}</span></div>
                            <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                              <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
