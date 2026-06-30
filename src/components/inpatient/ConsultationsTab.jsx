import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  Plus, Stethoscope, CheckCircle2, Clock,
  Loader2, X, IndianRupee
} from 'lucide-react'
import { Button }   from '@/components/ui/button'
import { Badge }    from '@/components/ui/badge'
import { Label }    from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import client from '@/api/client'



const inr = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`

const STATUS_STYLE = {
  REQUESTED:   'bg-orange-100 text-orange-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED:   'bg-green-100 text-green-800',
  BILLED:      'bg-green-100 text-green-800',
  CANCELLED:   'bg-gray-100 text-gray-600',
}

const CARD_BORDER = {
  REQUESTED:   'border-l-orange-400',
  IN_PROGRESS: 'border-l-blue-500',
  COMPLETED:   'border-l-green-400',
  BILLED:      'border-l-green-500',
  CANCELLED:   'border-l-gray-300',
}

const emptyForm = {
  departmentId: 'all', consultingDoctorId: '',
  referralReason: '', scheduledAt: '',
}
const emptyCompleteForm = { consultationNotes: '', diagnosis: '', recommendedPlan: '' }

export default function ConsultationsTab({ admission, doctors = [], departments = [] }) {
  const admissionId = admission?.id

  const [consultations, setConsultations] = useState([])
  const [loading, setLoading]             = useState(false)
  const [showNew, setShowNew]             = useState(false)
  const [form, setForm]                   = useState(emptyForm)
  const [saving, setSaving]               = useState(false)
  const [completing, setCompleting]       = useState(false)
  const [completeForm, setCompleteForm]   = useState(emptyCompleteForm)
  const [showComplete, setShowComplete]   = useState(false)
  const [completingId, setCompletingId]   = useState(null)

  const load = useCallback(async () => {
    if (!admissionId) return
    setLoading(true)
    try {
      const res = await client.get(`/inpatient?resource=ipd-consultation&admissionId=${admissionId}`)
      setConsultations(res.data || [])
    } catch { toast.error('Failed to load consultations') }
    setLoading(false)
  }, [admissionId])

  useEffect(() => { load() }, [load])

  // Filter doctors by selected department
  const filteredDoctors = (form.departmentId && form.departmentId !== 'all')
    ? doctors.filter(d => d.departmentId === form.departmentId)
    : doctors


  const handleCreate = async () => {
    if (!form.consultingDoctorId || !form.referralReason.trim()) {
      toast.error('Doctor and referral reason are required')
      return
    }
    setSaving(true)
    try {
      const res = await client.post('/inpatient', {
        resource:          'ipd-consultation',
        admissionId,
        consultingDoctorId: form.consultingDoctorId,
        departmentId:       form.departmentId === 'all' ? null : form.departmentId,
        referralReason:     form.referralReason,
        scheduledAt:        form.scheduledAt || null,
      })
      if (res.success) {
        toast.success('Consultation requested')
        setShowNew(false)
        setForm(emptyForm)
        load()
      } else {
        toast.error(res.error || 'Failed to request consultation')
      }
    } catch (err) { toast.error(err.message || 'Failed') }
    setSaving(false)
  }

  const transition = async (id, status) => {
    try {
      const res = await client.patch('/inpatient', { resource: 'ipd-consultation', id, status })
      if (res.success) { toast.success('Status updated'); load() }
      else toast.error(res.error || 'Failed to update status')
    } catch (err) { toast.error(err.message || 'Failed') }
  }

  const handleComplete = async () => {
    if (!completingId) return
    setCompleting(true)
    try {
      const res = await client.patch('/inpatient', {
        resource: 'ipd-consultation',
        id:       completingId,
        status:   'COMPLETED',
        ...completeForm,
      })
      if (res.success) {
        const fee = res.charge?.lineTotal
        toast.success(fee ? `Completed · ${inr(fee)} auto-billed to IPD bill` : 'Completed & billed')
        setShowComplete(false)
        setCompleteForm(emptyCompleteForm)
        setCompletingId(null)
        load()
      } else {
        toast.error(res.error || 'Failed to complete consultation')
      }
    } catch (err) { toast.error(err.message || 'Failed') }
    setCompleting(false)
  }

  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this consultation request?')) return
    try {
      const res = await client.delete('/inpatient', { params: { resource: 'ipd-consultation', id } })
      if (res.success) { toast.success('Consultation cancelled'); load() }
      else toast.error(res.error || 'Failed to cancel')
    } catch (err) { toast.error(err.message || 'Failed') }
  }

  const openCompleteDialog = (id) => {
    setCompletingId(id)
    setCompleteForm(emptyCompleteForm)
    setShowComplete(true)
  }

  return (
    <div className="space-y-4">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">Specialist consultations called during this IPD stay</p>
        {admission?.status === 'admitted' && (
          <Button size="sm" onClick={() => { setForm(emptyForm); setShowNew(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Request Consultation
          </Button>
        )}
      </div>

      {/* Loading spinner */}
      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}

      {/* Empty state */}
      {!loading && consultations.length === 0 && (
        <div className="text-center py-10 text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
          <Stethoscope className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          No consultations requested yet
          {admission?.status === 'admitted' && (
            <p className="text-xs mt-1">Click &quot;Request Consultation&quot; to call a specialist</p>
          )}
        </div>
      )}

      {/* Consultation cards */}
      {!loading && consultations.map(c => (
        <div key={c.id}
          className={`border-l-4 ${CARD_BORDER[c.status] || 'border-l-gray-300'} bg-white border border-gray-200 rounded-lg p-3 space-y-2 shadow-sm`}>

          {/* Status + department + time */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={`text-xs font-medium ${STATUS_STYLE[c.status] || 'bg-gray-100 text-gray-700'}`}>
                {c.status}
              </Badge>
              {c.department && (
                <span className="text-xs bg-cyan-50 text-cyan-700 border border-cyan-200 rounded px-2 py-0.5">
                  {c.department.name}
                </span>
              )}
            </div>
            <span className="text-xs text-gray-400 shrink-0">
              {c.requestedAt ? format(new Date(c.requestedAt), 'dd MMM, h:mm a') : ''}
            </span>
          </div>

          {/* Doctor + Requested by */}
          <div className="flex items-center gap-2 text-sm">
            <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
              {c.consultingDoctor?.fullName?.[0] || 'D'}
            </div>
            <span className="font-medium">{c.consultingDoctor?.fullName || '—'}</span>
            {c.requestedBy && (
              <span className="text-xs text-gray-400">· Requested by {c.requestedBy.fullName}</span>
            )}
          </div>

          {/* Referral reason */}
          {c.referralReason && (
            <p className="text-xs text-gray-500 leading-relaxed">{c.referralReason}</p>
          )}

          {/* Clinical output (completed) */}
          {c.diagnosis && (
            <p className="text-xs font-medium text-gray-700">Dx: {c.diagnosis}</p>
          )}
          {c.recommendedPlan && (
            <p className="text-xs text-gray-500">Plan: {c.recommendedPlan}</p>
          )}
          {c.consultationNotes && (
            <p className="text-xs text-gray-400 italic">{c.consultationNotes}</p>
          )}

          {/* Auto-bill preview for open consultations */}
          {['REQUESTED', 'IN_PROGRESS'].includes(c.status) && (
            <div className="bg-blue-50 border border-blue-100 rounded px-2 py-1 text-xs text-blue-700 flex items-center gap-1">
              <IndianRupee className="h-3 w-3 shrink-0" />
              Auto-billed on completion · fee adjusted by room category
            </div>
          )}

          {/* Billing confirmation (billed) */}
          {c.status === 'BILLED' && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-xs text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {c.feeApplied ? inr(c.feeApplied) : 'Fee'} auto-posted to IPD bill
              </div>
              {c.commissionAmount > 0 && (
                <span className="text-xs text-gray-400">Commission {inr(c.commissionAmount)} pending</span>
              )}
            </div>
          )}

          {/* Action buttons — only for open statuses on admitted patients */}
          {['REQUESTED', 'IN_PROGRESS'].includes(c.status) && admission?.status === 'admitted' && (
            <div className="flex items-center gap-2 pt-1">
              {c.status === 'REQUESTED' && (
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => transition(c.id, 'IN_PROGRESS')}>
                  <Clock className="h-3 w-3 mr-1" /> Mark In Progress
                </Button>
              )}
              <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700"
                onClick={() => openCompleteDialog(c.id)}>
                <CheckCircle2 className="h-3 w-3 mr-1" /> Complete &amp; Bill
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-400 hover:text-red-600 ml-auto"
                title="Cancel consultation"
                onClick={() => handleCancel(c.id)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      ))}

      {consultations.length > 0 && (
        <p className="text-[11px] text-gray-400 italic border-t pt-2">
          Auto-billing: fee is posted to the IPD bill automatically when status is set to COMPLETED. No manual entry needed.
        </p>
      )}

      {/* ── Request Consultation Dialog ─────────────────────────────────────── */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-5 w-5 text-blue-600" />
              Request Specialist Consultation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Department</Label>
                <Select value={form.departmentId}
                  onValueChange={v => setForm(p => ({ ...p, departmentId: v, consultingDoctorId: '' }))}>
                  <SelectTrigger className="mt-1 h-9 text-sm">
                    <SelectValue placeholder="All departments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departments.map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Specialist Doctor *</Label>
                <Select value={form.consultingDoctorId}
                  onValueChange={v => setForm(p => ({ ...p, consultingDoctorId: v }))}>
                  <SelectTrigger className="mt-1 h-9 text-sm">
                    <SelectValue placeholder="Select doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredDoctors.map(d => (
                      <SelectItem key={d.id} value={d.id}>
                        <div className="flex items-center gap-2">
                          <div className="h-5 w-5 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700 shrink-0">
                            {d.fullName?.[0] || 'D'}
                          </div>
                          {d.fullName}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>


            <div>
              <Label className="text-xs">Referral Reason *</Label>
              <Textarea className="mt-1 text-sm resize-none" rows={3}
                placeholder="Describe why this specialist is being called in..."
                value={form.referralReason}
                onChange={e => setForm(p => ({ ...p, referralReason: e.target.value }))} />
            </div>

            <div>
              <Label className="text-xs">Scheduled At (optional)</Label>
              <input type="datetime-local"
                className="mt-1 w-full border border-input rounded-md h-9 px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.scheduledAt}
                onChange={e => setForm(p => ({ ...p, scheduledAt: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <Plus className="h-4 w-4 mr-1" />}
              Send Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Complete & Bill Dialog ──────────────────────────────────────────── */}
      <Dialog open={showComplete} onOpenChange={setShowComplete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Complete Consultation &amp; Bill
            </DialogTitle>
          </DialogHeader>
          <Alert className="bg-green-50 border-green-200 py-2">
            <AlertDescription className="text-xs text-green-700">
              Completing this will <strong>automatically post the fee</strong> to the patient&apos;s IPD bill.
            </AlertDescription>
          </Alert>
          <div className="space-y-3 py-1">
            <div>
              <Label className="text-xs">Diagnosis</Label>
              <Textarea className="mt-1 text-sm resize-none" rows={2}
                placeholder="e.g. Bilateral serous otitis media"
                value={completeForm.diagnosis}
                onChange={e => setCompleteForm(p => ({ ...p, diagnosis: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Consultation Notes</Label>
              <Textarea className="mt-1 text-sm resize-none" rows={3}
                placeholder="Clinical findings, examination notes..."
                value={completeForm.consultationNotes}
                onChange={e => setCompleteForm(p => ({ ...p, consultationNotes: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Recommended Plan</Label>
              <Textarea className="mt-1 text-sm resize-none" rows={2}
                placeholder="Treatment plan, medications, follow-up..."
                value={completeForm.recommendedPlan}
                onChange={e => setCompleteForm(p => ({ ...p, recommendedPlan: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowComplete(false)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleComplete} disabled={completing}>
              {completing
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Complete &amp; Post Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
