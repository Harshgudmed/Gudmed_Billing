// The public/lobby display board's read model. Deliberately thin: floor and
// room STRUCTURE (names, doctors, sitting type) is already served correctly
// by roomController's /api/rooms and /api/rooms/floors — this file only adds
// the two things that are genuinely display-specific:
//   1. per-floor waiting/in-progress counts, for the "All Floors" overview tiles
//   2. the per-room queue feed: the in-progress ticket + the waiting list,
//      grouped by doctor for a shared room (see lib/activeDoctor.js)
//
// V1 auth note: mounted behind the same `authenticate`+`authorize()` as every
// other route (routes/index.js) — no new public/unauthenticated surface. The
// lobby TV/kiosk browser logs in once with a low-privilege account and stays
// open, same as any other staff screen today. A dedicated kiosk-token scheme
// is a reasonable v2 if that becomes a real operational pain point.
import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'

// A board calls this once to learn its organization, so it can join the right
// realtime room and only receive its own hospital's queue pushes.
export function whoami(req, res) {
  res.json({ success: true, organizationId: getOrgId(req) })
}
import { resolveActiveDoctor } from '../lib/activeDoctor.js'
import { toRoomDTO, ROOM_INCLUDE, DOCTOR_SELECT } from './roomController.js'
import { todayRange, nowInZone } from '../lib/dates.js'
import { DAY_NAMES } from '../lib/doctorTimetable.js'
import { groupWaitingByDoctor, groupInProgressByDoctor } from '../lib/queueGrouping.js'
import { syncAppointmentsToQueue } from '../lib/queueSync.js'
import { ymdInZone } from '../lib/dates.js'
import { PATIENT_NAME_SELECT, patientFullName } from '../lib/patientName.js'
import { QUEUE_ORDER_BY } from '../lib/queuePriority.js'

const WAITING_STATUSES = ['waiting', 'called']

// The board read whatever was already in QueueManagement and never derived it.
// Only the Queue screen called syncAppointmentsToQueue, so the board silently
// depended on a member of staff having opened that screen first: on a day nobody
// did, today's appointments had no queue row (or a row with no roomId, from
// before their doctor had a room), and the board showed empty rooms while the
// patients sat in the corridor. A wall display cannot depend on someone else
// clicking something.
//
// The sync is idempotent and its writes are upserts, so running it from here is
// safe — but the board polls every 3s and the sync scans the day's appointments,
// so it is throttled and never awaited: the poll that triggers it returns the
// current data, and the next one (3s later) sees the healed rows.
const SYNC_EVERY_MS = 60_000
const lastSyncAt = new Map() // organizationId -> epoch ms
let syncInFlight = false

function healTodaysQueue(organizationId) {
  const now = Date.now()
  if (syncInFlight || now - (lastSyncAt.get(organizationId) || 0) < SYNC_EVERY_MS) return
  lastSyncAt.set(organizationId, now)
  syncInFlight = true
  const today = ymdInZone()
  syncAppointmentsToQueue(organizationId, today, today)
    .catch((e) => console.error('[display] queue sync failed:', e.message))
    .finally(() => { syncInFlight = false })
}

