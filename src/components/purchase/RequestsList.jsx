import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { Clock, ClipboardList, UserRound, FilePen, XCircle } from 'lucide-react'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { useDateFilter } from '@/components/common/DateFilter'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime } from '@/lib/format'
import { PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { STATUS, PRIORITY, APPROVER_LABEL, useMe } from './requestMeta'
import RequestForm from './RequestForm'
import RequestDetail from './RequestDetail'
import RfqForm from './RfqForm'

// Purchase requests — the start of every purchase. Three views of one list,
// chosen with tiles that show how many each holds (the Queue's status tiles
// work the same way: click to filter, a blue ring on the one that is on):
//   Awaiting My Approval — my role's level is the current one
//   All Requests         — every request in the hospital
//   Requests I Raised    — the ones I raised
// A view that can never hold anything for this person is not offered: a store
// keeper approves nothing, a Finance Controller raises nothing.
// A row opens the request; everything done to it happens there.

const VIEWS = [
  { value: 'to-approve', label: 'Awaiting My Approval', hint: 'Your decision is needed', tone: 'yellow', icon: Clock, count: 'toApprove', who: 'approver' },
  { value: 'all', label: 'All Requests', hint: 'Across all departments and statuses', tone: 'purple', icon: ClipboardList, count: 'total', who: 'overseer' },
  { value: 'mine', label: 'Requests I Raised', hint: 'Created by you', tone: 'blue', icon: UserRound, count: 'mine', who: 'buyer' },
]
// The store sees only its own requests, so its tiles split them by where they
// stand instead — and each one filters the list by that status.
const MY_TILES = [
  { status: 'all', label: 'All My Requests', hint: 'Every one you raised', tone: 'blue', icon: UserRound, count: 'mine' },
  { status: 'draft', label: 'Drafts', hint: 'Not sent yet', tone: 'purple', icon: FilePen, count: 'drafts' },
  { status: 'submitted', label: 'With Approvers', hint: 'Waiting for a decision', tone: 'yellow', icon: Clock, count: 'mineWaiting' },
  { status: 'rejected', label: 'Rejected — Fix & Resend', hint: 'Sent back to you', tone: 'orange', icon: XCircle, count: 'rejected' },
]
// Written out in full so Tailwind finds them (an interpolated class never ships).
const COLS = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }
const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'urgent,emergency', label: 'Urgent & emergency' },
  ...Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label })),
]
const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))]

