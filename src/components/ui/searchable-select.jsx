import { useState, useMemo } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

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
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selected = options.find(o => o.value === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      `${o.label} ${o.sublabel || ''} ${o.keywords || ''}`.toLowerCase().includes(q)
    )
  }, [options, query])

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
          <span className={cn('truncate', !selected && 'text-gray-400')}>
            {selected ? selected.label : placeholder}
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
        </div>
        <div className="max-h-64 overflow-y-auto p-1" onWheel={(e) => e.stopPropagation()}>
          {filtered.length === 0 ? (
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
