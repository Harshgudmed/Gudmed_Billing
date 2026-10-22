// Bulk room setup: one sheet of Floor / Room / Department / Sitting Type /
// Doctor / Days / Times that creates floors and rooms and adds doctor shifts
// to their timetables.
//
// Doctors go into the TIMETABLE (User.preferences JSON), not just a
// DoctorRoomAssignment row — that table is a derived cache of the timetable,
// and the timetable save deletes any assignment its shifts don't cover. A
// link written on its own would vanish the next time anyone saved that
// doctor's timetable.
//
// Valid rows are saved, failed rows are reported, and anything that already
// exists (floor, room, identical shift) is reused/skipped — so re-uploading
// the same file only adds what's new.

import ExcelJS from 'exceljs'
import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'
import { parseSheet, styleHeader, buildErrorFile, sendWorkbook } from '../lib/bulkSheet.js'
import { parseTimetable, shiftsOnDay, toMinutes } from '../lib/doctorTimetable.js'
import { assertValidShift } from '../lib/activeDoctor.js'
import { normalizeTimeHHMM } from '../lib/dates.js'

const MAX_ROWS = 2000
const MAX_FLOOR_LENGTH = 50
const MAX_ROOM_LENGTH = 20

const HEADER_MAP = {
  'floor':        'floor',
  'room no':      'roomNumber',
  'department':   'department',
  'sitting type': 'sittingType',
  'doctor name':  'doctorName',
  'doctor email': 'doctorEmail',
  'days':         'days',
  'start time':   'startTime',
  'end time':     'endTime',
}
const REQUIRED_HEADERS = ['floor', 'room no']
const DOCTOR_FIELDS = ['doctorName', 'doctorEmail', 'days', 'startTime', 'endTime']

const ROW_COLUMNS = [
  { header: 'Floor',        key: 'floor',       width: 18 },
  { header: 'Room No',      key: 'roomNumber',  width: 10 },
  { header: 'Department',   key: 'department',  width: 20 },
  { header: 'Sitting Type', key: 'sittingType', width: 13 },
  { header: 'Doctor Name',  key: 'doctorName',  width: 22 },
  { header: 'Doctor Email', key: 'doctorEmail', width: 28 },
  { header: 'Days',         key: 'days',        width: 16 },
  { header: 'Start Time',   key: 'startTime',   width: 11 },
  { header: 'End Time',     key: 'endTime',     width: 11 },
]

// Week order for ranges — a clinic's week starts Monday, so "Mon-Sat" is the
// natural range and "Sat-Mon" wraps through Sunday.
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_ALIASES = Object.fromEntries(WEEK.flatMap((d) => [
  [d.toLowerCase(), d], [d.slice(0, 3).toLowerCase(), d],
]))
DAY_ALIASES.tues = 'Tuesday'
DAY_ALIASES.thur = 'Thursday'
DAY_ALIASES.thurs = 'Thursday'

/** "Mon-Sat" | "Mon,Wed,Fri" | "Daily" | "Monday" → ['Monday', ...]; throws on junk. */
export function parseDays(input) {
  const text = String(input).trim().toLowerCase()
  if (text === 'daily' || text === 'all' || text === 'everyday') return [...WEEK]
  const days = new Set()
  for (const part of text.split(/[,/;]+/).map((p) => p.trim()).filter(Boolean)) {
    const range = part.split(/\s*(?:-|–|to)\s*/)
    if (range.length === 2) {
      const a = WEEK.indexOf(DAY_ALIASES[range[0]])
      const b = WEEK.indexOf(DAY_ALIASES[range[1]])
      if (a < 0 || b < 0) throw new Error(`Invalid days "${input}"`)
      for (let i = a; ; i = (i + 1) % 7) { days.add(WEEK[i]); if (i === b) break }
    } else {
      const d = DAY_ALIASES[part]
      if (!d) throw new Error(`Invalid days "${input}"`)
      days.add(d)
    }
  }
  if (days.size === 0) throw new Error('Days is required')
  return WEEK.filter((d) => days.has(d))
}

