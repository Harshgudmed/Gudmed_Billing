import { z } from 'zod'
import { db } from '../config/db.js'
import { getOrgId, getActor } from '../lib/reqContext.js'
import { resolveActiveDoctor, otherConcurrentDoctors, nextSessionForRoom } from '../lib/activeDoctor.js'
import { parseTimetable, shiftsForRoom } from '../lib/doctorTimetable.js'

export const DOCTOR_SELECT = { id: true, fullName: true, preferences: true }

// Builds the room's DTO straight from each candidate doctor's OWN timetable —
// there is no separate "schedule" row to read. DoctorRoomAssignment (room.
// doctorLinks) is just the fast index of "who might be active here", kept in
// sync whenever a doctor saves their timetable (doctorAccountabilityController.js).
export function toRoomDTO(room) {
  const candidates = room.doctorLinks.map((l) => ({
    doctorId: l.doctorId,
    doctorName: l.doctor.fullName,
    timetable: parseTimetable(l.doctor.preferences),
  }))

  const schedule = candidates.flatMap((d) =>
    shiftsForRoom(d.timetable, room.id).map((s) => ({ doctorId: d.doctorId, doctorName: d.doctorName, ...s }))
  )

  const override = room.overrideDoctorId
    ? { doctorId: room.overrideDoctorId, doctorName: room.overrideDoctor?.fullName, setAt: room.overrideSetAt, setBy: room.overrideSetBy?.fullName }
    : null

  const activeOverrideOpt = override ? { doctorId: override.doctorId, doctorName: override.doctorName } : null
  const shiftCandidates = candidates.map(({ doctorId, doctorName, timetable }) => ({ doctorId, doctorName, timetable }))
  const active = resolveActiveDoctor(room.id, shiftCandidates, { override: activeOverrideOpt })

  // Who ELSE is genuinely scheduled in this room at this exact moment — not
  // "everyone who has ever had a shift here." Shared-room shifts are
  // non-overlapping by design, so this is normally empty; a display board
  // should only ever show "N doctors sitting here" when they are truly
  // concurrent, not list every doctor who takes a turn at a different hour.
  const otherActiveDoctors = otherConcurrentDoctors(room.id, shiftCandidates, { override: activeOverrideOpt, activeDoctorId: active.doctorId })

  // "Nobody here right now" is not one state — the session may not have started,
  // may have ended, may be a lunch gap, the clinic may be shut for the day, or
  // the doctor may be on leave. The board said "On break" for all of them, which
  // reads as "back shortly" and answers none of them. A patient wants one thing:
  // how long. Only computed when there IS nobody, so an occupied room costs
  // nothing.
  const nextSession = (active.doctorId || active.unassigned)
    ? null
    : nextSessionForRoom(room.id, shiftCandidates)

  return {
    id: room.id,
    roomNumber: room.roomNumber,
    sittingType: room.sittingType,
    floor: room.floor ? { id: room.floor.id, name: room.floor.name } : null,
    department: room.department ? { id: room.department.id, name: room.department.name, code: room.department.code } : null,
    doctorLinks: candidates.map(({ doctorId, doctorName }) => ({ doctorId, doctorName })),
    schedule, // read-only, derived — edited via Doctor Accountability → Timetable, not here
    override,
    activeDoctor: active,
    otherActiveDoctors,
    nextSession, // null when someone is here, or when no doctor is linked at all
  }
}

export const ROOM_INCLUDE = {
  floor: { select: { id: true, name: true } },
  department: { select: { id: true, name: true, code: true } },
  doctorLinks: { include: { doctor: { select: DOCTOR_SELECT } } },
  overrideDoctor: { select: DOCTOR_SELECT },
  overrideSetBy: { select: DOCTOR_SELECT },
}

// ---------- Floors ----------

export async function getFloors(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const floors = await db.floor.findMany({
      where: { organizationId: ORG_ID },
      include: { _count: { select: { rooms: true } } },
      orderBy: { sortOrder: 'asc' },
    })
    res.json({ success: true, data: floors.map((f) => ({ id: f.id, name: f.name, roomCount: f._count.rooms })) })
  } catch (err) { next(err) }
}

