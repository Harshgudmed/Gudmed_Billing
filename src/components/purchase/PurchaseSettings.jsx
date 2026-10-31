import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, Ruler, FolderTree, ShieldCheck, CheckCircle2, ChevronRight, ShoppingCart, Truck, Package } from 'lucide-react'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import UnitsMaster from './UnitsMaster'
import CategoriesMaster from './CategoriesMaster'
import ApprovalRulesSettings from './ApprovalRulesSettings'

// Settings → Integrations → Purchase Setup: where an administrator changes the purchase SETUP —
// units, categories and who approves how much — using UnitsMaster and
// CategoriesMaster in their editable mode. Retired rows are listed here (greyed) so they can be restored.
// Vendors and items are day-to-day records and stay in Purchase → Masters.
//
// The setup checklist sits on top: the one place that says whether the
// hospital is ready to buy. It is the administrator's, so it lives with the
// setup rather than on the Purchase screen every buyer opens each day. A step
// set here opens its section below; vendors and items are only counted,
// because they are added in Purchase → Masters.

// What the open section is for — in the left column, under the menu.
const HELP = {
  units: ['A unit tells the system how a quantity is counted: pieces, boxes, litres, days.', 'A default unit keeps its code and kind.', 'A unit that items already use cannot be retired.'],
  categories: ['Every item belongs to a category.', 'The category sets the GST a new item starts with.', 'It also sets the heading Finance reports the spend under.'],
  approvals: ['Rules decide who approves a request or an order, by amount.', 'Changes apply only to documents sent from now on.', 'Documents already waiting keep the rules they were sent with.'],
}

const VIEWS = [
  { key: 'units', label: 'Units of measure', hint: 'How quantities are counted', Icon: Ruler },
  { key: 'categories', label: 'Item categories', hint: 'Groups that items belong to', Icon: FolderTree },
  { key: 'approvals', label: 'Approval rules', hint: 'Who approves how much', Icon: ShieldCheck },
]

const EMPTY_STATUS = { activeUnits: 0, liveGroups: 0, vendors: 0, items: 0, rulesSet: false }

export default function PurchaseSettings() {
  const [view, setView] = useState('units')
  const [units, setUnits] = useState([])
  const [categories, setCategories] = useState([])
  // Checklist counts come from the server in one call — not computed from
  // downloaded lists — so the ticks reflect the actual database state.
  const [status, setStatus] = useState(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const [s, u, c] = await Promise.all([
        purchaseApi.getSetupStatus(),
        purchaseApi.getUnits({ includeInactive: true }),
        purchaseApi.getCategories({ includeInactive: true }),
      ])
      setStatus(s?.data ?? EMPTY_STATUS)
      setUnits(u?.data ?? [])
      setCategories(c?.data ?? [])
    } catch (err) {
      setError(err?.message || 'Could not load the purchase setup')
      showApiError(err, 'Could not load the purchase setup')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  // After a change only the lists refresh — the screen stays where it is.
  const reload = useCallback(() => load({ quiet: true }), [load])

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading…</div>
  if (error) return <div className="flex items-center justify-center py-16 text-red-600"><AlertCircle className="h-5 w-5 mr-2" />{error}</div>

  const { activeUnits, liveGroups, vendors, items, rulesSet } = status
  const steps = [
    { label: 'Units of measure', Icon: Ruler, note: `${activeUnits} active`, done: activeUnits > 0, opens: 'units' },
    { label: 'Item categories', Icon: FolderTree, note: `${liveGroups} group${liveGroups !== 1 ? 's' : ''}`, done: liveGroups > 0, opens: 'categories' },
    { label: 'Request & order approval rules', Icon: ShieldCheck, note: rulesSet ? 'Both are set' : 'One or both are not set — Administrator approval is the default', done: rulesSet, opens: 'approvals' },
    { label: 'Vendors', Icon: Truck, note: vendors ? `${vendors} active · added in Purchase → Masters` : 'None yet — add them in Purchase → Masters', done: vendors > 0 },
    { label: 'Items', Icon: Package, note: items ? `${items} active · added in Purchase → Masters` : 'None yet — add them in Purchase → Masters', done: items > 0 },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const percent = Math.round((doneCount / steps.length) * 100)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#2E4168] text-white shadow-sm"><ShoppingCart className="h-6 w-6" /></span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-gray-900">Purchase &amp; Supply Chain setup</h2>
            <p className="text-sm text-gray-500">What must be in place before the hospital can buy. Each step ticks itself off.</p>
          </div>
        </div>
        <div className="w-full sm:w-72">
          <div className="flex items-center justify-between text-xs font-medium text-gray-600">
            <span>Setup progress</span>
            <span className={`rounded-full px-2.5 py-0.5 font-semibold ${doneCount === steps.length ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{doneCount} of {steps.length} ready</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
            <div className={`h-full rounded-full transition-all ${doneCount === steps.length ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${percent}%` }} />
          </div>
        </div>
      </header>

      <section aria-label="Purchase setup checklist" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((s) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.done ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}><s.Icon className="h-[18px] w-[18px]" /></span>
                {s.done
                  ? <CheckCircle2 className="h-5 w-5 text-green-600" aria-label="Done" />
                  : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">To do</span>}
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-900">{s.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{s.note}</p>
              {s.opens && <p className="mt-3 flex items-center gap-1 text-xs font-semibold text-blue-700">{view === s.opens ? 'Showing below' : 'Open'}<ChevronRight className="h-3.5 w-3.5" /></p>}
            </>
          )
          const box = `flex h-full flex-col rounded-xl border bg-white p-4 text-left shadow-sm transition ${view === s.opens ? 'border-blue-600 ring-1 ring-blue-600' : 'border-gray-200'}`
          return s.opens ? (
            <button key={s.label} type="button" onClick={() => setView(s.opens)} className={`${box} hover:border-blue-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>{body}</button>
          ) : (
            <div key={s.label} className={box}>{body}</div>
          )
        })}
      </section>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="shrink-0 space-y-4 lg:sticky lg:top-4 lg:w-72">
        <nav aria-label="Purchase setup" className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {VIEWS.map(({ key, label, hint, Icon }) => {
            const on = view === key
            const count = { units: activeUnits, categories: liveGroups, approvals: null }[key]
            return (
              <button key={key} type="button" onClick={() => setView(key)} aria-current={on ? 'page' : undefined}
                className={`group flex min-w-[14rem] flex-1 items-center gap-3 rounded-xl border px-3 py-3.5 text-left transition lg:min-w-0 lg:flex-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  on ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${on ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 group-hover:bg-gray-200'}`}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-semibold ${on ? 'text-blue-800' : 'text-gray-900'}`}>{label}</span>
                  <span className="block text-xs leading-snug text-gray-500">{hint}</span>
                </span>
                {count != null && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${on ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{count}</span>}
              </button>
            )
          })}
        </nav>
        <div className="hidden rounded-xl border border-blue-100 bg-blue-50/60 p-4 lg:block">
          <p className="text-sm font-semibold text-blue-900">About this section</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-blue-900/80">
            {(HELP[view] || []).map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
        </aside>
        <div className="flex-1 min-w-0">
          {view === 'units' && <UnitsMaster units={units} editable onChanged={reload} />}
          {view === 'categories' && <CategoriesMaster categories={categories} editable onChanged={reload} />}
          {view === 'approvals' && <ApprovalRulesSettings onSaved={reload} />}
        </div>
      </div>
    </div>
  )
}
