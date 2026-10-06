import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A quantity box with − and + on either side: tap to change by one, or type
 * any amount in the middle.
 *
 *   <QuantityInput value={qty} onChange={setQty} aria-label="Quantity" />
 *
 * It looks like the inputs around it — same height, border and corners — so a
 * form reads as one piece. Colour is only on the signs: − red (takes away),
 * + blue (adds), each with a light tint on hover; − greys out once it cannot
 * go lower. Filled, saturated buttons were tried and pulled the eye away from
 * the form's real action (Send).
 *
 * `value` is kept as the person typed it (a string), so "2." or an empty box
 * mid-typing is not snapped back; the buttons read it as a number. − stops at
 * `min` (default 0); `step` is how much one tap changes it (default 1).
 * Decimals can be typed (2.5 metre) — whether the unit allows them is for the
 * form and the server to decide.
 */
export function QuantityInput({ value, onChange, min = 0, step = 1, className, disabled, ...props }) {
  const n = Number(value) || 0
  // Round away float noise from 0.1 + 0.2 style steps.
  const set = (next) => onChange(String(Math.round(Math.max(min, next) * 1000) / 1000))
  const label = props['aria-label'] ? ` ${props['aria-label'].toLowerCase()}` : ''
  const btn = 'flex h-full w-9 shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent'
  return (
    <div className={cn('flex h-9 items-center overflow-hidden rounded-md border border-input bg-background shadow-sm', disabled && 'opacity-50', className)}>
      <button type="button" onClick={() => set(n - step)} disabled={disabled || n <= min} aria-label={`Decrease${label}`}
        className={cn(btn, 'text-red-600 hover:bg-red-50')}>
        <Minus className="h-4 w-4" strokeWidth={2.25} />
      </button>
      <input
        {...props}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        className="h-full w-full min-w-0 border-x border-input bg-transparent text-center text-sm font-semibold text-gray-900 tabular-nums placeholder:font-normal placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
      />
      <button type="button" onClick={() => set(n + step)} disabled={disabled} aria-label={`Increase${label}`}
        className={cn(btn, 'text-blue-600 hover:bg-blue-50')}>
        <Plus className="h-4 w-4" strokeWidth={2.25} />
      </button>
    </div>
  )
}