// GET /api/display/floors — floor tiles with a live waiting-room headcount.
export async function getFloorsOverview(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    healTodaysQueue(ORG_ID) // fire-and-forget; see the note above
    // A passport-office display board is inherently "right now" — same
    // "today-only entries" rule as the main Queue screen. Without this, every
    // appointment ever synced (queueSync stamps every non-cancelled
    // appointment across its whole requested range, including a year in the
    // past or future) counts as "waiting" forever, since nothing ever expires
    // an old row. That's both a correctness bug (absurd counts like "46,411
    // waiting" on one floor) and the reason this endpoint got slow once the
    // historical backfill grew the table past ~1M rows — every 3s poll was
    // aggregating the whole table, not just today.
    const todayFilter = todayRange()
    const floors = await db.floor.findMany({
      where: { organizationId: ORG_ID },
      include: {
        rooms: {
          select: {
            id: true, roomNumber: true,
            department: { select: { id: true, name: true, code: true } },
            queueEntries: { where: { status: { in: [...WAITING_STATUSES, 'in_progress'] }, joinedQueueAt: todayFilter }, select: { id: true, status: true } },
          },
        },
      },
      // Explicit display order, not name (alphabetical puts "1st Floor"
      // before "Ground Floor": '1' < 'G') or createdAt (an implicit, fragile
      // proxy that breaks the moment a floor is added out of sequence).
      orderBy: { sortOrder: 'asc' },
    })

    const data = floors.map((f) => {
      const departments = new Map()
      let waitingCount = 0
      let inProgressCount = 0
      for (const room of f.rooms) {
        for (const e of room.queueEntries) {
          if (e.status === 'in_progress') inProgressCount++
          else waitingCount++
        }
        if (room.department && !departments.has(room.department.id)) {
          departments.set(room.department.id, room.department)
        }
      }
      return {
        id: f.id, name: f.name,
        roomCount: f.rooms.length,
        waitingCount, inProgressCount,
        departments: Array.from(departments.values()),
      }
    })
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

// Builds one UN-hydrated column per doctor, per room — shared by every board
// feed that turns a room list into doctor-columns (getFloorQueue's floor-wide
// even-split and getScreenQueue's admin-assigned room set below). A shared
// room with three doctors sitting at once produces THREE columns, each with
// only its own patients — not one room column with everyone mixed together.
// Patient/doctor NAMES are deliberately left unresolved (`_waiting`/
// `_inProgId` carry only ids) — see hydrateColumns, which the caller runs on
// just the slice it's about to render, not every column it built.
async function buildRoomColumns(orgId, rooms, { includeIdle = false } = {}) {
  const roomIds = rooms.map((r) => r.id)

  // Lightweight fetch: every waiting/in-progress row for these rooms, but
  // WITHOUT the patient join (that join was what made the whole-floor read
  // slow — 4.3s measured before this was split out). Just the scalar fields
  // needed to group by doctor and count.
  const rawEntries = roomIds.length ? await db.queueManagement.findMany({
    where: { organizationId: orgId, roomId: { in: roomIds }, status: { in: [...WAITING_STATUSES, 'in_progress'] }, joinedQueueAt: todayRange() },
    // queueNumber is carried so a hospital can announce the token instead of the
    // patient's name — a name spoken over hall speakers reaches further than the
    // same name printed on the screen.
    select: { id: true, roomId: true, assignedToId: true, followUpDoctorId: true, status: true, visitType: true, queueNumber: true, priorityRank: true, joinedQueueAt: true, createdAt: true },
    orderBy: QUEUE_ORDER_BY,
  }) : []
  const entriesByRoom = new Map(roomIds.map((id) => [id, []]))
  for (const e of rawEntries) entriesByRoom.get(e.roomId)?.push(e)

  // One column per doctor, per room — same grouping the room-detail screen
  // uses (lib/queueGrouping), so a walk-in folds into the active doctor and a
  // patient booked with a doctor who isn't here today does too.
  const PER_COL = 10
  const todayName = DAY_NAMES[nowInZone().dayOfWeek]
  const columns = []
  for (const room of rooms) {
    const dto = toRoomDTO(room)
    const activeId = dto.activeDoctor.doctorId
    const hasShiftToday = (docId) => dto.schedule.some((s) => s.doctorId === docId && s.dayName === todayName)
    const roomEntries = entriesByRoom.get(room.id) || []
    const waitingEntries = roomEntries.filter((e) => e.status !== 'in_progress')
    const inProgEntries = roomEntries.filter((e) => e.status === 'in_progress')

    const byDoctor = groupWaitingByDoctor(waitingEntries, { activeDoctorId: activeId, hasShiftToday })
    const inProgByDoctor = groupInProgressByDoctor(inProgEntries, { activeDoctorId: activeId, hasShiftToday })

    const groupIds = new Set([...byDoctor.keys(), ...inProgByDoctor.keys()])
    // Active doctor first within a room, then the rest.
    const ordered = [...groupIds].sort((a, b) => (a === activeId ? -1 : b === activeId ? 1 : 0))
    for (const doctorId of ordered) {
      const waiting = (byDoctor.get(doctorId) || [])
      const inProgId = inProgByDoctor.get(doctorId)?.id || null
      // A doctor with nobody waiting AND nobody being served has 0 patients —
      // keep them off the board (the active doctor's group is always seeded, even
      // when empty; see groupWaitingByDoctor). `?includeClosed=1` overrides this
      // to show every sitting doctor, idle or not.
      if (!includeIdle && waiting.length === 0 && !inProgId) continue
      const link = dto.doctorLinks.find((l) => l.doctorId === doctorId)
      columns.push({
        roomId: room.id,
        roomNumber: room.roomNumber,
        department: dto.department?.name || null,
        doctorId,
        doctorName: link?.doctorName || null, // unresolved names filled in by hydrateColumns
        active: doctorId === activeId,
        waitingCount: waiting.length,
        _waiting: waiting.slice(0, PER_COL).map((e) => ({ id: e.id, visitType: e.visitType, queueNumber: e.queueNumber, flash: e.status === 'called' })),
        _inProgId: inProgId,
        _inProgToken: inProgByDoctor.get(doctorId)?.queueNumber || null,
      })
    }
  }
  return columns
}

// Hydrates a (usually already-sliced) set of skeleton columns with patient
// names + any doctor names the room index didn't already know, in two
// batched queries — the expensive part, so callers only run it on what they
// are about to actually render, not every column buildRoomColumns produced.
async function hydrateColumns(columns) {
  const entryIds = columns.flatMap((c) => [...c._waiting.map((w) => w.id), c._inProgId].filter(Boolean))
  const missingDoctorIds = [...new Set(columns.filter((c) => c.doctorId && !c.doctorName).map((c) => c.doctorId))]
  const [patients, docs] = await Promise.all([
    entryIds.length ? db.queueManagement.findMany({ where: { id: { in: entryIds } }, select: { id: true, patient: { select: { ...PATIENT_NAME_SELECT, mrn: true } } } }) : [],
    missingDoctorIds.length ? db.user.findMany({ where: { id: { in: missingDoctorIds } }, select: { id: true, fullName: true } }) : [],
  ])
  const patientById = new Map(patients.map((p) => [p.id, p.patient]))
  const docNameById = new Map(docs.map((d) => [d.id, d.fullName]))

  return columns.map((c) => {
    const inProg = c._inProgId ? patientById.get(c._inProgId) : null
    return {
      roomId: c.roomId,
      // A shared room produces one column PER doctor, all with the same roomId
      // — so the client keys its grid on roomId+doctorId, not roomId alone.
      // Keying on roomId alone made React see two same-room columns as one key
      // and duplicate/omit them, which showed up as the board mis-rendering
      // (extra or missing cards) on pages that held a shared room.
      doctorId: c.doctorId || null,
      roomNumber: c.roomNumber,
      department: c.department,
      doctorName: c.doctorName || docNameById.get(c.doctorId) || 'Unassigned',
      doctorState: 'active',
      active: c.active,
      waitingCount: c.waitingCount,
      // queueEntryId, not just the name: the board announces this patient aloud
      // and the fallback poll re-delivers the same payload every 30 seconds.
      // Without an id to remember, the hall would hear the same name again and
      // again for as long as the patient is in the room.
      nowServing: inProg
        ? { queueEntryId: c._inProgId, name: patientFullName(inProg), uhid: inProg?.mrn || '—', token: c._inProgToken }
        : null,
      patients: c._waiting.map((w) => {
        const p = patientById.get(w.id)
        return {
          queueEntryId: w.id, name: patientFullName(p) || '—', uhid: p?.mrn || '—',
          visitType: w.visitType, flash: w.flash,
          // The token is minted per day and already unique. It never reached the
          // board, so a hospital that would rather not say a patient's name out
          // loud in a public hall had nothing else to announce.
          token: w.queueNumber || null,
        }
      }),
    }
  })
}

// GET /api/display/floor-queue?floorId=&screen=1&screens=4
//
// The OPD wall board the client sketched: one FLOOR laid out as COLUMNS. Each
// column is ONE DOCTOR — room number + doctor on top, that doctor's own waiting
// list below.
//
// A floor is spread across several TVs, so `screen`/`screens` slice the COLUMNS
// (doctors) EVENLY — screen 2 of 4 shows the second quarter, whatever rooms
// that happens to be. This is the auto-divide fallback for a floor with no
// screens configured yet; getScreenQueue below is the one that actually
// answers "where is the patient standing" (an admin-assigned, fixed room
// list) — use that once the floor's screens exist in Settings → TV Boards.
//
// Column order is stable (room number, then doctor) so a given doctor is always
// in the same place on the same TV; which doctor is active in a shared room
// still comes from the timetable in real time.
export async function getFloorQueue(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { floorId } = req.query
    if (!floorId) return res.status(400).json({ success: false, error: 'floorId is required' })

    healTodaysQueue(ORG_ID) // same fire-and-forget self-heal as the other board reads

    const floor = await db.floor.findFirst({ where: { id: floorId, organizationId: ORG_ID }, select: { id: true, name: true } })
    if (!floor) return res.status(404).json({ success: false, error: 'Floor not found' })

    const floorRooms = await db.room.findMany({ where: { organizationId: ORG_ID, floorId }, include: ROOM_INCLUDE })
    floorRooms.sort((a, b) => (Number(a.roomNumber) || 0) - (Number(b.roomNumber) || 0) || String(a.roomNumber).localeCompare(String(b.roomNumber)))

    // Only OPEN rooms by default — a floor may have 90 rooms but only a dozen
    // with a doctor sitting. `?includeClosed=1` shows every room.
    const includeClosed = req.query.includeClosed === '1'
    const isOpen = (room) => { const a = toRoomDTO(room).activeDoctor; return !a.unassigned && !a.onBreak }
    const openRooms = includeClosed ? floorRooms : floorRooms.filter(isOpen)

    const allColumns = await buildRoomColumns(ORG_ID, openRooms, { includeIdle: includeClosed })

    // Slice the COLUMNS (doctors) across this floor's TVs.
    const screens = Math.max(1, Math.min(30, Number(req.query.screens) || 1))
    const screen = Math.max(1, Math.min(screens, Number(req.query.screen) || 1))
    const totalColumns = allColumns.length
    const base = Math.floor(totalColumns / screens)
    const extra = totalColumns % screens
    const startIdx = (screen - 1) * base + Math.min(screen - 1, extra)
    const take = base + (screen <= extra ? 1 : 0)
    const visible = allColumns.slice(startIdx, startIdx + take)

    // Hydrate ONLY the visible slice — the expensive part, run only on what
    // this TV actually renders.
    const columns = await hydrateColumns(visible)

    res.json({ success: true, data: { floor, screen, screens, totalColumns, columns, announce: await announceSettings(ORG_ID) } })
  } catch (err) { next(err) }
}

