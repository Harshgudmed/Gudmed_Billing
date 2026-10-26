import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { useDateFilter } from '@/components/common/DateFilter'
import { Hourglass, CheckCircle2, XCircle, Undo2, ListChecks } from 'lucide-react'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime } from '@/lib/format'
import { PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { purchaseReturnApi } from '@/api/purchaseReturnApi'
import { useMe } from './requestMeta'
import LoadFailed from './LoadFailed'
import ReturnForm from './ReturnForm'
import ReturnDetail, { RETURN_STATUS, REASON_LABEL } from './ReturnDetail'

// Goods sent back to vendors, and their debit notes. Laid out like the bills
// list: tiles for the work people come here for (each is exactly the rows its
// click lists), the filter row, then the table.
//   Waiting for Approval — raised by the store, for the purchase officer
//   Posted This Month    — out of stock, debit note made
//   Rejected             — turned down, the goods stayed
//   All Returns          — everything, with a status filter
// How returns run (approval or direct) is the hospital's setting, read from
// the server; the store sees quantities only — the server sends it no money.

const VIEWS = [
  { value: 'pending', label: 'Waiting for Approval', tone: 'yellow', icon: Hourglass },
  { value: 'posted-month', label: 'Posted This Month', tone: 'green', icon: CheckCircle2 },
  { value: 'rejected', label: 'Rejected', tone: 'red', icon: XCircle },
  { value: 'all', label: 'All Returns', tone: 'purple', icon: ListChecks },
]
const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...Object.entries(RETURN_STATUS).map(([value, s]) => ({ value, label: s.label }))]
const day = (v) => formatDateTime(v, { withTime: false })

// `openId` (optional): a return to open — from a notification.
export default function ReturnsTab({ onChanged, openId: openIdLink = null }) {
  const me = useMe()
  // The purchase officer comes here to decide; the store to raise and follow up.
  const [view, setView] = useState(me.canDecideReturn && !me.isAdmin ? 'pending' : 'all')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const dateFilter = useDateFilter('all', { showClear: false })
  const debounced = useDebounce(search, 300)
  const list = useServerPagination(PURCHASE_ENDPOINT, {
    params: {
      resource: 'returns', search: debounced,
      view: view === 'all' ? '' : view,
      status: view === 'all' && status !== 'all' ? status : '',
      startDate: dateFilter.range.startDate,
      endDate: dateFilter.range.endDate,
    },
  })
  useLiveData('purchase', list.refresh)

  // The hospital's setting decides what the raise button says; a failed read
  // is said, not guessed (the server decides on saving either way).
  const [returnMode, setReturnMode] = useState(null)
  const [settingsFailed, setSettingsFailed] = useState(false)
  const loadSettings = useCallback(async () => {
    setSettingsFailed(false)
    try { setReturnMode((await purchaseReturnApi.getSettings()).data.returnMode) } catch { setSettingsFailed(true) }
  }, [])
  useEffect(() => { loadSettings() }, [loadSettings])

  const [openId, setOpenId] = useState(openIdLink)
  const [formOpen, setFormOpen] = useState(false)
  const changed = useCallback(() => { list.refresh(); onChanged?.() }, [list, onChanged])

  const s = list.summary || {}
  const money = (x) => (x?.amount != null && x.amount > 0 ? formatMoney(x.amount) : null)
  const tiles = {
    pending: { value: s.pending?.count ?? 0, sublabel: money(s.pending) || (returnMode === 'direct' ? 'Returns post at once here' : 'For the purchase officer') },
    'posted-month': { value: s.postedThisMonth?.count ?? 0, sublabel: money(s.postedThisMonth) || 'Out of stock, debit note made' },
    rejected: { value: s.rejected ?? 0, sublabel: 'Goods stayed in stock' },
    all: { value: s.all ?? '—', sublabel: 'Every return, every status' },
  }
  const filtered = !!search || (view === 'all' && status !== 'all') || dateFilter.active
  const seesMoney = me.seesMoney

  return (
    <div className="min-w-0 space-y-4">
      <div role="group" aria-label="Which returns" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {VIEWS.map((v) => (
          <StatCard key={v.value} tone={v.tone} icon={v.icon} label={v.label} sublabel={tiles[v.value].sublabel}
            value={tiles[v.value].value} selected={view === v.value} onClick={() => setView(v.value)} />
        ))}
      </div>

      {settingsFailed && <LoadFailed onRetry={loadSettings}>The hospital&apos;s return setting did not load, so it is not known whether a new return needs approval.</LoadFailed>}

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search return, debit note, vendor, PO, item or batch…"
        active={filtered}
        onClear={() => { setSearch(''); setStatus('all'); dateFilter.reset() }}
        actions={me.canRaiseReturn && <Button onClick={() => setFormOpen(true)} disabled={!returnMode}><Undo2 className="h-4 w-4 mr-2" />Return goods</Button>}
      >
        {view === 'all' && <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} className="w-48" />}
        {dateFilter.control}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <PaginatedTable
            pagination={list}
            tableClassName={seesMoney ? 'min-w-[960px]' : 'min-w-[820px]'}
            empty={filtered ? 'No return matches this search'
              : view === 'pending' ? 'No return is waiting for approval'
              : view === 'posted-month' ? 'Nothing was returned this month'
              : view === 'rejected' ? 'No return was rejected'
              : me.canRaiseReturn ? 'No returns yet — use "Return goods" when goods must go back to a vendor' : 'No returns yet'}
            columns={[
              { header: 'Return' }, { header: 'Vendor · PO', className: 'min-w-[180px]' }, { header: 'Items', className: 'min-w-[200px]' },
              { header: 'Reason' }, ...(seesMoney ? [{ header: 'Value', className: 'text-right' }] : []), { header: 'Debit note' }, { header: 'Status' },
            ]}
            renderRow={(x) => {
              const st = RETURN_STATUS[x.status] || RETURN_STATUS.pending_approval
              const more = x.lineCount - (x.lines?.length || 0)
              return (
                <TableRow key={x.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenId(x.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(x.id) }}>
                  <TableCell>
                    <div className="whitespace-nowrap font-mono text-sm font-medium text-blue-700">{x.number}</div>
                    <div className="text-xs text-gray-500">{day(x.createdAt)} · {x.createdByName}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{x.vendorName}</div>
                    <div className="font-mono text-xs text-gray-500">{x.order?.number}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {(x.lines || []).map((l) => `${l.itemName} ${l.quantity} ${l.unitCode}`).join(', ')}
                    {more > 0 && <span className="text-gray-500"> and {more} more</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{REASON_LABEL[x.reason] || x.reason}</TableCell>
                  {seesMoney && <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(x.total)}</TableCell>}
                  <TableCell className="whitespace-nowrap text-sm">
                    {x.debitNoteNumber ? <span className="font-mono">{x.debitNoteNumber}</span> : <span className="text-gray-400">—</span>}
                    {seesMoney && x.debitNoteNumber && <div className="text-xs text-gray-500">{x.bill ? `on ${x.bill.number}` : 'not billed'}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={`whitespace-nowrap ${st.cls}`}>{st.label}</Badge></TableCell>
                </TableRow>
              )
            }}
          />
        </CardContent>
      </Card>

      {me.canRaiseReturn && <ReturnForm open={formOpen} onOpenChange={setFormOpen} returnMode={returnMode} onSaved={(r) => { changed(); setOpenId(r.id) }} />}
      <ReturnDetail id={openId} open={!!openId && !formOpen} onOpenChange={(v) => { if (!v) setOpenId(null) }} onChanged={changed} />
    </div>
  )
}
