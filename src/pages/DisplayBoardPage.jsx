import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Clock, ChevronRight, Users, DoorOpen } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import Logo from '@/components/Logo'
import { useOrgSettings } from '@/lib/useOrgSettings'
import { useAuth } from '@/lib/auth'
import { drName } from '@/lib/utils'
import { formatTime12h } from '@/lib/format'

// Real hospital queue displays poll rather than push — a lobby TV has one
// reader per screen and tolerates a few seconds of staleness invisibly, so a
// WebSocket/SSE layer buys nothing here. See the project's queue research
// notes for the reasoning (OpenMRS's own production display board polls too).
const POLL_MS = 3000

// An UNATTENDED wall display should drift back to the overview after someone
// taps into a floor or room and walks away — the next person arriving should
// find the board on its home screen, not on whatever the last person opened.
//
// It must not do that to someone who is still LOOKING at the screen. At 30s,
// reading a room's patient list was long enough to get thrown out mid-read,
// because only `click` counted as activity: scrolling the list, moving the
// mouse, or pressing a key all left the board convinced nobody was there.
// Two minutes is past what it takes to read a room and still short enough to
// reset a genuinely abandoned board.
const IDLE_RETURN_MS = 120000

// ── Why this screen looks different from the rest of the app ────────────────
//
// Every other screen is an ADMIN screen: dense, read at arm's length, by
// someone who chose to look at it. This one is a TV on a wall, read from
// across a waiting room by a patient who is anxious and not necessarily
// looking. It was built with admin-screen values — 14px rows, a table, and a
// layout that left ~70% of a 1080p panel empty — and so was unreadable at the
// only distance that matters.
//
// The guidance for this kind of display is well established (see the sources
// noted with this change):
//   · roughly 1 inch of cap height per 10 feet of viewing distance
//   · the single thing the reader came for — who is being seen now — should be
//     the largest object on the screen, not one cell in a grid
//   · high contrast throughout; nothing structural in caption-sized type
//
// Light ground, by the hospital's choice. That puts the weight on TYPE and
// SPACE rather than on a dark canvas: near-black text on white for anything
// that must carry across a room, one saturated accent reserved for the hero,
// and generous padding so the eye can find a row without scanning.
const SURFACE = 'bg-slate-50'
const CARD = 'bg-white border border-slate-200 shadow-sm'
const TEXT_MUTED = 'text-slate-500'
const BRAND = '#2E4168'

// Public-display privacy, OFF by the hospital's decision.
//
// This board has no separate token system: the patient's name and UHID ARE how
// they are called and how they recognise their turn, so both are shown in full.
//
// Flipping this to true partially masks them ("Harsh K. V." / "••••7884"),
// which is what public queue-board guidance recommends — a waiting room is a
// public space, and a full name beside a full hospital ID links an identity to
// a medical visit for every stranger present or anyone photographing the
// screen. Left here, and applied at every render site, so that decision is one
// line away rather than a rewrite.
const MASK_PATIENT_IDENTITY = false

export function maskPatientName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!MASK_PATIENT_IDENTITY || parts.length <= 1) return name || '—'
  const [given, ...rest] = parts
  return `${given} ${rest.map((p) => p[0].toUpperCase() + '.').join(' ')}`
}

export function maskUhid(uhid) {
  const s = String(uhid || '')
  if (!MASK_PATIENT_IDENTITY || s.length <= 4) return s || '—'
  return `••••${s.slice(-4)}`
}

