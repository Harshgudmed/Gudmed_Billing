import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Loader2, Plus, Search, X, Clock, FlaskConical, Scan, Pill, Stethoscope, ChevronRight, AlertTriangle, Zap, ClipboardPlus, ArrowLeft, Package, HeartPulse } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import client from '@/api/client'
import { useAuth } from '@/lib/auth'

const PRIORITIES = ['ROUTINE', 'URGENT', 'STAT']
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
const TYPE_ICON = { LAB: FlaskConical, RADIOLOGY: Scan, PHARMACY: Pill, PROCEDURE: Stethoscope, SUPPLY: Package, IMPLANT: HeartPulse }
// Display labels only — the underlying orderType codes stay LAB/RADIOLOGY so the
// catalog search, billing and order lifecycle keep working unchanged.
const TYPE_LABEL = { LAB: 'Pathology', RADIOLOGY: 'Radiology', PHARMACY: 'Pharmacy', PROCEDURE: 'Procedure', SUPPLY: 'Supplies', IMPLANT: 'Implant' }
const TYPE_STYLE = { LAB: 'bg-sky-100 text-sky-800', RADIOLOGY: 'bg-indigo-100 text-indigo-800', PHARMACY: 'bg-violet-100 text-violet-800', PROCEDURE: 'bg-cyan-100 text-cyan-800', SUPPLY: 'bg-emerald-100 text-emerald-800', IMPLANT: 'bg-orange-100 text-orange-800' }
const PRIO_STYLE = { ROUTINE: 'bg-gray-100 text-gray-700', URGENT: 'bg-amber-100 text-amber-800', STAT: 'bg-red-100 text-red-800' }
const STATUS_STYLE = { ORDERED: 'bg-gray-100 text-gray-700', ACKNOWLEDGED: 'bg-blue-100 text-blue-800', IN_PROGRESS: 'bg-amber-100 text-amber-800', COMPLETED: 'bg-green-100 text-green-800', CANCELLED: 'bg-rose-100 text-rose-700' }

// Category rail (modern CPOE): icon + accent per order type.
const TYPE_RAIL = [
  { key: '', label: 'All', Icon: ClipboardPlus, accent: 'text-gray-700', ring: 'data-[on=true]:border-gray-900 data-[on=true]:bg-gray-900 data-[on=true]:text-white' },
  { key: 'LAB', label: 'Pathology', Icon: FlaskConical, accent: 'text-sky-600', ring: 'data-[on=true]:border-sky-500 data-[on=true]:bg-sky-50 data-[on=true]:text-sky-700' },
  { key: 'RADIOLOGY', label: 'Radiology', Icon: Scan, accent: 'text-indigo-600', ring: 'data-[on=true]:border-indigo-500 data-[on=true]:bg-indigo-50 data-[on=true]:text-indigo-700' },
  { key: 'PHARMACY', label: 'Meds', Icon: Pill, accent: 'text-violet-600', ring: 'data-[on=true]:border-violet-500 data-[on=true]:bg-violet-50 data-[on=true]:text-violet-700' },
  { key: 'PROCEDURE', label: 'Procedure', Icon: Stethoscope, accent: 'text-cyan-600', ring: 'data-[on=true]:border-cyan-500 data-[on=true]:bg-cyan-50 data-[on=true]:text-cyan-700' },
  { key: 'SUPPLY', label: 'Supplies', Icon: Package, accent: 'text-emerald-600', ring: 'data-[on=true]:border-emerald-500 data-[on=true]:bg-emerald-50 data-[on=true]:text-emerald-700' },
  { key: 'IMPLANT', label: 'Implant', Icon: HeartPulse, accent: 'text-orange-600', ring: 'data-[on=true]:border-orange-500 data-[on=true]:bg-orange-50 data-[on=true]:text-orange-700' },
]
// Priority cards — color-coded, STAT emphasised (real-hospital convention).
const PRIO_META = {
  ROUTINE: { Icon: Clock, on: 'border-gray-800 bg-gray-900 text-white', hint: 'Routine' },
  URGENT: { Icon: AlertTriangle, on: 'border-amber-500 bg-amber-500 text-white', hint: 'Urgent' },
  STAT: { Icon: Zap, on: 'border-red-600 bg-red-600 text-white', hint: 'Immediately' },
}
const FREQ_CHIPS = ['OD', 'BD', 'TDS', 'QID', 'HS', 'SOS']

