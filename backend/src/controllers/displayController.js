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
import { resolveActiveDoctor } from '../lib/activeDoctor.js'
import { toRoomDTO, ROOM_INCLUDE, DOCTOR_SELECT } from './roomController.js'
import { todayRange, nowInZone } from '../lib/dates.js'
import { DAY_NAMES } from '../lib/doctorTimetable.js'
import { groupWaitingByDoctor } from '../lib/queueGrouping.js'
import { syncAppointmentsToQueue } from '../lib/queueSync.js'
import { ymdInZone } from '../lib/dates.js'

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

    const entries = await db.queueManagement.findMany({
      where: { organizationId: ORG_ID, roomId, status: { in: [...WAITING_STATUSES, 'in_progress'] }, joinedQueueAt: todayRange() },
      include: {
        patient: { select: { firstName: true, lastName: true, mrn: true } },
        followUpDoctor: { select: DOCTOR_SELECT },
        // The appointment's own doctor — this is who the patient actually
        // came to see, and so who they must be listed under.
        assignedTo: { select: DOCTOR_SELECT },
      },
      orderBy: [{ priorityRank: 'desc' }, { joinedQueueAt: 'asc' }],
    })

    const inProgressEntry = entries.find((e) => e.status === 'in_progress') || null
    const waitingEntries = entries.filter((e) => e.status !== 'in_progress')

    const toPatientDTO = (e) => ({
      queueEntryId: e.id,
      name: `${e.patient?.firstName || ''} ${e.patient?.lastName || ''}`.trim() || '—',
      uhid: e.patient?.mrn || '—',
      visitType: e.visitType,
      followUpDoctorId: e.followUpDoctorId,
      followUpDoctorName: e.followUpDoctor?.fullName || null,
      // Used as the group's display name when the doctor a patient is booked
      // with isn't in this room's doctorLinks index.
      assignedToName: e.assignedTo?.fullName || null,
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
    const byDoctor = groupWaitingByDoctor(waitingEntries, {
      activeDoctorId: activeId,
      hasShiftToday: (docId) => Boolean(todayShiftFor(docId)),
    })
    const waitingGroups = Array.from(byDoctor.entries()).map(([doctorId, entries]) => {
      const patients = entries.map(toPatientDTO)
      const link = roomDTO.doctorLinks.find((l) => l.doctorId === doctorId)
      const todayShift = todayShiftFor(doctorId)
      return {
        doctorId,
        doctorName: link?.doctorName || patients[0]?.followUpDoctorName || patients[0]?.assignedToName || 'Unassigned',
        active: doctorId === activeId,
        // Only ever a TODAY note — never another weekday.
        scheduleNote: doctorId === activeId ? 'active now' : (todayShift ? `today from ${todayShift.start}` : null),
        patients,
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
        waitingGroups,
      },
    })
  } catch (err) { next(err) }
}
