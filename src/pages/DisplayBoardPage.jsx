import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Clock, ChevronRight, Users, DoorOpen } from 'lucide-react'
import client from '@/api/client'
import Logo from '@/components/Logo'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { drName } from '@/lib/utils'

// Real hospital queue displays poll rather than push — a lobby TV has one
// reader per screen and tolerates a few seconds of staleness invisibly, so a
// WebSocket/SSE layer buys nothing here. See the project's queue research
// notes for the reasoning (OpenMRS's own production display board polls too).
const POLL_MS = 3000
const IDLE_RETURN_MS = 30000

// Distinct, readable bg/text pairs so a floor's departments are visually
// tellable apart at a glance instead of all rendering as the same gray chip.
// Hashed by department id so a given department always gets the same color
// (stable across polls/re-renders), not just the first N in whatever order
// they arrive in.
const DEPARTMENT_COLORS = [
  'bg-blue-50 text-blue-700 hover:bg-blue-100',
  'bg-purple-50 text-purple-700 hover:bg-purple-100',
  'bg-green-50 text-green-700 hover:bg-green-100',
  'bg-amber-50 text-amber-700 hover:bg-amber-100',
  'bg-pink-50 text-pink-700 hover:bg-pink-100',
  'bg-teal-50 text-teal-700 hover:bg-teal-100',
  'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
  'bg-orange-50 text-orange-700 hover:bg-orange-100',
]
function departmentColorClass(departmentId) {
  let hash = 0
  for (let i = 0; i < departmentId.length; i++) hash = (hash * 31 + departmentId.charCodeAt(i)) | 0
  return DEPARTMENT_COLORS[Math.abs(hash) % DEPARTMENT_COLORS.length]
}

/**
 * What to put on a room where nobody is sitting right now.
 *
 * This used to be the single word "On break", which reads as "back in a minute"
 * and was shown for every reason a room can be empty: the session has not
 * started, it ended hours ago, it is a lunch gap, the clinic is shut for the
 * day, or the doctor is on leave. At 11pm every room said "On break". A patient
 * in the waiting area is asking one question — how long — so answer it from the
 * next scheduled session, and say "closed" plainly when there isn't one.
 *
 * `nextSession` comes from the API ({ dayName, start, today }); null means
 * nobody is scheduled here in the next week.
 */
function emptyRoomLabel(nextSession) {
  if (!nextSession) return 'Consultations closed'
  if (nextSession.today) return `Next session ${to12h(nextSession.start)}`
  return `Closed today · Next ${nextSession.dayName.slice(0, 3)} ${to12h(nextSession.start)}`
}

/** "14:00" -> "2:00 PM". A waiting room reads clock time, not 24h. */
function to12h(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm || ''
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

function useLiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

// This is a wall display read from across a waiting room, not an admin screen —
// type is sized for distance, not for density.
function Header() {
  const now = useLiveClock()
  const { orgInfo } = useOrgSettings()
  return (
    <div className="bg-[#2E4168] text-white px-8 py-4 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-3.5">
        <Logo size={40} />
        <div>
          <div className="text-lg font-bold leading-tight">{orgInfo?.name || 'Hospital'}</div>
          <div className="text-[11px] text-white/60 uppercase tracking-[0.15em] font-semibold">Live Queue Display</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-2xl font-semibold tabular-nums leading-tight">{now.toLocaleTimeString('en-IN', { hour12: true })}</div>
        <div className="text-xs text-white/60 font-semibold">{now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
      </div>
    </div>
  )
}

/**
 * Sits in normal flow under the header. It used to be `absolute top-16` INSIDE
 * the header — which put it behind the navy bar, in grey-on-navy, unreadable.
 */
function Breadcrumb({ crumbs }) {
  if (!crumbs?.length) return null
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm mb-5">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-4 w-4 text-gray-300" />}
          {c.onClick
            ? <button onClick={c.onClick} className="text-gray-500 hover:text-[#2E4168] font-medium transition-colors">{c.label}</button>
            : <span className="font-semibold text-gray-800">{c.label}</span>}
        </span>
      ))}
    </nav>
  )
}

function useIdleReturn(active) {
  const navigate = useNavigate()
  const timer = useRef(null)
  const reset = useCallback(() => {
    clearTimeout(timer.current)
    if (!active) return
    timer.current = setTimeout(() => navigate('/display'), IDLE_RETURN_MS)
  }, [active, navigate])
  useEffect(() => {
    reset()
    document.addEventListener('click', reset)
    return () => { clearTimeout(timer.current); document.removeEventListener('click', reset) }
  }, [reset])
}

