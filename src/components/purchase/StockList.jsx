import { useState, useMemo, useCallback, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { useDateFilter } from '@/components/common/DateFilter'
import { Boxes, AlertTriangle, PackageX, CalendarClock, ClipboardCheck, PackageCheck } from 'lucide-react'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime, localYmd } from '@/lib/format'
import { PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { STOCK_STATUS, RECEIPT_STATUS, useMe } from './requestMeta'
import { flattenCategories, categoryFilterOptions } from './categoryOptions'
import StockItemDialog from './StockItemDialog'
import ReceiptDetail from './ReceiptDetail'

// The store: what is on the shelf, and the goods receipts that put it there.
// Tiles in the HMS status colours pick what the table shows — everything in
// stock, what is at or under its reorder level, what has run out, what expires
// within 60 days — and the last tile switches to today's goods receipts (GRNs),
// the ones it counts; clearing the date shows every receipt. A tile clicked
// again goes back to every item. Money columns appear only for those who see
// money; the server leaves them out for the store.

const ALL = '__all'
const VIEWS = [
  { value: 'in_stock', label: 'In Stock', hint: 'Items on the shelf', tone: 'green', icon: Boxes, count: 'inStock' },
  { value: 'low', label: 'Low Stock', hint: 'At or under reorder level', tone: 'yellow', icon: AlertTriangle, count: 'low' },
  { value: 'out', label: 'Out of Stock', hint: 'Nothing left', tone: 'red', icon: PackageX, count: 'out' },
  { value: 'expiring', label: 'Expiring Soon', hint: 'Within 60 days', tone: 'orange', icon: CalendarClock, count: 'expiring' },
  { value: 'receipts', label: 'Deliveries Recorded Today', hint: 'Goods receipts', tone: 'purple', icon: ClipboardCheck, count: 'receivedToday' },
]
const RECEIPT_FILTER = [{ value: 'all', label: 'All receipts' }, { value: 'posted', label: 'Received' }, { value: 'cancelled', label: 'Cancelled' }]

// `intent` — { view, receiptId, receivedToday }: `receivedToday` opens the
// receipts on today's received ones, as the dashboard's "Received Today" counts them.
export default function StockList({ categories = [], receivedToday = 0, intent = {}, onReceive, onOpenOrder, onChanged }) {
  const me = useMe()
  const [view, setView] = useState(intent.view || 'all')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(ALL)
  const [receiptStatus, setReceiptStatus] = useState(intent.receivedToday ? 'posted' : 'all')
  const dateFilter = useDateFilter('all', { showClear: false })
  const debounced = useDebounce(search, 300)
  const [itemId, setItemId] = useState(null)
  const [receiptId, setReceiptId] = useState(intent.receiptId || null)
  const receipts = view === 'receipts'

  useEffect(() => {
    if (intent.receivedToday) dateFilter.setMode('today')
  }, [intent.receivedToday, dateFilter.setMode])

  const stock = useServerPagination(PURCHASE_ENDPOINT, {
    perPage: 20,
    params: { resource: 'stock', search: receipts ? '' : debounced, categoryId: category === ALL ? '' : category, status: receipts || view === 'all' ? '' : view },
  })
  const grns = useServerPagination(PURCHASE_ENDPOINT, {
    perPage: 20,
    params: {
      resource: 'receipts', search: receipts ? debounced : '', status: receiptStatus,
      startDate: dateFilter.range.startDate, endDate: dateFilter.range.endDate,
    },
  })
  const refresh = useCallback(() => { stock.refresh(); grns.refresh() }, [stock, grns])
  useLiveData('purchase', refresh)

  const flat = useMemo(() => flattenCategories(categories), [categories])
  const counts = { ...(stock.summary || {}), receivedToday }
  const money = me.seesMoney
  const soon = localYmd(new Date(), 60)
  const pick = (v) => {
    setView((cur) => (cur === v ? 'all' : v)); setSearch('')
    // The receipts tile counts today's received ones, so it opens on those.
    if (v === 'receipts' && !receipts) { dateFilter.setMode('today'); setReceiptStatus('posted') }
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-label="What to show" className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {VIEWS.map((v) => (
          <StatCard key={v.value} tone={v.tone} icon={v.icon} label={v.label} sublabel={v.hint}
            value={counts[v.count] ?? 0} selected={view === v.value} onClick={() => pick(v.value)} />
        ))}
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder={receipts ? 'Search GRN, PO, vendor, challan or item…' : 'Search item name, code or HSN…'}
        active={!!search || (receipts ? receiptStatus !== 'all' || dateFilter.active : category !== ALL || view !== 'all')}
        onClear={() => { setSearch(''); setCategory(ALL); setReceiptStatus('all'); dateFilter.reset(); setView(receipts ? 'receipts' : 'all') }}
        actions={me.canReceive && onReceive && <Button onClick={onReceive} className="bg-green-600 hover:bg-green-700"><PackageCheck className="h-4 w-4 mr-2" />Receive goods</Button>}
      >
        {receipts ? (
          <>
            <FilterSelect value={receiptStatus} onChange={setReceiptStatus} options={RECEIPT_FILTER} className="w-44" />
            {dateFilter.control}
          </>
        ) : <FilterSelect value={category} onChange={setCategory} options={categoryFilterOptions(flat, ALL)} className="w-64" />}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          {receipts ? (
            <PaginatedTable
              pagination={grns}
              empty={dateFilter.active ? 'No receipt matches this date range'
                : search || receiptStatus !== 'all' ? 'No receipt matches this search' : 'No goods received yet — receive them from an approved order'}
              columns={[
                { header: 'GRN' }, { header: 'Order' }, { header: 'Vendor' }, { header: 'Challan' },
                { header: 'Items', className: 'text-right' }, ...(money ? [{ header: 'Value', className: 'text-right' }] : []), { header: 'Status' },
              ]}
              renderRow={(g) => {
                const s = RECEIPT_STATUS[g.status] || RECEIPT_STATUS.posted
                return (
                  <TableRow key={g.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setReceiptId(g.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setReceiptId(g.id) }}>
                    <TableCell>
                      <div className="font-mono text-sm font-medium text-blue-700">{g.number}</div>
                      <div className="text-xs text-gray-500">{formatDateTime(g.receivedAt)} · {g.receivedByName}</div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{g.order?.number}</TableCell>
                    <TableCell className="font-medium">{g.vendorName}</TableCell>
                    <TableCell className="text-sm">{g.challanNumber || <span className="text-gray-400">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.lineCount}</TableCell>
                    {money && <TableCell className="text-right font-medium tabular-nums">{formatMoney(g.totalValue)}</TableCell>}
                    <TableCell><Badge variant="outline" className={s.cls}>{s.label}</Badge></TableCell>
                  </TableRow>
                )
              }}
            />
          ) : (
            <PaginatedTable
              pagination={stock}
              empty={search || category !== ALL || view !== 'all' ? 'No item matches this' : 'No stocked items yet — add items in the Items tab'}
              columns={[
                { header: 'Item' }, { header: 'On hand', className: 'text-right' }, { header: 'Reorder at', className: 'text-right' },
                { header: 'Nearest expiry' }, ...(money ? [{ header: 'Value', className: 'text-right' }] : []), { header: 'Status' },
              ]}
              renderRow={(i) => {
                const s = STOCK_STATUS[i.status] || STOCK_STATUS.none
                const exp = i.nearestExpiry ? String(i.nearestExpiry).slice(0, 10) : null
                return (
                  <TableRow key={i.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setItemId(i.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setItemId(i.id) }}>
                    <TableCell>
                      <div className="font-medium">{i.name}{!i.isActive && <span className="ml-2 text-xs font-normal text-gray-400">retired</span>}</div>
                      <div className="text-xs text-gray-500">{i.code} · {i.category?.name}</div>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap"><span className="font-semibold tabular-nums">{i.onHand}</span> <span className="text-xs text-gray-500">{i.stockUnit?.code}</span></TableCell>
                    <TableCell className="text-right tabular-nums text-gray-600">{i.reorderLevel ?? '—'}</TableCell>
                    <TableCell className={`text-sm ${exp && exp <= soon ? 'font-medium text-orange-700' : ''}`}>{exp ? formatDateTime(i.nearestExpiry, { withTime: false }) : <span className="text-gray-400">—</span>}</TableCell>
                    {money && <TableCell className="text-right tabular-nums">{formatMoney(i.value)}</TableCell>}
                    <TableCell><Badge variant="outline" className={s.cls}>{s.label}</Badge></TableCell>
                  </TableRow>
                )
              }}
            />
          )}
        </CardContent>
      </Card>
      {!receipts && money && stock.summary?.value != null && (
        <p className="text-right text-sm text-gray-600">Stock value (at purchase price, before GST): <b className="tabular-nums">{formatMoney(stock.summary.value)}</b></p>
      )}

      <StockItemDialog id={itemId} open={!!itemId && !receiptId} onOpenChange={(v) => { if (!v) setItemId(null) }} onOpenReceipt={setReceiptId} />
      <ReceiptDetail id={receiptId} open={!!receiptId} onOpenChange={(v) => { if (!v) setReceiptId(null) }}
        onChanged={() => { refresh(); onChanged?.() }} onOpenOrder={onOpenOrder ? (id) => { setReceiptId(null); setItemId(null); onOpenOrder(id) } : undefined} />
    </div>
  )
}
