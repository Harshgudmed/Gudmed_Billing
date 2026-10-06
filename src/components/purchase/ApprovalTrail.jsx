import { CheckCircle2, XCircle, Circle, MinusCircle } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { APPROVER_LABEL } from './requestMeta'

// A document's approval steps: each level, who acted, when, and what they said.
// The same trail for a request and an order (both use lib/approvals.js).

const STEP_ICON = {
  approved: <CheckCircle2 className="h-5 w-5 text-green-600" />,
  rejected: <XCircle className="h-5 w-5 text-red-600" />,
  cancelled: <MinusCircle className="h-5 w-5 text-gray-400" />,
  pending: <Circle className="h-5 w-5 text-amber-500" />,
}

/** `emptyText` is what to say when there are no steps (draft, or approved on sending). */
export default function ApprovalTrail({ steps = [], currentStepId, emptyText }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Approval</h3>
      {steps.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText || 'No approval steps.'}</p>
      ) : (
        <ol className="space-y-2">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-3 rounded-md border px-3 py-2">
              <span className="mt-0.5 shrink-0">{STEP_ICON[s.status]}</span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">Level {s.level} · {APPROVER_LABEL[s.approverRole] || s.approverRole}</span>
                  <span className="text-gray-500">
                    {s.status === 'pending' ? (currentStepId === s.id ? 'waiting now' : 'after the level above')
                      : s.status === 'cancelled' ? 'not needed any more'
                        : `${s.status} by ${s.actedByName || 'someone'} · ${formatDateTime(s.actedAt)}`}
                  </span>
                </div>
                {s.remark && <p className="text-gray-700 mt-0.5">“{s.remark}”</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
