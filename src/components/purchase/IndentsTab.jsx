import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { useDateFilter } from '@/components/common/DateFilter'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime } from '@/lib/format'
import { Clock, PackageOpen, PackageCheck, Lock, XCircle, Layers } from 'lucide-react'
import client from '@/api/client'
import { PURCHASE_INDENT_ENDPOINT } from '@/api/purchaseIndentApi'
import { INDENT_STATUS, ISSUE_STATUS, TILE_COLS } from '@/components/store-indent/indentMeta'
import { PRIORITY, useMe } from './requestMeta'
import { usePickList } from './usePickList'
import LoadFailed from './LoadFailed'
import IndentDetail from './IndentDetail'
import IssueDetail from './IssueDetail'

// Purchase → Indents: what the departments have asked the store for, and the
// issues made against them. The store keeper opens an indent and gives what
// the shelf holds — no approval step; the purchase officer reads them (what
// the wards use is what gets reordered). Tiles split the indents by status
// and each one filters the list to exactly the rows it counts. Issues are a
// second view: every slip, to find and reprint one.

const TILES = [
  { status: 'submitted', label: 'Open', hint: 'Nothing given yet', tone: 'yellow', icon: Clock },
  { status: 'partly_issued', label: 'Partly issued', hint: 'More to give', tone: 'orange', icon: PackageOpen },
  { status: 'issued', label: 'Issued', hint: 'Everything given', tone: 'green', icon: PackageCheck },
  { status: 'closed', label: 'Closed', hint: 'The rest will not be given', tone: 'blue', icon: Lock },
  { status: 'cancelled', label: 'Cancelled', hint: 'By the department', tone: 'red', icon: XCircle },
  { status: 'all', label: 'All indents', tone: 'purple', icon: Layers },
]
const VIEWS = [{ value: 'indents', label: 'Indents' }, { value: 'issues', label: 'Issue slips' }]
const ISSUE_STATUS_OPTIONS = [{ value: 'all', label: 'All issues' }, ...Object.entries(ISSUE_STATUS).map(([value, s]) => ({ value, label: s.label }))]

const loadDepartments = () => client.get('/settings?resource=departments')