export async function createFloor(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
    // New floors go to the end of the display order by default — an admin
    // reordering floors is a future UI concern, not something to guess here.
    const last = await db.floor.findFirst({ where: { organizationId: ORG_ID }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const floor = await db.floor.create({ data: { organizationId: ORG_ID, name, sortOrder: (last?.sortOrder ?? -1) + 1 } })
    res.status(201).json({ success: true, data: floor })
  } catch (err) { next(err) }
}

export async function deleteFloor(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params
    const floor = await db.floor.findFirst({ where: { id, organizationId: ORG_ID }, include: { _count: { select: { rooms: true } } } })
    if (!floor) return res.status(404).json({ success: false, error: 'Floor not found' })
    // Room.floorId cascades on delete — block instead of silently wiping every
    // room on this floor along with it.
    if (floor._count.rooms > 0) {
      return res.status(409).json({ success: false, error: `Move or delete the ${floor._count.rooms} room(s) on this floor first` })
    }
    await db.floor.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) { next(err) }
}

// ---------- Rooms ----------

export async function getRooms(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { floorId, departmentId } = req.query
    const where = { organizationId: ORG_ID }
    if (floorId) where.floorId = floorId
    if (departmentId) where.departmentId = departmentId

    const rooms = await db.room.findMany({ where, include: ROOM_INCLUDE, orderBy: { roomNumber: 'asc' } })
    res.json({ success: true, data: rooms.map(toRoomDTO) })
  } catch (err) { next(err) }
}

// GET /api/rooms/picker-list — minimal fields for the Timetable's per-shift
// room picker (Floor → Department → Room). No activeDoctor/schedule
// computation here — that's not needed to just pick a room, and skipping it
// keeps this fast even with hundreds of rooms.
export async function getRoomsPickerList(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const rooms = await db.room.findMany({
      where: { organizationId: ORG_ID },
      select: {
        id: true, roomNumber: true, sittingType: true,
        floor: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        _count: { select: { doctorLinks: true } },
      },
      orderBy: [{ floor: { name: 'asc' } }, { roomNumber: 'asc' }],
    })
    res.json({ success: true, data: rooms })
  } catch (err) { next(err) }
}

export async function getRoom(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params
    const room = await db.room.findFirst({ where: { id, organizationId: ORG_ID }, include: ROOM_INCLUDE })
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' })
    res.json({ success: true, data: toRoomDTO(room) })
  } catch (err) { next(err) }
}

// Suggests the next free room number for a floor, using a per-floor block
// of 100 (1st Floor → 1-100, 2nd → 101-200, 3rd → 201-300, ...) so numbers
// read the way a real hospital's do. Purely a UI suggestion — any number can
// still be typed manually.
export async function suggestRoomNumber(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { floorId } = req.query
    if (!floorId) return res.status(400).json({ success: false, error: 'floorId is required' })

    const floors = await db.floor.findMany({ where: { organizationId: ORG_ID }, orderBy: { sortOrder: 'asc' }, select: { id: true } })
    const floorIndex = floors.findIndex((f) => f.id === floorId)
    if (floorIndex === -1) return res.status(404).json({ success: false, error: 'Floor not found' })

    // A floor's block is its OWN number, the way every building numbers rooms:
    // 1st floor is the 100s, 2nd the 200s, 3rd the 300s. `sortOrder` puts the
    // ground floor first, so it is index 0 and takes 1-99 (there is no room 0).
    // This was `(floorIndex + 1) * 100`, which shifted every floor up by one and
    // put rooms 300-399 on the 2nd floor.
    const blockStart = floorIndex === 0 ? 1 : floorIndex * 100
    const blockEnd = floorIndex === 0 ? 99 : blockStart + 99
    const roomsOnFloor = await db.room.findMany({ where: { organizationId: ORG_ID, floorId }, select: { roomNumber: true } })
    const used = new Set(roomsOnFloor.map((r) => Number(r.roomNumber)).filter(Number.isFinite))

    let suggestion = blockStart
    while (used.has(suggestion)) suggestion++
    res.json({ success: true, data: { suggested: String(suggestion), blockStart, blockEnd } })
  } catch (err) { next(err) }
}

const roomSchema = z.object({
  roomNumber: z.string().min(1),
  floorId: z.string(),
  departmentId: z.string().optional().nullable(),
  sittingType: z.enum(['single', 'multiple']).default('single'),
})

export async function createRoom(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const data = roomSchema.parse(req.body)
    const floor = await db.floor.findFirst({ where: { id: data.floorId, organizationId: ORG_ID }, select: { id: true } })
    if (!floor) return res.status(400).json({ success: false, error: 'Floor not found' })
    if (data.departmentId) {
      const dept = await db.department.findFirst({ where: { id: data.departmentId, organizationId: ORG_ID }, select: { id: true } })
      if (!dept) return res.status(400).json({ success: false, error: 'Department not found' })
    }
    const room = await db.room.create({
      data: { organizationId: ORG_ID, roomNumber: data.roomNumber, floorId: data.floorId, departmentId: data.departmentId || null, sittingType: data.sittingType },
      include: ROOM_INCLUDE,
    })
    res.status(201).json({ success: true, data: toRoomDTO(room) })
  } catch (err) {
    // Room_organizationId_floorId_roomNumber_key
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'A room with this number already exists on this floor' })
    next(err)
  }
}

