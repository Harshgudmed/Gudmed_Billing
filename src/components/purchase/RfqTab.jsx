import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { FilePen, Send, AlarmClock, Award, ClipboardList, Plus } from 'lucide-react'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatDateTime, localYmd } from '@/lib/format'
import { PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { useMe } from './requestMeta'
import RfqForm from './RfqForm'
import RfqDetail, { RFQ_STATUS } from './RfqDetail'

// Requests for quotation: ask several vendors the same items, enter their
// rates, compare them side by side and award one — the award makes the
// purchase order. Laid out like the other purchase lists: tiles for the views
// people work from (each counts exactly the rows it opens), the filter row,
// the table. A row opens the RFQ; everything else happens there.
// The purchase officer makes and awards; Finance reads.

const VIEWS = [
  { value: 'draft', label: 'Drafts', hint: 'Not sent yet', tone: 'yellow', icon: FilePen },
  { value: 'open', label: 'Out with vendors', hint: 'Sent — quotes coming in', tone: 'blue', icon: Send },
  { value: 'due', label: 'Quotes due', hint: 'Due today or earlier — compare and award', tone: 'orange', icon: AlarmClock },
  { value: 'awarded', label: 'Awarded', hint: 'Purchase order made', tone: 'green', icon: Award },
  { value: 'all', label: 'All RFQs', hint: 'Every status', tone: 'purple', icon: ClipboardList },
]
const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...Object.entries(RFQ_STATUS).map(([value, s]) => ({ value, label: s.label }))]
const day = (v) => formatDateTime(v, { withTime: false })

// `openId` (optional): an RFQ to open — from a notification.
export default function RfqTab({ onChanged, openId: openIdLink = null }) {
  const me = useMe()
  // The officer starts on what is out with vendors; Finance, which only reads, on everything.
  const [view, setView] = useState(me.canRfq ? 'open' : 'all')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  const rfqs = useServerPagination(PURCHASE_ENDPOINT, {
    params: { resource: 'rfqs', search: debounced, view: view === 'all' ? '' : view, status: view === 'all' && status !== 'all' ? status : '' },
  })
  useLiveData('purchase', rfqs.refresh)

  const [openId, setOpenId] = useState(openIdLink)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const changed = useCallback(() => { rfqs.refresh(); onChanged?.() }, [rfqs, onChanged])
  const s = rfqs.summary || {}
  const filtered = !!search || (view === 'all' && status !== 'all')
  const today = localYmd()

  return (
    <div className="min-w-0 space-y-4">
      <div role="group" aria-label="Which RFQs" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {VIEWS.map((v) => (
          <StatCard key={v.value} tone={v.tone} icon={v.icon} label={v.label} sublabel={v.hint}
            value={s[v.value] ?? '—'} selected={view === v.value} onClick={() => { setView(v.value); setStatus('all') }} />
        ))}
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search RFQ no., title, item or vendor…"
        active={filtered}
        onClear={() => { setSearch(''); setStatus('all') }}
        actions={me.canRfq && <Button onClick={() => { setEditing(null); setFormOpen(true) }}><Plus className="h-4 w-4 mr-2" />New RFQ</Button>}
      >
        {view === 'all' && <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} className="w-44" />}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <PaginatedTable
            pagination={rfqs}
            tableClassName="min-w-[860px]"
            empty={filtered ? 'No RFQ matches this search'
              : view === 'draft' ? 'No draft RFQs'
              : view === 'open' ? 'No RFQ is out with vendors'
              : view === 'due' ? 'No quotes are due — nothing waits to be compared'
              : view === 'awarded' ? 'No RFQ has been awarded yet'
              : me.canRfq ? 'No RFQs yet — ask vendors for rates with New RFQ' : 'No RFQs yet'}
            columns={[
              { header: 'RFQ' }, { header: 'Title', className: 'min-w-[200px]' }, { header: 'Items', className: 'text-right' },
              { header: 'Quotes' }, { header: 'Due by' }, { header: 'Status' },
            ]}
            renderRow={(q) => {
              const st = RFQ_STATUS[q.status] || RFQ_STATUS.draft
              const late = q.status === 'open' && q.dueDate && String(q.dueDate).slice(0, 10) <= today
              return (
                <TableRow key={q.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenId(q.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(q.id) }}>
                  <TableCell>
                    <div className="whitespace-nowrap font-mono text-sm font-medium text-blue-700">{q.number}</div>
                    <div className="text-xs text-gray-500">{day(q.createdAt)} · {q.createdByName}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{q.title}</div>
                    {q.request?.number && <div className="text-xs text-gray-500">from {q.request.number}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{q.lineCount}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {q.quotedCount} of {q.vendorCount} quoted
                    {q.declinedCount > 0 && <div className="text-xs text-gray-500">{q.declinedCount} declined</div>}
                  </TableCell>
                  <TableCell className={`whitespace-nowrap text-sm ${late ? 'font-semibold text-orange-700' : ''}`}>{q.dueDate ? day(q.dueDate) : '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`whitespace-nowrap ${st.cls}`}>{st.label}</Badge>
                    {q.status === 'awarded' && (
                      <div className="mt-1 text-xs text-gray-500">{q.awardedVendorName}{q.order?.number && ` · ${q.order.number}`}</div>
                    )}
                  </TableCell>
                </TableRow>
              )
            }}
          />
        </CardContent>
      </Card>

      <RfqForm open={formOpen} onOpenChange={setFormOpen} rfq={editing} onSaved={(saved) => { changed(); setOpenId(saved.id) }} />
      {/* One dialog at a time: editing a draft closes it, saving brings it back. */}
      <RfqDetail id={openId} open={!!openId && !formOpen} onOpenChange={(v) => { if (!v) setOpenId(null) }}
        onEdit={(rfq) => { setEditing(rfq); setFormOpen(true) }} onChanged={changed} />
    </div>
  )
}
