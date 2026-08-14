import { useState } from 'react'
import { toast } from 'sonner'

/**
 * The state and the plumbing behind CancelActionDialog, shared by all four modules.
 *
 * Every one of them does the same five things around the two calls that actually
 * differ: hold which record is being cancelled, disable the button while the
 * request is in flight, catch and surface the failure, close on success and
 * refresh the list. Written out per module that is four copies of the same
 * try/catch — and the copy that forgets `setSubmitting(false)` in its failure path
 * leaves the dialog frozen with no error to say why.
 *
 * A module supplies only what is genuinely its own:
 *
 *   reschedule(record, choice)  move it, however that module moves things
 *   cancel(record, choice)      settle it, however that module settles
 *
 * Both may be async and both may throw; a throw is reported and the dialog stays
 * open with what the user typed intact, so the reason does not have to be
 * retyped after a network blip.
 *
 *   const cancelAction = useCancelAction({
 *     reschedule: (o, c) => api.patch(...),
 *     cancel:     (o, c) => api.patch(...),
 *     onDone:     () => table.refresh(),
 *   })
 *   <Button onClick={() => cancelAction.start(order)} />
 *   <CancelActionDialog {...cancelAction.dialogProps} module="radiology" ... />
 */
export function useCancelAction({ reschedule, cancel, onDone, messages = {} }) {
  const [record, setRecord] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const confirm = async (choice) => {
    if (!record) return
    setSubmitting(true)
    try {
      if (choice.action === 'reschedule') {
        await reschedule?.(record, choice)
        toast.success(messages.rescheduled?.(choice) ?? `Moved to ${choice.date}`)
      } else {
        await cancel?.(record, choice)
        toast.success(
          messages.cancelled?.(choice)
            ?? (choice.refund > 0
              ? (choice.instant
                ? 'Cancelled — refund issued at the counter'
                : 'Cancelled — refund sent for approval')
              : 'Cancelled'),
        )
      }
      // Only on success: a failed attempt keeps the dialog open with the reason
      // still typed, which is the difference between retrying and starting over.
      setRecord(null)
      onDone?.()
    } catch (e) {
      toast.error(e?.message || 'Could not complete this — nothing was changed')
    } finally {
      // finally, not the try: an error path that forgets this leaves the confirm
      // button spinning for ever and the only way out is a page reload.
      setSubmitting(false)
    }
  }

  return {
    record,
    start: setRecord,
    dialogProps: {
      open: !!record,
      onOpenChange: (v) => { if (!v && !submitting) setRecord(null) },
      record,
      onConfirm: confirm,
      isSubmitting: submitting,
    },
  }
}