/**
 * The hospital's board settings — what the display SHOWS (`display*`) and what
 * it SAYS (`announce*`).
 *
 * Sent with the queue it already fetches rather than as a second request, so a
 * wall display still makes exactly one call per refresh.
 *
 * ONLY those two prefixes, never the whole settings blob: a display board is a
 * public screen in a corridor and the rest of that object — GST number, refund
 * policy, API keys — is nobody's business out there. Defaults are NOT applied
 * here; they are declared once in src/lib/orgSettingsSchema.js and applied by
 * the caller, so the board and the Settings form can never disagree about what
 * "unset" means.
 */
const BOARD_SETTING_PREFIXES = ['announce', 'display']

async function announceSettings(organizationId) {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
  let stored = {}
  try { stored = JSON.parse(org?.settings || '{}') } catch { stored = {} }
  return Object.fromEntries(
    Object.entries(stored).filter(([k]) => BOARD_SETTING_PREFIXES.some((p) => k.startsWith(p))),
  )
}

// GET /api/display/screen-queue?screenId= — the room-based counterpart to
// getFloorQueue above: instead of evenly slicing a whole floor's columns
// across N TVs, this reads the EXACT rooms an admin dragged onto this one
// screen (Settings → TV Boards). A room's physical location never changes,
// so whichever doctor the timetable puts there today is automatically on the
// right wall — nobody has to re-map anything when a doctor's shift or room
// changes. See DisplayScreen in schema.prisma.
export async function getScreenQueue(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { screenId } = req.query
    if (!screenId) return res.status(400).json({ success: false, error: 'screenId is required' })

    healTodaysQueue(ORG_ID)

    const displayScreen = await db.displayScreen.findFirst({
      where: { id: screenId, organizationId: ORG_ID },
      select: {
        id: true, name: true, maxDoctors: true, sliderSpeedSeconds: true, announcementText: true,
        rooms: { select: { id: true } },
      },
    })
    if (!displayScreen) return res.status(404).json({ success: false, error: 'Screen not found' })

    const roomIds = displayScreen.rooms.map((r) => r.id)
    const rawRooms = roomIds.length
      ? await db.room.findMany({ where: { id: { in: roomIds }, organizationId: ORG_ID }, include: ROOM_INCLUDE })
      : []
    rawRooms.sort((a, b) => (Number(a.roomNumber) || 0) - (Number(b.roomNumber) || 0) || String(a.roomNumber).localeCompare(String(b.roomNumber)))

    // Same "only rooms with someone actually sitting there" rule as
    // getFloorQueue, so a room the admin assigned to this screen but nobody
    // is in right now doesn't sit on the board as a dead, doctor-less column.
    const includeClosed = req.query.includeClosed === '1'
    const isOpen = (room) => { const a = toRoomDTO(room).activeDoctor; return !a.unassigned && !a.onBreak }
    const rooms = includeClosed ? rawRooms : rawRooms.filter(isOpen)

    const allColumns = await buildRoomColumns(ORG_ID, rooms, { includeIdle: includeClosed })
    const columns = await hydrateColumns(allColumns) // curated by an admin, not a whole floor — hydrate all of it

    res.json({
      success: true,
      data: {
        screen: {
          id: displayScreen.id,
          name: displayScreen.name,
          maxDoctors: displayScreen.maxDoctors,
          sliderSpeedSeconds: displayScreen.sliderSpeedSeconds,
          announcementText: displayScreen.announcementText,
        },
        announce: await announceSettings(ORG_ID),
        totalColumns: columns.length,
        columns,
      },
    })
  } catch (err) { next(err) }
}

