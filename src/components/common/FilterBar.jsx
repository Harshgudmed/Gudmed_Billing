import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * The one filter row every list screen uses: a search box that takes the width,
 * the filter dropdowns beside it, then Clear, then any buttons of the screen's
 * own (Export, Print …).
 *
 * `actions` is NOT the place for a Refresh button. Lists are live over the
 * hospital's socket (lib/useLiveData.js), so a Refresh button would only ever
 * re-do what has already happened.
 *
 * Every module had built this by hand, and the copies had drifted: some put it
 * in the card header where the search box was a third of its width, some had no
 * Clear, the dropdown widths were all different, and one had a stray "3"
 * rendering between two controls. One component, so a change to the shape is
 * made once and every screen follows.
 *
 *   <FilterBar
 *     search={search} onSearchChange={setSearch}
 *     placeholder="Search patient, UHID, phone or order #..."
 *     active={!!search || status !== 'all'}
 *     onClear={() => { setSearch(''); setStatus('all') }}
 *     actions={<Button variant="outline" onClick={exportCsv}>Export</Button>}
 *   >
 *     <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
 *     <FilterSelect value={dateMode} onChange={setDateMode} options={DATE_MODES} />
 *   </FilterBar>
 *
 * Leave out `onSearchChange` for a screen that only has dropdowns.
 */
export function FilterBar({
  search = '',
  onSearchChange,
  placeholder = 'Search...',
  onClear,
  active = false,
  children,
  actions,
  className,
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {onSearchChange && (
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9"
            placeholder={placeholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      )}
      {children}
      {/* Only when something is actually set — a Clear that never does anything
          is one more control to read on every screen. */}
      {active && onClear && (
        <Button variant="ghost" className="text-gray-500" onClick={onClear}>
          <X className="h-4 w-4 mr-1" />Clear
        </Button>
      )}
      {actions}
    </div>
  )
}

/** One dropdown in that row. `options` is [{ value, label }]. */
export function FilterSelect({ value, onChange, options = [], className = 'w-40', placeholder }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The date dropdown's options, written once. Pair the chosen mode with
 * `dateRangeFor({ mode })` from DateFilter.jsx to get { startDate, endDate }
 * for the server — the same day boundaries every other list already uses.
 */
export const DATE_MODES = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
]

/** "All Statuses" + one option per status, from a list of raw status values. */
export function statusOptions(values, { allLabel = 'All Statuses', label } = {}) {
  return [
    { value: 'all', label: allLabel },
    ...values.map((v) => ({ value: v, label: label ? label(v) : v.replace(/_/g, ' ') })),
  ]
}
