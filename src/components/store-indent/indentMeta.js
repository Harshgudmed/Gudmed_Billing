// How an indent and an issue look — shared by the department's screen (Store
// Indent) and the store's (Purchase → Indents), so both say the same thing.

export const INDENT_STATUS = {
  submitted:     { label: 'Open',           cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  partly_issued: { label: 'Partly issued',  cls: 'border-orange-200 bg-orange-50 text-orange-700' },
  issued:        { label: 'Issued',         cls: 'border-green-200 bg-green-50 text-green-700' },
  closed:        { label: 'Closed',         cls: 'border-slate-300 bg-slate-50 text-slate-700' },
  cancelled:     { label: 'Cancelled',      cls: 'border-gray-200 bg-white text-gray-500' },
}

export const ISSUE_STATUS = {
  posted:    { label: 'Issued',    cls: 'border-green-200 bg-green-50 text-green-700' },
  cancelled: { label: 'Cancelled', cls: 'border-gray-200 bg-white text-gray-500 line-through' },
}

/** "2 BOX", "2.5 L" — a quantity with its unit. */
export const qtyText = (n, unit) => `${Math.round((Number(n) || 0) * 1000) / 1000} ${unit || ''}`.trim()

// Written out in full so Tailwind finds them (an interpolated class never ships).
export const TILE_COLS = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3'
