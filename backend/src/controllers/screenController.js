// Display Boards admin panel — CRUD for DisplayScreen, the drag-and-drop
// room-to-screen mapping the client sketched. A screen owns a set of ROOMS
// (not doctors): whichever doctor is timetabled into a room today shows up
// on that room's screen automatically, so this panel only ever has to be
// touched when a TV moves or a room is added — not every time a doctor's
// shift changes. See lib/queueGrouping.js / displayController.getFloorQueue
// for how a room's live queue turns into a screen's column.

import { db } from '../config/db.js'
import { z } from 'zod'
import { getOrgId } from '../lib/reqContext.js'

// Floor comes along so the admin panel can group screens by floor (a screen's
// rooms are, in practice, always on the same floor — see DisplayBoardsModule).
const SCREEN_ROOM_SELECT = { id: true, roomNumber: true, floor: { select: { id: true, name: true, sortOrder: true } } }

/** roomNumber is a string column — sorts "1","10","11",..."2" alphabetically
 * otherwise. Same fix used everywhere else a room list is shown. */
function sortRoomsNumerically(rooms) {
  return [...rooms].sort((a, b) => (Number(a.roomNumber) || 0) - (Number(b.roomNumber) || 0) || String(a.roomNumber).localeCompare(String(b.roomNumber)))
}

const screenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  maxDoctors: z.coerce.number().int().min(1).max(20).default(5),
  sliderSpeedSeconds: z.coerce.number().int().min(5).max(300).default(30),
  announcementText: z.string().trim().max(500).nullable().optional(),
  roomIds: z.array(z.string()).default([]),
})

// GET /api/screens
export async function getScreens(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const screens = await db.displayScreen.findMany({
      where: { organizationId: ORG_ID },
      include: { rooms: { select: SCREEN_ROOM_SELECT } },
      orderBy: { createdAt: 'asc' },
    })
    for (const s of screens) s.rooms = sortRoomsNumerically(s.rooms)
    res.json({ success: true, data: screens })
  } catch (err) { next(err) }
}

// GET /api/screens/rooms/all — every room in the org, for the drag-and-drop
// panel's "Available Rooms" column (it filters out ones already on THIS
// screen client-side; a room already on ANOTHER screen still appears here —
// dragging it into a new screen just moves it, same as re-cabling a TV).
export async function getAllRoomsForScreens(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const rooms = await db.room.findMany({
      where: { organizationId: ORG_ID },
      select: { id: true, roomNumber: true, displayScreenId: true, floor: { select: { id: true, name: true, sortOrder: true } } },
    })
    // roomNumber is a string column — Postgres would sort it alphabetically
    // ("1", "10", "11", ... "2"), not numerically. Same fix as the wall
    // board's own room sort (displayController.js).
    rooms.sort((a, b) =>
      (a.floor?.sortOrder ?? 0) - (b.floor?.sortOrder ?? 0)
      || (Number(a.roomNumber) || 0) - (Number(b.roomNumber) || 0)
      || String(a.roomNumber).localeCompare(String(b.roomNumber)))
    res.json({ success: true, data: rooms })
  } catch (err) { next(err) }
}

// POST /api/screens
export async function createScreen(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const data = screenSchema.parse(req.body)

    if (data.roomIds.length) {
      const owned = await db.room.count({ where: { id: { in: data.roomIds }, organizationId: ORG_ID } })
      if (owned !== data.roomIds.length) return res.status(400).json({ success: false, error: 'One or more rooms were not found' })
    }

    const screen = await db.$transaction(async (tx) => {
      const created = await tx.displayScreen.create({
        data: {
          organizationId: ORG_ID,
          name: data.name,
          maxDoctors: data.maxDoctors,
          sliderSpeedSeconds: data.sliderSpeedSeconds,
          announcementText: data.announcementText || null,
        },
      })
      if (data.roomIds.length) {
        await tx.room.updateMany({ where: { id: { in: data.roomIds }, organizationId: ORG_ID }, data: { displayScreenId: created.id } })
      }
      return tx.displayScreen.findUnique({ where: { id: created.id }, include: { rooms: { select: SCREEN_ROOM_SELECT } } })
    })

    res.status(201).json({ success: true, data: screen })
  } catch (err) { next(err) }
}

// PUT /api/screens/:id — replaces the room set wholesale (the panel always
// sends the full roomIds list, not a diff): rooms removed from the list are
// released back to "unassigned", rooms added are claimed from wherever they
// were before.
export async function updateScreen(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params
    const data = screenSchema.parse(req.body)

    const existing = await db.displayScreen.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Screen not found' })

    if (data.roomIds.length) {
      const owned = await db.room.count({ where: { id: { in: data.roomIds }, organizationId: ORG_ID } })
      if (owned !== data.roomIds.length) return res.status(400).json({ success: false, error: 'One or more rooms were not found' })
    }

    const screen = await db.$transaction(async (tx) => {
      await tx.displayScreen.update({
        where: { id },
        data: {
          name: data.name,
          maxDoctors: data.maxDoctors,
          sliderSpeedSeconds: data.sliderSpeedSeconds,
          announcementText: data.announcementText || null,
        },
      })
      // Release every room this screen currently owns, then re-claim exactly
      // the submitted set — simplest correct way to apply drag-and-drop's
      // "remove" side without a separate diff.
      await tx.room.updateMany({ where: { displayScreenId: id }, data: { displayScreenId: null } })
      if (data.roomIds.length) {
        await tx.room.updateMany({ where: { id: { in: data.roomIds }, organizationId: ORG_ID }, data: { displayScreenId: id } })
      }
      return tx.displayScreen.findUnique({ where: { id }, include: { rooms: { select: SCREEN_ROOM_SELECT } } })
    })

    res.json({ success: true, data: screen })
  } catch (err) { next(err) }
}

// DELETE /api/screens/:id — rooms on it fall back to unassigned (their
// displayScreenId FK is nullable and ON DELETE SET NULL), not deleted.
export async function deleteScreen(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params
    const existing = await db.displayScreen.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Screen not found' })
    await db.displayScreen.delete({ where: { id } })
    res.json({ success: true })
  } catch (err) { next(err) }
}
