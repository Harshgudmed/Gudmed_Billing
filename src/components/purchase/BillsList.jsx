import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { Receipt, Wallet, ReceiptText, FilePlus2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime } from '@/lib/format'
import { PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { BILL_STATUS, useMe } from './requestMeta'
import { billOverdue } from './orderMath'
import { billStillDue } from './paymentAccess'
import BillForm from './BillForm'
import BillDetail from './BillDetail'

// Vendor bills — the step after the goods are received: the vendor's invoice,
// checked against the order's rate and what the store received. Laid out like
// the orders list: tiles for the work people come here for, the filter row,
// then the table.
//   To Bill           — orders with goods in and no bill yet; a click starts
//                       a bill (the purchase officer's tile only)
//   On Hold           — bills that differ from the order, waiting for Finance
//   Approved — To Pay — passed for payment, not paid yet
//   All Bills         — everything, with a status filter
// A row opens the bill; approving, rejecting and cancelling happen there, and
// only for Finance. Finance sees nothing for making a bill.

// The same colour and icon as the dashboard's tile for each, so a bill on hold
// looks the same wherever it is counted.
const VIEWS = [
  { value: 'on-hold', label: 'On Hold — Mismatch', tone: 'red', icon: AlertTriangle },
  { value: 'approved', label: 'Approved — To Pay', tone: 'green', icon: Wallet },
  { value: 'all', label: 'All Bills', tone: 'purple', icon: ReceiptText },
]
// Written out in full so Tailwind finds them (an interpolated class never ships).
const COLS = { 3: 'grid-cols-1 sm:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4' }
const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...Object.entries(BILL_STATUS).map(([value, s]) => ({ value, label: s.label }))]
const day = (v) => formatDateTime(v, { withTime: false })