// `intent` opens the list the way the Overview asked: a view, filters, one
// request already open, or a new request's form. Read once, on mount.
// `counts` — { toApprove, total, mine, drafts, mineWaiting, rejected } for the tiles.
// `onMakeOrder(request)` — an approved request's "Make purchase order" goes to the Orders tab.
export default function RequestsList({ counts = {}, onChanged, intent = {}, onMakeOrder }) {
  const me = useMe()
  const approver = me.isAdmin || !!APPROVER_LABEL[me.role]
  // The store sees only its own requests (the server sends no others).
  const allowed = { approver, buyer: me.canBuy, overseer: me.seesEverything }
  const views = VIEWS.filter((v) => !v.who || allowed[v.who])
  const own = !me.seesEverything
  const [view, setView] = useState(own ? 'mine' : views.some((v) => v.value === intent.view) ? intent.view : 'all')
  const [status, setStatus] = useState(intent.status || 'all')
  const [priority, setPriority] = useState(intent.priority || 'all')
  const [search, setSearch] = useState(intent.search || '')
  const dateFilter = useDateFilter('all', { showClear: false })
  const debounced = useDebounce(search, 300)
  const requests = useServerPagination(PURCHASE_ENDPOINT, {
    params: {
      resource: 'requests', search: debounced,
      view: view === 'all' ? '' : view,
      status: view === 'to-approve' || status === 'all' ? '' : status,
      priority: priority === 'all' ? '' : priority,
      startDate: dateFilter.range.startDate,
      endDate: dateFilter.range.endDate,
    },
  })
  useLiveData('purchase', requests.refresh)

  const [formOpen, setFormOpen] = useState(!!intent.startNew)
  const [editing, setEditing] = useState(null)
  const [openId, setOpenId] = useState(intent.openId || null)
  const [rfqFormOpen, setRfqFormOpen] = useState(false)
  const [rfqPreselect, setRfqPreselect] = useState(null)

  const changed = useCallback(() => { requests.refresh(); onChanged?.() }, [requests, onChanged])

  return (
    // The HMS list layout, as on Pharmacy's tabs: which requests, the filter
    // row, then the table in a card. New requests start from the page header.
    <div className="space-y-4">
      <div role="group" aria-label="Which requests" className={`grid grid-cols-1 ${COLS[own ? MY_TILES.length : views.length]} gap-4`}>
        {own
          ? MY_TILES.map((v) => (
            <StatCard key={v.status} tone={v.tone} icon={v.icon} label={v.label} sublabel={v.hint}
              value={counts[v.count] ?? 0} selected={status === v.status} onClick={() => setStatus(v.status)} />
          ))
          : views.map((v) => (
            <StatCard key={v.value} tone={v.tone} icon={v.icon} label={v.label} sublabel={v.hint}
              value={counts[v.count] ?? 0} selected={view === v.value} onClick={() => setView(v.value)} />
          ))}
      </div>

        <FilterBar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search number, item, reason or who raised it…"
          active={!!search || status !== 'all' || priority !== 'all' || dateFilter.active}
          onClear={() => { setSearch(''); setStatus('all'); setPriority('all'); dateFilter.reset() }}
        >
          <FilterSelect value={priority} onChange={setPriority} options={PRIORITY_OPTIONS} className="w-48" />
          {view !== 'to-approve' && <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} className="w-48" />}
          {dateFilter.control}
        </FilterBar>

      <Card>
        <CardContent className="p-0">
        <PaginatedTable
          pagination={requests}
          empty={search || status !== 'all' || priority !== 'all' || dateFilter.active ? 'No request matches these filters' : view === 'to-approve' ? 'Nothing is waiting for your approval' : 'No purchase requests yet'}
          columns={[
            { header: 'Request' }, { header: 'Department' }, { header: 'Items', className: 'text-right' },
            ...(me.seesMoney ? [{ header: 'Estimated', className: 'text-right' }] : []), { header: 'Status' }, { header: own ? 'Raised on' : 'Raised by' },
          ]}
          renderRow={(r) => {
            const s = STATUS[r.status] || STATUS.draft
            return (
              <TableRow key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenId(r.id)}
                tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id) }}>
                <TableCell>
                  <div className="font-mono text-sm font-medium text-blue-700">{r.number}</div>
                  {r.priority !== 'normal' && <Badge variant="outline" className={`mt-1 ${PRIORITY[r.priority]?.cls}`}>{PRIORITY[r.priority]?.label}</Badge>}
                </TableCell>
                <TableCell>{r.department?.name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.lineCount}</TableCell>
                {me.seesMoney && <TableCell className="text-right font-medium tabular-nums">{formatMoney(r.estimatedTotal)}</TableCell>}
                <TableCell>
                  <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                  {r.status === 'submitted' && r.currentStep && (
                    <div className="text-xs text-gray-500 mt-1">
                      Level {r.currentStep.level} of {r.levels} · {APPROVER_LABEL[r.currentStep.approverRole] || r.currentStep.approverRole}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {/* the store's list is all its own — the name would repeat on every row */}
                  {!own && <div className="text-sm">{r.requestedByName}</div>}
                  <div className={own ? 'text-sm' : 'text-xs text-gray-500'}>{formatDateTime(r.createdAt, { withTime: false })}</div>
                </TableCell>
              </TableRow>
            )
          }}
        />
        </CardContent>
      </Card>

      <RequestForm
        open={formOpen}
        onOpenChange={setFormOpen}
        request={editing}
        onSaved={(pr) => { changed(); setOpenId(pr.id) }}
      />
      <RequestDetail
        id={openId}
        open={!!openId && !formOpen}
        onOpenChange={(v) => { if (!v) setOpenId(null) }}
        onEdit={(pr) => { setEditing(pr); setFormOpen(true) }}
        onMakeOrder={onMakeOrder ? (pr) => { setOpenId(null); onMakeOrder(pr) } : undefined}
        onMakeRfq={(pr) => { setOpenId(null); setRfqPreselect(pr.id); setRfqFormOpen(true) }}
        onChanged={changed}
      />
      <RfqForm
        open={rfqFormOpen}
        onOpenChange={(v) => { setRfqFormOpen(v); if (!v) setRfqPreselect(null) }}
        rfq={null}
        preSelectRequestId={rfqPreselect}
        onSaved={changed}
      />
    </div>
  )
}
