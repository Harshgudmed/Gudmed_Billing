import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { StatCard } from '@/components/common/StatCard'
import {
  Clock, AlertTriangle, XCircle, ClipboardList, ShieldCheck, Truck, Package, PackagePlus, FileCheck2, ShoppingCart,
  AlertCircle, ChevronRight, ArrowRight, Activity, PackageCheck, Boxes, CalendarClock, ClipboardCheck, Receipt, Wallet,
} from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { STATUS, PRIORITY, APPROVER_LABEL, OPEN_ORDERS, GOODS_IN_ORDERS, useMe } from './requestMeta'

// The Purchase dashboard, laid out like the other HMS module dashboards
// (Laboratory is the model): a row of tinted status tiles, then Quick Actions
// beside "Requests Requiring Attention", then the workflow card, then where the
// money went and what happened lately. The tiles use the shared StatCard in the
// HMS status colours — yellow waiting, red critical, blue in hand, green done,
// orange sent back, purple totals — so a colour means the same on every screen.
//
// Everything comes from one read (resource=dashboard). `onOpen(intent)` opens
// the Requests tab ({ view, status, priority, search, openId, startNew });
// `onOrders(intent)` the Orders tab ({ view, status, openId, make }); `onStock(intent)`
// the Stock tab ({ view, receiptId, receivedToday }); `onMaster(key)` the Vendors or Items tab.
// A tile opens exactly the rows it counts.

const WORKFLOW = [
  { status: 'draft', label: 'Draft' },
  { status: 'submitted', label: 'Awaiting approval' },
  { status: 'approved', label: 'Approved' },
  { status: 'ordered', label: 'Ordered' },
]
// Tailwind finds class names by scanning the source, so a column count picked
// at run time (`lg:grid-cols-${n}`) never ships — the real classes are spelled
// out here, one per tile count a role can have.
const TILE_COLS = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }

// The bar on the left of an attention row, as on the lab's attention list.
const PRIORITY_BAR = { emergency: 'bg-red-500', urgent: 'bg-orange-500', normal: 'bg-yellow-400' }

const VERB = { create: 'started a draft of', submit: 'sent', cancel: 'cancelled', reopen: 'reopened', delete: 'deleted a draft', send: 'sent to the vendor', close: 'closed short' }
const RECEIPT_VERB = { create: 'received goods —', cancel: 'cancelled receipt' }
const BILL_VERB = { create: 'entered vendor bill', 'create and submit': 'entered and submitted vendor bill', save: 'changed bill', submit: 'sent bill', cancel: 'cancelled bill', reopen: 'reopened bill', delete: 'deleted a draft bill' }
function describe(action, kind) {
  if (kind === 'receipt') return RECEIPT_VERB[action] || action
  if (kind === 'bill') return BILL_VERB[action] || (/^approve/.test(action) ? 'approved bill' : /^reject/.test(action) ? 'rejected bill' : action)
  const m = /^(approve|reject) level (\d+)/.exec(action)
  if (m) return m[1] === 'approve' ? `approved level ${m[2]} of` : 'rejected'
  return VERB[action] || action
}
const ago = (at) => formatDistanceToNow(new Date(at), { addSuffix: true })

