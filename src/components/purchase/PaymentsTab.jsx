import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { CalendarClock, AlertTriangle, Factory, Hourglass, Wallet, X } from 'lucide-react'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { formatMoney, formatDateTime } from '@/lib/format'
import { PURCHASE_ENDPOINT } from '@/api/purchaseApi'
import { useMe } from './requestMeta'
import { paymentAccess, usePaymentMode, MODE_TEXT, PAYMENT_STATUS, PAY_MODES, modeLabel } from './paymentAccess'
import PaymentForm from './PaymentForm'
import PaymentDetail from './PaymentDetail'
import BillDetail from './BillDetail'
import LoadFailed from './LoadFailed'

// Vendor payments — the step after a bill is approved. Three lists:
//   Bills to pay  — approved bills with something still due, most overdue
//                   first: due day, days overdue, the MSME 45-day limit, and
//                   "Pay" for whoever records payments in this hospital
//   By vendor     — the same money per vendor, in ageing buckets
//   Payments      — every payment recorded, whatever became of it
// The tiles count the whole hospital (the server's summary) and open exactly
// the rows they count. Who records and who approves follows the hospital's
// setting (Settings → Purchase), read from the server.

const BUCKETS = [
  { key: 'notDue', label: 'Not yet due' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd61_90', label: '61–90 days' },
  { key: 'd90plus', label: 'Over 90 days' },
]
const BUCKET_TONE = { notDue: 'text-green-700', d1_30: 'text-amber-700', d31_60: 'text-orange-700', d61_90: 'text-red-700', d90plus: 'text-red-800' }
const SECTIONS = [
  { value: 'bills', label: 'Bills to pay' },
  { value: 'vendors', label: 'By vendor' },
  { value: 'payments', label: 'Payments' },
]
const VIEW_LABEL = { overdue: 'Overdue', 'due-week': 'Due this week', msme: 'MSME at risk' }
const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...Object.entries(PAYMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))]
const MODE_OPTIONS = [{ value: 'all', label: 'Every mode' }, ...PAY_MODES.map((m) => ({ value: m.value, label: m.label }))]
const day = (v) => formatDateTime(v, { withTime: false })
const ymdDay = (v) => (v ? day(`${v}T00:00:00`) : '—')

function DueText({ row }) {
  if (row.daysOverdue > 0) return <span className="font-semibold text-red-700">{row.daysOverdue} day{row.daysOverdue === 1 ? '' : 's'} overdue</span>
  if (row.daysOverdue === 0) return <span className="font-medium text-amber-700">Due today</span>
  return <span className="text-gray-500">in {-row.daysOverdue} day{row.daysOverdue === -1 ? '' : 's'}</span>
}

function MsmeText({ row }) {
  if (!row.msme) return null
  if (row.msmeFlag === 'past') return <Badge variant="outline" className="whitespace-nowrap border-red-200 bg-red-50 text-red-700">MSME · {-row.msmeDaysLeft}d past 45</Badge>
  if (row.msmeFlag === 'near') return <Badge variant="outline" className="whitespace-nowrap border-orange-200 bg-orange-50 text-orange-700">MSME · {row.msmeDaysLeft}d left</Badge>
  return <Badge variant="outline" className="whitespace-nowrap">MSME</Badge>
}

