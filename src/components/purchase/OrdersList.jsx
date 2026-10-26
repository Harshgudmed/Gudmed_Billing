import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { useDateFilter } from '@/components/common/DateFilter'
import { Clock, Truck, ClipboardList, PackagePlus, PackageCheck, CheckCheck } from 'lucide-react'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime } from '@/lib/format'
import { PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { ORDER_STATUS, APPROVER_LABEL, OPEN_ORDERS, GOODS_IN_ORDERS, useMe } from './requestMeta'
import OrderDetail from './OrderDetail'
import OrderForm from './OrderForm'
import MakeOrdersDialog from './MakeOrdersDialog'
import ReceiveGoodsDialog from './ReceiveGoodsDialog'
import ReceiptDetail from './ReceiptDetail'

// Purchase orders, laid out like the requests list: tiles for the views people
// work from — waiting for my approval, approved and ready to send to the
// vendor, waiting to be received, everything — then the filter row and the
// table. "Make orders from approved requests" turns everything approved into
// draft orders, one per vendor; a row opens the order, and from there its
// goods are received. Each person sees only the tiles for their work, and the
// store sees no money.

const VIEWS = [
  { value: 'to-approve', label: 'Waiting for My Approval', hint: 'Your turn to decide', tone: 'yellow', icon: Clock, count: 'toApprove', who: 'approver' },
  { value: 'to-send', label: 'Approved — To Send', hint: 'Print and give to the vendor', tone: 'green', icon: Truck, count: 'toSend', who: 'orderer' },
  { value: 'to-receive', label: 'To Receive', hint: 'Ordered, not all in yet', tone: 'blue', icon: PackageCheck, count: 'toReceive', who: 'receiver' },
  { value: 'received', label: 'Received', hint: 'Delivered in full, or closed', tone: 'green', icon: CheckCheck, count: 'received', who: 'store' },
  { value: 'all', label: 'All Orders', hint: 'Every vendor, every status', tone: 'purple', icon: ClipboardList, count: 'all', who: 'overseer' },
]
const COLS = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }
const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  // what the dashboard's Open Orders / Awaiting Delivery tiles and its "Received (orders)" stage open
  { value: OPEN_ORDERS, label: 'Open — awaiting delivery' },
  { value: GOODS_IN_ORDERS, label: 'Goods in — part or full' },
  ...Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.label })),
]

