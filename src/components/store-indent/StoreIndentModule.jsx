import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar } from '@/components/common/FilterBar'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatDateTime } from '@/lib/format'
import { ClipboardList, Plus, Clock, PackageOpen, PackageCheck, Lock, XCircle, Layers } from 'lucide-react'
import { STORE_INDENT_ENDPOINT } from '@/api/purchaseIndentApi'
import { PRIORITY } from '@/components/purchase/requestMeta'
import { INDENT_STATUS, TILE_COLS } from './indentMeta'
import IndentForm from './IndentForm'
import DeptIndentDetail from './DeptIndentDetail'

// Store Indent — a department asks the store for goods and follows what has
// been given. Each person sees their department's indents (an administrator:
// every department's; someone with no department: the ones they raised). The
// store issues from Purchase → Indents; this list follows it live.
//
// A bell notification opens an indent here as ?open=<id>.

// Each tile filters the list to what it counts (the server counts with the same filters).
const TILES = [
  { status: 'all', label: 'All indents', tone: 'purple', icon: Layers },
  { status: 'submitted', label: 'Open', hint: 'Waiting for the store', tone: 'yellow', icon: Clock },
  { status: 'partly_issued', label: 'Partly issued', hint: 'More to come', tone: 'orange', icon: PackageOpen },
  { status: 'issued', label: 'Issued', hint: 'Everything given', tone: 'green', icon: PackageCheck },
  { status: 'closed', label: 'Closed', hint: 'The rest is not coming', tone: 'blue', icon: Lock },
  { status: 'cancelled', label: 'Cancelled', tone: 'red', icon: XCircle },
]

export default function StoreIndentModule() {
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  const list = useServerPagination(STORE_INDENT_ENDPOINT, { params: { resource: 'indents', status, search: debounced } })
  // The store's issues come through /purchase, the department's own writes through /store-indents.
  useLiveData(['store-indents', 'purchase'], list.refresh)
  // Tile figures come with each page (counted with the same search, every status).
  const counts = list.summary || {}

  const [formOpen, setFormOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const [openId, setOpenId] = useState(params.get('open') || null)
  // A notification's link opens its indent once; drop it so a reload does not reopen it.
  useEffect(() => { if (params.get('open')) setParams({}, { replace: true }) }, [params, setParams])

  const changed = useCallback(() => list.refresh(), [list])

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ClipboardList className="h-8 w-8 text-blue-600" />
            Store Indent
          </h1>
          <p className="text-gray-500">Ask the store for what your department needs, and follow what has been given</p>
        </div>
        <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4 mr-2" />New indent</Button>
      </div>

      <div role="group" aria-label="Which indents" className={TILE_COLS}>
        {TILES.map((t) => (
          <StatCard key={t.status} tone={t.tone} icon={t.icon} label={t.label} sublabel={t.hint}
            value={(t.status === 'all' ? counts.all : counts[t.status]) ?? 0} selected={status === t.status} onClick={() => setStatus(t.status)} />
        ))}
      </div>

      <FilterBar search={search} onSearchChange={setSearch} placeholder="Search indent number or item…"
        active={!!search || status !== 'all'} onClear={() => { setSearch(''); setStatus('all') }} />

      <Card>
        <CardContent className="p-0">
          <PaginatedTable
            pagination={list}
            empty={search || status !== 'all' ? 'No indent matches this search' : 'No indents yet — press New indent to ask the store for something'}
            columns={[{ header: 'Indent' }, { header: 'Items' }, { header: 'Department' }, { header: 'Status' }, { header: 'Needed by' }, { header: 'Raised' }]}
            renderRow={(r) => {
              const s = INDENT_STATUS[r.status] || INDENT_STATUS.submitted
              return (
                <TableRow key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenId(r.id)}
                  tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id) }}>
                  <TableCell>
                    <div className="font-mono text-sm font-medium text-blue-700">{r.number}</div>
                    {r.priority !== 'normal' && <Badge variant="outline" className={`mt-1 ${PRIORITY[r.priority]?.cls}`}>{PRIORITY[r.priority]?.label}</Badge>}
                  </TableCell>
                  <TableCell className="max-w-[260px]"><div className="truncate">{r.items}</div><div className="text-xs text-gray-500">{r.lineCount} item{r.lineCount === 1 ? '' : 's'}</div></TableCell>
                  <TableCell>{r.department?.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                    {r.status === 'partly_issued' && <div className="mt-1 text-xs text-gray-500">{r.pendingLines} item{r.pendingLines === 1 ? '' : 's'} still to come</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.neededBy ? formatDateTime(r.neededBy, { withTime: false }) : <span className="text-gray-400">—</span>}</TableCell>
                  <TableCell>
                    <div className="text-sm">{r.requestedByName}</div>
                    <div className="text-xs text-gray-500">{formatDateTime(r.createdAt, { withTime: false })}</div>
                  </TableCell>
                </TableRow>
              )
            }}
          />
        </CardContent>
      </Card>

      <IndentForm open={formOpen} onOpenChange={setFormOpen} onSaved={(ind) => { changed(); setOpenId(ind.id) }} />
      <DeptIndentDetail id={openId} open={!!openId && !formOpen} onOpenChange={(v) => { if (!v) setOpenId(null) }} onChanged={changed} />
    </div>
  )
}