// `openId` / `issueId` (optional): an indent or issue slip to open — from a notification.
export default function IndentsTab({ onChanged, openId: openIdLink = null, issueId: issueIdLink = null }) {
  const me = useMe()
  const [view, setView] = useState('indents')
  const [status, setStatus] = useState('submitted')
  const [issueStatus, setIssueStatus] = useState('all')
  const [departmentId, setDepartmentId] = useState('all')
  const [search, setSearch] = useState('')
  const dateFilter = useDateFilter('all', { showClear: false })
  const debounced = useDebounce(search, 300)
  const departments = usePickList(loadDepartments)

  const indents = useServerPagination(PURCHASE_INDENT_ENDPOINT, { params: {
    resource: 'indents', status, departmentId, search: view === 'indents' ? debounced : '',
    startDate: dateFilter.range.startDate, endDate: dateFilter.range.endDate,
  } })
  const issues = useServerPagination(PURCHASE_INDENT_ENDPOINT, { params: {
    resource: 'issues', status: issueStatus, departmentId, search: view === 'issues' ? debounced : '',
    startDate: dateFilter.range.startDate, endDate: dateFilter.range.endDate,
  } })
  // New indents arrive through /store-indents; issues and closes through /purchase.
  const refreshAll = useCallback(() => { indents.refresh(); issues.refresh() }, [indents, issues])
  useLiveData(['store-indents', 'purchase'], refreshAll)
  const counts = indents.summary || {}

  const [openId, setOpenId] = useState(openIdLink)
  const [issueId, setIssueId] = useState(issueIdLink)
  const changed = useCallback(() => { refreshAll(); onChanged?.() }, [refreshAll, onChanged])

  const deptOptions = [{ value: 'all', label: 'All departments' }, ...departments.list.map((d) => ({ value: d.id, label: d.name }))]
  const filtered = !!search || departmentId !== 'all' || (view === 'issues' && issueStatus !== 'all') || dateFilter.active

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Indents or issue slips" className="inline-flex rounded-md border bg-white p-0.5">
        {VIEWS.map((v) => (
          <Button key={v.value} aria-pressed={view === v.value} size="sm" variant={view === v.value ? 'default' : 'ghost'} onClick={() => setView(v.value)}>{v.label}</Button>
        ))}
      </div>

      {view === 'indents' && (
        <div role="group" aria-label="Which indents" className={TILE_COLS}>
          {TILES.map((t) => (
            <StatCard key={t.status} tone={t.tone} icon={t.icon} label={t.label} sublabel={t.hint}
              value={counts[t.status] ?? 0} selected={status === t.status} onClick={() => setStatus(t.status)} />
          ))}
        </div>
      )}

      {departments.failed && <LoadFailed onRetry={departments.reload}>Could not load the departments for the filter.</LoadFailed>}
      <FilterBar search={search} onSearchChange={setSearch}
        placeholder={view === 'indents' ? 'Search indent number, item or who raised it…' : 'Search issue or indent number, item or who collected it…'}
        active={filtered} onClear={() => { setSearch(''); setDepartmentId('all'); setIssueStatus('all'); dateFilter.reset() }}>
        <FilterSelect value={departmentId} onChange={setDepartmentId} options={deptOptions} className="w-48" />
        {view === 'issues' && <FilterSelect value={issueStatus} onChange={setIssueStatus} options={ISSUE_STATUS_OPTIONS} className="w-40" />}
        {dateFilter.control}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          {view === 'indents' ? (
            <PaginatedTable
              pagination={indents}
              empty={filtered ? 'No indent matches this search' : status === 'submitted' ? 'No open indents — nothing waits for the store' : 'No indents here'}
              columns={[{ header: 'Indent' }, { header: 'Department' }, { header: 'Items' }, { header: 'Status' }, { header: 'Needed by' }, { header: 'Raised' }]}
              renderRow={(r) => {
                const s = INDENT_STATUS[r.status] || INDENT_STATUS.submitted
                return (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenId(r.id)}
                    tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id) }}>
                    <TableCell>
                      <div className="font-mono text-sm font-medium text-blue-700">{r.number}</div>
                      {r.priority !== 'normal' && <Badge variant="outline" className={`mt-1 ${PRIORITY[r.priority]?.cls}`}>{PRIORITY[r.priority]?.label}</Badge>}
                    </TableCell>
                    <TableCell>{r.department?.name}</TableCell>
                    <TableCell className="max-w-[260px]"><div className="truncate">{r.items}</div><div className="text-xs text-gray-500">{r.lineCount} item{r.lineCount === 1 ? '' : 's'}</div></TableCell>
                    <TableCell>
                      <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                      {r.status === 'partly_issued' && <div className="mt-1 text-xs text-gray-500">{r.pendingLines} item{r.pendingLines === 1 ? '' : 's'} still to give</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.neededBy ? formatDateTime(r.neededBy, { withTime: false }) : <span className="text-gray-400">—</span>}</TableCell>
                    <TableCell>
                      <div className="text-sm">{r.requestedByName}</div>
                      <div className="text-xs text-gray-500">{formatDateTime(r.createdAt)}</div>
                    </TableCell>
                  </TableRow>
                )
              }}
            />
          ) : (
            <PaginatedTable
              pagination={issues}
              empty={filtered ? 'No issue matches this search' : 'No goods issued yet'}
              columns={[
                { header: 'Issue' }, { header: 'Department' }, { header: 'Indent' }, { header: 'Collected by' }, { header: 'Issued' },
                ...(me.seesMoney ? [{ header: 'Cost', className: 'text-right' }] : []), { header: 'Status' },
              ]}
              renderRow={(r) => {
                const s = ISSUE_STATUS[r.status] || ISSUE_STATUS.posted
                return (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setIssueId(r.id)}
                    tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setIssueId(r.id) }}>
                    <TableCell className="font-mono text-sm font-medium text-blue-700">{r.number}</TableCell>
                    <TableCell>{r.department?.name}</TableCell>
                    <TableCell className="font-mono text-sm">{r.indent?.number || '—'}</TableCell>
                    <TableCell>{r.receivedByName || '—'}</TableCell>
                    <TableCell><div className="text-sm">{formatDateTime(r.issuedAt)}</div><div className="text-xs text-gray-500">by {r.issuedByName}</div></TableCell>
                    {me.seesMoney && <TableCell className="text-right tabular-nums">{r.totalValue !== undefined ? formatMoney(r.totalValue) : '—'}</TableCell>}
                    <TableCell><Badge variant="outline" className={s.cls}>{s.label}</Badge></TableCell>
                  </TableRow>
                )
              }}
            />
          )}
        </CardContent>
      </Card>

      <IndentDetail id={openId} open={!!openId && !issueId} onOpenChange={(v) => { if (!v) setOpenId(null) }}
        onChanged={changed} onOpenIssue={(id) => setIssueId(id)} />
      <IssueDetail id={issueId} open={!!issueId} onOpenChange={(v) => { if (!v) setIssueId(null) }} onChanged={changed} />
    </div>
  )
}
