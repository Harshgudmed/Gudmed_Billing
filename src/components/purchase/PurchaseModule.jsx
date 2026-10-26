import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  ShoppingCart, Loader2, AlertCircle, Plus, PackageCheck,
} from 'lucide-react'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { useLiveData } from '@/lib/useLiveData'
import VendorsMaster from './VendorsMaster'
import BudgetsMaster from './BudgetsMaster'
import ItemsMaster from './ItemsMaster'
import RequestsList from './RequestsList'
import OrdersList from './OrdersList'
import StockList from './StockList'
import BillsList from './BillsList'
import PurchaseOverview from './PurchaseOverview'
import { useMe } from './requestMeta'
import LoadFailed from './LoadFailed'

// The later Purchase tabs load when opened: most roles see only some of them.
const RfqTab = lazy(() => import('./RfqTab'))
const IndentsTab = lazy(() => import('./IndentsTab'))
const ReturnsTab = lazy(() => import('./ReturnsTab'))
const PaymentsTab = lazy(() => import('./PaymentsTab'))
const ReportsTab = lazy(() => import('./ReportsTab'))
const tabLoading = <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" /></div>

// Purchase & Supply Chain — module shell.
//
// Tabs, the way an ERP separates daily work from setup:
//   Overview — what this person has to do now and where the money goes
//              (PurchaseOverview). The one-time setup checklist is the
//              administrator's and lives with the setup, in
//              Settings → Integrations → Purchase Setup.
//   Requests — purchase requests and their approval.
//   Orders   — purchase orders: approval, sending, receiving goods (GRN).
//   Stock    — what is on the store's shelf, by batch, and the receipts.
//   RFQ, Indents, Returns, Payments, Reports — the later steps, each in its
//              own file and loaded only when opened (most roles see some).
//   Vendors, Items — the records buyers keep day to day, each its own tab as
//              Pharmacy's lists are. Units and categories are the
//              administrator's setup and live in Settings → Integrations →
//              Purchase Setup only — one place to change them. They are still
//              loaded here: the item form picks from them.

// Full class names for the tab row by how many tabs a role has (Tailwind only
// ships classes it finds written out).
const TAB_COLS = {
  4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6', 7: 'sm:grid-cols-7',
  8: 'sm:grid-cols-4 xl:grid-cols-8', 9: 'sm:grid-cols-5 xl:grid-cols-9', 10: 'sm:grid-cols-5 xl:grid-cols-10',
  11: 'sm:grid-cols-6 xl:grid-cols-11', 12: 'sm:grid-cols-6 xl:grid-cols-12',
  13: 'sm:grid-cols-7 xl:grid-cols-7',
}

