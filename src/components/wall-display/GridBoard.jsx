import { useState, useEffect, useRef } from 'react'
import Logo from '@/components/Logo'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { drName } from '@/lib/utils'
import { TEXT_MUTED, DEFAULT_MAX_VISIBLE, DEFAULT_SLIDE_MS } from './constants'
import { maskPatientName, emptyRoomLabel, columnSize } from './utils'
import { useLiveClock } from './hooks'

function GridClock() {
  const now = useLiveClock()
  return (
    <div className="text-right">
      <div className="text-2xl font-bold leading-none tabular-nums">
        {now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}
      </div>
      <div className="text-[10px] font-medium text-white/60">
        {now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}
      </div>
    </div>
  )
}

// One room = one column: room+doctor header, then the waiting list. A 'called'
// patient's row FLASHES (the sketch's "Flash"), so the whole room can see whose
// turn it is from across the floor. `colCount` is how many columns are
// sharing the screen RIGHT NOW (after paging) — fewer columns get bigger type,
// so the board never leaves width on the table when only 1-2 doctors are in.
function RoomColumn({ c, colCount = 5 }) {
  const active = c.doctorState === 'active'
  const size = columnSize(colCount)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      {/* Header — active room gets the navy fill so open rooms pop; a closed
          room stays pale and quiet. */}
      <div className={`shrink-0 px-4 py-3 ${active ? 'bg-gradient-to-br from-[#2E4168] to-[#243654] text-white' : 'bg-slate-100 text-slate-500'}`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${active ? 'bg-white/15 text-white/90' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>
            Room {c.roomNumber}
          </span>
          {active && (
            <span className="flex items-baseline gap-1">
              <span className="text-xl font-bold leading-none tabular-nums">{c.waitingCount}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">waiting</span>
            </span>
          )}
        </div>
        <div className={`mt-1.5 truncate font-bold leading-tight ${size.doctor}`}>
          {c.doctorName ? drName(c.doctorName) : (c.doctorState === 'closed' ? emptyRoomLabel(c.nextSession) : 'No doctor')}
        </div>
        {c.department && <div className={`truncate text-xs font-medium ${active ? 'text-white/50' : 'text-slate-400'}`}>{c.department}</div>}
      </div>

      {/* Now serving — the one being seen. */}
      {c.nowServing && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-emerald-200 bg-emerald-50 px-4 py-2.5">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-600">In Patient</span>
            <span className={`block truncate font-bold text-emerald-900 ${size.now}`}>{maskPatientName(c.nowServing.name)}</span>
          </span>
        </div>
      )}

      {/* Waiting list, numbered like the sketch, zebra-striped for legibility. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {c.patients.length === 0 ? (
          <div className={`px-4 py-5 text-center text-base ${TEXT_MUTED}`}>{c.nowServing ? '—' : 'No one waiting'}</div>
        ) : (
          c.patients.map((p, i) => (
            <div
              key={p.queueEntryId}
              className={`flex items-center gap-3 px-3 py-2.5 ${
                p.flash
                  ? 'animate-pulse bg-amber-100 ring-2 ring-inset ring-amber-400'
                  : i % 2 ? 'bg-slate-50/70' : 'bg-white'
              }`}
            >
              <span className={`flex shrink-0 items-center justify-center rounded-lg font-bold tabular-nums ${size.num} ${
                p.flash ? 'bg-amber-500 text-white' : active ? 'bg-[#2E4168]/10 text-[#2E4168]' : 'bg-slate-100 text-slate-400'
              }`}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-semibold leading-tight text-slate-800 ${size.patient}`}>{maskPatientName(p.name)}</span>
                {p.flash && <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">You're next Be ready</span>}
              </span>
              {p.visitType === 'follow_up' && (
                <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 ring-1 ring-emerald-200">F/U</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// The paging + auto-rotate grid shared by both board feeds:
//   FloorGridScreen — a whole floor, evenly sliced across N TVs (no admin
//     setup needed, the historical fallback)
//   ScreenBoardView — the rooms an admin actually dragged onto ONE screen
// Both just hand this a flat column list plus their own header content; the
// paging math and the slide timer (the fiddly part — see the comment below
// on why it reads a ref instead of closing over state) live here ONCE.
// `horizontalScroll` = the floor-wide view (a laptop where a human can scroll):
// show EVERY doctor-column in one horizontally-scrollable row, no auto-rotate,
// so a presenter can scroll to any doctor and it never jumps away mid-demo.
// The default (auto-slide) is for the wall TV, where nobody is there to scroll —
// there it MUST page itself. See ScreenBoardView vs FloorGridScreen.
export function GridBoard({ headerTitle, headerSubtitle, columns, maxVisible = DEFAULT_MAX_VISIBLE, slideMs = DEFAULT_SLIDE_MS, tickerText, resetKey, horizontalScroll = false }) {
  const { orgInfo } = useOrgSettings() // the hospital's own name, straight from Settings
  const [page, setPage] = useState(0)
  const totalWaiting = columns.reduce((n, c) => n + (c.waitingCount || 0), 0)
  // In scroll mode there are no pages — the whole list shows and the user scrolls.
  const totalPages = horizontalScroll ? 1 : Math.max(1, Math.ceil(columns.length / maxVisible))
  // Clamp rather than trust `page` directly: if doctors have left since the
  // page was picked (shift ended, floor/screen shrank), a stale page number
  // could point past the new last page and render nothing.
  const safePage = Math.min(page, totalPages - 1)
  const pageStart = safePage * maxVisible
  const visible = horizontalScroll ? columns : columns.slice(pageStart, pageStart + maxVisible)

  // A new floor/screen starts back on page 1 — otherwise a page index left
  // over from whatever was on screen before could point past this one's end.
  useEffect(() => { setPage(0) }, [resetKey])

  // Latest data for the slide timer to read WITHOUT resetting its own
  // interval — the timer is on a fixed cadence (30s by default); it must not
  // restart on every 3s poll tick, or it would never actually fire.
  const latest = useRef({ columns, safePage })
  latest.current = { columns, safePage }

  useEffect(() => {
    if (horizontalScroll || totalPages <= 1) return // scroll mode never auto-rotates
    const id = setInterval(() => {
      const { columns: curCols, safePage: curPage } = latest.current
      const start = curPage * maxVisible
      const curVisible = curCols.slice(start, start + maxVisible)
      // Never slide away from a page the board is actively flashing "you're
      // next" on — that flash is a promise the room is watching for, and
      // sliding to the next page mid-flash breaks it.
      if (curVisible.some((c) => c.patients.some((p) => p.flash))) return
      setPage((p) => (p + 1) % totalPages)
    }, slideMs)
    return () => clearInterval(id)
  }, [horizontalScroll, totalPages, maxVisible, slideMs])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      {/* Brand strip. */}
      <header className="flex items-center justify-between bg-gradient-to-r from-[#2E4168] to-[#1b2a45] px-8 py-3.5 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <div className="text-xl font-bold leading-tight tracking-tight">{orgInfo?.name || 'OPD Live Queue'}</div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              {headerTitle}{headerSubtitle ? ` · ${headerSubtitle}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              {Array.from({ length: totalPages }).map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === safePage ? 'w-5 bg-white' : 'w-1.5 bg-white/30'}`} />
              ))}
            </div>
          )}
          <div className="text-right">
            <div className="text-2xl font-bold leading-none tabular-nums">{totalWaiting}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/50">Waiting</div>
          </div>
          <div className="h-9 w-px bg-white/20" />
          <GridClock />
        </div>
      </header>

      {columns.length === 0 ? (
        <div className={`flex flex-1 items-center justify-center text-2xl ${TEXT_MUTED}`}>No doctors sitting here right now</div>
      ) : horizontalScroll ? (
        // Every column in one row that scrolls sideways — fixed column width so
        // cards stay readable instead of shrinking to fit an entire floor.
        <div className="flex flex-1 gap-3 overflow-x-auto p-3">
          {visible.map((c) => (
            <div key={`${c.roomId}::${c.doctorId || 'none'}`} className="w-[22rem] shrink-0">
              <RoomColumn c={c} colCount={3} />
            </div>
          ))}
        </div>
      ) : (
        <div
          className="grid flex-1 gap-3 p-3"
          style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}
        >
          {visible.map((c) => <RoomColumn key={`${c.roomId}::${c.doctorId || 'none'}`} c={c} colCount={visible.length} />)}
        </div>
      )}

      {tickerText && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-2.5 text-center text-sm font-semibold text-slate-600">
          {tickerText}
        </div>
      )}
    </div>
  )
}