// `counts` — { toApprove, toSend, toReceive, all, readyToOrder }. `intent` opens it the way
// the dashboard asked: a view (with `status` on All Orders), an order already open, or the
// "make orders" step.
export default function OrdersList({ counts = {}, onChanged, intent = {}, onMakeBill }) {
  const me = useMe()
  const approver = me.isAdmin || !!APPROVER_LABEL[me.role]
  // The store's history of deliveries; everyone else finds them under All Orders.
  const allowed = { approver, orderer: me.canOrder, receiver: me.canReceive, overseer: me.seesEverything, store: !me.seesEverything && me.canReceive }
  const views = VIEWS.filter((v) => !v.who || allowed[v.who])
  const [view, setView] = useState(views.some((v) => v.value === intent.view) ? intent.view : views[views.length - 1]?.value || 'all')
  const [status, setStatus] = useState(intent.status || 'all')
  const [search, setSearch] = useState(intent.search || '')
  const dateFilter = useDateFilter('all', { showClear: false })
  const debounced = useDebounce(search, 300)
  const orders = useServerPagination(PURCHASE_ENDPOINT, {
    params: {
      resource: 'orders', search: debounced,
      view: view === 'all' ? '' : view,
      status: view === 'all' && status !== 'all' ? status : '',
      startDate: dateFilter.range.startDate,
      endDate: dateFilter.range.endDate,
    },
  })
  useLiveData('purchase', orders.refresh)

  const [openId, setOpenId] = useState(intent.openId || null)
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [making, setMaking] = useState(!!intent.makeFrom || intent.make === true)
  const [receiving, setReceiving] = useState(null) // the order whose goods are being received
  const [receiptId, setReceiptId] = useState(null)
  const changed = useCallback(() => { orders.refresh(); onChanged?.() }, [orders, onChanged])

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Which orders" className={`grid grid-cols-1 ${COLS[views.length]} gap-4`}>
        {/* a tile shows exactly what it counts, so it drops any status filter */}
        {views.map((v) => (
          <StatCard key={v.value} tone={v.tone} icon={v.icon} label={v.label} sublabel={v.hint}
            value={counts[v.count] ?? 0} selected={view === v.value} onClick={() => { setView(v.value); setStatus('all') }} />
        ))}
      </div>

      {me.canOrder && counts.readyToOrder > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-blue-900">
            <b>{counts.readyToOrder} approved request{counts.readyToOrder === 1 ? ' is' : 's are'}</b> waiting to be ordered.
          </p>
          <Button onClick={() => setMaking(true)} className="shrink-0"><PackagePlus className="h-4 w-4 mr-2" />Make orders</Button>
        </div>
      )}

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search PO number, vendor or item…"
        active={!!search || status !== 'all' || dateFilter.active}
        onClear={() => { setSearch(''); setStatus('all'); dateFilter.reset() }}
        actions={me.canOrder && <Button variant="outline" onClick={() => { setEditing(null); setFormOpen(true) }}>New order</Button>}
      >
        {view === 'all' && <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} className="w-48" />}
        {dateFilter.control}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <PaginatedTable
            pagination={orders}
            empty={search || status !== 'all' || dateFilter.active ? 'No order matches these filters' : view === 'to-approve' ? 'No order is waiting for your approval' : view === 'to-send' ? 'Nothing approved is waiting to be sent' : view === 'to-receive' ? 'Nothing is waiting to be received' : view === 'received' ? 'Nothing received yet' : 'No purchase orders yet'}
            columns={[
              { header: 'Order' }, { header: 'Vendor' }, { header: 'Items', className: 'text-right' },
              ...(me.seesMoney ? [{ header: 'Total', className: 'text-right' }] : []), { header: 'Status' }, { header: 'Needed by' },
            ]}
            renderRow={(o) => {
              const s = ORDER_STATUS[o.status] || ORDER_STATUS.draft
              return (
                <TableRow key={o.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenId(o.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(o.id) }}>
                  <TableCell>
                    <div className="font-mono text-sm font-medium text-blue-700">{o.number}</div>
                    <div className="text-xs text-gray-500">{formatDateTime(o.createdAt, { withTime: false })} · {o.createdByName}</div>
                  </TableCell>
                  <TableCell className="font-medium">{o.vendorName}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.lineCount}</TableCell>
                  {me.seesMoney && <TableCell className="text-right font-medium tabular-nums">{formatMoney(o.total)}</TableCell>}
                  <TableCell>
                    <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                    {o.status === 'submitted' && o.currentStep && (
                      <div className="text-xs text-gray-500 mt-1">Level {o.currentStep.level} of {o.levels} · {APPROVER_LABEL[o.currentStep.approverRole] || o.currentStep.approverRole}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{o.expectedDate ? formatDateTime(o.expectedDate, { withTime: false }) : '—'}</TableCell>
                </TableRow>
              )
            }}
          />
        </CardContent>
      </Card>

      <MakeOrdersDialog open={making} onOpenChange={setMaking} requestId={intent.makeFrom || null}
        onMade={(made) => { changed(); if (made[0]) setOpenId(made[0].id) }} />
      <OrderForm open={formOpen} onOpenChange={setFormOpen} order={editing} onSaved={(po) => { changed(); setOpenId(po.id) }} />
      {/* One dialog at a time: receiving or a receipt opens over the order by
          closing it, and closing them brings the order back, re-read. */}
      <OrderDetail id={openId} open={!!openId && !formOpen && !making && !receiving && !receiptId} onOpenChange={(v) => { if (!v) setOpenId(null) }}
        onEdit={(po) => { setEditing(po); setFormOpen(true) }} onChanged={changed}
        onReceive={setReceiving} onOpenReceipt={setReceiptId} onMakeBill={onMakeBill} />
      <ReceiveGoodsDialog order={receiving} open={!!receiving} onOpenChange={(v) => { if (!v) setReceiving(null) }} onReceived={changed} />
      <ReceiptDetail id={receiptId} open={!!receiptId} onOpenChange={(v) => { if (!v) setReceiptId(null) }} onChanged={changed} />
    </div>
  )
}