// `intent` opens the list the way the dashboard or an order asked:
//   { view: 'to-bill' | 'on-hold' | 'approved' | 'all', openId, make, orderId }
// 'to-bill' and `make` open the bill form (on `orderId` when given). Read once, on mount.
// `onOpenOrder(orderId)` — a bill's PO number opens the order on the Orders tab.
export default function BillsList({ intent = {}, onChanged, onOpenOrder }) {
  const me = useMe()
  // Finance comes here to decide, so it lands on what waits for it.
  const [view, setView] = useState(VIEWS.some((v) => v.value === intent.view) ? intent.view : me.canBill ? 'all' : 'on-hold')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  const bills = useServerPagination(PURCHASE_ENDPOINT, {
    params: { resource: 'bills', search: debounced, view: view === 'all' ? '' : view, status: view === 'all' && status !== 'all' ? status : '' },
  })
  useLiveData('purchase', bills.refresh)

  const [openId, setOpenId] = useState(intent.openId || null)
  // The bill form: a new bill (on an order already chosen, or pick one), or a draft being corrected.
  const startForm = me.canBill && (intent.make === true || intent.view === 'to-bill')
  const [formOpen, setFormOpen] = useState(startForm)
  const [formOrderId, setFormOrderId] = useState(startForm ? intent.orderId || null : null)
  const [editing, setEditing] = useState(null)
  const openForm = (draft = null, orderId = null) => { setEditing(draft); setFormOrderId(orderId); setFormOpen(true) }
  const changed = useCallback(() => { bills.refresh(); onChanged?.() }, [bills, onChanged])

  // The counts cover the whole hospital, whatever the table is showing.
  const s = bills.summary || {}
  const allCount = s.all ?? (view === 'all' && status === 'all' && !debounced ? bills.total : null)
  const values = {
    'on-hold': { value: s.onHold?.count ?? 0, sublabel: s.onHold?.amount ? formatMoney(s.onHold.amount) : 'Waiting for Finance' },
    approved: { value: s.approved?.count ?? 0, sublabel: s.approved?.amount ? formatMoney(s.approved.amount) : 'Passed for payment' },
    // Drafts are the purchase officer's unfinished work; Finance never acts on them.
    all: { value: allCount ?? '—', sublabel: me.canBill && s.drafts ? `${s.drafts} draft${s.drafts === 1 ? '' : 's'} not submitted` : 'Every vendor, every status' },
  }
  const tiles = VIEWS.length + (me.canBill ? 1 : 0)
  const filtered = !!search || (view === 'all' && status !== 'all')

  return (
    <div className="min-w-0 space-y-4">
      <div role="group" aria-label="Which bills" className={`grid gap-4 ${COLS[tiles]}`}>
        {/* Not a filter: orders waiting for a bill are picked in the bill form. */}
        {me.canBill && (
          <StatCard tone="blue" icon={Receipt} label="To Bill" sublabel="Goods in, no bill yet"
            value={s.toBill ?? 0} onClick={() => openForm()} />
        )}
        {VIEWS.map((v) => (
          <StatCard key={v.value} tone={v.tone} icon={v.icon} label={v.label} sublabel={values[v.value].sublabel}
            value={values[v.value].value} selected={view === v.value} onClick={() => setView(v.value)} />
        ))}
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search bill no., vendor, invoice no. or PO…"
        active={filtered}
        onClear={() => { setSearch(''); setStatus('all') }}
        actions={me.canBill && <Button onClick={() => openForm()}><FilePlus2 className="h-4 w-4 mr-2" />Enter vendor bill</Button>}
      >
        {view === 'all' && <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} className="w-48" />}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <PaginatedTable
            pagination={bills}
            // On a phone the table scrolls inside its card; the vendor keeps
            // room for its name rather than wrapping a word per line.
            tableClassName="min-w-[1040px]"
            empty={filtered ? 'No bill matches this search'
              : view === 'on-hold' ? 'No bill is on hold'
              : view === 'approved' ? 'No approved bill is waiting to be paid'
              : me.canBill ? 'No vendor bills yet — enter one when the vendor\'s invoice arrives' : 'No vendor bills yet'}
            columns={[
              { header: 'Bill' }, { header: 'Vendor · invoice', className: 'min-w-[200px]' }, { header: 'PO' },
              { header: 'Total', className: 'text-right' }, { header: 'TDS', className: 'text-right' }, { header: 'Payable', className: 'text-right' },
              { header: 'Due' }, { header: 'Match' }, { header: 'Status' },
            ]}
            renderRow={(b) => {
              // An approved bill stays "approved" on the server; what has been
              // paid on it is shown here. What is still due counts debit notes
              // (goods sent back) as well as payments, so a bill settled by a
              // return plus a payment reads "Paid", not "Part paid".
              const due = billStillDue(b)
              const settled = Number(b.amountPaid) > 0 || Number(b.debitNoteTotal) > 0
              const paidState = b.status === 'approved' && settled ? (due > 0 ? 'partly_paid' : 'paid') : b.status
              const st = BILL_STATUS[paidState] || BILL_STATUS.draft
              const overdue = billOverdue(b) && due > 0
              return (
                <TableRow key={b.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenId(b.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(b.id) }}>
                  <TableCell>
                    <div className="whitespace-nowrap font-mono text-sm font-medium text-blue-700">{b.number}</div>
                    <div className="text-xs text-gray-500">{day(b.createdAt)} · {b.createdByName}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{b.vendorName}</div>
                    <div className="text-xs text-gray-500">Inv {b.vendorInvoiceNumber}{b.vendorInvoiceDate && ` · ${day(b.vendorInvoiceDate)}`}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-sm">{b.order?.number || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(b.total)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-600">{b.tdsAmount > 0 ? formatMoney(b.tdsAmount) : '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(b.payable)}</TableCell>
                  <TableCell className={`whitespace-nowrap text-sm ${overdue ? 'font-semibold text-red-700' : ''}`}>
                    {b.dueDate ? day(b.dueDate) : <span className="text-gray-400">—</span>}
                    {overdue && <div className="text-xs font-medium">Overdue</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {b.matched
                      ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-4 w-4" />Matched</span>
                      : <span className="inline-flex items-center gap-1 font-medium text-amber-700"><AlertTriangle className="h-4 w-4" />Mismatch</span>}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={`whitespace-nowrap ${st.cls}`}>{st.label}</Badge></TableCell>
                </TableRow>
              )
            }}
          />
        </CardContent>
      </Card>

      <BillForm open={formOpen} onOpenChange={setFormOpen} bill={editing} orderId={formOrderId}
        onSaved={(b) => { changed(); setOpenId(b.id) }} />
      {/* One dialog at a time: correcting a draft closes the bill, and closing
          the form brings the bill back, re-read. */}
      <BillDetail id={openId} open={!!openId && !formOpen} onOpenChange={(v) => { if (!v) setOpenId(null) }}
        onEdit={(b) => openForm(b)} onChanged={changed}
        onOpenOrder={onOpenOrder ? (orderId) => { setOpenId(null); onOpenOrder(orderId) } : undefined} />
    </div>
  )
}
