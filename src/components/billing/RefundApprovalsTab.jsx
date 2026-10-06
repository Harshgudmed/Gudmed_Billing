import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card'
import { TableRow, TableCell } from '../ui/table'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Check, X, Clock } from 'lucide-react'
import client from '@/api/client'
import { toast } from 'sonner'
import { getFullName } from '@/lib/patient'
import { billingAccess } from '@/lib/billing'
import { formatMoney, formatDateTime } from '@/lib/format'
import { useServerPagination } from '@/lib/useServerPagination'
import { useLiveData } from '@/lib/useLiveData'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { useAuth } from '@/lib/auth'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'

const STATUS_OPTIONS = [
  { value: 'PENDING_APPROVAL', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'all', label: 'All refunds' },
]

const STATUS_BADGE = {
  PENDING_APPROVAL: { label: 'Pending', cls: 'text-amber-600 bg-amber-50' },
  APPROVED: { label: 'Approved', cls: 'text-green-600 bg-green-50' },
  REJECTED: { label: 'Rejected', cls: 'text-red-600 bg-red-50' },
}

export default function RefundApprovalsTab({ userRole, onProcess }) {
  // Pending first: this is where Finance decides. The list is paged on the
  // server — it used to read only the 10 newest refunds, so an older pending
  // one never appeared and could not be approved.
  const [status, setStatus] = useState('PENDING_APPROVAL')
  const refunds = useServerPagination('/billing', {
    perPage: 15,
    params: { resource: 'payments', isRefund: 'true', status },
  })
  // Inpatient refunds live on the IPD bill's own ledger, where an approved one
  // is a completed (SUCCESS) receipt. Same filter, own paged list.
  const ipdRefunds = useServerPagination('/inpatient', {
    perPage: 15,
    params: { resource: 'refund-requests', status: status === 'APPROVED' ? 'SUCCESS' : status },
  })
  // A refund requested at the counter or on an IPD bill appears here without a reload.
  useLiveData(['billing', 'payments'], refunds.refresh)
  useLiveData('inpatient', ipdRefunds.refresh)
  // The refund being decided — its buttons wait, so one click is one decision.
  const [busyId, setBusyId] = useState(null)

  const decide = async (paymentId, action, list, request) => {
    setBusyId(paymentId)
    try {
      const res = await request()
      if (res.success) {
        toast.success(`Refund ${action === 'APPROVE' ? 'Approved' : 'Rejected'} Successfully`)
        list.refresh()
        if (onProcess) onProcess() // Refresh parent module data
      }
    } catch (err) {
      toast.error(err.message || 'Error processing refund')
      list.refresh() // someone else may have decided it first — show what is true now
    } finally {
      setBusyId(null)
    }
  }
  const handleAction = (paymentId, action) =>
    decide(paymentId, action, refunds, () => client.post('/billing', { resource: 'approve_refund', paymentId, action }))
  const handleIpdAction = (paymentId, action) =>
    decide(paymentId, action, ipdRefunds, () => client.post('/inpatient', { resource: 'refund-decision', paymentId, action }))

  // The server's rule (lib/billing.js billingAccess). With login off there is
  // no role, and the demo may approve, as the server allows.
  const { canApprove } = billingAccess(userRole)
  // Maker-checker, as the server rules (lib/refundPolicy.js selfApprovalProblem):
  // whoever raised a refund approves it only where the hospital allows it.
  const { user } = useAuth()
  const { orgInfo } = useOrgSettings()
  const raisedByMe = (a) => !!user?.id && a.createdById === user.id && !orgInfo.refundSelfApproval
  // An IPD request records who raised it as its receiver (inpatient/billPaymentService.js).
  const ipdRaisedByMe = (a) => !!user?.id && a.receivedById === user.id && !orgInfo.refundSelfApproval

  const columns = [
    { header: 'Date' }, { header: 'Status' }, { header: 'Patient' }, { header: 'Invoice #' },
    { header: 'Amount', className: 'text-right' }, { header: 'Reason' }, { header: 'Approver' },
    ...(canApprove ? [{ header: 'Action', className: 'text-right' }] : []),
  ]
  const ipdColumns = [
    { header: 'Date' }, { header: 'Status' }, { header: 'Patient' }, { header: 'IPD Bill #' },
    { header: 'Amount', className: 'text-right' }, { header: 'Reason' }, { header: 'Raised by' }, { header: 'Approver' },
    ...(canApprove ? [{ header: 'Action', className: 'text-right' }] : []),
  ]
  // The Approve / Reject cell, the same for both lists.
  const actionCell = (a, isPending, mine, onAction) => (
    <TableCell className="py-3 text-right space-x-2 whitespace-nowrap">
      {isPending && mine ? (
        <span className="text-xs text-gray-500" title="Someone else must approve a refund you raised">Raised by you</span>
      ) : isPending ? (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 border-red-200 text-red-600 hover:bg-red-50"
            disabled={!!busyId}
            onClick={() => onAction(a.id, 'REJECT')}
          >
            <X className="w-4 h-4 mr-1" /> Reject
          </Button>
          <Button
            size="sm"
            className="h-8 px-2 bg-green-600 hover:bg-green-700 text-white"
            disabled={!!busyId}
            onClick={() => onAction(a.id, 'APPROVE')}
          >
            <Check className="w-4 h-4 mr-1" /> Approve
          </Button>
        </>
      ) : (
        <span className="text-xs text-gray-400">Processed</span>
      )}
    </TableCell>
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            Refund Approvals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterBar active={status !== 'PENDING_APPROVAL'} onClear={() => setStatus('PENDING_APPROVAL')}>
            <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </FilterBar>
          <div className="overflow-x-auto">
            <PaginatedTable
              pagination={refunds}
              headerClassName="bg-gray-50"
              columns={columns}
              empty={status === 'PENDING_APPROVAL' ? 'No refunds waiting for approval.' : 'No refunds found.'}
              renderRow={(a) => {
                const badge = STATUS_BADGE[a.status]
                return (
                  <TableRow key={a.id}>
                    <TableCell className="py-3 text-sm whitespace-nowrap">{formatDateTime(a.paymentDate, { withTime: false })}</TableCell>
                    <TableCell className="py-3">
                      {badge && <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>}
                    </TableCell>
                    <TableCell className="py-3 font-medium text-sm">
                      {/* a refund row carries no patient of its own; its invoice does */}{getFullName(a.patient || a.invoice?.patient)}
                    </TableCell>
                    <TableCell className="py-3 text-sm font-mono text-gray-600">{a.invoice?.invoiceNumber}</TableCell>
                    <TableCell className="py-3 text-right font-bold text-red-600 tabular-nums">{formatMoney(a.amount)}</TableCell>
                    <TableCell className="py-3 text-xs text-gray-500 max-w-[200px] truncate" title={a.refundReason}>
                      {a.refundReason}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-gray-500">
                      {a.approvedByUserId ? (a.approvedByName || 'A former user') : '-'}
                      {a.approvalDate && <div className="text-[10px] text-gray-400">{formatDateTime(a.approvalDate, { withTime: false })}</div>}
                    </TableCell>
                    {canApprove && actionCell(a, a.status === 'PENDING_APPROVAL', raisedByMe(a), handleAction)}
                  </TableRow>
                )
              }}
            />
          </div>

          <div className="pt-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-indigo-700 bg-indigo-50 border-indigo-200">IPD</Badge>
              Inpatient bill refunds
            </h3>
            <div className="overflow-x-auto">
              <PaginatedTable
                pagination={ipdRefunds}
                headerClassName="bg-gray-50"
                columns={ipdColumns}
                empty={status === 'PENDING_APPROVAL' ? 'No inpatient refunds waiting for approval.' : 'No inpatient refunds found.'}
                renderRow={(a) => {
                  const badge = STATUS_BADGE[a.status === 'SUCCESS' ? 'APPROVED' : a.status]
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="py-3 text-sm whitespace-nowrap">{formatDateTime(a.paidAt, { withTime: false })}</TableCell>
                      <TableCell className="py-3">
                        {badge && <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>}
                      </TableCell>
                      <TableCell className="py-3 font-medium text-sm">
                        {getFullName(a.patient)}
                        {a.patient?.mrn && <div className="text-[10px] text-gray-400 font-mono">{a.patient.mrn}</div>}
                      </TableCell>
                      <TableCell className="py-3 text-sm font-mono text-gray-600">
                        <Badge variant="outline" className="mr-1 text-[10px] text-indigo-700 bg-indigo-50 border-indigo-200">IPD</Badge>
                        {a.bill?.billNumber || 'Draft bill'}
                      </TableCell>
                      <TableCell className="py-3 text-right font-bold text-red-600 tabular-nums">{formatMoney(Math.abs(a.amount))}</TableCell>
                      <TableCell className="py-3 text-xs text-gray-500 max-w-[200px] truncate" title={a.note || ''}>{a.note || '-'}</TableCell>
                      <TableCell className="py-3 text-xs text-gray-500">{a.receivedByName || '-'}</TableCell>
                      <TableCell className="py-3 text-xs text-gray-500">
                        {a.decidedByName || '-'}
                        {a.decidedAt && <div className="text-[10px] text-gray-400">{formatDateTime(a.decidedAt, { withTime: false })}</div>}
                      </TableCell>
                      {canApprove && actionCell(a, a.status === 'PENDING_APPROVAL', ipdRaisedByMe(a), handleIpdAction)}
                    </TableRow>
                  )
                }}
              />
            </div>
          </div>
          {!canApprove && refunds.rows.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-800 text-sm rounded-md flex items-start gap-2 border border-amber-200">
              <Clock className="w-4 h-4 mt-0.5 shrink-0" />
              <p>You do not have permission to approve refunds. A Finance Controller or Administrator must approve these requests.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