// Distinct, readable pairs so a floor's departments are tellable apart at a
// glance instead of all rendering as the same chip. Hashed by department id so
// a given department always gets the same colour (stable across polls), not
// just the first N in whatever order they arrive in. Tuned for the dark ground:
// a light-mode `bg-blue-50` chip on near-black is an unreadable glare patch.
const DEPARTMENT_COLORS = [
  'bg-sky-50 text-sky-700 ring-sky-200',
  'bg-violet-50 text-violet-700 ring-violet-200',
  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'bg-amber-50 text-amber-700 ring-amber-200',
  'bg-pink-50 text-pink-700 ring-pink-200',
  'bg-teal-50 text-teal-700 ring-teal-200',
  'bg-indigo-50 text-indigo-700 ring-indigo-200',
  'bg-orange-50 text-orange-700 ring-orange-200',
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
  if (nextSession.today) return `Next session ${formatTime12h(nextSession.start)}`
  return `Closed today · Next ${nextSession.dayName.slice(0, 3)} ${formatTime12h(nextSession.start)}`
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
function Board({ children }) {
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
function Breadcrumb({ crumbs }) {
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
function SectionLabel({ children }) {
  return (
    <h2 className={`mb-4 text-sm font-bold uppercase tracking-[0.25em] ${TEXT_MUTED}`}>{children}</h2>
  )
}

// Anything that means a human is present. `click` alone was not enough: reading
// a room's list involves scrolling and mouse movement but often no click at all,
// so an attentive viewer read as idle and the board navigated away underneath
// them mid-read.
const ACTIVITY_EVENTS = ['click', 'mousemove', 'wheel', 'scroll', 'keydown', 'touchstart', 'pointerdown']

function useIdleReturn(active) {
  const navigate = useNavigate()
  const lastActivity = useRef(Date.now())

  useEffect(() => {
    if (!active) return

    // A timestamp + one slow interval, rather than clearing and re-arming a
    // timeout on every event — `mousemove` alone fires hundreds of times a
    // second, and re-arming a timer that often on a wall panel is pure waste.
    const mark = () => { lastActivity.current = Date.now() }
    for (const e of ACTIVITY_EVENTS) {
      document.addEventListener(e, mark, { passive: true })
    }

    lastActivity.current = Date.now()
    const check = setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_RETURN_MS) navigate('/display')
    }, 1000)

    return () => {
      clearInterval(check)
      for (const e of ACTIVITY_EVENTS) document.removeEventListener(e, mark)
    }
  }, [active, navigate])
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
    <Board>
      <div className="px-10 pb-10 pt-8">
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
          <div className="mt-3 truncate text-2xl font-bold leading-snug">
            {a.unassigned ? <span className="font-medium text-slate-400">No doctor assigned</span> : drName(a.doctorName)}
            {!a.unassigned && a.manual && (
              <span className="ml-2 align-middle rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">Cover</span>
            )}
          </div>
          {otherDoctors.length > 0 && (
            <div className={`mt-1.5 truncate text-base ${TEXT_MUTED}`}>
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

// ── Room detail: In Progress + Waiting (grouped by doctor for shared rooms) ─
function RoomScreen() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  // null = follow the default (see below); set once the user picks a doctor.
  const [selectedDoctorId, setSelectedDoctorId] = useState(null)

  // Who gets the controls.
  //
  // The doctor sits in the room with this exact screen in front of them, so
  // this is where the controls belong — walking them over to the reception
  // queue screen mid-clinic is not a workflow anyone will follow.
  //
  // But the SAME route is what hangs on the waiting-room wall, and the last
  // thing that board should carry is a button a patient can press. The two are
  // told apart by WHO IS LOGGED IN, which needs nothing typed and cannot be
  // got wrong: staff see the controls, and a wall panel — signed in as a
  // display/kiosk account, or as a patient, or not at all — does not.
  //
  // ?doctor=0 forces them off for a panel that happens to be signed in as
  // staff; ?doctor=1 forces them on. The URL only ever overrides.
  const { user } = useAuth()
  const STAFF = ['doctor', 'admin', 'receptionist']
  const override = searchParams.get('doctor')
  const doctorMode = override === '1' ? true
    : override === '0' ? false
    : STAFF.includes(user?.role)
  // A console is being watched by the person using it; it must not wander back
  // to the floor list under them.
  useIdleReturn(!doctorMode)

  const load = useCallback(async () => {
    const res = await client.get('/display/queue', { params: { roomId } })
    setData(res.data)
  }, [roomId])

  // Act, then refresh immediately rather than waiting out the poll — the
  // person who pressed the button is looking straight at the result.
  const act = useCallback(async (fn, failure) => {
    setBusy(true)
    try {
      const res = await fn()
      if (res?.success) { toast.success(res.message || 'Done'); await load() }
      else toast.error(res?.error || failure)
    } catch (err) {
      toast.error(err.message || failure)
    } finally {
      setBusy(false)
    }
  }, [load])

  const alertNext = (entryId) => act(
    () => client.patch(`/queue/${entryId}`, { status: 'called' }),
    'Could not alert that patient',
  )
  // Always names the doctor, never just the room. In a room two doctors share
  // at the same time, a room-only call would finish whichever patient happened
  // to be in progress there — possibly the OTHER doctor's, mid-consultation.
  const callInNext = (doctorId) => act(
    () => client.post('/queue/call-next', { roomId, doctorId }),
    'Could not call the next patient',
  )

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  if (!data) return <Board><div className="p-10 text-slate-500">Loading…</div></Board>

  const { room, activeDoctor: a, inProgress, waitingGroups } = data
  const totalWaiting = waitingGroups.reduce((n, g) => n + g.patients.length, 0)
  // Whoever "call next" would actually bring in: first in line for the doctor
  // who is sitting, falling back to the head of the room's queue. Kept in step
  // with the server's own ordering so the console names the same person it
  // will call.
  // Which doctor is this console acting for?
  //
  // A room can genuinely hold two or three doctors at once, and each of them
  // must only ever finish and call THEIR OWN patients. So the console commits
  // to one doctor and says whose queue it is working on:
  //   · a logged-in doctor always acts as themselves
  //   · anyone else (admin/reception covering the desk) gets the doctor who is
  //     actually sitting, and can switch if the room has more than one
  const doctorGroups = waitingGroups.filter((g) => g.doctorId)
  const myGroup = doctorGroups.find((g) => g.doctorId === user?.id)
  const defaultDoctorId = (myGroup || doctorGroups.find((g) => g.active) || doctorGroups[0])?.doctorId || null
  const actingDoctorId = selectedDoctorId ?? defaultDoctorId
  const actingGroup = doctorGroups.find((g) => g.doctorId === actingDoctorId) || null
  // The patient THIS doctor would call — not the head of the shared room list.
  const firstWaiting = actingGroup?.patients?.[0] || null

  return (
    <Board>
      <div className="flex min-h-0 flex-1 flex-col px-10 pb-8 pt-6">
        <Breadcrumb crumbs={[
          { label: 'All Floors', onClick: () => navigate('/display') },
          { label: room.floor?.name, onClick: () => navigate(`/display/floor/${room.floor?.id}`) },
          { label: `Room ${room.roomNumber}` },
        ]} />

        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 text-sm font-bold uppercase tracking-[0.2em] text-[#2E4168]">
              <span className="rounded-md bg-slate-100 px-3 py-1 ring-1 ring-slate-200">Room {room.roomNumber}</span>
              <span className={TEXT_MUTED}>{room.department?.name}</span>
            </div>
            {/* The doctor's name is what a patient scans the wall for, so it is
                the second-largest thing here — behind only who is being seen. */}
            <h1 className="mt-3 text-6xl font-bold leading-none tracking-tight">
              {a.unassigned ? <span className="text-slate-400">No doctor assigned</span>
                : a.onBreak ? <span className="text-slate-500">{emptyRoomLabel(data.nextSession)}</span>
                : <>
                    {drName(a.doctorName)}
                    {a.manual && <span className="ml-4 align-middle rounded-full bg-amber-50 px-4 py-1.5 text-base font-bold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">Covering</span>}
                  </>}
            </h1>
          </div>
          <div className="text-right">
            <div className="text-7xl font-bold leading-none tabular-nums">{totalWaiting}</div>
            <div className={`mt-1 text-sm font-bold uppercase tracking-[0.2em] ${TEXT_MUTED}`}>Waiting</div>
          </div>
        </div>

        {/* min-h-0 so the two columns may shrink inside the flex parent and let
            their own overflow scroll, instead of pushing the page taller. */}
        <div className="grid min-h-0 flex-1 gap-8 lg:grid-cols-[minmax(0,5fr),minmax(0,7fr)]">
          {/* ── NOW SERVING: the one thing the reader came for ──────────── */}
          <section className="flex min-h-0 flex-col">
            <SectionLabel>Now Serving</SectionLabel>
            {inProgress ? (
              // White, like everything else on the board. A solid navy slab
              // this size fought the rest of the screen for attention and made
              // the panel look two-toned; on a light ground the way to say
              // "this is the important one" is SIZE and a single accent edge,
              // not a block of colour.
              <div className={`relative flex flex-1 flex-col justify-center overflow-hidden rounded-2xl ${CARD} p-10`}>
                <span className="absolute inset-y-0 left-0 w-2 bg-emerald-500" />
                <div className="flex items-center gap-2.5 pl-2 text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  In Progress
                </div>
                <div className="mt-4 break-words pl-2 text-6xl font-bold leading-tight tracking-tight">
                  {maskPatientName(inProgress.name)}
                </div>
                <div className={`mt-3 pl-2 font-mono text-2xl ${TEXT_MUTED}`}>{maskUhid(inProgress.uhid)}</div>
                <div className={`ml-2 mt-6 inline-flex w-fit rounded-full px-5 py-2 text-base font-bold uppercase tracking-wider ring-1 ${
                  inProgress.visitType === 'follow_up'
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    : 'bg-sky-50 text-sky-700 ring-sky-200'
                }`}>
                  {inProgress.visitType === 'follow_up' ? 'Follow-up' : 'New patient'}
                </div>
              </div>
            ) : (
              <div className={`flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center ${TEXT_MUTED}`}>
                <DoorOpen className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                <div className="text-2xl font-semibold">Room free</div>
                <div className="mt-1 text-base">No patient in progress</div>
              </div>
            )}

            {/* The doctor's controls, under the patient they refer to. Only in
                ?doctor=1 mode — never on the wall board. */}
            {doctorMode && (
              <div className={`mt-5 rounded-2xl ${CARD} p-5`}>
                <div className={`mb-3 flex items-baseline gap-2 text-xs font-bold uppercase tracking-[0.2em] ${TEXT_MUTED}`}>
                  Doctor controls
                  {actingGroup && (
                    <span className="normal-case tracking-normal text-slate-700">
                      · acting as <b>{drName(actingGroup.doctorName)}</b>
                    </span>
                  )}
                </div>

                {/* Only when the room really does hold more than one doctor at
                    once. Each doctor may finish and call only their OWN
                    patients, so the console has to be explicit about whose
                    queue these buttons touch. */}
                {doctorGroups.length > 1 && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {doctorGroups.map((g) => (
                      <button
                        key={g.doctorId}
                        onClick={() => setSelectedDoctorId(g.doctorId)}
                        className={`rounded-lg px-3.5 py-2 text-sm font-semibold ring-1 transition-colors ${
                          g.doctorId === actingDoctorId
                            ? 'bg-[#2E4168] text-white ring-[#2E4168]'
                            : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {drName(g.doctorName)}
                        <span className="ml-2 opacity-70">{g.patients.length}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => callInNext(actingDoctorId)}
                    disabled={busy || !firstWaiting}
                    className="flex-1 rounded-xl bg-[#2E4168] px-6 py-4 text-lg font-bold text-white transition-colors hover:bg-[#253453] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {inProgress ? 'Finish & call next patient' : 'Call next patient in'}
                  </button>
                  <button
                    onClick={() => alertNext(firstWaiting.queueEntryId)}
                    disabled={busy || !firstWaiting || firstWaiting.alerted}
                    className="flex-1 rounded-xl border-2 border-amber-300 bg-amber-50 px-6 py-4 text-lg font-bold text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {firstWaiting?.alerted ? 'Next patient alerted' : 'Alert next patient'}
                  </button>
                </div>
                <p className={`mt-3 text-sm ${TEXT_MUTED}`}>
                  {firstWaiting
                    ? <>Next up: <b className="text-slate-700">{firstWaiting.name}</b>. “Alert” shows them “you are next” on the board; “Call next” brings them in and finishes the current patient.</>
                    : 'Nobody is waiting for this doctor.'}
                </p>
              </div>
            )}
          </section>

          {/* ── UP NEXT ─────────────────────────────────────────────────── */}
          <section className="flex min-h-0 flex-col">
            <SectionLabel>Up Next</SectionLabel>
            {totalWaiting === 0 ? (
              <div className={`flex flex-1 items-center justify-center rounded-2xl ${CARD} p-12 text-center text-2xl ${TEXT_MUTED}`}>No one waiting</div>
            ) : (
              <div className="min-h-0 flex-1 space-y-7 overflow-y-auto pr-1">
                {waitingGroups.map((g) => (
                  <div key={g.doctorId || 'unassigned'}>
                    {/* Whose queue is this? Driven by the REAL data (is there more
                        than one doctor's queue here?) — never by the cosmetic
                        `sittingType` label. Room 200 is labelled "single" while
                        three doctors actually share it, and gating on that label
                        hid every heading, leaving three anonymous tables that no
                        patient could match themselves to. */}
                    {waitingGroups.length > 1 && (
                      <div className="mb-3 flex items-baseline gap-3 border-b border-slate-200 pb-2">
                        <span className="text-2xl font-bold text-[#2E4168]">
                          {g.doctorName === 'Unassigned' ? 'Unassigned' : drName(g.doctorName)}
                        </span>
                        {/* Composed here, not on the server: the sentence and
                            the 12-hour conversion both belong at the point of
                            display. */}
                        {g.active
                          ? <span className={`text-base ${TEXT_MUTED}`}>· active now</span>
                          : g.shiftStart && <span className={`text-base ${TEXT_MUTED}`}>· today from {formatTime12h(g.shiftStart)}</span>}
                        <span className={`ml-auto text-base font-semibold ${TEXT_MUTED}`}>{g.patients.length} waiting</span>
                      </div>
                    )}
                    {g.patients.length === 0 ? (
                      <p className={`text-lg ${TEXT_MUTED}`}>No one waiting</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {g.patients.map((p, i) => {
                          // Only ever shown because a human pressed "Alert
                          // next" — never inferred from being first in line.
                          // A message on a public wall telling someone to get
                          // ready has to be something staff chose to send: if
                          // the board decided on its own, it would be telling
                          // patients to stand up while the doctor is still
                          // fifteen minutes from finishing.
                          const isNext = p.alerted
                          // Prescription already uploaded = this consultation is
                          // wrapping up, so the wording gets more immediate.
                          const imminent = isNext && inProgress?.prescriptionUploaded
                          return (
                            <li
                              key={p.queueEntryId}
                              className={`flex items-center gap-5 rounded-xl px-5 py-4 transition-colors ${
                                isNext
                                  ? 'bg-amber-50 ring-2 ring-amber-300'
                                  : CARD
                              }`}
                            >
                              <span className={`w-12 shrink-0 text-4xl font-bold tabular-nums ${isNext ? 'text-amber-600' : 'text-slate-400'}`}>
                                {i + 1}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-3xl font-semibold">{maskPatientName(p.name)}</span>
                                {isNext && (
                                  <span className="mt-1 flex items-center gap-2 text-base font-bold uppercase tracking-wider text-amber-700">
                                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
                                    {imminent ? 'You are next — please come to the door' : 'You are next — please be ready'}
                                  </span>
                                )}
                              </span>
                              <span className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-bold uppercase tracking-wider ring-1 ${
                                p.visitType === 'follow_up'
                                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                  : 'bg-sky-50 text-sky-700 ring-sky-200'
                              }`}>
                                {p.visitType === 'follow_up' ? 'Follow-up' : 'New'}
                              </span>
                              <span className={`hidden shrink-0 font-mono text-lg xl:block ${TEXT_MUTED}`}>{maskUhid(p.uhid)}</span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </Board>
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