export default function PurchaseOverview({ data, onOpen, onOrders, onStock, onBills, onMaster }) {
  const me = useMe()
  // Anyone who can hold an approval level (or an administrator) gets the
  // approval queue first; someone who only raises requests gets their own.
  const approver = me.isAdmin || !!APPROVER_LABEL[me.role]
  const { cards, pipeline, attention, myOpen, approvedLast30Days, activity, orders, stock } = data
  const list = approver ? attention : myOpen
  const approved30 = approvedLast30Days.reduce((s, d) => s + d.amount, 0)
  const topSpend = approvedLast30Days[0]?.amount || 0

  // Each role sees its own day and its quick actions. Approving an order sends
  // it to the vendor in the same step (no separate "mark as sent"), so there is
  // no "orders to send" tile — once approved, it is already on its way:
  //   store      what to receive, what came today, what runs low or expires, its requests
  //   buyer      what to approve, to order, what is due in, what to bill, open orders
  //   finance    approvals with their money, bills on hold and to pay, open orders
  //   admin      the approvals, ordering and bills together
  const bills = data.bills || { onHold: { count: 0, amount: 0 }, approved: { count: 0, amount: 0 }, toBill: 0 }
  const money = (n, amount) => (n ? formatMoney(amount) : null)
  const T = {
    reqMine:  { key: 'req-mine', tone: 'yellow', icon: Clock, label: 'Staff Requests to Approve', value: cards.toApprove.count, sublabel: money(cards.toApprove.count, cards.toApprove.amount), go: () => onOpen({ view: 'to-approve' }) },
    poMine:   { key: 'po-mine', tone: 'orange', icon: FileCheck2, label: 'Purchase Orders — Pending Approval', value: orders.ordersToApprove.count, sublabel: 'Administrator approval required', go: () => onOrders({ view: 'to-approve' }) },
    ready:    { key: 'ready', tone: 'blue', icon: PackagePlus, label: 'Requests Ready for Ordering', value: orders.requestsReadyToOrder, sublabel: 'Create a purchase order', go: () => onOrders({ view: 'all', make: true }) },
    dueIn:    { key: 'due-in', tone: 'blue', icon: PackageCheck, label: 'Awaiting Delivery', value: stock.toReceive, sublabel: 'Ordered, not all in yet', go: () => onOrders({ view: 'all', status: OPEN_ORDERS }) },
    toBill:   { key: 'to-bill', tone: 'blue', icon: Receipt, label: 'Invoice Pending', value: bills.toBill, sublabel: 'Goods received; supplier invoice not entered', go: () => onBills({ view: 'to-bill' }) },
    onHold:   { key: 'on-hold', tone: 'red', icon: AlertTriangle, label: 'Bills on Hold', value: bills.onHold.count, sublabel: `${bills.financeReviewerConfigured ? 'Finance' : 'Administrator'} review${bills.onHold.count ? ` · ${formatMoney(bills.onHold.amount)}` : ''}`, go: () => onBills({ view: 'on-hold' }) },
    toPay:    { key: 'to-pay', tone: 'green', icon: Wallet, label: 'Approved Bills', value: bills.approved.count, sublabel: money(bills.approved.count, bills.approved.amount), go: () => onBills({ view: 'approved' }) },
    open:     { key: 'open', tone: 'purple', icon: ShoppingCart, label: 'Open Orders', value: orders.openOrders.count, sublabel: money(orders.openOrders.count, orders.openOrders.amount), go: () => onOrders({ view: 'all', status: OPEN_ORDERS }) },
    urgent:   { key: 'urgent', tone: 'red', icon: AlertTriangle, label: 'Urgent & Emergency', value: cards.urgentOpen, go: () => onOpen({ view: 'all', status: 'submitted', priority: 'urgent,emergency' }) },
    // the store's own
    myWaiting: { key: 'my-waiting', tone: 'yellow', icon: Clock, label: 'My Requests — With Approvers', value: cards.mineWaiting ?? 0, go: () => onOpen({ view: 'mine', status: 'submitted' }) },
    myRejected: { key: 'my-rejected', tone: 'orange', icon: XCircle, label: 'Rejected — Fix & Resend', value: cards.rejected, go: () => onOpen({ view: 'mine', status: 'rejected' }) },
    receive:  { key: 'receive', tone: 'blue', icon: PackageCheck, label: 'To Receive', value: stock.toReceive, sublabel: 'Orders not all in yet', go: () => onOrders({ view: 'to-receive' }) },
    today:    { key: 'today', tone: 'green', icon: ClipboardCheck, label: 'Received Today', value: stock.receivedToday, sublabel: 'Goods receipts', go: () => onStock({ view: 'receipts', receivedToday: true }) },
    low:      { key: 'low', tone: 'red', icon: AlertTriangle, label: 'Low Stock', value: stock.belowReorder, sublabel: 'At or under reorder level', go: () => onStock({ view: 'low' }) },
    expiring: { key: 'expiring', tone: 'purple', icon: CalendarClock, label: 'Expiring Soon', value: stock.expiringItems, sublabel: 'Within 60 days', go: () => onStock({ view: 'expiring' }) },
    // Finance's view of the store: what it holds is worth, at purchase price
    worth:    { key: 'worth', tone: 'blue', icon: Boxes, label: 'Stock Value', value: formatMoney(stock.value || 0), sublabel: 'At purchase price, before GST' },
  }
  const store = !me.seesEverything
  const finance = !store && me.canDecideBill && !me.canBuy
  const buyer = !store && !finance && !me.isAdmin
  // The workflow's "Received (orders)" stage opens the orders it counts. The
  // store has no All Orders list, so it counts its own Received list (in full,
  // or closed short) — a part-received order is still on its To Receive list.
  const received = store
    ? { count: orders.completedOrders, title: 'Orders received in full, or closed short', go: () => onOrders({ view: 'received' }) }
    : { count: orders.receivedOrders, title: 'Orders with goods received, in part or in full', go: () => onOrders({ view: 'all', status: GOODS_IN_ORDERS }) }
  const tiles = store ? [T.myWaiting, T.myRejected, T.receive, T.today, T.low, T.expiring]
    : finance ? [T.reqMine, T.poMine, T.onHold, T.toPay, T.open, T.worth]
      : buyer ? [T.reqMine, T.ready, T.dueIn, T.toBill, T.open]
        : [T.reqMine, T.ready, T.poMine, T.toBill, T.onHold, T.toPay]

  // Quick actions for this role, most used first.
  const A = {
    newReq:   { key: 'new', icon: ClipboardList, label: 'New Request', go: () => onOpen({ view: 'mine', startNew: true }) },
    myReq:    { key: 'my', icon: ClipboardList, label: 'My Requests', go: () => onOpen({ view: 'mine' }) },
    receive:  { key: 'receive', icon: PackageCheck, label: 'Receive Goods', go: () => onOrders({ view: 'to-receive' }) },
    stock:    { key: 'stock', icon: Boxes, label: 'Stock', go: () => onStock({}) },
    make:     { key: 'make', icon: PackagePlus, label: 'Make Orders', go: () => onOrders({ view: 'all', make: true }) },
    bill:     { key: 'bill', icon: Receipt, label: 'Enter Invoice', go: () => onBills({ make: true }) },
    apr:      { key: 'apr', icon: ShieldCheck, label: 'Approve Requests', go: () => onOpen({ view: 'to-approve' }) },
    apo:      { key: 'apo', icon: FileCheck2, label: 'Approve Orders', go: () => onOrders({ view: 'to-approve' }) },
    hold:     { key: 'hold', icon: AlertTriangle, label: 'Review Invoice Exceptions', go: () => onBills({ view: 'on-hold' }) },
    toPay:    { key: 'to-pay', icon: Wallet, label: 'Approved Bills', go: () => onBills({ view: 'approved' }) },
    vendors:  { key: 'vendors', icon: Truck, label: 'Vendors', go: () => onMaster('vendors') },
    items:    { key: 'items', icon: Package, label: 'Items', go: () => onMaster('items') },
  }
  const actions = (store ? [{ ...A.receive, primary: true }, A.newReq, A.stock, A.myReq]
    : finance ? [{ ...A.apr, primary: true }, A.apo, A.hold, A.toPay, A.vendors]
      : buyer ? [{ ...A.newReq, primary: true }, A.make, A.bill, A.apr, A.vendors, A.items]
        : [{ ...A.newReq, primary: true }, A.make, A.apr, A.apo, A.bill, A.hold]
  ).slice(0, 6) // six buttons at most; the tabs reach the rest

  return (
    <div className="space-y-6">
      <div className={`grid grid-cols-2 md:grid-cols-3 ${TILE_COLS[tiles.length] || TILE_COLS[6]} gap-4`}>
        {tiles.map(({ key, go, ...t }) => <StatCard key={key} {...t} onClick={go} />)}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common purchase tasks</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {actions.map((a, i) => (
              <Button key={a.key} className="h-20 flex flex-col gap-1" variant={a.primary ? 'default' : i < 4 ? 'secondary' : 'outline'} onClick={a.go}>
                <a.icon className="h-6 w-6" /><span>{a.label}</span>
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-500" />
              {approver ? 'Requests Requiring Your Approval' : 'My Open Requests'}
            </CardTitle>
            <CardDescription>{approver ? 'Emergency first, then urgent, then the longest waiting' : 'Drafts, requests with the approvers, and ones sent back'}</CardDescription>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <p className="text-center text-gray-500 py-8">{approver ? 'Nothing is waiting for your approval' : 'You have no requests in progress'}</p>
            ) : (
              <div className="space-y-3 max-h-[230px] overflow-y-auto pr-1">
                {list.map((r) => {
                  const s = STATUS[r.status] || STATUS.submitted
                  return (
                    <button key={r.id} type="button" onClick={() => onOpen({ view: 'all', openId: r.id })}
                      className="flex w-full items-center justify-between gap-3 p-3 rounded-lg border text-left hover:bg-gray-50">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-10 rounded-full shrink-0 ${PRIORITY_BAR[r.priority] || PRIORITY_BAR.normal}`} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm">{r.number}</span>
                            <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                            {r.priority !== 'normal' && <Badge variant="outline" className={PRIORITY[r.priority]?.cls}>{PRIORITY[r.priority]?.label}</Badge>}
                          </div>
                          <p className="text-sm font-medium">{r.department}</p>
                          <p className="text-xs text-gray-500">
                            {r.status === 'submitted' && r.level
                              ? <>Level {r.level.level} · {APPROVER_LABEL[r.level.approverRole] || r.level.approverRole} &bull; {ago(r.waitingSince)}</>
                              : ago(r.waitingSince)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {me.seesMoney && <span className="text-sm font-semibold tabular-nums">{formatMoney(r.estimatedTotal)}</span>}
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {store && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>My Requests — Where They Stand</CardTitle>
            <CardDescription>The requests you raised, stage by stage — Ordered means all its items are on purchase orders.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {WORKFLOW.map((w, i) => (
                <div key={w.status} className="flex items-center gap-2">
                  {i > 0 && <ArrowRight className="h-4 w-4 text-gray-300 shrink-0" />}
                  <button type="button" onClick={() => onOpen({ view: 'mine', status: w.status })}
                    className={`min-w-[120px] rounded-lg border px-4 py-2 text-left transition-shadow hover:shadow-md ${STATUS[w.status].cls}`}>
                    <div className="text-2xl font-bold tabular-nums">{pipeline[w.status] || 0}</div>
                    <div className="text-xs font-medium">{w.status === 'draft' ? 'My drafts' : w.label}</div>
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-gray-300 shrink-0" />
                <button type="button" onClick={received.go} title={received.title}
                  className="min-w-[120px] rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-left text-purple-700 transition-shadow hover:shadow-md">
                  <div className="text-2xl font-bold tabular-nums">{received.count ?? 0}</div>
                  <div className="text-xs font-medium">Received (orders)</div>
                </button>
              </div>
            </div>
            {(pipeline.rejected || pipeline.cancelled) ? (
              <p className="mt-3 text-xs text-gray-500">
                Also {pipeline.rejected || 0} rejected and {pipeline.cancelled || 0} cancelled &mdash; not moving further.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <div className={`grid gap-6 ${me.seesMoney ? 'md:grid-cols-2' : ''}`}>
        {me.seesMoney && <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Approved by Department</CardTitle>
                <CardDescription>Estimated value with GST, last 30 days</CardDescription>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-bold text-green-600 tabular-nums">{formatMoney(approved30)}</p>
                <p className="text-xs text-gray-500">Approved, 30 days</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {approvedLast30Days.length === 0 ? (
              <p className="text-center text-gray-500 py-8">Nothing approved in the last 30 days</p>
            ) : approvedLast30Days.slice(0, 6).map((d) => (
              <div key={d.department}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium truncate">{d.department} <span className="text-xs font-normal text-gray-500">&bull; {d.count} request{d.count === 1 ? '' : 's'}</span></span>
                  <span className="font-semibold tabular-nums">{formatMoney(d.amount)}</span>
                </div>
                <Progress value={topSpend ? (d.amount / topSpend) * 100 : 0} className="h-2 mt-1.5" aria-label={`${d.department} share`} />
              </div>
            ))}
          </CardContent>
        </Card>}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-blue-600" />Recent Activity</CardTitle>
            <CardDescription>Who did what, latest first</CardDescription>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No activity yet</p>
            ) : (
              <ol className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                {activity.map((a, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="leading-snug">
                        <span className="font-medium">{a.by}</span> {describe(a.action, a.kind)}{' '}
                        {a.number && (a.requestId
                          ? <button type="button" className="font-mono text-blue-700 hover:underline"
                            onClick={() => (a.kind === 'order' ? onOrders({ view: 'all', openId: a.requestId }) : a.kind === 'receipt' ? onStock({ view: 'receipts', receiptId: a.requestId }) : a.kind === 'bill' ? onBills({ openId: a.requestId }) : onOpen({ view: me.seesEverything ? 'all' : 'mine', openId: a.requestId }))}>{a.number}</button>
                          : <span className="font-mono">{a.number}</span>)}
                      </p>
                      <p className="text-xs text-gray-500">{ago(a.at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
