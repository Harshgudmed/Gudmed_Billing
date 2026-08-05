import { useState, useMemo, useEffect } from 'react'
import { Check, ChevronsUpDown, Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDebounce } from '@/lib/useDebounce'

/**
 * A type-to-filter combobox. Drop-in replacement for a Select when the option
 * list is large (e.g. hundreds of drugs / lab tests / radiology exams).
 *
 * Props:
 *  - options: [{ value, label, sublabel?, keywords? }]
 *  - value: currently selected value
 *  - onChange: (value) => void
 *  - placeholder, searchPlaceholder, emptyText, className, disabled
 *  - contentClassName: extra classes for the dropdown panel. By default the
 *    dropdown matches the trigger width; pass e.g. `w-[380px]` here when the
 *    trigger is compact but the options are long (room pickers, etc.) so the
 *    labels aren't truncated to "Room ..." / "1st Floo...".
 *
 * ── Server-side search (optional) ──
 * Passing `onSearch` switches the list from "filter a fully-loaded array" to
 * "ask the server for each query". Use it whenever the catalogue can outgrow
 * one request: the pharmacy catalogue is ~200k rows, so a picker that loaded
 * `limit=5000` up-front simply could not see 97% of it, and typing a drug that
 * sorted past the cap returned "no results" for a drug that plainly exists.
 *  - onSearch: (query) => void, debounced; the parent fetches and feeds `options`
 *  - loading: show a spinner while that fetch is in flight
 *  - minSearchLength: characters required before searching (default 2)
 *  - selectedLabel: label for `value` when the selected row isn't in `options`
 *    (server mode only holds the current result page, not the whole catalogue)
 */
export function SearchableSelect({
  options = [],
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Type to search...',
  emptyText = 'No results found',
  className,
  contentClassName,
  disabled,
  onSearch,
  loading = false,
  minSearchLength = 2,
  selectedLabel,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const serverMode = typeof onSearch === 'function'

  const debouncedQuery = useDebounce(query, 300)
  useEffect(() => {
    if (!serverMode) return
    const q = debouncedQuery.trim()
    onSearch(q.length >= minSearchLength ? q : '')
    // `onSearch` is intentionally not a dep: parents commonly pass an inline
    // arrow, which would re-fire this on every render and loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, serverMode, minSearchLength])

  // In server mode `options` IS the result set — filtering it again locally
  // would hide rows the server deliberately returned.
  const selected = options.find(o => o.value === value)
  const selectedText = selected?.label ?? (value ? selectedLabel : undefined)

  const filtered = useMemo(() => {
    if (serverMode) return options
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      `${o.label} ${o.sublabel || ''} ${o.keywords || ''}`.toLowerCase().includes(q)
    )
  }, [options, query, serverMode])

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('justify-between font-normal', className)}
        >
          <span className={cn('truncate', !selectedText && 'text-gray-400')}>
            {selectedText || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-[--radix-popover-trigger-width] max-w-[92vw] p-0', contentClassName)} align="start">
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-10 px-2"
          />
          {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
        </div>
        <div className="max-h-64 overflow-y-auto p-1" onWheel={(e) => e.stopPropagation()}>
          {serverMode && query.trim().length < minSearchLength ? (
            <div className="py-6 text-center text-sm text-gray-400">
              Type at least {minSearchLength} characters to search
            </div>
          ) : loading && filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">Searching...</div>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">{emptyText}</div>
          ) : (
            filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); setQuery('') }}
                className={cn(
                  'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-gray-100',
                  o.value === value && 'bg-gray-50'
                )}
              >
                <Check className={cn('mt-0.5 h-4 w-4 shrink-0', o.value === value ? 'opacity-100 text-blue-600' : 'opacity-0')} />
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.sublabel && <span className="block truncate text-xs text-gray-500">{o.sublabel}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