// Doctor-friendly "times a day" dropdown for lab/imaging — plain numbers instead
// of Latin codes. Each maps to the frequency code the backend expander understands.
const TIMES_PER_DAY_OPTIONS = [
  { value: 'OD', label: '1 time a day' },
  { value: 'BD', label: '2 times a day' },
  { value: 'TDS', label: '3 times a day' },
  { value: 'QID', label: '4 times a day' },
  { value: 'q6h', label: 'Every 6 hours' },
  { value: 'q8h', label: 'Every 8 hours' },
  { value: 'SOS', label: 'Once only / SOS' },
]

// How many times a day a frequency code fires. Mirrors the backend schedule
// expander (scheduleService.js) so the doctor's preview matches what the nurse
// actually gets. Returns 0 for SOS/PRN/blank (single ad-hoc occurrence).
function timesPerDay(frequency) {
  const f = String(frequency || '').toUpperCase()
  const everyN = f.match(/Q\s*(\d+)\s*H|EVERY\s*(\d+)\s*H/)
  if (everyN) {
    const n = parseInt(everyN[1] || everyN[2], 10)
    if (n >= 1 && n <= 24) { let c = 0; for (let h = 8; h < 24; h += n) c++; return c || 1 }
  }
  const map = { QID: 4, TDS: 3, TID: 3, BID: 2, BD: 2, QD: 1, OD: 1, HS: 1 }
  for (const code of ['QID', 'TDS', 'TID', 'BID', 'BD', 'QD', 'OD', 'HS']) if (f.includes(code)) return map[code]
  return 0
}

