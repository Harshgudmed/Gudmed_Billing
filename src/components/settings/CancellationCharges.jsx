// How much the hospital keeps when a bill is cancelled, set for the two stages
// (work not started / work started). A percentage on its own means little to the
// person setting it up, so each stage shows the result on a ₹1,000 bill, live:
// slide the percentage and the bar and the two amounts move with it.
import { Clock, FlaskConical } from 'lucide-react'
import { formatMoney } from '@/lib/format'

const SAMPLE = 1000
const clampPct = (v) => Math.min(100, Math.max(0, Number(v) || 0))

function Stage({ Icon, title, example, value, onChange, label }) {
  const pct = clampPct(value)
  const keep = Math.round((SAMPLE * pct) / 100)
  const back = SAMPLE - keep
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs leading-relaxed text-gray-500">{example}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <input
          type="range" min="0" max="100" step="5" value={pct} aria-label={`${label}, percent the hospital keeps`}
          onChange={(e) => onChange(e.target.value)}
          className="h-2 flex-1 cursor-pointer accent-blue-600"
        />
        <div className="flex items-center rounded-md border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-blue-500">
          <input
            type="number" min="0" max="100" inputMode="numeric" placeholder="0" value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-14 rounded-l-md bg-transparent px-2 py-1.5 text-right text-sm font-semibold outline-none"
          />
          <span className="pr-2 text-sm text-gray-500">%</span>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">Hospital keeps {pct}% of the bill</p>

      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`Patient gets back ${formatMoney(back)}, hospital keeps ${formatMoney(keep)}`}>
        <div className="bg-green-500 transition-all" style={{ width: `${100 - pct}%` }} />
        <div className="bg-gray-400 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-green-50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-green-700">Patient gets back</p>
          <p className="text-base font-semibold text-green-800 tabular-nums">{formatMoney(back)}</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-600">Hospital keeps</p>
          <p className="text-base font-semibold text-gray-800 tabular-nums">{formatMoney(keep)}</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">Example on a {formatMoney(SAMPLE)} bill.</p>
    </div>
  )
}

export function CancellationCharges({ before, after, onBefore, onAfter }) {
  return (
    <div>
      <p className="text-sm font-medium text-gray-900">How much does the hospital keep when a bill is cancelled?</p>
      <p className="mt-0.5 text-xs text-gray-500">Set a percentage for each stage. The patient gets back the rest. Use the same number in both for one flat rate.</p>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Stage Icon={Clock} title="Before the work starts" example="Sample not taken, scan not done, medicine not given."
          label="Before the work starts" value={before} onChange={onBefore} />
        <Stage Icon={FlaskConical} title="After the work has started" example="Sample taken, scan done, reagent or contrast already used."
          label="After the work has started" value={after} onChange={onAfter} />
      </div>
    </div>
  )
}