// ── Overview: all floors ─────────────────────────────────────────────────
function OverviewScreen() {
  const [floors, setFloors] = useState([])
  const navigate = useNavigate()
  useIdleReturn(false)

  const load = useCallback(async () => {
    const res = await client.get('/display/floors')
    setFloors(res.data)
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="p-8 pt-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Select a Floor</h1>
        <p className="text-gray-500 mb-6">Tap a floor to see its departments and rooms.</p>
        {floors.length === 0 ? (
          <p className="text-gray-400">No floors configured yet — add one in Settings → Rooms.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {floors.map((f) => (
              <button
                key={f.id}
                onClick={() => navigate(`/display/floor/${f.id}`)}
                className="text-left bg-white border border-gray-200 border-l-4 border-l-[#2E4168] rounded-lg p-5 hover:shadow-md hover:border-l-[#253453] transition-all"
              >
                <div className="text-lg font-bold text-gray-900">{f.name}</div>
                <div className="text-sm text-[#2E4168] font-semibold mt-1">{f.waitingCount} waiting · {f.inProgressCount} in progress</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {f.departments.map((d) => (
                    <span
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); navigate(`/display/floor/${f.id}?dept=${d.id}`) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); navigate(`/display/floor/${f.id}?dept=${d.id}`) } }}
                      className={`text-xs rounded-full px-2.5 py-1 font-medium cursor-pointer transition-colors ${departmentColorClass(d.id)}`}
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
    </div>
  )
}

// ── Floor: department tabs + room grid ───────────────────────────────────
function FloorScreen() {
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

  useEffect(() => {
    loadRooms()
    const id = setInterval(loadRooms, POLL_MS)
    return () => clearInterval(id)
  }, [loadRooms])

  const floor = floors.find((f) => f.id === floorId)

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="p-8">
        <Breadcrumb crumbs={[{ label: 'All Floors', onClick: () => navigate('/display') }, { label: floor?.name || '…' }]} />
        <div className="flex gap-1 border-b mb-6 overflow-x-auto">
          {floor?.departments.map((d) => (
            <button
              key={d.id}
              onClick={() => setDeptId(d.id)}
              className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 ${deptId === d.id ? 'border-[#2E4168] text-[#2E4168]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {d.name}
            </button>
          ))}
        </div>
        {rooms.length === 0 ? (
          <p className="text-gray-400">No rooms in this department yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((r) => {
              const a = r.activeDoctor
              const isShared = r.sittingType === 'multiple'
              const doctorCount = r.doctorLinks?.length || 0
              // Only doctors GENUINELY scheduled in this room at this exact
              // moment — not everyone who ever takes a shift here. Shifts in
              // a shared room are non-overlapping by design (different hours,
              // same room), so this is normally empty; a non-empty list means
              // two doctors' timetables really do overlap right now.
              const otherDoctors = r.otherActiveDoctors || []
              return (
                <button
                  key={r.id}
                  onClick={() => navigate(`/display/room/${r.id}`)}
                  className="text-left bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md hover:border-blue-300 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-500">ROOM {r.roomNumber}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${isShared ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {isShared ? `Shared · ${doctorCount}` : 'Single'}
                    </span>
                  </div>
                  <div className="mt-2 font-bold text-gray-900">
                    {a.unassigned ? <span className="text-gray-400 italic font-normal">No doctor assigned</span>
                      : a.onBreak ? <span className="text-gray-500 font-medium">{emptyRoomLabel(r.nextSession)}</span>
                      : drName(a.doctorName)}
                    {!a.unassigned && a.manual && <span className="ml-1.5 text-[9px] font-bold uppercase text-amber-700 bg-amber-50 rounded-full px-1.5 py-0.5 align-middle">Cover</span>}
                  </div>
                  {otherDoctors.length > 0 && (
                    <div className="mt-1 text-[11px] text-gray-400 truncate">
                      + {otherDoctors.map((d) => drName(d.doctorName)).join(', ')}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Room detail: In Progress + Waiting (grouped by doctor for shared rooms) ─
function RoomScreen() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  useIdleReturn(true)

  const load = useCallback(async () => {
    const res = await client.get('/display/queue', { params: { roomId } })
    setData(res.data)
  }, [roomId])

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  if (!data) return <div className="min-h-screen bg-gray-50"><Header /></div>

  const { room, activeDoctor: a, inProgress, waitingGroups } = data

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="p-8">
        <Breadcrumb crumbs={[
          { label: 'All Floors', onClick: () => navigate('/display') },
          { label: room.floor?.name, onClick: () => navigate(`/display/floor/${room.floor?.id}`) },
          { label: `Room ${room.roomNumber}` },
        ]} />
        <div className="mb-6">
          <div className="text-sm font-mono text-[#2E4168] font-semibold tracking-wide">ROOM {room.roomNumber} · {room.department?.name}</div>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">
            {a.unassigned ? <span className="text-gray-400 italic">No doctor assigned to this room</span>
              : a.onBreak ? <span className="text-gray-500">{emptyRoomLabel(data.nextSession)}</span>
              : <>{drName(a.doctorName)}{a.manual && <span className="ml-2 text-xs font-bold uppercase text-amber-700 bg-amber-50 rounded-full px-2 py-1 align-middle">Covering</span>}</>}
          </h1>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr,1.4fr]">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">In Progress</div>
            {inProgress ? (
              <div className="bg-gradient-to-br from-[#2E4168] to-[#253453] text-white rounded-lg p-6">
                <div className="text-xs uppercase tracking-wide text-white/70 font-bold mb-2">Now Serving</div>
                <div className="text-2xl font-bold">{inProgress.name}</div>
                <div className="text-white/70 mt-1">{inProgress.uhid}</div>
                <div className="text-sm mt-3 font-semibold">{inProgress.visitType === 'follow_up' ? 'Follow-up patient' : 'New patient'}</div>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center text-gray-400 italic">Room free — no patient in progress</div>
            )}
          </div>

          <div className="space-y-5">
            {waitingGroups.length === 0 && (
              <p className="text-sm text-gray-400 italic">No one waiting</p>
            )}
            {waitingGroups.map((g) => (
              <div key={g.doctorId || 'unassigned'}>
                {/* Whose queue is this? Driven by the REAL data (is there more
                    than one doctor's queue here?) — never by the cosmetic
                    `sittingType` label. Room 200 is labelled "single" while
                    three doctors actually share it, and gating on that label
                    hid every heading, leaving three anonymous tables that no
                    patient could match themselves to. */}
                {waitingGroups.length > 1 && (
                  <div className="flex items-baseline gap-2 mb-2 pb-1.5 border-b border-gray-200">
                    <span className="font-bold text-base text-[#2E4168]">{g.doctorName === 'Unassigned' ? 'Unassigned' : drName(g.doctorName)}</span>
                    {g.scheduleNote && <span className="text-xs text-gray-500 font-medium">· {g.scheduleNote}</span>}
                    <span className="ml-auto text-xs font-semibold text-gray-500">
                      {g.patients.length} waiting
                    </span>
                  </div>
                )}
                {g.patients.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No one waiting</p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[40px,1fr,90px,140px] bg-gray-50 text-[11px] font-bold uppercase tracking-wide text-gray-500 px-4 py-2">
                      <span>#</span><span>Patient</span><span>Visit</span><span>UHID</span>
                    </div>
                    {g.patients.map((p, i) => {
                      const isNext = i === 0 && g.active && inProgress?.prescriptionUploaded
                      return (
                        <div key={p.queueEntryId}>
                          <div className={`grid grid-cols-[40px,1fr,90px,140px] items-center px-4 py-2.5 border-t text-sm ${isNext ? 'bg-red-50' : i % 2 ? 'bg-gray-50/60' : ''}`}>
                            <span className={`font-mono font-semibold ${isNext ? 'text-red-600' : 'text-gray-400'}`}>{i + 1}</span>
                            <span className="font-medium">{p.name}</span>
                            <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 w-fit ${p.visitType === 'follow_up' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                              {p.visitType === 'follow_up' ? 'Follow-up' : 'New'}
                            </span>
                            <span className="font-mono text-xs text-gray-500">{p.uhid}</span>
                          </div>
                          {isNext && (
                            <div className="bg-red-50 px-4 py-2 border-t border-red-100 flex items-center gap-2 text-red-600 font-bold text-sm animate-pulse">
                              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />You are next. Be ready.
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DisplayBoardPage() {
  return (
    <Routes>
      <Route index element={<OverviewScreen />} />
      <Route path="floor/:floorId" element={<FloorScreen />} />
      <Route path="room/:roomId" element={<RoomScreen />} />
    </Routes>
  )
}