// Which transition buttons a role may attempt (UI hint; server enforces authoritatively).
// Departments acknowledge/start/complete their own work; doctors place + cancel, and
// may complete a PROCEDURE. (No role → demo: show everything.)
function actionsFor(order, role) {
  const r = role || 'admin'
  const isDept = ['nurse', 'lab_technician', 'radiology_technician', 'pharmacist', 'admin', 'super_admin'].includes(r)
  const canCancel = ['doctor', 'admin', 'super_admin'].includes(r)
  const a = []
  if (order.status === 'ORDERED' && isDept) a.push('ack', 'start')
  if (order.status === 'ACKNOWLEDGED' && isDept) a.push('start')
  if (order.status === 'IN_PROGRESS') {
    if (isDept) a.push('complete')
    else if (r === 'doctor' && order.orderType === 'PROCEDURE') a.push('complete')
  }
  if (['ORDERED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(order.status) && canCancel) a.push('cancel')
  return a
}
const ACTION_LABEL = { ack: 'Acknowledge', start: 'Start', complete: 'Complete', cancel: 'Cancel' }

export default function ClinicalOrdersTab({ admitted = [], admissionId: controlledId }) {
  const { user } = useAuth()
  const role = user?.role
  const canCreate = !user || ['doctor', 'nurse', 'admin', 'super_admin'].includes(role)

  // When `admissionId` is passed (combined Notes & Orders view), the patient is
  // controlled by the parent and the internal picker is hidden.
  const [innerId, setInnerId] = useState('')
  const selectedId = controlledId || innerId
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState(null) // {order, events}

  useEffect(() => { if (!controlledId && !innerId && admitted.length) setInnerId(admitted[0].id) }, [admitted, innerId, controlledId])

  const load = useCallback(async (id) => {
    if (!id) return
    setLoading(true)
    try {
      const res = await client.get(`/inpatient?resource=orders&admissionId=${id}`)
      setOrders(res.data || [])
    } catch { toast.error('Failed to load orders') }
    setLoading(false)
  }, [])
  useEffect(() => { if (selectedId) load(selectedId) }, [selectedId, load])

  // Near real-time: poll the selected patient's orders every 10s so orders placed
  // elsewhere (e.g. the doctor's portal) appear here automatically, and vice-versa.
  useEffect(() => {
    if (!selectedId) return
    const t = setInterval(() => load(selectedId), 10000)
    return () => clearInterval(t)
  }, [selectedId, load])

  const doTransition = async (order, action) => {
    const reason = action === 'cancel' ? (window.prompt('Reason for cancellation?') || '') : undefined
    if (action === 'cancel' && reason === '') return
    try {
      const res = await client.post('/inpatient', { resource: `order-${action}`, id: order.id, reason })
      if (res.success) {
        if (action === 'complete' && res.charge) toast.success(`Completed · ₹${res.charge.lineTotal} billed`)
        else toast.success(`Order ${ACTION_LABEL[action].toLowerCase()}d`)
        load(selectedId); if (detail?.order?.id === order.id) openDetail(order.id)
      } else toast.error(res.error || 'Failed')
    } catch (e) { toast.error(e.message || `Could not ${action} order`) }
  }

  const openDetail = async (id) => {
    try { const res = await client.get(`/inpatient?resource=order&id=${id}`); if (res.success) setDetail(res.data) }
    catch { toast.error('Failed to load order') }
  }

  if (!admitted.length) {
    return <Card><CardContent className="py-14 text-center text-gray-400">No admitted patients. Admit a patient to place clinical orders.</CardContent></Card>
  }

  const sel = admitted.find((a) => a.id === selectedId)
  const patientLabel = sel ? `${`${sel.patient?.firstName || ''} ${sel.patient?.lastName || ''}`.trim()} · Bed ${sel.bed?.bedNumber || '—'}` : ''

  // Full in-page New Order view (replaces the list while active — not a drawer).
  if (showNew) {
    return <NewOrderView admissionId={selectedId} patientLabel={patientLabel} onClose={() => setShowNew(false)} onPlaced={() => { setShowNew(false); load(selectedId) }} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {!controlledId && (
          <>
            <Label className="text-sm text-gray-600">Patient</Label>
            <Select value={selectedId} onValueChange={setInnerId}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Select admitted patient" /></SelectTrigger>
              <SelectContent>
                {admitted.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {(a.patient?.firstName || '') + ' ' + (a.patient?.lastName || '')} · Bed {a.bed?.bedNumber || '—'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
          Live
        </span>
        <div className="flex-1" />
        {canCreate && <Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" />New Order</Button>}
      </div>

      {loading ? (
        <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Loading orders…</div>
      ) : orders.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-gray-400">No clinical orders for this patient yet.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => {
            const Icon = TYPE_ICON[o.orderType] || Stethoscope
            return (
              <Card key={o.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="py-3 flex items-center gap-3">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TYPE_STYLE[o.orderType] || ''}`}><Icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{o.itemName}</span>
                      <Badge className={TYPE_STYLE[o.orderType]} variant="secondary">{TYPE_LABEL[o.orderType] || o.orderType}</Badge>
                      <Badge className={PRIO_STYLE[o.priority]} variant="secondary">{o.priority}</Badge>
                    </div>
                    <div className="text-xs text-gray-500">
                      {o.quantity > 1 ? `×${o.quantity} · ` : ''}{o.frequency ? o.frequency + ' · ' : ''}
                      {o.orderedByName || 'Doctor'} · {o.orderedAt ? format(new Date(o.orderedAt), 'dd MMM HH:mm') : ''}
                    </div>
                  </div>
                  <Badge className={STATUS_STYLE[o.status]} variant="secondary">{o.status}</Badge>
                  {o.billed && <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">₹ billed</Badge>}
                  <div className="flex gap-1">
                    {actionsFor(o, role).map((act) => (
                      <Button key={act} size="sm" variant={act === 'cancel' ? 'ghost' : 'outline'} onClick={() => doTransition(o, act)}>{ACTION_LABEL[act]}</Button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={() => openDetail(o.id)}><Clock className="h-4 w-4" /></Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {detail && <OrderTimelineDrawer detail={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function NewOrderView({ admissionId, patientLabel, onClose, onPlaced }) {
  const [q, setQ] = useState('')
  const [type, setType] = useState('') // '' = all
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(null)
  const [form, setForm] = useState({ priority: 'ROUTINE', quantity: 1, dosage: '', frequency: '', duration: '', route: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      if (!q.trim()) { setResults([]); return }
      setSearching(true)
      try {
        const res = await client.get(`/inpatient?resource=orderables&q=${encodeURIComponent(q.trim())}${type ? `&type=${type}` : ''}`)
        setResults(res.data || [])
      } catch { /* silent */ }
      setSearching(false)
    }, 250)
    return () => timer.current && clearTimeout(timer.current)
  }, [q, type])

  const place = async () => {
    if (!picked) { toast.error('Pick an order item first'); return }
    setSaving(true)
    try {
      const res = await client.post('/inpatient', {
        resource: 'order', admissionId,
        orderType: picked.orderType, serviceGroup: picked.serviceGroup,
        catalogModel: picked.catalogModel, catalogItemId: picked.catalogItemId,
        itemName: picked.name, itemCode: picked.code,
        priority: form.priority, quantity: Number(form.quantity) || 1,
        frequency: form.frequency || null, duration: form.duration || null, route: form.route || null, dosage: form.dosage || null, notes: form.notes || null,
      })
      if (res.success) { toast.success(`Ordered: ${picked.name}`); onPlaced() }
      else toast.error(res.error || 'Failed to place order')
    } catch (e) { toast.error(e.message || 'Failed to place order') }
    setSaving(false)
  }

  // How many billable units this order will generate:
  //  - with a schedule (freq + duration) → occurrences = perDay × days (the full
  //    course), which is what the nurse will tick and what actually gets billed.
  //  - SOS / single (no per-day pattern) → 1.
  //  - no frequency at all → fall back to the Quantity field.
  const perDay = form.frequency ? timesPerDay(form.frequency) : 0
  const durationDays = Math.min(parseInt((String(form.duration).match(/\d+/) || [])[0] || '', 10) || 0, 14)
  const occurrenceCount = !form.frequency
    ? (Number(form.quantity) || 1)
    : perDay === 0
      ? 1
      : (durationDays ? perDay * durationDays : perDay)

  // Estimate now reflects the WHOLE course: unit price × occurrences (e.g. CBC
  // ₹350 × 12 collections = ₹4,200) — consistent across lab, imaging & medicine.
  const estimate = picked?.basePrice != null ? Number(picked.basePrice) * occurrenceCount : null

  // Live schedule preview ("3×/day × 4 days = 12 collections") so the doctor sees
  // exactly what lands on the nurse's Treatment Chart.
  const schedulePreview = (() => {
    if (!form.frequency) return null
    const noun = picked?.orderType === 'PHARMACY' ? 'doses' : picked?.orderType === 'RADIOLOGY' ? 'scans' : 'collections'
    if (perDay === 0) return `1 ${noun.slice(0, -1)} (single / SOS)`
    if (!durationDays) return `${perDay}×/day — set duration to see total`
    return `${perDay}×/day × ${durationDays} day${durationDays > 1 ? 's' : ''} = ${perDay * durationDays} ${noun}`
  })()

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><ClipboardPlus className="h-5 w-5" /></span>
        <div>
          <h3 className="text-lg font-semibold leading-tight">New Clinical Order</h3>
          <p className="text-xs text-gray-500">{patientLabel ? `For ${patientLabel}` : 'Search the catalogue — order type is detected automatically'}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-4 items-start">
        {/* LEFT: search + results */}
        <div className="lg:col-span-3 space-y-3">
          {/* Category rail */}
          <div className="grid grid-cols-5 gap-2">
            {TYPE_RAIL.map(({ key, label, Icon, accent, ring }) => (
              <button key={key || 'ALL'} data-on={type === key} onClick={() => setType(key)}
                className={`flex flex-col items-center gap-1 rounded-xl border bg-white py-2.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 ${ring}`}>
                <Icon className={`h-4 w-4 ${type === key ? '' : accent}`} />
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
            <Input className="pl-9 h-11 bg-white" placeholder="Search order (CBC, X-Ray, Paracetamol, Dressing…)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>

          {/* Results */}
          <Card>
            <CardContent className="p-2">
              <div className="space-y-2 max-h-[58vh] overflow-y-auto">
                {searching && <div className="text-xs text-gray-400 py-3 text-center"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Searching…</div>}
                {!searching && q.trim() && results.length === 0 && (
                  <div className="text-center text-sm text-gray-400 py-10">No matching orderable found.</div>
                )}
                {!q.trim() && (
                  <div className="text-center text-xs text-gray-400 py-10">Start typing to search labs, imaging, medicines and procedures.</div>
                )}
                {results.map((r) => {
                  const Icon = TYPE_ICON[r.orderType] || Stethoscope
                  const on = picked && picked.catalogModel === r.catalogModel && picked.catalogItemId === r.catalogItemId
                  return (
                    <button key={`${r.catalogModel}:${r.catalogItemId}`} onClick={() => setPicked(r)}
                      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:border-blue-300 hover:shadow-sm ${on ? 'border-blue-500 bg-blue-50/60' : 'bg-white'}`}>
                      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${TYPE_STYLE[r.orderType] || 'bg-gray-100'}`}><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{r.name}</span>
                        <span className="block text-xs text-gray-400 truncate">
                          <Badge className={TYPE_STYLE[r.orderType]} variant="secondary">{TYPE_LABEL[r.orderType] || r.orderType}</Badge>
                          {r.code ? <span className="ml-2">{r.code}</span> : null}
                          {r.category ? <span className="ml-2">· {r.category}</span> : null}
                        </span>
                      </span>
                      {r.basePrice != null && <span className="text-sm font-semibold text-gray-700">₹{r.basePrice}</span>}
                      <ChevronRight className="h-4 w-4 text-gray-300" />
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: configure */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-4">
            <Card>
              <CardContent className="p-4">
                {!picked ? (
                  <div className="py-20 text-center text-sm text-gray-400">
                    <ClipboardPlus className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                    Select an item on the left to configure and place the order.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* selected item */}
                    <div className="flex items-center gap-3 rounded-xl border-2 border-blue-200 bg-blue-50/40 p-3">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${TYPE_STYLE[picked.orderType] || 'bg-gray-100'}`}>
                        {(() => { const I = TYPE_ICON[picked.orderType] || Stethoscope; return <I className="h-5 w-5" /> })()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-gray-900">{picked.name}</div>
                        <div className="text-xs text-gray-400">
                          <Badge className={TYPE_STYLE[picked.orderType]} variant="secondary">{TYPE_LABEL[picked.orderType] || picked.orderType}</Badge>
                          {picked.code ? <span className="ml-2">{picked.code}</span> : null}
                          {picked.basePrice != null ? <span className="ml-2">· ₹{picked.basePrice}</span> : null}
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setPicked(null)}>Change</Button>
                    </div>

                    {/* priority */}
                    <div>
                      <Label className="text-xs font-medium text-gray-500">Priority</Label>
                      <div className="mt-1.5 grid grid-cols-3 gap-2">
                        {PRIORITIES.map((p) => {
                          const M = PRIO_META[p]; const on = form.priority === p
                          return (
                            <button key={p} onClick={() => setForm((f) => ({ ...f, priority: p }))}
                              className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 text-xs font-semibold transition ${on ? M.on : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}>
                              <M.Icon className="h-4 w-4" />{p}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Quantity (+ dosage for meds) — not relevant to lab/imaging */}
                    {picked.orderType !== 'LAB' && picked.orderType !== 'RADIOLOGY' && (
                      <div className={`grid ${picked.orderType === 'PHARMACY' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                        <div><Label className="text-xs text-gray-500">Quantity</Label><Input className="bg-white" type="number" min="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} /></div>
                        {picked.orderType === 'PHARMACY' && (
                          <div><Label className="text-xs text-gray-500">Dosage</Label><Input className="bg-white" placeholder="e.g. 500mg" value={form.dosage} onChange={(e) => setForm((f) => ({ ...f, dosage: e.target.value }))} /></div>
                        )}
                      </div>
                    )}

                    {/* Repeating schedule — same Frequency chips + Duration the doctor
                        already uses for medicines, now available for lab tests &
                        imaging too (e.g. ABG TDS for 4 days → 12 collections). */}
                    {['PHARMACY', 'LAB', 'RADIOLOGY'].includes(picked.orderType) && (
                      <>
                        {picked.orderType === 'PHARMACY' ? (
                          <div>
                            <Label className="text-xs text-gray-500">Frequency</Label>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {FREQ_CHIPS.map((fq) => (
                                <button key={fq} onClick={() => setForm((f) => ({ ...f, frequency: f.frequency === fq ? '' : fq }))}
                                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${form.frequency === fq ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}>{fq}</button>
                              ))}
                              <Input className="bg-white h-7 w-28 text-xs" placeholder="custom…" value={FREQ_CHIPS.includes(form.frequency) ? '' : form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))} />
                            </div>
                          </div>
                        ) : (
                          <div>
                            <Label className="text-xs text-gray-500">How many times a day?</Label>
                            <Select value={form.frequency} onValueChange={(val) => setForm((f) => ({ ...f, frequency: val }))}>
                              <SelectTrigger className="bg-white mt-1.5"><SelectValue placeholder="Select…" /></SelectTrigger>
                              <SelectContent>
                                {TIMES_PER_DAY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div>
                          <Label className="text-xs text-gray-500">Duration</Label>
                          <Input className="bg-white" placeholder="e.g. 4 days" value={form.duration} onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))} />
                        </div>
                        {schedulePreview && (
                          <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                            <Clock className="h-3.5 w-3.5" />
                            <span>📅 {schedulePreview}</span>
                          </div>
                        )}
                      </>
                    )}

                    {picked.orderType === 'PHARMACY' && (
                      <div>
                        <Label className="text-xs text-gray-500">Route / Form</Label>
                        <Select value={form.route} onValueChange={(val) => setForm((f) => ({ ...f, route: val }))}>
                          <SelectTrigger className="bg-white"><SelectValue placeholder="Select Form/Route" /></SelectTrigger>
                          <SelectContent>
                            {DRUG_FORMS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div><Label className="text-xs text-gray-500">Clinical notes</Label><Textarea className="bg-white" rows={2} placeholder={picked.orderType === 'RADIOLOGY' ? 'Reason for exam / instructions…' : 'Indication / instructions…'} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>

                    {/* action */}
                    <div className="border-t pt-3 flex items-center gap-3">
                      <div className="flex-1 text-sm">
                        <Badge className={PRIO_STYLE[form.priority]} variant="secondary">{form.priority}</Badge>
                        {estimate != null && (
                          <span className="ml-2 text-gray-500">
                            est.{' '}
                            {occurrenceCount > 1 && (
                              <span className="text-gray-400">{occurrenceCount} × ₹{Number(picked.basePrice).toLocaleString('en-IN')} = </span>
                            )}
                            <span className="font-semibold text-gray-800">₹{estimate.toLocaleString('en-IN')}</span>
                          </span>
                        )}
                      </div>
                      <Button onClick={place} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-1" />}Place Order
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function OrderTimelineDrawer({ detail, onClose }) {
  const o = detail
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-sm h-full bg-white shadow-xl p-5 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Order Timeline</h3>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="mb-4">
          <div className="font-medium">{o.itemName}</div>
          <div className="flex gap-2 mt-1">
            <Badge className={TYPE_STYLE[o.orderType]} variant="secondary">{TYPE_LABEL[o.orderType] || o.orderType}</Badge>
            <Badge className={PRIO_STYLE[o.priority]} variant="secondary">{o.priority}</Badge>
            <Badge className={STATUS_STYLE[o.status]} variant="secondary">{o.status}</Badge>
          </div>
        </div>
        <div className="space-y-3">
          {(o.events || []).map((e) => (
            <div key={e.id} className="flex gap-3">
              <div className="mt-1 h-2 w-2 rounded-full bg-gray-300" />
              <div className="text-sm">
                <div className="font-medium">{e.toStatus}</div>
                <div className="text-xs text-gray-500">{e.actorName || '—'}{e.actorRole ? ` (${e.actorRole})` : ''} · {e.at ? format(new Date(e.at), 'dd MMM HH:mm') : ''}</div>
                {e.remark && <div className="text-xs text-gray-600 italic">“{e.remark}”</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