// GET /api/display/queue?roomId= — the live feed one display-board room
// card/detail view polls (recommended: every 3s, matching the pattern real
// hospital queue boards use — see the project's queue research notes).
export async function getRoomQueue(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { roomId } = req.query
    if (!roomId) return res.status(400).json({ success: false, error: 'roomId is required' })

    const room = await db.room.findFirst({ where: { id: roomId, organizationId: ORG_ID }, include: ROOM_INCLUDE })
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' })

    const roomDTO = toRoomDTO(room)

    // A wall board must never fetch the whole queue. A busy clinic runs to
    // hundreds of patients per doctor a day; fetching them all — with each
    // one's patient + two doctor relations — measured at 4.3s and a 2.3 MB
    // payload PER 3-second poll, longer than the poll interval itself. And
    // nobody in the room reads past the next handful of names anyway.
    //
    // So: exact counts come from a cheap grouped count, and only the first
    // FETCH_LIMIT rows are hydrated for display. FETCH_LIMIT is generous enough
    // that, across the two or three doctors who might share a room, each one's
    // next several patients are present (rows interleave by appointment time),
    // while the per-doctor list the UI renders is capped much lower.
    const FETCH_LIMIT = 120
    const baseWhere = { organizationId: ORG_ID, roomId, status: { in: [...WAITING_STATUSES, 'in_progress'] }, joinedQueueAt: todayRange() }

    const [entries, waitingTotal] = await Promise.all([
      db.queueManagement.findMany({
        where: baseWhere,
        take: FETCH_LIMIT,
        include: {
          patient: { select: { ...PATIENT_NAME_SELECT, mrn: true } },
          followUpDoctor: { select: DOCTOR_SELECT },
          // The appointment's own doctor — this is who the patient actually
          // came to see, and so who they must be listed under.
          assignedTo: { select: DOCTOR_SELECT },
        },
        orderBy: QUEUE_ORDER_BY,
      }),
      // Exact "N waiting" per booked doctor, over the WHOLE queue, not just the
      // hydrated slice. COALESCE(followUp, assigned) mirrors bookedDoctorId; a
      // true walk-in (both null) counts under the active doctor, added below.
      db.$queryRaw`
        SELECT COALESCE("followUpDoctorId", "assignedToId") AS doctor_id, COUNT(*)::int AS n
        FROM "QueueManagement"
        WHERE "organizationId" = ${ORG_ID} AND "roomId" = ${roomId}
          AND status IN ('waiting', 'called')
          AND "joinedQueueAt" >= ${todayRange().gte} AND "joinedQueueAt" <= ${todayRange().lte}
        GROUP BY 1`,
    ])
    const waitingCountByDoctor = new Map(waitingTotal.map((r) => [r.doctor_id, r.n]))

    // Two or three doctors can consult in one room at once, so "who is being
    // seen" is a LIST, not a single patient — grouped per doctor below. The
    // first is still exposed as `inProgress` for the wall board's hero panel.
    const inProgressEntries = entries.filter((e) => e.status === 'in_progress')
    const inProgressEntry = inProgressEntries[0] || null
    const waitingEntries = entries.filter((e) => e.status !== 'in_progress')

    const toPatientDTO = (e) => ({
      queueEntryId: e.id,
      name: patientFullName(e.patient) || '—',
      uhid: e.patient?.mrn || '—',
      visitType: e.visitType,
      followUpDoctorId: e.followUpDoctorId,
      followUpDoctorName: e.followUpDoctor?.fullName || null,
      // Used as the group's display name when the doctor a patient is booked
      // with isn't in this room's doctorLinks index.
      assignedToName: e.assignedTo?.fullName || null,
      // 'called' means a member of staff has DELIBERATELY alerted this patient.
      // The board only shows "you are next" for that — never inferred from
      // position, so the message on the wall is always something a human chose
      // to put there.
      alerted: e.status === 'called',
      // For hospitals that announce the token rather than the name — a name
      // spoken over hall speakers reaches further than the same name on screen.
      token: e.queueNumber || null,
    })

    const inProgress = inProgressEntry ? {
      ...toPatientDTO(inProgressEntry),
      prescriptionUploaded: !!inProgressEntry.prescriptionUploadedAt,
    } : null

    // Grouping rules (who each patient is waiting for) live in
    // lib/queueGrouping.js so they're unit-testable without a clock or a DB.
    const todayName = DAY_NAMES[nowInZone().dayOfWeek]
    const todayShiftFor = (docId) => roomDTO.schedule.find((s) => s.doctorId === docId && s.dayName === todayName)

    const activeId = roomDTO.activeDoctor.doctorId
    const hasShiftToday = (docId) => Boolean(todayShiftFor(docId))
    const byDoctor = groupWaitingByDoctor(waitingEntries, { activeDoctorId: activeId, hasShiftToday })

    // The in-progress patients grouped the SAME way, so each doctor's console
    // shows the patient THAT doctor is currently seeing — not the room's first.
    const inProgressByDoctor = groupInProgressByDoctor(inProgressEntries, { activeDoctorId: activeId, hasShiftToday })

    // A doctor may have someone in progress but nobody waiting, so the groups
    // are keyed by the union of both maps — otherwise their console vanishes
    // the moment their queue empties, mid-consultation.
    const groupIds = new Set([...byDoctor.keys(), ...inProgressByDoctor.keys()])
    const waitingGroups = Array.from(groupIds).map((doctorId) => {
      const entries = byDoctor.get(doctorId) || []
      const patients = entries.map(toPatientDTO)
      const link = roomDTO.doctorLinks.find((l) => l.doctorId === doctorId)
      const inProgEntry = inProgressByDoctor.get(doctorId) || null
      const todayShift = todayShiftFor(doctorId)
      return {
        doctorId,
        doctorName: link?.doctorName || patients[0]?.followUpDoctorName || patients[0]?.assignedToName
          || (inProgEntry ? (inProgEntry.followUpDoctor?.fullName || inProgEntry.assignedTo?.fullName) : null) || 'Unassigned',
        active: doctorId === activeId,
        // This doctor's current consultation (or null) — powers their console's
        // "finish & call next" and the per-doctor NOW SERVING card.
        inProgress: inProgEntry ? { ...toPatientDTO(inProgEntry), prescriptionUploaded: !!inProgEntry.prescriptionUploadedAt } : null,
        // The raw "HH:mm" shift start, NOT a finished sentence. This used to be
        // pre-formatted here as `today from ${start}`, which shipped a 24-hour
        // time ("today from 14:00") straight onto a board where every other
        // time reads as 12-hour — the server has no 12-hour formatter and
        // adding one would be a second copy of the frontend's.
        //
        // Times cross the wire in the stored 24h form and are converted once,
        // at the point of display (lib/format.js#formatTime12h). Only ever
        // TODAY's shift — never another weekday.
        shiftStart: doctorId === activeId ? null : (todayShift?.start ?? null),
        // The TRUE number waiting for this doctor (whole queue), not the length
        // of the hydrated slice. Walk-ins (COALESCE key null) fold into the
        // active doctor, matching how they're grouped for display.
        waitingCount: (waitingCountByDoctor.get(doctorId) || 0)
          + (doctorId === activeId ? (waitingCountByDoctor.get(null) || 0) : 0),
        // Only the first several are shipped — the wall shows the next few, not
        // patient #347. The count above is the real total.
        patients: patients.slice(0, 12),
      }
    }).sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1))

    res.json({
      success: true,
      data: {
        room: { id: room.id, roomNumber: room.roomNumber, sittingType: room.sittingType, floor: roomDTO.floor, department: roomDTO.department },
        activeDoctor: roomDTO.activeDoctor,
        // Lets the room screen say WHEN, instead of the old catch-all "On break".
        nextSession: roomDTO.nextSession,
        inProgress,
        // Every current consultation in the room (one per doctor). The wall
        // board shows all of them; a single-doctor room just has one.
        inProgressList: inProgressEntries.map((e) => ({ ...toPatientDTO(e), prescriptionUploaded: !!e.prescriptionUploadedAt })),
        waitingGroups,
        announce: await announceSettings(ORG_ID),
      },
    })
  } catch (err) { next(err) }
}