const roomUpdateSchema = z.object({
  roomNumber: z.string().min(1).optional(),
  floorId: z.string().optional(),
  departmentId: z.string().nullable().optional(),
  // Cosmetic label only now — resolution no longer branches on it, so
  // switching it doesn't need to validate or clear anything.
  sittingType: z.enum(['single', 'multiple']).optional(),
})

export async function updateRoom(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params
    const data = roomUpdateSchema.parse(req.body)
    const existing = await db.room.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Room not found' })

    const room = await db.room.update({ where: { id }, data, include: ROOM_INCLUDE })
    res.json({ success: true, data: toRoomDTO(room) })
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'A room with this number already exists on this floor' })
    next(err)
  }
}

export async function deleteRoom(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params
    const existing = await db.room.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Room not found' })
    // doctorLinks is this room's OWN child index (onDelete: Cascade on
    // roomId) — deleting it along with the room is correct. Any doctor whose
    // timetable still points a shift at this (now-gone) room simply resolves
    // to nothing for that shift on their next save/view — not a dangling FK.
    await db.room.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) { next(err) }
}

// ---------- Override (absent-doctor case) ----------

export async function setOverride(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id: roomId } = req.params
    const { doctorId, expectedOverrideSetAt } = z.object({
      doctorId: z.string(),
      // Guards against a stale UI clobbering a colleague's more recent
      // override (or vice versa) — the room's overrideSetAt at the moment
      // this staff member's screen last loaded it. Optional so existing
      // clients that don't send it still work (no guard, old behavior).
      expectedOverrideSetAt: z.string().nullable().optional(),
    }).parse(req.body)
    const actor = getActor(req)

    const room = await db.room.findFirst({ where: { id: roomId, organizationId: ORG_ID }, select: { id: true, overrideSetAt: true } })
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' })
    // The override doctor need not have any shift pointing at this room (a
    // covering doctor from elsewhere is a valid real scenario) — just confirm
    // they exist, belong to this org, and actually hold the doctor role.
    const doctor = await db.user.findFirst({ where: { id: doctorId, organizationId: ORG_ID }, select: { id: true, role: true } })
    if (!doctor) return res.status(400).json({ success: false, error: 'Doctor not found' })
    if (doctor.role !== 'doctor') return res.status(400).json({ success: false, error: 'Only users with the doctor role can cover a room' })

    if (expectedOverrideSetAt !== undefined) {
      const expected = expectedOverrideSetAt ? new Date(expectedOverrideSetAt).getTime() : null
      const actual = room.overrideSetAt ? room.overrideSetAt.getTime() : null
      if (expected !== actual) {
        return res.status(409).json({ success: false, code: 'STALE_OVERRIDE', error: 'This room\'s covering doctor was just changed by someone else — reload and try again' })
      }
    }

    const updated = await db.room.update({
      where: { id: roomId },
      data: { overrideDoctorId: doctorId, overrideSetAt: new Date(), overrideSetById: actor.id },
      include: ROOM_INCLUDE,
    })
    res.json({ success: true, data: toRoomDTO(updated) })
  } catch (err) { next(err) }
}

export async function clearOverride(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id: roomId } = req.params
    const { expectedOverrideSetAt } = z.object({
      expectedOverrideSetAt: z.string().nullable().optional(),
    }).parse(req.body || {})
    const room = await db.room.findFirst({ where: { id: roomId, organizationId: ORG_ID }, select: { id: true, overrideSetAt: true } })
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' })

    if (expectedOverrideSetAt !== undefined) {
      const expected = expectedOverrideSetAt ? new Date(expectedOverrideSetAt).getTime() : null
      const actual = room.overrideSetAt ? room.overrideSetAt.getTime() : null
      if (expected !== actual) {
        return res.status(409).json({ success: false, code: 'STALE_OVERRIDE', error: 'This room\'s covering doctor was just changed by someone else — reload and try again' })
      }
    }

    const updated = await db.room.update({
      where: { id: roomId },
      data: { overrideDoctorId: null, overrideSetAt: null, overrideSetById: null },
      include: ROOM_INCLUDE,
    })
    res.json({ success: true, data: toRoomDTO(updated) })
  } catch (err) { next(err) }
}
