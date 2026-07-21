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
import { PATIENT_NAME_SELECT, patientFullName } from '../lib/patientName.js'

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
        // createdAt as the final tiebreak so tied (priorityRank, joinedQueueAt)
        // rows keep a stable order — the public board must not reshuffle the same
        // patients between 3-second polls. Matches queueController's ORDER BY.
        orderBy: [{ priorityRank: 'desc' }, { joinedQueueAt: 'asc' }, { createdAt: 'asc' }],
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
    const inProgressByDoctor = new Map()
    for (const e of inProgressEntries) {
      const bookedWith = e.followUpDoctorId || e.assignedToId || null
      const hereToday = bookedWith && (bookedWith === activeId || hasShiftToday(bookedWith))
      const key = hereToday ? bookedWith : (activeId || 'unassigned')
      inProgressByDoctor.set(key, e) // one consult per doctor at a time
    }

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
      },
    })
  } catch (err) { next(err) }
}
