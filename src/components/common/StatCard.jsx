import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// The HMS status colours for summary tiles — the ones the Laboratory
// dashboard set: yellow = pending, blue = collected / in hand, orange = in
// progress, green = done, red = critical, purple = totals. Written out in full,
// never built as `bg-${tone}-50`: Tailwind finds class names by scanning the
// source, and an interpolated one is never found, so the tile ships colourless.
const TONES = {
  yellow: { card: 'bg-yellow-50 border-yellow-200', num: 'text-yellow-700', txt: 'text-yellow-600', icon: 'text-yellow-500' },
  blue:   { card: 'bg-blue-50 border-blue-200',     num: 'text-blue-700',   txt: 'text-blue-600',   icon: 'text-blue-500' },
  orange: { card: 'bg-orange-50 border-orange-200', num: 'text-orange-700', txt: 'text-orange-600', icon: 'text-orange-500' },
  green:  { card: 'bg-green-50 border-green-200',   num: 'text-green-700',  txt: 'text-green-600',  icon: 'text-green-500' },
  red:    { card: 'bg-red-50 border-red-200',       num: 'text-red-700',    txt: 'text-red-600',    icon: 'text-red-500' },
  purple: { card: 'bg-purple-50 border-purple-200', num: 'text-purple-700', txt: 'text-purple-600', icon: 'text-purple-500' },
}

/**
 * One figure on a summary row. Two looks:
 *
 *   <StatCard icon={Users} label="Active Doctors" value="12" color="bg-blue-500" />
 *     white card, icon in a coloured square on the left (Doctor Accountability)
 *
 *   <StatCard tone="yellow" icon={Clock} label="Pending Orders" value={69} />
 *     tinted tile in the HMS status colours, number first, icon on the right
 *     (the Laboratory and Purchase dashboards)
 *
 * Opt-in extras for either look, so a plain card stays exactly as it was:
 *  - sublabel: a second line ("₹2,40,555")
 *  - onClick:  the whole card becomes a button that opens what the number counts
 *  - valueClassName: colour the value (icon-square look)
 *  - selected: with onClick, the card is a filter that is switched on — a
 *    blue ring, as the Queue's status tiles show it (aria-pressed for readers)
 */
export function StatCard({ icon: Icon, label, value, color = 'bg-blue-500', tone, sublabel, onClick, valueClassName, selected }) {
  const t = tone && TONES[tone]
  const body = t ? (
    <Card className={cn('h-full', t.card, onClick && 'transition-shadow hover:shadow-md', selected && 'ring-2 ring-blue-500')}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className={cn('text-2xl font-bold tabular-nums', t.num)}>{value}</p>
            <p className={cn('text-xs', t.txt)}>{label}</p>
            {sublabel && <p className={cn('text-[11px] tabular-nums opacity-80', t.txt)}>{sublabel}</p>}
          </div>
          {Icon && <Icon className={cn('h-8 w-8 shrink-0', t.icon)} />}
        </div>
      </CardContent>
    </Card>
  ) : (
    <Card className={cn('h-full', onClick && 'transition-colors hover:border-blue-300', selected && 'ring-2 ring-blue-500')}>
      <CardContent className="p-4 flex items-center gap-4">
        {Icon && <div className={cn('p-3 rounded-lg shrink-0', color)}><Icon className="h-5 w-5 text-white" /></div>}
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{label}</p>
          <p className={cn('text-xl font-bold tabular-nums', valueClassName)}>{value}</p>
          {sublabel && <p className="text-xs text-gray-500 tabular-nums">{sublabel}</p>}
        </div>
      </CardContent>
    </Card>
  )
  if (!onClick) return body
  return (
    <button type="button" onClick={onClick} aria-pressed={selected === undefined ? undefined : !!selected} className="block h-full w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
      {body}
    </button>
  )
}
