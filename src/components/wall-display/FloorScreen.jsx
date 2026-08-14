import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import client from '@/api/client'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { drName } from '@/lib/utils'
import { Board, Breadcrumb } from './Board'
import { CARD, TEXT_MUTED } from './constants'
import { emptyRoomLabel } from './utils'
import { useIdleReturn } from './hooks'

// One room, as a card on the floor grid. Only ever rendered for a room that is
// OPEN — the closed ones collapse to a compact row (see FloorScreen).
function RoomCard({ r, onOpen }) {
  const a = r.activeDoctor
  // Count the doctors actually linked — never the `sittingType` label. That
  // label is set by hand when a room is created and nothing updates it as
  // doctors come and go, so Room 100 read "Single" while three doctors sat in
  // it. The link count is the truth; the label is a leftover.
  const doctorCount = r.doctorLinks?.length || 0
  const isShared = doctorCount > 1
  // Only doctors GENUINELY scheduled in this room at this exact moment — not
  // everyone who ever takes a shift here. Shifts in a shared room are
  // non-overlapping by design, so this is normally empty; a non-empty list
  // means two doctors' timetables really do overlap right now.
  const otherDoctors = r.otherActiveDoctors || []
  const waiting = r.waitingCount || 0

  return (
    <button
      onClick={onOpen}
      className={`group relative overflow-hidden rounded-2xl ${CARD} p-6 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg`}
    >
      {/* A colour edge, not a badge: it marks the card as live from across the
          room, before any text is legible. */}
      <span className="absolute inset-y-0 left-0 w-1.5 bg-emerald-500" />
      <div className="flex items-start justify-between gap-4 pl-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="rounded-md bg-slate-100 px-3 py-1 text-sm font-bold uppercase tracking-[0.15em] text-[#2E4168] ring-1 ring-slate-200">
              Room {r.roomNumber}
            </span>
            {isShared && (
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-sky-700 ring-1 ring-sky-200">
                Shared · {doctorCount}
              </span>
            )}
          </div>
          {/* Wraps to a second line rather than truncating. "Dr. Deepika
              Deshp…" is not a doctor's name — a patient standing across the
              hall cannot tell it from Dr. Deshmukh, and this card exists to
              tell them exactly that. Grid items already stretch to the tallest
              in their row, so the two-line card does not make the row ragged.
              Capped at two lines so one very long name cannot push the waiting
              count off the card. */}
          <div className="mt-3 text-2xl font-bold leading-snug [overflow-wrap:anywhere] line-clamp-2">
            {a.unassigned ? <span className="font-medium text-slate-400">No doctor assigned</span> : drName(a.doctorName)}
            {!a.unassigned && a.manual && (
              <span className="ml-2 align-middle rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">Cover</span>
            )}
          </div>
          {otherDoctors.length > 0 && (
            <div className={`mt-1.5 line-clamp-2 [overflow-wrap:anywhere] text-base ${TEXT_MUTED}`}>
              + {otherDoctors.map((d) => drName(d.doctorName)).join(', ')}
            </div>
          )}
        </div>
        {/* The count is why a patient looks at this card at all — which room is
            moving, and how long is the line. It gets the weight to match. */}
        <div className="shrink-0 text-right">
          <div className={`text-5xl font-bold leading-none tabular-nums ${waiting > 0 ? 'text-[#2E4168]' : 'text-slate-300'}`}>
            {waiting}
          </div>
          <div className={`mt-1 text-[11px] font-bold uppercase tracking-[0.15em] ${TEXT_MUTED}`}>Waiting</div>
        </div>
      </div>
    </button>
  )
}

// ── Floor: department tabs + room grid ───────────────────────────────────
export function FloorScreen() {
  const { floorId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [floors, setFloors] = useState([])
  const [deptId, setDeptId] = useState(searchParams.get('dept') || null)
  const [rooms, setRooms] = useState([])
  useIdleReturn(true)

  useEffect(() => {
    client.get('/display/floors').then((res) => {
      setFloors(res.data)
      const f = res.data.find((x) => x.id === floorId)
      // A department chip clicked from the Overview screen names its own
      // department via ?dept= — honour it instead of always defaulting to
      // the floor's first department.
      const requested = searchParams.get('dept')
      const valid = requested && f?.departments?.some((d) => d.id === requested)
      if (f?.departments?.length) setDeptId((cur) => cur || (valid ? requested : f.departments[0].id))
    })
  }, [floorId])

  const loadRooms = useCallback(async () => {
    if (!deptId) return
    const res = await client.get('/rooms', { params: { floorId, departmentId: deptId } })
    setRooms(res.data)
  }, [floorId, deptId])

  // Live push (with a slow polling fallback) instead of a 3s poll — see useLiveRefresh.
  useLiveRefresh(loadRooms)

  const floor = floors.find((f) => f.id === floorId)

  // "Open" means somebody is actually sitting in there right now — a doctor
  // resolved, and not on a break/gap. Those lead, busiest first, because a
  // patient scanning a floor is looking for a moving queue, not a room list.
  const isOpen = (r) => !r.activeDoctor?.unassigned && !r.activeDoctor?.onBreak
  const openRooms = rooms
    .filter(isOpen)
    .sort((x, y) => (y.waitingCount || 0) - (x.waitingCount || 0))
  const closedRooms = rooms.filter((r) => !isOpen(r))

  return (
    <Board>
      <div className="px-10 pb-10 pt-6">
        <Breadcrumb crumbs={[{ label: 'All Floors', onClick: () => navigate('/display') }, { label: floor?.name || '…' }]} />
        <div className="mb-8 flex gap-2 overflow-x-auto border-b border-slate-200">
          {floor?.departments.map((d) => (
            <button
              key={d.id}
              onClick={() => setDeptId(d.id)}
              className={`whitespace-nowrap border-b-[3px] px-5 py-3 text-xl font-semibold transition-colors ${
                deptId === d.id
                  ? 'border-[#2E4168] text-[#2E4168]'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
        {rooms.length === 0 ? (
          <p className={`text-xl ${TEXT_MUTED}`}>No rooms in this department yet.</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pb-2 pr-1">
            {/* OPEN rooms first, and busiest of those first.
                Every card used to carry identical weight, so a floor of 90
                rooms rendered as 90 near-identical tiles — 18 of them repeating
                "Closed today · Next Tue 8:00 AM" — and the four rooms with a
                doctor actually sitting in them were no easier to spot than the
                rest. A patient is looking for somewhere OPEN; that is the sort
                order and the visual weight. */}
            {openRooms.length > 0 && (
              <div className="mb-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {openRooms.map((r) => <RoomCard key={r.id} r={r} onOpen={() => navigate(`/display/room/${r.id}`)} />)}
              </div>
            )}
            {closedRooms.length > 0 && (
              <>
                <div className={`mb-3 flex items-center gap-3 text-sm font-bold uppercase tracking-[0.2em] ${TEXT_MUTED}`}>
                  Closed now
                  <span className="h-px flex-1 bg-slate-200" />
                  {closedRooms.length} rooms
                </div>
                {/* Closed rooms still have to be FINDABLE — a patient may be
                    looking for one to know when it opens — but they must not
                    compete with the open ones, so they collapse to a compact
                    row rather than a full card. */}
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {closedRooms.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => navigate(`/display/room/${r.id}`)}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/60 px-4 py-3 text-left transition-colors hover:bg-white"
                    >
                      <span className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-sm font-bold tracking-wider text-slate-500">
                        {r.roomNumber}
                      </span>
                      <span className={`truncate text-base ${TEXT_MUTED}`}>{emptyRoomLabel(r.nextSession)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Board>
  )
}