/** ['Monday'...'Saturday'] → "Mon-Sat"; non-consecutive → "Mon,Wed,Fri". */
export function formatDays(dayNames) {
  const idx = [...new Set(dayNames)].map((d) => WEEK.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b)
  if (idx.length === 7) return 'Daily'
  const runs = []
  let start = idx[0]
  let prev = idx[0]
  for (const i of [...idx.slice(1), null]) {
    if (i === prev + 1) { prev = i; continue }
    const s = WEEK[start].slice(0, 3)
    const e = WEEK[prev].slice(0, 3)
    runs.push(start === prev ? s : prev === start + 1 ? `${s},${e}` : `${s}-${e}`)
    start = prev = i
  }
  return runs.join(',')
}

/** Excel may hand a time cell over as "9:00", "09:00:00" or a day fraction ("0.375"). */
export function normalizeCellTime(value) {
  const v = String(value).trim()
  if (/^\d*\.\d+$/.test(v) || v === '0') {
    const mins = Math.round(Number(v) * 24 * 60)
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  }
  const m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i)
  if (!m) return v
  let h = Number(m[1])
  const ap = m[3]?.toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return normalizeTimeHHMM(`${h}:${m[2]}`)
}

/** "Dr. Ramesh  Patil" → "ramesh patil" — for comparing a typed name to the account. */
function nameKey(name) {
  return String(name || '').replace(/^\s*(dr\.?\s+)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

const overlaps = (a, b) => toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)

// Same block rule as suggestRoomNumber: ground floor 1-99, Nth floor N00-N99.
function floorBlock(floorIndex) {
  const start = floorIndex === 0 ? 1 : floorIndex * 100
  return { start, end: floorIndex === 0 ? 99 : start + 99 }
}

// ── Template ──────────────────────────────────────────────────────────────

export async function downloadRoomSetupTemplate(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const [floors, departments, doctors] = await Promise.all([
      db.floor.findMany({ where: { organizationId: ORG_ID }, orderBy: { sortOrder: 'asc' }, select: { name: true } }),
      db.department.findMany({ where: { organizationId: ORG_ID }, orderBy: { name: 'asc' }, select: { name: true } }),
      db.user.findMany({ where: { organizationId: ORG_ID, role: 'doctor', isActive: true }, orderBy: { fullName: 'asc' }, select: { fullName: true, email: true } }),
    ])

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Setup')
    sheet.columns = ROW_COLUMNS.map((c) => ({
      ...c,
      header: REQUIRED_HEADERS.includes(c.header.toLowerCase()) ? `${c.header} *` : c.header,
    }))
    styleHeader(sheet)
    ;[
      ['Ground Floor', '1',   'General Medicine', 'single',   'Dr. Ramesh Patil', 'ramesh@hospital.com', 'Mon-Sat',     '09:00', '13:00'],
      ['Ground Floor', '1',   'General Medicine', 'single',   'Dr. Anita Shah',   'anita@hospital.com',  'Mon-Sat',     '14:00', '18:00'],
      ['1st Floor',    '101', 'Cardiology',       'multiple', 'Dr. Vikas Rao',    'vikas@hospital.com',  'Mon,Wed,Fri', '10:00', '14:00'],
      ['1st Floor',    '102', 'Cardiology',       'single',   '',                 '',                    '',            '',      ''],
    ].forEach((r) => sheet.addRow(r))
    // Room No and times as text, so Excel doesn't turn "09:00" into 0.375 or drop leading zeros.
    for (const key of ['roomNumber', 'startTime', 'endTime']) sheet.getColumn(key).numFmt = '@'
    for (let r = 2; r <= MAX_ROWS + 1; r++) {
      sheet.getCell(`D${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"single,multiple"'],
        showErrorMessage: true, errorTitle: 'Sitting Type', error: 'Choose single or multiple',
      }
    }

    const lists = workbook.addWorksheet('Lists')
    lists.columns = [
      { header: 'Existing Floors', key: 'floor',  width: 22 },
      { header: 'Departments',     key: 'dept',   width: 26 },
      { header: 'Doctor Name',     key: 'docName', width: 26 },
      { header: 'Doctor Email',    key: 'docEmail', width: 32 },
    ]
    styleHeader(lists)
    const n = Math.max(floors.length, departments.length, doctors.length)
    for (let i = 0; i < n; i++) {
      lists.addRow({
        floor:    floors[i]?.name || '',
        dept:     departments[i]?.name || '',
        docName:  doctors[i]?.fullName || '',
        docEmail: doctors[i]?.email || '',
      })
    }

    const help = workbook.addWorksheet('Instructions')
    help.columns = [{ header: 'Instructions', key: 'text', width: 110 }]
    styleHeader(help)
    ;[
      'One row = one room, or one room + one doctor shift. A room shared by several doctors uses one row per doctor.',
      `Floor * — created if it doesn't exist yet (max ${MAX_FLOOR_LENGTH} characters).`,
      `Room No * — created on that floor if it doesn't exist yet (max ${MAX_ROOM_LENGTH} characters). An existing room is reused unchanged.`,
      'Department — must already exist (see the Lists sheet). A row with an unknown department fails.',
      'Sitting Type — single or multiple. Blank = single. In a single room two doctors cannot have overlapping times.',
      'Doctor Name + Doctor Email — the email identifies the doctor; the name must match that account. Leave all doctor columns blank to create just the room.',
      'Days — Mon-Sat, Mon,Wed,Fri, Daily, or a single day like Tuesday.',
      'Start Time / End Time — 24-hour HH:MM, e.g. 09:00 and 17:30. Start must be before End.',
      'A doctor cannot be in two rooms at overlapping times.',
      'Re-uploading the same file is safe: existing floors, rooms and identical shifts are skipped.',
      `Up to ${MAX_ROWS} rows per file. Delete the example rows before uploading.`,
    ].forEach((text) => help.addRow({ text }))

    await sendWorkbook(res, workbook, 'room_setup_template')
  } catch (err) { next(err) }
}

// ── Import ────────────────────────────────────────────────────────────────

export async function importRoomSetup(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file attached. Please upload an .xlsx or .csv file.' })
    }
    const ORG_ID = getOrgId(req)
    const { headers, rows } = parseSheet(req.file.buffer, HEADER_MAP)

    const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h))
    if (missingHeaders.length) {
      return res.status(400).json({
        success: false,
        error: `Missing required column(s): ${missingHeaders.map((h) => '"' + h + '"').join(', ')}. Download the template for the correct format.`,
      })
    }
    if (rows.length === 0) return res.status(400).json({ success: false, error: 'The file is empty or has no data rows.' })
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({ success: false, error: `Too many rows (${rows.length}). Maximum is ${MAX_ROWS} per file.` })
    }

    const [floors, departments, rooms, doctors] = await Promise.all([
      db.floor.findMany({ where: { organizationId: ORG_ID }, select: { id: true, name: true, sortOrder: true } }),
      db.department.findMany({ where: { organizationId: ORG_ID }, select: { id: true, name: true } }),
      db.room.findMany({ where: { organizationId: ORG_ID }, select: { id: true, floorId: true, roomNumber: true, sittingType: true } }),
      db.user.findMany({
        where: { organizationId: ORG_ID, role: 'doctor', isActive: true },
        select: { id: true, fullName: true, email: true, preferences: true, updatedAt: true },
      }),
    ])

    const floorByKey = new Map(floors.map((f) => [f.name.toLowerCase(), f]))
    const floorNameById = new Map(floors.map((f) => [f.id, f.name.toLowerCase()]))
    const deptByKey = new Map(departments.map((d) => [d.name.toLowerCase(), d]))
    const doctorByEmail = new Map(doctors.map((d) => [d.email.toLowerCase(), d]))
    // Rooms are keyed "floor name (lower)|room number" so rooms that don't exist
    // yet (on floors that don't exist yet) can be planned alongside real ones.
    const roomKeyOf = (floorName, roomNumber) => `${floorName.toLowerCase()}|${roomNumber}`
    const existingRoomByKey = new Map(rooms.map((r) => [roomKeyOf(floorNameById.get(r.floorId), r.roomNumber), r]))
    const roomKeyById = new Map(rooms.map((r) => [r.id, roomKeyOf(floorNameById.get(r.floorId), r.roomNumber)]))

    // Every doctor's current active shifts, per day, with the room as a key —
    // used for duplicate detection and both overlap rules.
    const doctorState = new Map() // doctorId → { doctor, timetable, byDay: {day: [{start,end,roomKey}]}, added: [] }
    const roomDayShifts = new Map() // `${roomKey}|${day}` → [{doctorId,start,end}]
    for (const d of doctors) {
      const timetable = parseTimetable(d.preferences)
      const byDay = {}
      for (const day of WEEK) {
        byDay[day] = shiftsOnDay(timetable, day).filter((s) => s.start && s.end).map((s) => ({
          start: normalizeTimeHHMM(s.start), end: normalizeTimeHHMM(s.end), roomKey: roomKeyById.get(s.roomId) || null,
        }))
        for (const s of byDay[day]) {
          if (!s.roomKey) continue
          const k = `${s.roomKey}|${day}`
          if (!roomDayShifts.has(k)) roomDayShifts.set(k, [])
          roomDayShifts.get(k).push({ doctorId: d.id, start: s.start, end: s.end })
        }
      }
      doctorState.set(d.id, { doctor: d, timetable, byDay, added: [] })
    }

    const newFloors = new Map()  // floor key → { name, firstRow }
    const roomPlan = new Map()   // room key → { floorKey, roomNumber, departmentId, sittingType, firstRow, isNew }
    const failed = []
    const warnings = []
    const rowOutcome = new Map() // rowNumber → 'created' | 'skipped'

    for (const row of rows) {
      const fail = (msg) => failed.push({ ...row, _error: msg })
      const floorName = row.floor || ''
      const roomNumber = row.roomNumber || ''
      const label = `${floorName || '?'} / ${roomNumber || '?'}`
      row._label = label

      // ── Room stage: any failure here fails the whole row ──
      if (!floorName) { fail('Floor is required'); continue }
      if (floorName.length > MAX_FLOOR_LENGTH) { fail(`Floor name too long (max ${MAX_FLOOR_LENGTH} characters)`); continue }
      if (!roomNumber) { fail('Room No is required'); continue }
      if (roomNumber.length > MAX_ROOM_LENGTH) { fail(`Room No too long (max ${MAX_ROOM_LENGTH} characters)`); continue }

      let departmentId = null
      if (row.department) {
        const dept = deptByKey.get(row.department.toLowerCase())
        if (!dept) { fail(`Department "${row.department}" does not exist. Create it in Settings → Departments first.`); continue }
        departmentId = dept.id
      }

      const sittingType = (row.sittingType || 'single').toLowerCase()
      if (sittingType !== 'single' && sittingType !== 'multiple') { fail('Sitting Type must be single or multiple'); continue }

      const floorKey = floorName.toLowerCase()
      const roomKey = roomKeyOf(floorName, roomNumber)
      const existingRoom = existingRoomByKey.get(roomKey)
      let plan = roomPlan.get(roomKey)

      if (!existingRoom && plan && (plan.departmentId !== departmentId || plan.sittingType !== sittingType)) {
        fail(`Conflicts with row ${plan.firstRow} for room ${label} (different department or sitting type)`)
        continue
      }
      if (!plan) {
        plan = {
          floorKey, roomNumber, firstRow: row._rowNumber, isNew: !existingRoom,
          departmentId: existingRoom ? undefined : departmentId,
          sittingType: existingRoom ? existingRoom.sittingType : sittingType,
        }
        roomPlan.set(roomKey, plan)
        if (!floorByKey.has(floorKey) && !newFloors.has(floorKey)) newFloors.set(floorKey, { name: floorName, firstRow: row._rowNumber })
      }
      let outcome = plan.isNew && plan.firstRow === row._rowNumber ? 'created' : 'skipped'

      // ── Doctor stage: failures keep the room, skip only the shift ──
      const hasDoctor = DOCTOR_FIELDS.some((f) => row[f])
      if (hasDoctor) {
        const doctorFail = (msg) => fail(outcome === 'created' ? `Room created; doctor shift skipped: ${msg}` : msg)

        const missing = DOCTOR_FIELDS.filter((f) => !row[f])
        if (missing.length) {
          const names = { doctorName: 'Doctor Name', doctorEmail: 'Doctor Email', days: 'Days', startTime: 'Start Time', endTime: 'End Time' }
          doctorFail(`Missing ${missing.map((f) => names[f]).join(', ')} (all doctor columns are required when a doctor is given)`)
          rowOutcome.set(row._rowNumber, outcome); continue
        }
        const doctor = doctorByEmail.get(row.doctorEmail.toLowerCase())
        if (!doctor) { doctorFail(`No active doctor with email ${row.doctorEmail}`); rowOutcome.set(row._rowNumber, outcome); continue }
        if (nameKey(row.doctorName) !== nameKey(doctor.fullName)) {
          doctorFail(`Doctor name "${row.doctorName}" doesn't match the account for ${row.doctorEmail} (${doctor.fullName})`)
          rowOutcome.set(row._rowNumber, outcome); continue
        }

        let days
        const shift = { start: normalizeCellTime(row.startTime), end: normalizeCellTime(row.endTime) }
        try {
          days = parseDays(row.days)
          assertValidShift(shift)
        } catch (e) { doctorFail(e.message); rowOutcome.set(row._rowNumber, outcome); continue }

        const state = doctorState.get(doctor.id)
        const toAdd = []
        let conflict = null
        for (const day of days) {
          const mine = state.byDay[day]
          if (mine.some((s) => s.roomKey === roomKey && s.start === shift.start && s.end === shift.end)) continue // already there
          const clash = mine.find((s) => overlaps(s, shift))
          if (clash) { conflict = `${doctor.fullName} already has an overlapping shift on ${day} (${clash.start}–${clash.end}) — a doctor cannot be in two rooms at once`; break }
          if (plan.sittingType === 'single') {
            const other = (roomDayShifts.get(`${roomKey}|${day}`) || []).find((s) => s.doctorId !== doctor.id && overlaps(s, shift))
            if (other) {
              const otherName = doctorState.get(other.doctorId)?.doctor.fullName || 'another doctor'
              conflict = `Room ${label} is single-sitting and ${otherName} is already there on ${day} (${other.start}–${other.end})`
              break
            }
          }
          toAdd.push(day)
        }
        if (conflict) { doctorFail(conflict); rowOutcome.set(row._rowNumber, outcome); continue }

        for (const day of toAdd) {
          state.byDay[day].push({ ...shift, roomKey })
          const k = `${roomKey}|${day}`
          if (!roomDayShifts.has(k)) roomDayShifts.set(k, [])
          roomDayShifts.get(k).push({ doctorId: doctor.id, ...shift })
          state.added.push({ day, ...shift, roomKey, rowNumber: row._rowNumber })
        }
        if (toAdd.length) outcome = 'created'
      }
      rowOutcome.set(row._rowNumber, outcome)
    }

    // ── Write: floors → rooms → timetables ──
    let floorsCreated = 0
    if (newFloors.size) {
      let next = floors.reduce((max, f) => Math.max(max, f.sortOrder), -1) + 1
      const ordered = [...newFloors.values()].sort((a, b) => a.firstRow - b.firstRow)
      const inserted = await db.floor.createManyAndReturn({
        data: ordered.map((f) => ({ organizationId: ORG_ID, name: f.name, sortOrder: next++ })),
        skipDuplicates: true,
        select: { id: true },
      })
      floorsCreated = inserted.length
    }
    // Re-read so floors created concurrently (skipped above) still resolve.
    const allFloors = await db.floor.findMany({ where: { organizationId: ORG_ID }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } })
    const floorIdByKey = new Map(allFloors.map((f) => [f.name.toLowerCase(), f.id]))
    const floorIndexById = new Map(allFloors.map((f, i) => [f.id, i]))

    let roomsCreated = 0
    const newRooms = [...roomPlan.values()].filter((p) => p.isNew)
    if (newRooms.length) {
      const inserted = await db.room.createManyAndReturn({
        data: newRooms.map((p) => ({
          organizationId: ORG_ID,
          floorId: floorIdByKey.get(p.floorKey),
          roomNumber: p.roomNumber,
          departmentId: p.departmentId || null,
          sittingType: p.sittingType,
        })),
        skipDuplicates: true,
        select: { id: true },
      })
      roomsCreated = inserted.length
    }
    const allRooms = await db.room.findMany({ where: { organizationId: ORG_ID }, select: { id: true, floorId: true, roomNumber: true } })
    const floorKeyById = new Map(allFloors.map((f) => [f.id, f.name]))
    const roomIdByKey = new Map(allRooms.map((r) => [roomKeyOf(floorKeyById.get(r.floorId), r.roomNumber), r.id]))

    // Warn (don't fail) on numbers outside the floor's usual block.
    for (const [key, p] of roomPlan) {
      if (!p.isNew || !/^\d+$/.test(p.roomNumber)) continue
      const floorId = floorIdByKey.get(p.floorKey)
      const block = floorBlock(floorIndexById.get(floorId))
      const n = Number(p.roomNumber)
      if (n < block.start || n > block.end) {
        warnings.push({ row: p.firstRow, name: key.replace('|', ' / '), reason: `Room number is outside this floor's usual range ${block.start}–${block.end}` })
      }
    }

    let shiftsAdded = 0
    for (const state of doctorState.values()) {
      if (!state.added.length) continue
      const { doctor } = state
      let prefs = {}
      try { if (doctor.preferences) prefs = JSON.parse(doctor.preferences) } catch {}
      const timetable = prefs.timetable || { weeklySlots: {}, exceptions: [], slotDuration: 15, maxPatientsPerDay: 30 }
      timetable.weeklySlots = timetable.weeklySlots || {}
      const roomIds = new Set()
      for (const a of state.added) {
        const roomId = roomIdByKey.get(a.roomKey)
        roomIds.add(roomId)
        const day = timetable.weeklySlots[a.day]
        if (!day || day.active === false) {
          // A switched-off day keeps its old shifts so re-enabling restores
          // them — but we're turning it on now, and those stale shifts were
          // never checked for overlap, so start the day fresh.
          timetable.weeklySlots[a.day] = { ...(day || {}), active: true, shifts: [{ start: a.start, end: a.end, roomId }] }
        } else {
          day.shifts = [...(day.shifts || []), { start: a.start, end: a.end, roomId }]
        }
      }
      prefs.timetable = timetable

      try {
        await db.$transaction(async (tx) => {
          // Same optimistic lock as the timetable screen: if someone saved this
          // doctor's timetable since we read it, don't overwrite their change.
          const { count } = await tx.user.updateMany({
            where: { id: doctor.id, updatedAt: doctor.updatedAt },
            data: { preferences: JSON.stringify(prefs) },
          })
          if (count === 0) throw Object.assign(new Error('stale'), { isConflict: true })
          for (const roomId of roomIds) {
            await tx.doctorRoomAssignment.upsert({
              where: { doctorId_roomId: { doctorId: doctor.id, roomId } },
              create: { organizationId: ORG_ID, doctorId: doctor.id, roomId },
              update: {},
            })
          }
        })
        shiftsAdded += state.added.length
      } catch (e) {
        if (!e.isConflict) throw e
        for (const rowNumber of new Set(state.added.map((a) => a.rowNumber))) {
          const row = rows.find((r) => r._rowNumber === rowNumber)
          // Only the doctor part failed — a room this row created still stands.
          failed.push({ ...row, _error: `${doctor.fullName}'s timetable changed during import — upload the file again` })
        }
      }
    }

    failed.sort((a, b) => a._rowNumber - b._rowNumber)
    const failedRowNumbers = new Set(failed.map((f) => f._rowNumber))
    const skipped = [...rowOutcome.entries()].filter(([n, o]) => o === 'skipped' && !failedRowNumbers.has(n)).length

    const errorFile = failed.length
      ? await buildErrorFile(ROW_COLUMNS, failed, 'room-setup-errors.xlsx')
      : null

    return res.json({
      success: true,
      summary: { total: rows.length, floorsCreated, roomsCreated, shiftsAdded, skipped, failed: failed.length },
      errors: failed.map((r) => ({ row: r._rowNumber, name: r._label || '', reason: r._error })),
      warnings: warnings.sort((a, b) => a.row - b.row),
      errorFile,
    })
  } catch (err) { next(err) }
}

