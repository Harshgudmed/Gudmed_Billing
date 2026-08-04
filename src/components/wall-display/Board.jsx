import { ChevronRight } from 'lucide-react'
import Logo from '@/components/Logo'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { SURFACE, TEXT_MUTED } from './constants'
import { useLiveClock } from './hooks'

// This is a wall display read from across a waiting room, not an admin screen —
// type is sized for distance, not for density.
function Header() {
  const now = useLiveClock()
  const { orgInfo } = useOrgSettings()
  return (
    // Brand bar kept as it was — it anchors the panel and reads as the
    // hospital's own screen. Everything BELOW it is what changed.
    <header className="flex items-center justify-between bg-[#2E4168] px-10 py-5 text-white shadow-sm">
      <div className="flex items-center gap-4">
        <Logo size={44} />
        <div>
          <div className="text-2xl font-bold leading-tight">{orgInfo?.name || 'Hospital'}</div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
            {/* A wall panel shows the same frame whether it is live or frozen on
                a stale render. This pulse is the one cue that the data behind it
                is still moving. */}
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live Queue Display
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-4xl font-bold leading-none tracking-tight tabular-nums">
          {now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
        </div>
        <div className="mt-1.5 text-sm font-medium text-white/60">
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
        </div>
      </div>
    </header>
  )
}

// One shell for every screen, so moving between them never changes the frame —
// on a wall panel any flash between routes is the most visible thing in the room.
export function Board({ children }) {
  return (
    // A column that owns the full viewport height, so a screen can hand its
    // content `flex-1` and actually FILL a 1080p panel. Without this the board
    // sized itself to its content and left the bottom half of the wall blank —
    // the same list would have been twice as legible using the space it had.
    <div className={`flex h-screen flex-col overflow-hidden ${SURFACE} text-slate-900`}>
      <Header />
      {children}
    </div>
  )
}

/**
 * Sits in normal flow under the header. It used to be `absolute top-16` INSIDE
 * the header — which put it behind the navy bar, in grey-on-navy, unreadable.
 */
export function Breadcrumb({ crumbs }) {
  if (!crumbs?.length) return null
  return (
    <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-base">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <ChevronRight className="h-4 w-4 text-slate-400" />}
          {c.onClick
            ? <button onClick={c.onClick} className="font-medium text-slate-500 transition-colors hover:text-slate-900">{c.label}</button>
            : <span className="font-semibold text-slate-900">{c.label}</span>}
        </span>
      ))}
    </nav>
  )
}

// One consistent way to title a block, so the eye learns the rhythm of the
// screen once instead of re-parsing each section.
export function SectionLabel({ children }) {
  return (
    <h2 className={`mb-4 text-sm font-bold uppercase tracking-[0.25em] ${TEXT_MUTED}`}>{children}</h2>
  )
}
