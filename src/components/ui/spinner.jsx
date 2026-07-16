import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// The brand navy — same value as the sidebar and the queue display board.
export const BRAND = '#2E4168'

/**
 * The app's one loading spinner.
 *
 * IMPORTANT — colour: standalone spinners (page/section/table loads, on a white
 * surface) are brand navy. A spinner *inside a filled button* must NOT be navy —
 * on a navy button it would be invisible — so those keep `currentColor` and
 * inherit the button's own text colour. Pass `inherit` for that case.
 *
 *   <Spinner />                      // section load, navy, h-6
 *   <Spinner size="lg" />            // page load, navy, h-8
 *   <Spinner size="sm" inherit />    // inside a button, follows button text
 *
 * @param size    'sm' | 'md' | 'lg'
 * @param inherit use currentColor instead of brand navy (for buttons)
 */
export function Spinner({ size = 'md', inherit = false, className }) {
  const dim = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-6 w-6'
  return (
    <Loader2
      className={cn(dim, 'animate-spin', className)}
      style={inherit ? undefined : { color: BRAND }}
      aria-hidden="true"
    />
  )
}

/**
 * Centred loading state for a whole page/route (the Suspense fallback) or any
 * section that owns its vertical space.
 */
export function PageLoader({ label = 'Loading…', className }) {
  return (
    <div className={cn('flex h-64 flex-col items-center justify-center gap-3', className)} role="status" aria-live="polite">
      <Spinner size="lg" />
      <span className="text-sm font-medium text-gray-500">{label}</span>
    </div>
  )
}