// ── Export ────────────────────────────────────────────────────────────────

export async function exportRoomSetup(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx'

    const [rooms, doctors] = await Promise.all([
      db.room.findMany({
        where: { organizationId: ORG_ID },
        select: {
          id: true, roomNumber: true, sittingType: true,
          floor: { select: { name: true, sortOrder: true } },
          department: { select: { name: true } },
        },
      }),
      db.user.findMany({
        where: { organizationId: ORG_ID, role: 'doctor' },
        select: { id: true, fullName: true, email: true, preferences: true },
      }),
    ])

    // roomId → [{doctor, start, end, days[]}] — one group per doctor + time window.
    const groupsByRoom = new Map()
    for (const d of doctors) {
      const timetable = parseTimetable(d.preferences)
      if (!timetable) continue
      for (const day of WEEK) {
        for (const s of shiftsOnDay(timetable, day)) {
          if (!s.roomId || !s.start || !s.end) continue
          const start = normalizeTimeHHMM(s.start)
          const end = normalizeTimeHHMM(s.end)
          if (!groupsByRoom.has(s.roomId)) groupsByRoom.set(s.roomId, new Map())
          const groups = groupsByRoom.get(s.roomId)
          const key = `${d.id}|${start}|${end}`
          if (!groups.has(key)) groups.set(key, { doctor: d, start, end, days: [] })
          groups.get(key).days.push(day)
        }
      }
    }

    const collator = new Intl.Collator(undefined, { numeric: true })
    rooms.sort((a, b) => a.floor.sortOrder - b.floor.sortOrder || collator.compare(a.roomNumber, b.roomNumber))

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Setup')
    sheet.columns = ROW_COLUMNS
    for (const r of rooms) {
      const base = {
        floor: r.floor.name, roomNumber: r.roomNumber,
        department: r.department?.name || '', sittingType: r.sittingType,
      }
      const groups = [...(groupsByRoom.get(r.id)?.values() || [])]
        .sort((a, b) => a.start.localeCompare(b.start) || a.doctor.fullName.localeCompare(b.doctor.fullName))
      if (!groups.length) { sheet.addRow(base); continue }
      for (const g of groups) {
        sheet.addRow({
          ...base,
          doctorName: g.doctor.fullName, doctorEmail: g.doctor.email,
          days: formatDays(g.days), startTime: g.start, endTime: g.end,
        })
      }
    }
    if (format === 'xlsx') styleHeader(sheet)

    await sendWorkbook(res, workbook, `room_setup_export_${new Date().toISOString().slice(0, 10)}`, format)
  } catch (err) { next(err) }
}
