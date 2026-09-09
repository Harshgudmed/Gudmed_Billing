import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { StatusBadge } from '@/components/common/StatusBadge'
import { getFullName } from '@/lib/patient'
import { drName } from '@/lib/utils'
import { Loader2, AlertCircle, Users, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { otApi, otClinicalApi } from '@/api/otApi'
import { PreOpTab, ChecklistTab, AnaesthesiaTab, OpNoteTab } from './CaseRecordTabs'
import OtScheduleChangeDialog from './OtScheduleChangeDialog'
import {
  OT_STATUS_COLORS, OT_PRIORITY_COLORS, OT_ROLE_LABEL, OT_LATERALITY_LABEL,
  OT_NEXT_ACTIONS, OT_SCHEDULE_ACTIONS, canWriteOpNote, formatSlot, formatDuration,
} from './otDisplay'

// One case, everything recorded about it, and the moves it can make from here.
//
// The buttons come from OT_NEXT_ACTIONS, not from a list written here, so this
// screen can never offer "Start surgery" on a cancelled case — the user would
// press it and get a 409 they can do nothing about.
//
// Two refusals the backend makes are worth knowing about while reading this:
//   • CANCELLED / POSTPONED need a reason (medicolegal) — hence the prompt below
//   • CHECKED_IN / IN_THEATRE need the patient admitted — surfaced as-is, since
//     its message already says what to do about it

// `summary` is the row the list already has — enough to draw the dialog at once.
// The team, the anaesthetist and the reasons are NOT in the list payload (it
// carries only what the board renders), so the full case is fetched on open and
// takes over as soon as it lands. The dialog never shows a spinner over an empty
// panel because of it.
export default function CaseDetailDialog({ open, onOpenChange, booking: summary, onChanged }) {
  const [full, setFull] = useState(null)
  const [loadingFull, setLoadingFull] = useState(false)

  // Which reason-requiring action is waiting for its reason. null = none pending.
  const [pendingAction, setPendingAction] = useState(null)
  const [reason, setReason] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  // Set once the move lands, which is what swaps the wizard for its confirmation.
  const [scheduleDone, setScheduleDone] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // A different case opening must not inherit the last one's typed reason — that
  // reason is written onto the record, so it would be attributed to the wrong case.
  useEffect(() => {
    setPendingAction(null)
    setReason('')
    setError(null)
    setFull(null)

    if (!open || !summary?.id) return
    let live = true
    setLoadingFull(true)
    otApi.getBooking(summary.id)
      .then((res) => { if (live) setFull(res?.data ?? null) })
      .catch(() => { if (live) setError('Could not load the full case record') })
      .finally(() => { if (live) setLoadingFull(false) })
    return () => { live = false }
  }, [open, summary?.id])

  // The four case documents, in one request. Reloaded after any tab saves, so a
  // signed checklist phase or a new fitness shows immediately in the others.
  const [record, setRecord] = useState(null)
  const loadRecord = useCallback(() => {
    if (!summary?.id) return
    otClinicalApi.getCaseRecord(summary.id)
      .then((res) => setRecord(res?.data ?? null))
      .catch(() => setRecord(null))
  }, [summary?.id])

  useEffect(() => {
    if (!open || !summary?.id) { setRecord(null); return }
    loadRecord()
  }, [open, summary?.id, loadRecord])

  const booking = full ?? summary
  if (!booking) return null

  const actions = OT_NEXT_ACTIONS[booking.status] ?? []

  const run = async (action, withReason) => {
    setSubmitting(true)
    setError(null)
    try {
      await otApi.setStatus(booking.id, action.status, withReason)
      toast.success(`${booking.caseNumber} — ${action.label.toLowerCase()}d`)
      onOpenChange(false)
      onChanged?.()
    } catch (e) {
      setError(e?.message || 'Could not update this case')
    } finally {
      setSubmitting(false)
    }
  }

  const onAction = (action) => {
    // Postpone, Reschedule and Re-book all land here — one dialog, one code path.
    // Whichever button was pressed, the user is answering the same question.
    if (action.schedule) {
      setError(null)
      setScheduleOpen(true)
      return
    }
    if (action.needsReason) {
      setPendingAction(action)
      setReason('')
      return
    }
    run(action)
  }

  // Moving a case and postponing it are the same decision with two endings, so
  // they are decided in one place. `reschedule` is the only path that locks the
  // theatre and re-runs the clash check — which is why Re-book now comes through
  // here instead of flipping the status and leaving the old slot on the case.
  const applyScheduleChange = async (choice) => {
    setSubmitting(true)
    setError(null)
    try {
      let saved
      if (choice.action === OT_SCHEDULE_ACTIONS.MOVE) {
        saved = await otApi.reschedule(booking.id, {
          scheduledStart: choice.scheduledStart,
          estimatedMinutes: choice.estimatedMinutes,
          theatreId: choice.theatreId,
          reason: choice.reason,
        })
      } else {
        saved = await otApi.postponeCase(booking.id, choice.reason)
      }

      // The dialog stays open on its confirmation panel rather than vanishing.
      // A coordinator reads the new time off this screen — onto a whiteboard, or
      // down a phone to the ward — and a toast is gone before they have finished.
      setScheduleDone({
        action: choice.action,
        scheduledStart: saved?.data?.scheduledStart,
        scheduledEnd: saved?.data?.scheduledEnd,
        // Named by the wizard, which is the only place that knows which room was
        // picked out of the slot's list.
        theatreName: choice.theatreName ?? booking.theatre?.name,
      })
      // The board behind refreshes now, so it is already right when they close.
      onChanged?.()
    } catch (e) {
      setError(e?.message || 'Could not change this case')
    } finally {
      setSubmitting(false)
    }
  }

  // Closing the confirmation takes the whole case dialog with it: the case just
  // moved, so what is behind this describes where it used to be.
  const closeScheduleFlow = (next) => {
    setScheduleOpen(next)
    if (next === false) {
      setScheduleDone(null)
      if (scheduleDone) onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {booking.caseNumber}
            <StatusBadge status={booking.status} map={OT_STATUS_COLORS} />
            <Badge className={OT_PRIORITY_COLORS[booking.priority] || 'bg-gray-100 text-gray-700'}>
              {booking.priority}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* The four documents are four separate legal records with four authors,
            so the tabs carry a real tick rather than a decoration: it says that
            document has been signed off, which is the question anyone opening
            this case actually has. A green tick is only shown for the field that
            means the document is DONE — a half-filled checklist is not done. */}
        <Tabs defaultValue="summary">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1.5">
            <CaseTab value="summary" label="Summary" />
            <CaseTab value="preop" label="Pre-op" done={!!record?.preop?.fitness} />
            <CaseTab value="checklist" label="Safety checklist" done={!!record?.checklist?.signOutAt} />
            <CaseTab value="anaesthesia" label="Anaesthesia" done={!!record?.anaesthesia?.anaesthesiaType} />
            <CaseTab
              value="opnote"
              label="Operative note"
              done={!!record?.opnote?.procedurePerformed}
              disabled={canWriteOpNote(booking.status) === false && !record?.opnote}
            />
          </TabsList>

        <TabsContent value="summary" className="space-y-4 pt-3">
          <div>
            <p className="text-lg font-semibold">{booking.procedureName}</p>
            {booking.laterality && booking.laterality !== 'NA' && (
              <p className="text-sm text-gray-500">
                Side: {OT_LATERALITY_LABEL[booking.laterality] ?? booking.laterality}
              </p>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Row label="Patient" value={getFullName(booking.patient)} sub={booking.patient?.mrn} />
            <Row label="Theatre" value={booking.theatre?.name} sub={booking.theatre?.theatreType} />
            <Row
              label="Scheduled"
              value={formatSlot(booking.scheduledStart, booking.scheduledEnd)}
              sub={booking.estimatedMinutes ? formatDuration(booking.estimatedMinutes) : null}
            />
            <Row
              label="Actual"
              value={booking.actualStart ? formatSlot(booking.actualStart, booking.actualEnd) : '—'}
            />
            <Row label="Surgeon" value={drName(booking.surgeon?.fullName)} />
            <Row label="Anaesthetist" value={booking.anaesthetist ? drName(booking.anaesthetist.fullName) : '—'} />
          </dl>

          {/* The team arrives with the full record, not with the list row, so
              say it is coming rather than showing "no team" for a moment. */}
          {loadingFull && (
            <p className="flex items-center gap-1.5 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the team and case notes…
            </p>
          )}

          {booking.team?.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Users className="h-4 w-4 text-gray-400" /> Theatre team
              </p>
              <ul className="space-y-1 text-sm">
                {booking.team.map((member) => (
                  <li key={member.id} className="flex items-center justify-between gap-2">
                    <span>{member.memberName}</span>
                    <span className="text-xs text-gray-500">
                      {OT_ROLE_LABEL[member.role] ?? member.role}
                      {member.isExternal && ' · visiting'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Why a case was called off is the part of the record that gets read
              months later, so it is shown, never buried. */}
          {(booking.cancelReason || booking.postponeReason || booking.notes) && (
            <div className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
              {booking.cancelReason && <p><b>Cancelled:</b> {booking.cancelReason}</p>}
              {booking.postponeReason && <p><b>Postponed:</b> {booking.postponeReason}</p>}
              {booking.notes && <p><b>Notes:</b> {booking.notes}</p>}
            </div>
          )}

          {pendingAction && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Label>Reason to {pendingAction.label.toLowerCase()} *</Label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="This is kept on the record"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPendingAction(null)} disabled={submitting}>
                  Back
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  disabled={submitting || reason.trim().length === 0}
                  onClick={() => run(pendingAction, reason.trim())}
                >
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm {pendingAction.label}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </TabsContent>

        {/* The four case documents. Each tab loads from the same one request and
            reloads all four after a save, so a signed checklist phase shows up in
            the tab headers immediately. */}
        <TabsContent value="preop" className="pt-3">
          <PreOpTab bookingId={booking.id} record={record?.preop} onSaved={loadRecord} />
        </TabsContent>
        <TabsContent value="checklist" className="pt-3">
          <ChecklistTab bookingId={booking.id} record={record?.checklist} onSaved={loadRecord} />
        </TabsContent>
        <TabsContent value="anaesthesia" className="pt-3">
          <AnaesthesiaTab bookingId={booking.id} record={record?.anaesthesia} onSaved={loadRecord} />
        </TabsContent>
        <TabsContent value="opnote" className="pt-3">
          {canWriteOpNote(booking.status) ? (
            /* The case itself, not just its note: the theatre already stamped
               when the patient came in and went out, and those two times are the
               anchor the surgeon writes incision and closure against. */
            <OpNoteTab bookingId={booking.id} booking={booking} record={record?.opnote} onSaved={loadRecord} />
          ) : (
            /* Reached only when a note already exists and the case has since
               moved — the tab is disabled otherwise. What was written stays
               readable; it is the writing that stops. */
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  This case is {booking.status.toLowerCase().replace(/_/g, ' ')} — the
                  operative note is read-only until the case is under way.
                </span>
              </div>
              {record?.opnote?.findings && (
                <Row label="Operative findings" value={record.opnote.findings} />
              )}
              {record?.opnote?.procedurePerformed && (
                <Row label="Procedure performed" value={record.opnote.procedurePerformed} />
              )}
            </div>
          )}
        </TabsContent>
        </Tabs>

        <DialogFooter className="flex-wrap gap-2">
          {actions.length === 0 ? (
            <span className="mr-auto text-sm text-gray-500">
              This case is closed — nothing further to record here.
            </span>
          ) : (
            actions.map((action) => (
              <Button
                key={action.status}
                variant={action.destructive ? 'outline' : 'default'}
                className={action.destructive
                  ? 'text-red-600 hover:bg-red-50'
                  : 'bg-blue-600 hover:bg-blue-700'}
                disabled={submitting || !!pendingAction}
                onClick={() => onAction(action)}
              >
                {action.label}
              </Button>
            ))
          )}
        </DialogFooter>
      </DialogContent>

      {/* Postpone, Reschedule and Re-book all open this one. It carries its own
          error so a clash on the new slot is shown beside the slot list, where
          the user can pick another, rather than behind this dialog. */}
      <OtScheduleChangeDialog
        open={scheduleOpen}
        onOpenChange={closeScheduleFlow}
        booking={booking}
        onConfirm={applyScheduleChange}
        isSubmitting={submitting}
        error={scheduleOpen ? error : null}
        done={scheduleDone}
        // Back to the case, now showing its new slot — the wizard closes and the
        // record behind it has already been refreshed.
        onViewCase={() => { setScheduleDone(null); setScheduleOpen(false) }}
      />
    </Dialog>
  )
}

// One tab, with room to breathe and a tick that means something.
//
// The tabs were a tight row of plain words with a bare "✓" glued onto the label,
// where it read as part of the name. Padding, and a tick set apart from the
// text, make "what is left to fill in" answerable at a glance — which is what a
// coordinator opens this dialog to find out.
function CaseTab({ value, label, done = false, disabled = false }) {
  return (
    <TabsTrigger
      value={value}
      disabled={disabled}
      className="gap-1.5 px-3 py-2 text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm disabled:opacity-40"
    >
      {label}
      {done && <Check className="h-3.5 w-3.5 text-green-600" />}
    </TabsTrigger>
  )
}

function Row({ label, value, sub }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="font-medium">{value || '—'}</dd>
      {sub && <dd className="text-xs text-gray-500">{sub}</dd>}
    </div>
  )
}