export default function PurchaseModule() {
  const me = useMe()
  const [dash, setDash] = useState(null)
  // How the Requests tab opens: set by the Overview (a card, a row, a search)
  // and re-keyed each time so the list starts from it. Each role opens on its
  // own work: the store on its requests, Finance on what waits for it.
  // Doctor/Nurse: can raise requests but not buy, order or see money.
  const isRequestOnly = !me.canBuy && me.canRaiseRequest
  const [intent, setIntent] = useState({ view: !me.seesEverything ? 'mine' : me.canBuy ? 'all' : 'to-approve', n: 0 })
  const [units, setUnits] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Doctor/Nurse land directly on Requests (their only tab).
  const [tab, setTab] = useState(isRequestOnly ? 'requests' : 'overview')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Units and categories feed the item form's pickers.
      const [u, c, d] = await Promise.all([purchaseApi.getUnits(), purchaseApi.getCategories(), purchaseApi.getDashboard()])
      setDash(d?.data ?? null)
      setUnits(u?.data ?? [])
      setCategories(c?.data ?? [])
    } catch (err) {
      setError(err?.message || 'Could not load purchase masters')
      showApiError(err, 'Could not load purchase masters')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // After a request changes — here or on another screen — the Overview and
  // the "waiting for me" badge re-read quietly. When that fails the figures
  // on screen are out of date, so a line says so — and stays until a re-read
  // works (a toast faded and left old figures looking current). One line, not
  // a toast per failure: this runs on every change in the hospital.
  const [dashStale, setDashStale] = useState(false)
  const refreshDashboard = useCallback(async () => {
    try {
      const r = await purchaseApi.getDashboard()
      if (r?.data) setDash(r.data)
      setDashStale(false)
    } catch {
      setDashStale(true)
    }
  }, [])
  useLiveData('purchase', refreshDashboard)

  const openRequests = (next) => { setIntent((i) => ({ ...next, n: i.n + 1 })); setTab('requests') }
  // How the Orders tab opens: a view, an order, or "make orders" (from one request, or all approved).
  // The store opens on what it has to receive, Finance on what waits for its approval.
  const [orderIntent, setOrderIntent] = useState({ view: me.canReceive && !me.seesEverything ? 'to-receive' : me.canOrder ? 'all' : 'to-approve', n: 0 })
  const openOrders = (next) => { setOrderIntent((i) => ({ ...next, n: i.n + 1 })); setTab('orders') }
  // How the Stock tab opens: a tile's view, or a receipt already open.
  const [stockIntent, setStockIntent] = useState({ n: 0 })
  const openStock = (next = {}) => { setStockIntent((i) => ({ ...next, n: i.n + 1 })); setTab('stock') }
  // How the Bills tab opens: a view, a bill already open, or "make a bill" for an order.
  const [billIntent, setBillIntent] = useState({ n: 0 })
  const openBills = (next = {}) => { setBillIntent((i) => ({ ...next, n: i.n + 1 })); setTab('bills') }
  // The later tabs open a document from a link: { kind, id, n } (n remounts the tab).
  const [docLink, setDocLink] = useState({ n: 0 })
  const openDoc = (kind, id, tabName) => { setDocLink((d) => ({ kind, id, n: d.n + 1 })); setTab(tabName) }
  const linked = (kind) => (docLink.kind === kind ? docLink.id : null)
  // A notification links here as ?open=request:<id> | order:<id> | receipt:<id> | …:
  // open that document on its tab, then drop the link so a refresh does not reopen it.
  const [params, setParams] = useSearchParams()
  const link = params.get('open')
  useEffect(() => {
    if (!link) return
    const [kind, id] = link.split(':')
    if (id && kind === 'request') openRequests({ view: 'all', openId: id })
    else if (id && kind === 'order') openOrders({ view: 'all', openId: id })
    else if (id && kind === 'receipt') openStock({ view: 'receipts', receiptId: id })
    else if (id && kind === 'bill') openBills({ openId: id })
    else if (id && kind === 'indent') openDoc('indent', id, 'indents')
    else if (id && kind === 'issue') openDoc('issue', id, 'indents')
    else if (id && kind === 'return') openDoc('return', id, 'returns')
    else if (id && kind === 'rfq') openDoc('rfq', id, 'rfqs')
    else if (id && kind === 'payment') openDoc('payment', id, 'payments')
    setParams({}, { replace: true })
  }, [link])

  const orderCounts = {
    toApprove: dash?.orders.ordersToApprove.count ?? 0,
    toSend: dash?.orders.ordersToSend ?? 0,
    toReceive: dash?.stock?.toReceive ?? 0,
    received: dash?.orders.completedOrders ?? 0,
    all: dash?.orders.allOrders ?? 0,
    readyToOrder: dash?.orders.requestsReadyToOrder ?? 0,
  }
  const toApprove = dash?.cards.toApprove.count ?? 0
  const listCounts = {
    toApprove,
    total: dash ? Object.values(dash.pipeline).reduce((s, n) => s + n, 0) : 0,
    mine: dash?.cards.mine ?? 0,
    drafts: dash?.cards.drafts ?? 0,
    mineWaiting: dash?.cards.mineWaiting ?? 0,
    rejected: dash?.cards.rejected ?? 0,
  }

  // Each role's tabs — what it works on, nothing else (the server refuses the rest too):
  //   store keeper       Dashboard · Requests (its own) · Orders (to receive) · Stock · Indents · Returns · Reports
  //   purchase officer   Dashboard · Requests · RFQ · Orders · Stock · Indents · Returns · Bills · Payments · Reports · Vendors · Items
  //   finance controller Dashboard · Requests · RFQ · Orders (approvals) · Returns · Bills · Payments · Reports · Vendors
  const badge = (n, tone = 'bg-amber-500', title) => (n > 0
    ? <span title={title} className={`rounded-full ${tone} px-1.5 text-[11px] font-bold text-white tabular-nums`}>{n}</span>
    : null)
  const tabs = [
    { value: 'overview', label: 'Dashboard', show: !isRequestOnly },
    { value: 'requests', label: 'Requests', show: true, badge: badge(toApprove) },
    { value: 'rfqs', label: 'RFQ', show: !isRequestOnly && me.canSeeRfqs },
    { value: 'orders', label: 'Orders', show: !isRequestOnly, badge: badge(me.seesEverything ? orderCounts.toApprove : orderCounts.toReceive, me.seesEverything ? 'bg-amber-500' : 'bg-blue-600') },
    { value: 'stock', label: 'Stock', show: !isRequestOnly && me.canSeeStock, badge: badge(dash?.stock?.belowReorder ?? 0, 'bg-red-500', 'At or under reorder level') },
    { value: 'indents', label: 'Indents', show: !isRequestOnly && me.canSeeIndents },
    { value: 'returns', label: 'Returns', show: !isRequestOnly && me.canSeeReturns },
    { value: 'bills', label: 'Bills', show: !isRequestOnly && (me.canBill || me.canDecideBill), badge: badge(me.canDecideBill ? dash?.bills?.onHold?.count ?? 0 : 0) },
    { value: 'payments', label: 'Payments', show: !isRequestOnly && me.canSeePayments },
    { value: 'reports', label: 'Reports', show: !isRequestOnly && me.canSeeReports },
    { value: 'vendors', label: 'Vendors', show: !isRequestOnly && me.canSeeVendors },
    { value: 'items', label: 'Items', show: !isRequestOnly && me.canManageMasters },
    { value: 'budgets', label: 'Budgets', show: !isRequestOnly && me.canManageMasters },
  ].filter((x) => x.show)

  return (
    <div className="space-y-6">
      {/* Header — the same shape as every HMS module: icon + title, actions on the right */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-8 w-8 text-blue-600" />
            Purchase &amp; Supply Chain
          </h1>
          <p className="text-gray-500">Requests, RFQs, orders, goods receipt, stock, store indents, returns, vendor bills and payments</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {me.canReceive && (
            <Button variant="outline" onClick={() => openOrders({ view: 'to-receive' })}><PackageCheck className="h-4 w-4 mr-2" />Receive Goods</Button>
          )}
          {me.canRaiseRequest && (
            <Button onClick={() => openRequests({ view: 'mine', startNew: true })}><Plus className="h-4 w-4 mr-2" />New Request</Button>
          )}
        </div>
      </div>

      {dashStale && (
        <LoadFailed onRetry={refreshDashboard}>
          Could not refresh the purchase figures and counts — they may be out of date.
        </LoadFailed>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={`grid w-full h-auto ${tabs.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'} ${TAB_COLS[tabs.length]}`}>
          {tabs.map((x) => <TabsTrigger key={x.value} value={x.value} className="gap-2">{x.label}{x.badge}</TabsTrigger>)}
        </TabsList>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : error ? (
          <div className="flex items-center justify-center py-16 text-red-600"><AlertCircle className="h-5 w-5 mr-2" />{error}</div>
        ) : (
          <>
            <TabsContent value="overview" className="mt-4">
              {dash && <PurchaseOverview data={dash} onOpen={openRequests} onOrders={openOrders} onStock={openStock} onBills={openBills} onMaster={setTab} />}
            </TabsContent>

            <TabsContent value="requests" className="mt-4">
              {/* keyed by the intent so each click from the Overview opens it fresh */}
              <RequestsList key={intent.n} intent={intent} counts={listCounts} onChanged={refreshDashboard}
                onMakeOrder={(pr) => openOrders({ view: 'all', make: true, makeFrom: pr.id })} />
            </TabsContent>

            <TabsContent value="orders" className="mt-4">
              <OrdersList key={orderIntent.n} intent={orderIntent} counts={orderCounts} onChanged={refreshDashboard}
                onMakeBill={(po) => openBills({ make: true, orderId: po.id })} />
            </TabsContent>

            {me.canSeeStock && (
              <TabsContent value="stock" className="mt-4">
                {/* "Receive goods" is in the page header already */}
                <StockList key={stockIntent.n} intent={stockIntent} categories={categories} receivedToday={dash?.stock?.receivedToday ?? 0}
                  onOpenOrder={(id) => openOrders({ view: 'all', openId: id })} onChanged={refreshDashboard} />
              </TabsContent>
            )}

            {(me.canBill || me.canDecideBill) && (
              <TabsContent value="bills" className="mt-4">
                <BillsList key={billIntent.n} intent={billIntent} onChanged={refreshDashboard}
                  onOpenOrder={(id) => openOrders({ view: 'all', openId: id })} />
              </TabsContent>
            )}

            {me.canSeeVendors && (
              <TabsContent value="vendors" className="mt-4">
                <VendorsMaster />
              </TabsContent>
            )}

            {me.canManageMasters && (
              <TabsContent value="items" className="mt-4">
                <ItemsMaster units={units} categories={categories} />
              </TabsContent>
            )}

            {me.canManageMasters && (
              <TabsContent value="budgets" className="mt-4">
                <BudgetsMaster />
              </TabsContent>
            )}

            {me.canSeeRfqs && (
              <TabsContent value="rfqs" className="mt-4"><Suspense fallback={tabLoading}><RfqTab key={docLink.n} openId={linked('rfq')} onChanged={refreshDashboard} onAwardDone={(orderId) => openOrders({ openId: orderId })} /></Suspense></TabsContent>
            )}
            {me.canSeeIndents && (
              <TabsContent value="indents" className="mt-4"><Suspense fallback={tabLoading}><IndentsTab key={docLink.n} openId={linked('indent')} issueId={linked('issue')} onChanged={refreshDashboard} /></Suspense></TabsContent>
            )}
            {me.canSeeReturns && (
              <TabsContent value="returns" className="mt-4"><Suspense fallback={tabLoading}><ReturnsTab key={docLink.n} openId={linked('return')} onChanged={refreshDashboard} /></Suspense></TabsContent>
            )}
            {me.canSeePayments && (
              <TabsContent value="payments" className="mt-4"><Suspense fallback={tabLoading}><PaymentsTab key={docLink.n} intent={linked('payment') ? { openId: linked('payment') } : undefined} onChanged={refreshDashboard} /></Suspense></TabsContent>
            )}
            {me.canSeeReports && (
              <TabsContent value="reports" className="mt-4"><Suspense fallback={tabLoading}><ReportsTab /></Suspense></TabsContent>
            )}
          </>
        )}
      </Tabs>
    </div>
  )
}
