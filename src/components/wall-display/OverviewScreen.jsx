import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import client from '@/api/client'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { Board } from './Board'
import { CARD, TEXT_MUTED } from './constants'
import { departmentColorClass } from './utils'
import { useIdleReturn } from './hooks'

// ── Overview: all floors ─────────────────────────────────────────────────
export function OverviewScreen() {
  const [floors, setFloors] = useState([])
  const navigate = useNavigate()
  useIdleReturn(false)

  const load = useCallback(async () => {
    const res = await client.get('/display/floors')
    setFloors(res.data)
  }, [])

  // Live push (with a slow polling fallback) instead of a 3s poll — see useLiveRefresh.
  useLiveRefresh(load)

  return (
    <Board>
      {/* Scrolls, unlike the other boards.
          Board is `h-screen overflow-hidden` because a wall TV has nobody to
          scroll it — right for the room grids, wrong for THIS one. It is the
          page a person taps, its height grows with the number of floors, and a
          hospital with five floors already loses the last card off the bottom
          with no way to reach it. min-h-0 is what lets a flex child actually
          shrink and scroll instead of pushing its parent taller. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-10 pt-8">
        <h1 className="text-5xl font-bold tracking-tight">Select a Floor</h1>
        <p className={`mt-2 mb-8 text-xl ${TEXT_MUTED}`}>Tap a floor to see its departments and rooms.</p>
        {floors.length === 0 ? (
          <p className={`text-xl ${TEXT_MUTED}`}>No floors configured yet — add one in Settings → Rooms.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {floors.map((f) => (
              <button
                key={f.id}
                onClick={() => navigate(`/display/floor/${f.id}`)}
                className={`group rounded-2xl ${CARD} p-7 text-left transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="text-3xl font-bold">{f.name}</div>
                  <ChevronRight className="mt-1 h-7 w-7 shrink-0 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-slate-500" />
                </div>
                {/* Counts are the reason to pick one floor over another, so they
                    carry real weight rather than sitting in caption type. */}
                <div className="mt-5 flex items-baseline gap-6">
                  <span>
                    <span className="text-4xl font-bold tabular-nums text-[#2E4168]">{f.waitingCount}</span>
                    <span className={`ml-2 text-sm font-bold uppercase tracking-wider ${TEXT_MUTED}`}>Waiting</span>
                  </span>
                  <span>
                    <span className="text-4xl font-bold tabular-nums text-emerald-600">{f.inProgressCount}</span>
                    <span className={`ml-2 text-sm font-bold uppercase tracking-wider ${TEXT_MUTED}`}>In progress</span>
                  </span>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {f.departments.map((d) => (
                    <span
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); navigate(`/display/floor/${f.id}?dept=${d.id}`) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); navigate(`/display/floor/${f.id}?dept=${d.id}`) } }}
                      className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition-colors ${departmentColorClass(d.id)}`}
                    >
                      {d.name}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Board>
  )
}