// `intent` (optional): { section, openId } — a payment to open, e.g. from a notification.
export default function PaymentsTab({ intent = {}, onChanged }) {
  const me = useMe()
  const settings = usePaymentMode()
  const access = paymentAccess(me, settings.mode)

  const [section, setSection] = useState(intent.openId ? 'payments' : SECTIONS.some((s) => s.value === intent.section) ? intent.section : 'bills')
  const [view, setView] = useState('all') // bills: all | overdue | due-week | msme
  const [bucket, setBucket] = useState('')
  const [vendor, setVendor] = useState(null) // { id, name } — from the By vendor list
  const [status, setStatus] = useState('all')
  const [mode, setMode] = useState('all')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)

  // One list per shape: a bill row and a vendor row are different things, and
  // one list switching between them showed the old rows in the new columns
  // until the new page arrived.
  const payables = useServerPagination(PURCHASE_ENDPOINT, {
    params: { resource: 'payables', view, bucket, vendorId: vendor?.id || '', search: section === 'bills' ? debounced : '' },
  })
  const byVendor = useServerPagination(PURCHASE_ENDPOINT, {
    params: { resource: 'payables', by: 'vendor', bucket, search: section === 'vendors' ? debounced : '' },
  })
  const payments = useServerPagination(PURCHASE_ENDPOINT, {
    params: { resource: 'payments', status, mode, vendorId: vendor?.id || '', search: section === 'payments' ? debounced : '' },
  })
  const refresh = useCallback(() => { payables.refresh(); byVendor.refresh(); payments.refresh() }, [payables, byVendor, payments])
  useLiveData('purchase', refresh)

  const [payBillId, setPayBillId] = useState(null)
  const [openPayment, setOpenPayment] = useState(intent.openId || null)
  const [openBill, setOpenBill] = useState(null)
  const changed = useCallback(() => { refresh(); onChanged?.() }, [refresh, onChanged])

  const clearFilters = () => { setView('all'); setBucket(''); setVendor(null); setStatus('all'); setMode('all'); setSearch('') }
  const openTile = (next) => { clearFilters(); next() }
  const s = payables.summary || {}
  const tile = (t) => (t?.count ? formatMoney(t.amount) : null)

  const filtered = !!search || bucket || vendor || (section === 'bills' && view !== 'all') || (section === 'payments' && (status !== 'all' || mode !== 'all'))

  return (
    <div className="min-w-0 space-y-4">
      <div role="group" aria-label="Payments to make" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard tone="blue" icon={CalendarClock} label="Due this week" sublabel={tile(s.dueWeek) || 'Due today or in the next 6 days'}
          value={s.dueWeek?.count ?? 0} selected={section === 'bills' && view === 'due-week'} onClick={() => openTile(() => { setSection('bills'); setView('due-week') })} />
        <StatCard tone="red" icon={AlertTriangle} label="Overdue" sublabel={tile(s.overdue) || 'Past the due date'}
          value={s.overdue?.count ?? 0} selected={section === 'bills' && view === 'overdue'} onClick={() => openTile(() => { setSection('bills'); setView('overdue') })} />
        <StatCard tone="orange" icon={Factory} label="MSME at risk" sublabel={tile(s.msmeAtRisk) || '45-day limit near or past'}
          value={s.msmeAtRisk?.count ?? 0} selected={section === 'bills' && view === 'msme'} onClick={() => openTile(() => { setSection('bills'); setView('msme') })} />
        <StatCard tone="yellow" icon={Hourglass} label="Waiting for approval" sublabel={tile(s.pendingApproval) || 'Payments not yet approved'}
          value={s.pendingApproval?.count ?? 0} selected={section === 'payments' && status === 'pending_approval'} onClick={() => openTile(() => { setSection('payments'); setStatus('pending_approval') })} />
      </div>

      {settings.error ? (
        <LoadFailed onRetry={settings.retry}>Could not read who pays vendors in this hospital, so no payment can be recorded or approved from here.</LoadFailed>
      ) : settings.mode && (
        <p className="text-sm text-gray-600">
          <Wallet className="mr-1 inline h-4 w-4 text-blue-600" />{MODE_TEXT[settings.mode]}
          {s.totalDue && <> Still due on approved bills: <span className="font-semibold tabular-nums">{formatMoney(s.totalDue.amount)}</span> on {s.totalDue.count} bill{s.totalDue.count === 1 ? '' : 's'}.</>}
        </p>
      )}

      <div role="group" aria-label="Which list" className="inline-flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
        {SECTIONS.map((x) => (
          <button key={x.value} type="button" aria-pressed={section === x.value}
            className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${section === x.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => { setSection(x.value); setView('all'); setBucket(''); setSearch('') }}>
            {x.label}
          </button>
        ))}
      </div>

      {section !== 'payments' && (
        <div role="group" aria-label="Ageing" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {BUCKETS.map((b) => {
            const v = s.buckets?.[b.key]
            const on = bucket === b.key
            return (
              <button key={b.key} type="button" aria-pressed={on} onClick={() => { setBucket(on ? '' : b.key); setView('all') }}
                className={`rounded-md border bg-white px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${on ? 'ring-2 ring-blue-500' : 'hover:border-blue-300'}`}>
                <span className="block text-xs text-gray-500">{b.label}</span>
                <span className={`block font-semibold tabular-nums ${BUCKET_TONE[b.key]}`}>{formatMoney(v?.amount)}</span>
                <span className="block text-[11px] text-gray-500">{v?.count ?? 0} bill{v?.count === 1 ? '' : 's'}</span>
              </button>
            )
          })}
        </div>
      )}

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        placeholder={section === 'payments' ? 'Search payment no., vendor, reference, bill or invoice…' : 'Search vendor, bill no. or invoice no.…'}
        active={!!filtered}
        onClear={clearFilters}
      >
        {section === 'payments' && <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} className="w-48" />}
        {section === 'payments' && <FilterSelect value={mode} onChange={setMode} options={MODE_OPTIONS} className="w-40" />}
        {section === 'bills' && view !== 'all' && (
          <Badge variant="outline" className="h-9 gap-1 px-3">{VIEW_LABEL[view]}<button type="button" aria-label="Show every bill" onClick={() => setView('all')}><X className="h-3.5 w-3.5" /></button></Badge>
        )}
        {vendor && (
          <Badge variant="outline" className="h-9 gap-1 px-3">{vendor.name}<button type="button" aria-label="Every vendor" onClick={() => setVendor(null)}><X className="h-3.5 w-3.5" /></button></Badge>
        )}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          {section === 'bills' && (
            <PaginatedTable
              pagination={payables}
              tableClassName="min-w-[1000px]"
              empty={filtered ? 'No bill to pay matches this' : 'Nothing is due — every approved bill is paid'}
              columns={[
                { header: 'Bill' }, { header: 'Vendor', className: 'min-w-[180px]' }, { header: 'Due' },
                { header: 'Payable', className: 'text-right' }, { header: 'Paid / debit notes', className: 'text-right' },
                { header: 'Still due', className: 'text-right' }, { header: '' },
              ]}
              renderRow={(r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-gray-50" tabIndex={0} onClick={() => setOpenBill(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenBill(r.id) }}>
                  <TableCell>
                    <div className="whitespace-nowrap font-mono text-sm font-medium text-blue-700">{r.number}</div>
                    <div className="text-xs text-gray-500">Inv {r.vendorInvoiceNumber} · {ymdDay(r.invoiceDay)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{r.vendorName}</div>
                    <MsmeText row={r} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    <div>{ymdDay(r.dueDay)}</div>
                    <div className="text-xs"><DueText row={r} /></div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(r.payable)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-sm tabular-nums text-gray-600">
                    {r.amountPaid > 0 ? formatMoney(r.amountPaid) : '—'}
                    {r.debitNoteTotal > 0 && <div className="text-xs">DN {formatMoney(r.debitNoteTotal)}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <div className="font-semibold tabular-nums">{formatMoney(r.due)}</div>
                    {r.pending > 0 && <div className="text-xs text-amber-700">{formatMoney(r.pending)} waiting</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    {access.canRecord && r.payableNow > 0 && (
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); setPayBillId(r.id) }}>Pay</Button>
                    )}
                  </TableCell>
                </TableRow>
              )}
            />
          )}

          {section === 'vendors' && (
            <PaginatedTable
              pagination={byVendor}
              tableClassName="min-w-[960px]"
              empty={filtered ? 'No vendor matches this' : 'No vendor is owed anything'}
              columns={[
                { header: 'Vendor', className: 'min-w-[180px]' }, { header: 'Bills', className: 'text-right' },
                ...BUCKETS.map((b) => ({ header: b.label, className: 'text-right' })),
                { header: 'Total due', className: 'text-right' },
              ]}
              renderRow={(v) => (
                <TableRow key={v.vendorId} className="cursor-pointer hover:bg-gray-50" tabIndex={0}
                  onClick={() => { setVendor({ id: v.vendorId, name: v.vendorName }); setBucket(''); setSection('bills') }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setVendor({ id: v.vendorId, name: v.vendorName }); setBucket(''); setSection('bills') } }}>
                  <TableCell>
                    <div className="font-medium">{v.vendorName}</div>
                    {v.msme && <Badge variant="outline" className={v.msmeAtRisk ? 'border-orange-200 bg-orange-50 text-orange-700' : ''}>MSME{v.msmeAtRisk ? ` · ${v.msmeAtRisk} at risk` : ''}</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{v.bills}</TableCell>
                  {BUCKETS.map((b) => (
                    <TableCell key={b.key} className={`whitespace-nowrap text-right tabular-nums ${v[b.key] > 0 ? BUCKET_TONE[b.key] : 'text-gray-300'}`}>{v[b.key] > 0 ? formatMoney(v[b.key]) : '—'}</TableCell>
                  ))}
                  <TableCell className="whitespace-nowrap text-right">
                    <div className="font-semibold tabular-nums">{formatMoney(v.due)}</div>
                    {v.pending > 0 && <div className="text-xs text-amber-700">{formatMoney(v.pending)} waiting</div>}
                  </TableCell>
                </TableRow>
              )}
            />
          )}

          {section === 'payments' && (
            <PaginatedTable
              pagination={payments}
              tableClassName="min-w-[900px]"
              empty={filtered ? 'No payment matches this' : 'No payment recorded yet'}
              columns={[
                { header: 'Payment' }, { header: 'Vendor · bill', className: 'min-w-[180px]' }, { header: 'Paid by' },
                { header: 'Amount', className: 'text-right' }, { header: 'Status' },
              ]}
              renderRow={(p) => {
                const st = PAYMENT_STATUS[p.status] || PAYMENT_STATUS.posted
                return (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-gray-50" tabIndex={0} onClick={() => setOpenPayment(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenPayment(p.id) }}>
                    <TableCell>
                      <div className="whitespace-nowrap font-mono text-sm font-medium text-blue-700">{p.number}</div>
                      <div className="text-xs text-gray-500">Paid {day(p.paidOn)} · {p.createdByName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{p.vendorName}</div>
                      <div className="text-xs text-gray-500">{p.bill?.number} · inv {p.bill?.vendorInvoiceNumber}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{modeLabel(p.mode)}</div>
                      {p.reference && <div className="max-w-[180px] truncate font-mono text-xs text-gray-500" title={p.reference}>{p.reference}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(p.amount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`whitespace-nowrap ${st.cls}`}>{st.label}</Badge>
                      {p.status === 'pending_approval' && access.canDecide(p) && <div className="mt-0.5 text-xs font-medium text-amber-700">Needs your approval</div>}
                    </TableCell>
                  </TableRow>
                )
              }}
            />
          )}
        </CardContent>
      </Card>

      <PaymentForm open={!!payBillId} onOpenChange={(v) => { if (!v) setPayBillId(null) }} billId={payBillId}
        recordsPending={access.recordsPending} onSaved={(p) => { changed(); setOpenPayment(p.id) }} />
      <PaymentDetail id={openPayment} open={!!openPayment && !payBillId} onOpenChange={(v) => { if (!v) setOpenPayment(null) }}
        access={access} onChanged={changed} />
      <BillDetail id={openBill} open={!!openBill} onOpenChange={(v) => { if (!v) setOpenBill(null) }} onChanged={changed} />
    </div>
  )
}
