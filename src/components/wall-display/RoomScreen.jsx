import { useState, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DoorOpen, Bell } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { useAuth } from '@/lib/auth'
import { drName } from '@/lib/utils'
import { formatTime12h } from '@/lib/format'
import { Board, Breadcrumb } from './Board'
import { CARD, TEXT_MUTED } from './constants'
import { maskPatientName, maskUhid, emptyRoomLabel } from './utils'
import { useIdleReturn } from './hooks'

// One doctor's lane on the room screen: their current consultation, their next
// patients, and — only for staff — their own controls. Self-contained so two or
// three doctors sharing a room each get an identical, independent block that
// never touches another doctor's queue.
function DoctorLane({ g, showControls, busy, onCall, onAlert }) {
  const inProg = g.inProgress
  const next = g.patients?.[0] || null
  const shown = g.patients || []
  const moreWaiting = Math.max(0, (g.waitingCount || 0) - shown.length)

  return (
    <div className={`overflow-hidden rounded-2xl ${CARD} ${g.active ? 'ring-1 ring-emerald-200' : ''}`}>
      {/* Lane header — a tinted strip so each doctor's block reads as one unit
          at a glance, and the active one is unmistakable. */}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3.5 ${g.active ? 'bg-emerald-50' : 'bg-slate-50'}`}>
        <span className="text-2xl font-bold text-slate-800">
          {g.doctorName === 'Unassigned' ? 'Unassigned' : drName(g.doctorName)}
        </span>
        {g.active
          ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Active now
            </span>
          : g.shiftStart && <span className={`text-sm font-medium ${TEXT_MUTED}`}>from {formatTime12h(g.shiftStart)}</span>}
        <span className="ml-auto flex items-baseline gap-1.5">
          <span className="text-3xl font-bold tabular-nums text-[#2E4168]">{g.waitingCount || 0}</span>
          <span className={`text-xs font-bold uppercase tracking-wider ${TEXT_MUTED}`}>waiting</span>
        </span>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,4fr),minmax(0,6fr)]">
        {/* NOW SERVING + controls for this doctor */}
        <div className="flex flex-col">
          <div className={`mb-2 text-[11px] font-bold uppercase tracking-[0.2em] ${TEXT_MUTED}`}>Patient In</div>
          {inProg ? (
            <div className="relative flex-1 overflow-hidden rounded-xl bg-gradient-to-br from-emerald-50 to-white p-4 ring-1 ring-emerald-200">
              <div className="break-words text-2xl font-bold leading-tight text-slate-800">{maskPatientName(inProg.name)}</div>
              <div className={`mt-0.5 font-mono text-sm ${TEXT_MUTED}`}>{maskUhid(inProg.uhid)}</div>
            </div>
          ) : (
            <div className={`flex flex-1 items-center justify-center rounded-xl bg-slate-50 p-4 text-center text-base ${TEXT_MUTED}`}>Room free</div>
          )}

          {showControls && (
            // Both actions on ONE row.
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <button
                onClick={onCall}
                disabled={busy || !next}
                className="flex items-center justify-center gap-2 rounded-xl bg-[#2E4168] px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-[#253453] hover:shadow disabled:cursor-not-allowed disabled:opacity-40"
              >
                <DoorOpen className="h-4 w-4" />
                {inProg ? 'Finish & next' : 'Call next in'}
              </button>
              <button
                onClick={onAlert}
                disabled={busy || !next || next.alerted}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700 transition-all hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Bell className="h-4 w-4" />
                {next?.alerted ? 'Alerted' : 'Alert next'}
              </button>
            </div>
          )}
        </div>

        {/* UP NEXT for this doctor */}
        <div>
          <div className={`mb-2 text-[11px] font-bold uppercase tracking-[0.2em] ${TEXT_MUTED}`}>Up next</div>
          {shown.length === 0 ? (
            <div className={`flex h-full min-h-[64px] items-center rounded-xl bg-slate-50 px-4 text-base ${TEXT_MUTED}`}>No one waiting</div>
          ) : (
            <ul className="space-y-2">
              {shown.map((p, i) => {
                // Only ever shown because a human pressed "Alert next" — never
                // inferred from position. See the queue controller.
                const isNext = p.alerted
                const imminent = isNext && inProg?.prescriptionUploaded
                return (
                  <li
                    key={p.queueEntryId}
                    className={`flex items-center gap-4 rounded-xl px-4 py-3 transition-colors ${
                      isNext ? 'bg-amber-50 ring-2 ring-amber-300' : 'bg-white ring-1 ring-slate-200'
                    }`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold tabular-nums ${
                      isNext ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                    }`}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xl font-semibold text-slate-800">{maskPatientName(p.name)}</span>
                      {isNext && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-700">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                          {imminent ? 'Next — come to the door' : 'Next — please be ready'}
                        </span>
                      )}
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                      p.visitType === 'follow_up' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'
                    }`}>
                      {p.visitType === 'follow_up' ? 'Follow-up' : 'New'}
                    </span>
                    <span className={`hidden shrink-0 font-mono text-sm xl:block ${TEXT_MUTED}`}>{maskUhid(p.uhid)}</span>
                  </li>
                )
              })}
              {moreWaiting > 0 && (
                <li className={`rounded-xl bg-slate-50 px-4 py-2 text-sm font-semibold ${TEXT_MUTED}`}>+ {moreWaiting} more waiting</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Room detail: In Progress + Waiting (grouped by doctor for shared rooms) ─
export function RoomScreen() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)

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

  // Live push (with a slow polling fallback) instead of a 3s poll — see useLiveRefresh.
  useLiveRefresh(load)

  if (!data) return <Board><div className="p-10 text-slate-500">Loading…</div></Board>

  const { room, activeDoctor: a, waitingGroups } = data
  // True totals from the server (whole queue), not the length of the hydrated
  // slice — at 500/doctor the slice is capped but this count is exact.
  const totalWaiting = waitingGroups.reduce((n, g) => n + (g.waitingCount || 0), 0)

  // Each doctor gets their OWN lane and their OWN controls — nothing is shared
  // or switched between them. A logged-in doctor's own lane leads; otherwise
  // the active doctor's does.
  const lanes = [...waitingGroups].sort((x, y) => {
    if (x.doctorId === user?.id) return -1
    if (y.doctorId === user?.id) return 1
    return (y.active === x.active) ? 0 : x.active ? -1 : 1
  })

  return (
    <Board>
      <div className="flex min-h-0 flex-1 flex-col px-10 pb-8 pt-6">
        <Breadcrumb crumbs={[
          { label: 'All Floors', onClick: () => navigate('/display') },
          { label: room.floor?.name, onClick: () => navigate(`/display/floor/${room.floor?.id}`) },
          { label: `Room ${room.roomNumber}` },
        ]} />

        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 text-sm font-bold uppercase tracking-[0.2em] text-[#2E4168]">
              <span className="rounded-md bg-slate-100 px-3 py-1 ring-1 ring-slate-200">Room {room.roomNumber}</span>
              <span className={TEXT_MUTED}>{room.department?.name}</span>
            </div>
            <h1 className="mt-3 text-4xl font-bold leading-none tracking-tight text-slate-800">
              {a.unassigned ? <span className="text-slate-400">No doctor assigned</span>
                : a.onBreak ? <span className="text-slate-500">{emptyRoomLabel(data.nextSession)}</span>
                : <span className={TEXT_MUTED}>{lanes.length > 1 ? `${lanes.length} doctors in this room` : drName(a.doctorName)}</span>}
            </h1>
          </div>
          <div className="text-right">
            <div className="text-7xl font-bold leading-none tabular-nums">{totalWaiting}</div>
            <div className={`mt-1 text-sm font-bold uppercase tracking-[0.2em] ${TEXT_MUTED}`}>Waiting</div>
          </div>
        </div>

        {/* One lane per doctor — never combined. Each carries that doctor's own
            NOW SERVING, their own UP NEXT, and (in staff mode) their own
            controls, which only ever touch their own patients. */}
        {lanes.length === 0 ? (
          <div className={`flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center ${TEXT_MUTED}`}>
            <DoorOpen className="mx-auto mb-4 h-12 w-12 text-slate-300" />
            <div className="text-2xl font-semibold">{a.onBreak ? emptyRoomLabel(data.nextSession) : 'No one waiting'}</div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {lanes.map((g) => (
              <DoctorLane
                key={g.doctorId || 'unassigned'}
                g={g}
                showControls={doctorMode}
                busy={busy}
                onCall={() => callInNext(g.doctorId)}
                onAlert={() => g.patients[0] && alertNext(g.patients[0].queueEntryId)}
              />
            ))}
          </div>
        )}
      </div>
    </Board>
  )
}
