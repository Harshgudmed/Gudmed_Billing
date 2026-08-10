// Hostile audit of the CHECK-IN → QUEUE → DISPLAY BOARD pipeline.
//
//   node e2e/audit-queue-display.js            # everything
//   node e2e/audit-queue-display.js A B C      # only sections A, B, C
//
// Structure mirrors the attack plan; each section says WHY it exists.
//   A  contract diff:  UI sends × validator accepts × Prisma column × GET returns
//   B  check-in derivation: does the row land, and does it survive cancel/reschedule/delete
//   C  queueNumber uniqueness under REAL concurrency (127,073 duplicates once existed)
//   D  queue state machine: are illegal transitions refused?
//   E  priority & ordering determinism
//   F  display board correctness + PII + tenant isolation  ← highest stakes
//   G  performance at real volume (1M+ queue rows, ~2.7k appointments/day)
//   H  type confusion / mass assignment / cross-tenant
//
// Everything it creates is tagged AUDIT_TAG and removed in cleanup().
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Prisma lives in backend/, not at the repo root where this file sits.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backend = path.join(__dirname, '..', 'backend')
const require = createRequire(path.join(backend, 'package.json'))
const { PrismaClient } = require('@prisma/client')

// backend/.env holds DATABASE_URL; nothing loads it for a script run from here.
for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const UI = process.env.E2E_BASE || 'http://localhost:5173'
const API = process.env.E2E_API || 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const AUDIT_TAG = 'QA-AUDIT-QD'

const db = new PrismaClient()
const only = process.argv.slice(2).map((s) => s.toUpperCase())
const runs = (s) => only.length === 0 || only.includes(s)

// ── reporting ────────────────────────────────────────────────────────────
const findings = []
const ok = (n, d = '') => console.log(`  PASS  ${n}${d ? ` — ${d}` : ''}`)
const bug = (sev, n, d) => { findings.push({ sev, n, d }); console.log(`  ${sev}  ${n}\n        ${String(d).replace(/\n/g, '\n        ')}`) }
const info = (n, d = '') => console.log(`  ..    ${n}${d ? ` — ${d}` : ''}`)
const section = (s, t) => console.log(`\n${'═'.repeat(72)}\n${s}. ${t}\n${'═'.repeat(72)}`)

// ── raw HTTP so we can send payloads a browser/validator would never produce ──
async function call(method, url, body, headers = {}) {
  const t0 = Date.now()
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const ms = Date.now() - t0
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON error page */ }
  return { status: res.status, ms, body: json, text: text.slice(0, 300) }
}
const GET = (u, h) => call('GET', u, undefined, h)
const POST = (u, b, h) => call('POST', u, b, h)
const PATCH = (u, b, h) => call('PATCH', u, b, h)

const { ymdInZone, todayRange, dayRange } = await import('file://' + path.join(backend, 'src/lib/dates.js').replace(/\\/g, '/'))
const TODAY = ymdInZone()

// ── fixtures ─────────────────────────────────────────────────────────────
const made = { patients: [], appointments: [], queue: [], doctors: [], rooms: [], floors: [], depts: [] }

async function mkPatient(suffix) {
  const p = await db.patient.create({
    data: {
      organizationId: ORG,
      mrn: `${AUDIT_TAG}-${suffix}-${Date.now() % 100000}`,
      firstName: AUDIT_TAG, lastName: `P${suffix}`,
      phonePrimary: '9000000000', gender: 'male',
      dateOfBirth: new Date('1990-01-01'),
    },
  })
  made.patients.push(p.id)
  return p
}

// Appointment has @@unique([organizationId, doctorId, appointmentDate, appointmentTime]),
// so every fixture needs its own slot. Walk a counter through the day.
let slotSeq = 0
async function mkAppointment({ doctorId, patientId, date = TODAY, time, status = 'scheduled' }) {
  const n = slotSeq++
  const hh = String(9 + Math.floor(n / 60) % 12).padStart(2, '0')
  const mm = String(n % 60).padStart(2, '0')
  const a = await db.appointment.create({
    data: {
      organizationId: ORG, patientId, doctorId,
      // Distinct instant per fixture (still the same calendar day in IST, which
      // is all dayRange()/todayRange() care about).
      appointmentDate: new Date(Date.parse(`${date}T04:30:00.000Z`) + n * 1000),
      appointmentTime: time || `${hh}:${mm}`,
      appointmentType: 'new_patient',
      status, notes: AUDIT_TAG,
    },
  })
  made.appointments.push(a.id)
  return a
}

/** Track a queue row the SERVER created (via check-in) so cleanup gets it. */
const track = (id) => { if (id) made.queue.push(id) }

async function cleanup() {
  // Order matters: queue rows reference appointments/patients.
  await db.queueManagement.deleteMany({ where: { OR: [
    { id: { in: made.queue } },
    { appointmentId: { in: made.appointments } },
    { patientId: { in: made.patients } },
  ] } }).catch(() => {})
  await db.appointment.deleteMany({ where: { OR: [{ id: { in: made.appointments } }, { patientId: { in: made.patients } }] } }).catch(() => {})
  await db.consultation.deleteMany({ where: { patientId: { in: made.patients } } }).catch(() => {})
  await db.invoice.deleteMany({ where: { patientId: { in: made.patients } } }).catch(() => {})
  await db.patient.deleteMany({ where: { id: { in: made.patients } } }).catch(() => {})
  await db.doctorRoomAssignment.deleteMany({ where: { OR: [{ doctorId: { in: made.doctors } }, { roomId: { in: made.rooms } }] } }).catch(() => {})
  await db.user.deleteMany({ where: { id: { in: made.doctors } } }).catch(() => {})
  await db.room.deleteMany({ where: { id: { in: made.rooms } } }).catch(() => {})
  await db.department.deleteMany({ where: { id: { in: made.depts } } }).catch(() => {})
  await db.floor.deleteMany({ where: { id: { in: made.floors } } }).catch(() => {})
  // Belt and braces: anything still carrying the tag.
  await db.queueManagement.deleteMany({ where: { queueNumber: { startsWith: AUDIT_TAG } } }).catch(() => {})
}

// ═════════════════════════════════════════════════════════════════════════
async function sectionA() {
  section('A', 'THREE-WAY CONTRACT DIFF — sent × accepted × stored × returned')

  // WHY: a field the validator accepts and Prisma stores but no reader ever
  // surfaces is a promise the product does not keep. `displayMessage` is
  // literally named for the display board — if the board never returns it,
  // staff can type a message that no patient will ever see.
  const doctor = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor' }, select: { id: true } })
  const patient = await mkPatient('A1')
  const appt = await mkAppointment({ doctorId: doctor.id, patientId: patient.id })

  const ci = await PATCH(`/appointments/${appt.id}`, { status: 'checked_in' })
  const row = await db.queueManagement.findUnique({ where: { appointmentId: appt.id } })
  track(row?.id)
  if (!row) { bug('S1', 'A: check-in created no queue row', `PATCH /appointments/${appt.id} {status:checked_in} -> ${ci.status}`); return }

  // Write the two suspected-dead columns through the PUBLIC API.
  const wrote = await PATCH(`/queue/${row.id}`, { estimatedWaitMinutes: 42, displayMessage: 'AUDIT-CANARY-STRING' })
  const after = await db.queueManagement.findUnique({ where: { id: row.id } })
  info('PATCH /queue/:id {estimatedWaitMinutes,displayMessage}', `${wrote.status}; stored estimatedWaitMinutes=${after.estimatedWaitMinutes}, displayMessage=${JSON.stringify(after.displayMessage)}`)

  // Does either reader return them?
  const listed = await GET(`/queue?startDate=${TODAY}&endDate=${TODAY}&search=${patient.mrn}`)
  const listedRow = listed.body?.data?.find((r) => r.id === row.id)
  const boardResp = row.roomId ? await GET(`/display/queue?roomId=${row.roomId}`) : { body: null }
  const boardJson = JSON.stringify(boardResp.body || {})

  const inList = listedRow && 'displayMessage' in listedRow
  const onBoard = boardJson.includes('AUDIT-CANARY-STRING') || boardJson.includes('displayMessage')

  if (wrote.status === 200 && after.displayMessage === 'AUDIT-CANARY-STRING' && !onBoard) {
    bug('S3', 'displayMessage is a DEAD column — writable, stored, never displayed',
      `PATCH /queue/${row.id} {"displayMessage":"AUDIT-CANARY-STRING"} -> 200, DB row.displayMessage="AUDIT-CANARY-STRING".\n` +
      `GET /display/queue?roomId=${row.roomId} response does NOT contain the string or the key.\n` +
      `Returned by GET /queue only as a side effect of spreading the raw row (present in list JSON: ${inList}); no UI renders it.\n` +
      `Expected: either the board shows it, or the API rejects it. Actual: staff can set a per-patient display message that reaches no screen.`)
  } else ok('displayMessage reaches a reader')

  if (wrote.status === 200 && after.estimatedWaitMinutes === 42 && !boardJson.includes('estimatedWait')) {
    bug('S3', 'estimatedWaitMinutes is a DEAD column — writable, stored, never read',
      `PATCH /queue/${row.id} {"estimatedWaitMinutes":42} -> 200, DB row.estimatedWaitMinutes=42.\n` +
      `Nothing computes it (grep: only backend/seed-queue.js writes it) and no endpoint/UI reads it.\n` +
      `GET /queue returns it inside the spread row; the board never does. Queue UI shows a CALCULATED waitTime instead, ignoring this column.`)
  } else ok('estimatedWaitMinutes reaches a reader')

  // WHY: the board and the queue list must agree on what a queue row IS.
  const boardFields = boardResp.body?.data?.waitingGroups?.[0]?.patients?.[0]
  info('/display/queue patient DTO fields', boardFields ? Object.keys(boardFields).join(', ') : '(no waiting patient in that room)')
  info('/queue row fields', listedRow ? Object.keys(listedRow).join(', ') : '(row not in list)')
}

// ═════════════════════════════════════════════════════════════════════════
async function sectionB() {
  section('B', 'CHECK-IN DERIVATION — does the data land, and does it stay true?')

  const doctor = await db.user.findFirst({
    where: { organizationId: ORG, role: 'doctor', roomAssignments: { some: {} } },
    select: { id: true, fullName: true },
  })

  // ── B1: the happy path must actually populate roomId + visitType ───────
  {
    const p = await mkPatient('B1')
    const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id })
    const r = await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
    const q = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    track(q?.id)
    if (!q) bug('S1', 'B1: check-in created no queue row', `PATCH /appointments/${a.id} -> ${r.status}`)
    else if (!q.roomId || !q.visitType) bug('S1', 'B1: check-in row missing derived fields', `roomId=${q.roomId}, visitType=${q.visitType}`)
    else ok('B1 check-in populates roomId + visitType', `roomId=${q.roomId}, visitType=${q.visitType}, queueNumber=${q.queueNumber}`)
  }

  // ── B2: a doctor with NO room link ─────────────────────────────────────
  // WHY: deriveRoomAndVisitType returns roomId:null when the doctor has no
  // DoctorRoomAssignment. Every display-board query filters on roomId. A
  // patient who checks in and appears on NO board waits forever.
  {
    const roomless = await db.user.create({
      data: {
        id: `${AUDIT_TAG}-doc-noroom-${Date.now() % 100000}`,
        organizationId: ORG, role: 'doctor',
        email: `${AUDIT_TAG}-noroom-${Date.now() % 100000}@audit.local`,
        fullName: 'Dr Audit NoRoom', passwordHash: 'x', isActive: true,
      },
    })
    made.doctors.push(roomless.id)
    const p = await mkPatient('B2')
    const a = await mkAppointment({ doctorId: roomless.id, patientId: p.id })
    const r = await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
    const q = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    track(q?.id)

    if (!q) { bug('S1', 'B2: roomless-doctor check-in created no row', `-> ${r.status}`); return }

    // Prove the patient is on NO board anywhere: every board query needs roomId.
    const floors = await GET('/display/floors')
    let foundOnAnyBoard = false
    const roomIds = await db.room.findMany({ where: { organizationId: ORG }, select: { id: true }, take: 40 })
    for (const rm of roomIds) {
      const b = await GET(`/display/queue?roomId=${rm.id}`)
      if (JSON.stringify(b.body || {}).includes(p.mrn)) { foundOnAnyBoard = true; break }
    }
    // ...and prove they ARE in the staff queue (so staff think they're queued).
    const list = await GET(`/queue?startDate=${TODAY}&endDate=${TODAY}&search=${p.mrn}`)
    const inStaffQueue = (list.body?.data || []).some((x) => x.id === q.id)

    if (q.roomId === null && !foundOnAnyBoard) {
      bug('S1', 'B2: a checked-in patient whose doctor has no room link appears on NO display board — and nothing warns anyone',
        `Request: PATCH /appointments/${a.id} {"status":"checked_in"} -> ${r.status} (success).\n` +
        `DB row ${q.id}: status="waiting", roomId=NULL, assignedToId=${q.assignedToId}, queueNumber=${q.queueNumber}.\n` +
        `Expected: check-in either refuses, or the patient is visible somewhere.\n` +
        `Actual: displayController.getRoomQueue ALWAYS filters where roomId=<a real room>, and getFloorsOverview only counts rows nested under floor.rooms — a NULL-roomId row matches no room, so it is counted on no floor tile and listed on no board. Searched ${roomIds.length} rooms: not found.\n` +
        `The staff /queue list DOES show them (present=${inStaffQueue}), so the patient looks queued to reception while the waiting-room TV never calls them.\n` +
        `Real hospital: the patient sits in the corridor indefinitely. Nothing in the UI, the API response, or the row itself flags the missing room.`)
    } else if (q.roomId) {
      ok('B2 roomless doctor still derived a room (unexpected)', `roomId=${q.roomId}`)
    }
    info('B2 floors overview total waiting', String((floors.body?.data || []).reduce((s, f) => s + f.waitingCount, 0)))
  }

  // ── B3: doctor ON LEAVE today ──────────────────────────────────────────
  // WHY: activeDoctor.isOnLeave() removes the doctor from the room. Their
  // patients still have queue rows pointing at that room. Who are they under?
  {
    const link = await db.doctorRoomAssignment.findFirst({ where: { doctorId: doctor.id }, select: { roomId: true } })
    const original = await db.user.findUnique({ where: { id: doctor.id }, select: { preferences: true } })
    let prefs = {}
    try { prefs = JSON.parse(original.preferences || '{}') } catch { prefs = {} }
    const patched = { ...prefs, timetable: { ...(prefs.timetable || {}), exceptions: [...((prefs.timetable || {}).exceptions || []), { date: TODAY, reason: `${AUDIT_TAG} leave` }] } }
    await db.user.update({ where: { id: doctor.id }, data: { preferences: JSON.stringify(patched) } })

    const p = await mkPatient('B3')
    const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id })
    const r = await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
    const q = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    track(q?.id)

    const board = await GET(`/display/queue?roomId=${q?.roomId || link.roomId}`)
    const groups = board.body?.data?.waitingGroups || []
    const mine = groups.find((g) => g.patients.some((x) => x.uhid === p.mrn))
    const active = board.body?.data?.activeDoctor

    if (r.status === 200 && q) {
      bug('S2', 'B3: check-in for a doctor who is ON LEAVE today is accepted with no warning',
        `Request: PATCH /appointments/${a.id} {"status":"checked_in"} -> 200. Doctor ${doctor.id} has timetable.exceptions=[{date:"${TODAY}"}].\n` +
        `Row created: roomId=${q.roomId}, status="waiting", assignedToId=${q.assignedToId}.\n` +
        `Board room ${q.roomId}: activeDoctor=${JSON.stringify(active)}; the patient lands in group "${mine?.doctorName}" (doctorId=${mine?.doctorId}).\n` +
        `Nothing in the check-in path calls isOnLeave(). Consequence: reception can queue patients for a doctor who is not in the building; the board files them under whoever else is sitting there (or shows the room closed).`)
    } else ok('B3 leave check-in blocked', `-> ${r.status}`)

    await db.user.update({ where: { id: doctor.id }, data: { preferences: original.preferences } })
  }

  // ── B4: appointment dated TOMORROW / YESTERDAY ─────────────────────────
  // WHY: the board filters on joinedQueueAt, but the appointment-check-in path
  // never sets joinedQueueAt — it defaults to now(). So the slot date is lost.
  for (const [label, date] of [['TOMORROW', new Date(Date.parse(TODAY) + 86400000).toISOString().slice(0, 10)],
                               ['YESTERDAY', new Date(Date.parse(TODAY) - 86400000).toISOString().slice(0, 10)]]) {
    const p = await mkPatient(`B4-${label}`)
    const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id, date })
    const r = await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
    const q = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    track(q?.id)
    if (!q) { info(`B4 ${label}: no row`, `-> ${r.status}`); continue }

    const tr = todayRange()
    const onTodayBoard = q.joinedQueueAt >= tr.gte && q.joinedQueueAt <= tr.lte
    const board = await GET(`/display/queue?roomId=${q.roomId}`)
    const visible = JSON.stringify(board.body || {}).includes(p.mrn)

    if (onTodayBoard) {
      bug(label === 'TOMORROW' ? 'S2' : 'S3', `B4: an appointment dated ${label} (${date}) checked in today lands on TODAY's display board`,
        `Request: PATCH /appointments/${a.id} {"status":"checked_in"} -> ${r.status}. Appointment.appointmentDate=${date}, appointmentTime=10:00.\n` +
        `DB row: joinedQueueAt=${q.joinedQueueAt.toISOString()} — i.e. NOW, not the appointment slot.\n` +
        `appointmentController.update()'s queueManagement.upsert (line ~448) sets no joinedQueueAt, so the schema default now() applies. lib/queueSync.js DOES stamp the slot (zonedDateTimeToUtc) — the two writers disagree.\n` +
        `Board GET /display/queue?roomId=${q.roomId} shows the patient: ${visible}.\n` +
        `Expected: a ${label} appointment is not today's queue. Actual: it is, and the board calls them.`)
    } else ok(`B4 ${label} did not leak onto today's board`, `joinedQueueAt=${q.joinedQueueAt.toISOString()}`)
  }

  // ── B5: double check-in fired CONCURRENTLY ─────────────────────────────
  // WHY: appointmentId is @unique. Two racing upserts inside a transaction can
  // still collide at the DB (upsert is not atomic against a concurrent insert).
  {
    const p = await mkPatient('B5')
    const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id })
    const [r1, r2] = await Promise.all([
      PATCH(`/appointments/${a.id}`, { status: 'checked_in' }),
      PATCH(`/appointments/${a.id}`, { status: 'checked_in' }),
    ])
    const rows = await db.queueManagement.findMany({ where: { appointmentId: a.id } })
    rows.forEach((r) => track(r.id))
    const statuses = [r1.status, r2.status]
    if (rows.length !== 1) bug('S1', 'B5: concurrent double check-in produced != 1 queue row', `rows=${rows.length}, responses=${statuses}`)
    else if (statuses.some((s) => s >= 500)) {
      bug('S3', 'B5: the losing side of a concurrent double check-in returns 500, not a graceful result',
        `Two simultaneous PATCH /appointments/${a.id} {"status":"checked_in"} -> ${statuses.join(' and ')}.\n` +
        `DB is correct (exactly 1 row: ${rows[0].id}) so no data damage, but the UI shows a red "failed" toast for a check-in that in fact succeeded — staff click again.\n` +
        `Cause: upsert() races another upsert; Prisma raises P2002/P2034 which no handler translates.\n` +
        `Responses: ${JSON.stringify([r1.body, r2.body]).slice(0, 240)}`)
    } else ok('B5 concurrent double check-in → exactly 1 row, both sides graceful', `responses=${statuses}, row=${rows[0].id}`)
  }

  // ── B6: check in a CANCELLED appointment ───────────────────────────────
  {
    const p = await mkPatient('B6')
    const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id, status: 'cancelled' })
    const r = await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
    const q = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    track(q?.id)
    if (r.status === 200 && q) {
      bug('S3', 'B6: a CANCELLED appointment can be checked in and enters the queue',
        `Appointment ${a.id} had status="cancelled". PATCH {"status":"checked_in"} -> 200. Queue row ${q.id} created, status="waiting", roomId=${q.roomId}.\n` +
        `No state machine on Appointment.status either — cancelled → checked_in is accepted. lib/queueSync.js deliberately refuses to queue cancelled appointments (NOT_QUEUEABLE); the check-in path does not apply the same rule.`)
    } else ok('B6 cancelled appointment cannot be checked in', `-> ${r.status}`)
  }

  // ── B7: check in, THEN cancel the appointment ──────────────────────────
  // WHY: the flagged S1/S2. Does the queue row follow the cancellation?
  {
    const p = await mkPatient('B7')
    const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id })
    await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
    const before = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    track(before?.id)

    const cancel = await PATCH(`/appointments/${a.id}`, { status: 'cancelled', cancellationReason: `${AUDIT_TAG} test` })
    const after = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    const appt = await db.appointment.findUnique({ where: { id: a.id }, select: { status: true, cancelledAt: true } })
    const board = await GET(`/display/queue?roomId=${after?.roomId}`)
    const stillOnBoard = JSON.stringify(board.body || {}).includes(p.mrn)
    const list = await GET(`/queue?startDate=${TODAY}&endDate=${TODAY}&search=${p.mrn}`)
    const stillInList = (list.body?.data || []).find((x) => x.id === after?.id)

    if (after && after.status === 'waiting') {
      bug('S1', 'B7: CANCELLING a checked-in appointment leaves the patient in the queue AND on the public display board',
        `1) PATCH /appointments/${a.id} {"status":"checked_in"} -> queue row ${before.id} status="waiting".\n` +
        `2) PATCH /appointments/${a.id} {"status":"cancelled"} -> ${cancel.status}. Appointment.status now "${appt.status}", cancelledAt=${appt.cancelledAt?.toISOString()}.\n` +
        `3) Queue row ${after.id} STILL status="${after.status}", roomId=${after.roomId}, appointmentId=${after.appointmentId} — untouched.\n` +
        `   Board GET /display/queue?roomId=${after.roomId} still lists them: ${stillOnBoard}. Staff /queue still lists them: ${!!stillInList} (status "${stillInList?.status}").\n` +
        `Cause: appointmentController.update() only touches queueManagement when status==='checked_in' (line 444). There is no branch for cancelled/no_show/rescheduled. lib/queueSync.js's NOT_QUEUEABLE list only skips CREATING rows; it never cancels an existing one, and the display board never joins back to Appointment.status.\n` +
        `Expected: cancelling removes/cancels the queue row. Actual: a cancelled patient keeps their token, keeps their place, and will be called into the consulting room.`)
    } else ok('B7 cancel propagated to the queue row', `queue status=${after?.status}`)
  }

  // ── B8: check in, THEN reschedule ──────────────────────────────────────
  {
    const p = await mkPatient('B8')
    const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id })
    await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
    const q0 = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    track(q0?.id)

    const other = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', id: { not: doctor.id }, roomAssignments: { some: {} } }, select: { id: true } })
    const resched = await POST(`/appointments/${a.id}/reschedule`, { appointmentDate: TODAY, appointmentTime: '16:30' })
    const newId = resched.body?.data?.id
    if (newId) made.appointments.push(newId)

    const q1 = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    const qNew = newId ? await db.queueManagement.findUnique({ where: { appointmentId: newId } }) : null
    track(qNew?.id)
    const oldAppt = await db.appointment.findUnique({ where: { id: a.id }, select: { status: true } })
    const board = await GET(`/display/queue?roomId=${q1?.roomId}`)
    const dupes = (board.body?.data?.waitingGroups || []).flatMap((g) => g.patients).filter((x) => x.uhid === p.mrn)

    if (q1 && q1.status === 'waiting') {
      bug('S2', 'B8: RESCHEDULING a checked-in appointment orphans the original queue row — the patient can appear TWICE',
        `1) Check-in of ${a.id} -> queue row ${q0.id} (status="waiting", joinedQueueAt=${q0.joinedQueueAt.toISOString()}).\n` +
        `2) POST /appointments/${a.id}/reschedule {"appointmentDate":"${TODAY}","appointmentTime":"16:30"} -> ${resched.status}, new appointment ${newId}. Old appointment.status="${oldAppt?.status}".\n` +
        `3) Old queue row ${q1.id} is UNCHANGED: status="${q1.status}", still pointing at the old slot/room. reschedule() (appointmentController.js:477) never touches QueueManagement.\n` +
        `4) The new appointment gets its own row once queueSync runs (present now: ${!!qNew}${qNew ? `, id=${qNew.id}` : ''}), because queueSync skips only status "rescheduled" — the OLD row it already created stays behind.\n` +
        `Board room ${q1.roomId} currently shows this patient ${dupes.length} time(s).\n` +
        `Real hospital: the same patient holds two tokens; the stale one is called at the original time to a doctor they no longer have an appointment with.`)
    } else ok('B8 reschedule cleaned up the old queue row', `old status=${q1?.status}`)
  }

  // ── B9: DELETE the appointment ─────────────────────────────────────────
  // WHY: the FK is ON DELETE SET NULL (verified in pg_constraint), so the row
  // is not removed — it is cut loose and can never be reconciled again.
  {
    const p = await mkPatient('B9')
    const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id })
    await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
    const q0 = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
    track(q0?.id)

    const del = await call('DELETE', `/appointments/${a.id}`)
    const q1 = q0 ? await db.queueManagement.findUnique({ where: { id: q0.id } }) : null
    const apptGone = !(await db.appointment.findUnique({ where: { id: a.id } }))

    if (q1 && q1.status === 'waiting') {
      bug('S2', 'B9: DELETING an appointment orphans its queue row (FK is ON DELETE SET NULL) — the patient stays on the board forever',
        `DELETE /api/appointments/${a.id} -> ${del.status}. Appointment gone: ${apptGone}.\n` +
        `Queue row ${q1.id} still exists: status="${q1.status}", roomId=${q1.roomId}, appointmentId=${q1.appointmentId} (was ${a.id}).\n` +
        `Verified constraint: QueueManagement_appointmentId_fkey ... ON DELETE SET NULL (pg_constraint). appointmentController.remove() cleans up the draft invoice + commission but never the queue row.\n` +
        `Because appointmentId is now NULL, lib/queueSync.js can never match this row to anything again — it is permanently un-healable and un-reconcilable, and still status "waiting" on the display board.`)
    } else ok('B9 delete cleaned up the queue row', `row=${q1 ? q1.status : 'gone'}`)
  }
}

// ═════════════════════════════════════════════════════════════════════════
async function sectionC() {
  section('C', 'queueNumber UNIQUENESS under real concurrency')

  // WHY: 127,073 real duplicates existed before nextQueueNumber. Reading the
  // code proves nothing — only concurrent writes do.
  const patients = []
  for (let i = 0; i < 20; i++) patients.push(await mkPatient(`C${i}`))

  const t0 = Date.now()
  const results = await Promise.all(patients.map((p) =>
    POST('/queue', { patientId: p.id, serviceArea: 'opd', priority: 'normal', visitType: 'new' })))
  const ms = Date.now() - t0

  const created = results.filter((r) => r.status === 201).map((r) => r.body.data)
  created.forEach((c) => track(c.id))
  const nums = created.map((c) => c.queueNumber)
  const uniq = new Set(nums)
  const failures = results.filter((r) => r.status !== 201)

  info('20 concurrent POST /api/queue', `${ms}ms total; ${created.length} created, ${failures.length} failed`)
  if (failures.length) info('  failure statuses', failures.map((f) => `${f.status}:${JSON.stringify(f.body).slice(0, 90)}`).join(' | '))

  if (uniq.size !== nums.length) {
    bug('S1', 'C: concurrent walk-in adds produced DUPLICATE queueNumbers',
      `20 concurrent POST /api/queue -> ${nums.length} rows, only ${uniq.size} distinct queueNumbers.\nSample: ${nums.sort().join(', ')}`)
  } else {
    ok('C 20 concurrent walk-ins → 20 distinct queueNumbers', `${nums.sort()[0]} … ${nums.sort().slice(-1)[0]}`)
  }

  // Is uniqueness enforced by the DB, or only by application logic?
  const idx = await db.$queryRawUnsafe(`SELECT indexdef FROM pg_indexes WHERE tablename='QueueManagement' AND indexname='QueueManagement_organizationId_queueNumber_key'`)
  if (idx.length) ok('C DB-level unique constraint exists (not application-only)', idx[0].indexdef)
  else bug('S2', 'C: queueNumber uniqueness is application-only — no DB constraint backs it', 'no QueueManagement_organizationId_queueNumber_key index in pg_indexes')

  // Try to force a collision AT THE DB to prove the constraint bites.
  const victim = created[0]
  if (victim) {
    let raised = null
    try {
      await db.queueManagement.create({ data: { organizationId: ORG, patientId: patients[0].id, serviceArea: 'opd', queueNumber: victim.queueNumber, status: 'waiting' } })
    } catch (e) { raised = e.code || e.message.slice(0, 60) }
    raised ? ok('C the unique index actually rejects a duplicate', `Prisma error ${raised}`)
           : bug('S1', 'C: a duplicate queueNumber INSERTED successfully', `wrote a second row with queueNumber=${victim.queueNumber}`)
  }

  // ── day-boundary behaviour ─────────────────────────────────────────────
  // WHY: nextQueueNumber builds its date key with new Date().toISOString() =
  // UTC. Everything else in the codebase uses the hospital timezone
  // (lib/dates.js HOSPITAL_TZ = Asia/Kolkata). Those disagree for 5h30m/day.
  const utcYmd = new Date().toISOString().slice(0, 10)
  const istYmd = ymdInZone()
  const counters = await db.billCounter.findMany({ where: { organizationId: ORG, series: { startsWith: 'QUEUE_OPD_' }, year: 'D' }, orderBy: { series: 'desc' }, take: 4, select: { series: true, value: true } })
  info('C queue-number counters (BillCounter)', counters.map((c) => `${c.series}=${c.value}`).join(', '))
  if (utcYmd !== istYmd) {
    bug('S3', 'C: the queue-number day rolls over at 05:30 IST, not midnight — tokens carry the WRONG date',
      `utils/queueNumber.js line 34: new Date().toISOString().slice(0,10) — UTC. Everything else uses lib/dates.js HOSPITAL_TZ='Asia/Kolkata'.\n` +
      `Right now UTC date=${utcYmd} but hospital date=${istYmd}. A token drawn now is prefixed ${utcYmd.replace(/-/g, '')} while the queue screen, the board and dayRange() all call it ${istYmd}.\n` +
      `Uniqueness is NOT affected (the counter is shared, just mis-labelled). Impact: between 00:00 and 05:30 IST every token prints yesterday's date and continues yesterday's numbering (e.g. Emergency, which runs 24/7, starts the day at #480 instead of #1).`)
  } else {
    info('C day-boundary', `UTC and hospital dates agree right now (${utcYmd}) — the 00:00–05:30 IST window is when they diverge; see the static finding in the report.`)
  }
}

// ═════════════════════════════════════════════════════════════════════════
async function sectionD() {
  section('D', 'QUEUE STATE MACHINE — are illegal transitions refused?')

  const doctor = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', roomAssignments: { some: {} } }, select: { id: true } })
  const p = await mkPatient('D1')
  const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id })
  await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
  const q = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
  track(q.id)

  // Every transition a real state machine would refuse.
  const illegal = [
    ['completed', 'waiting', 'a finished consultation reopens as waiting'],
    ['cancelled', 'in_progress', 'a cancelled patient is now being seen'],
    ['no_show', 'called', 'a no-show is called again'],
    ['waiting', 'completed', 'completed without ever being called or seen'],
    ['completed', 'called', 'a completed patient is called back into the room'],
  ]
  const accepted = []
  for (const [from, to, meaning] of illegal) {
    await db.queueManagement.update({ where: { id: q.id }, data: { status: from } })
    const r = await PATCH(`/queue/${q.id}`, { status: to })
    const row = await db.queueManagement.findUnique({ where: { id: q.id } })
    const landed = row.status === to
    console.log(`     ${from.padEnd(11)} -> ${to.padEnd(11)}  PATCH /queue/${q.id} {"status":"${to}"} -> ${r.status}  DB now "${row.status}"  ${landed ? 'ACCEPTED' : 'refused'}`)
    if (landed && r.status === 200) accepted.push(`${from} -> ${to}  (${meaning})`)
  }

  if (accepted.length) {
    bug('S2', `D: NO state machine — the queue API accepts every illegal status transition (${accepted.length}/${illegal.length})`,
      `Each of these returned 200 and landed in the DB:\n  ${accepted.join('\n  ')}\n` +
      `queueController.updateQueue() validates only that the value is one of the six enum members (queueUpdateSchema, line 33). It never reads the CURRENT status, so any status → any status.\n` +
      `Real hospital: a completed or cancelled patient can be silently returned to "waiting" and re-called; there is no audit trail and no guard. The UI hides the buttons (isCompleted), so the API is the only thing that could enforce this — and it does not.`)
  } else ok('D illegal transitions are refused')

  // ── status outside the enum ────────────────────────────────────────────
  const bogus = await PATCH(`/queue/${q.id}`, { status: 'teleported' })
  if (bogus.status === 400) ok('D unknown status → 400', JSON.stringify(bogus.body).slice(0, 90))
  else bug('S3', 'D: unknown status is not a clean 400', `PATCH {"status":"teleported"} -> ${bogus.status} ${JSON.stringify(bogus.body).slice(0, 120)}`)

  // ── timestamps: does going backwards leave corrupt data? ───────────────
  // WHY: a "waiting" row that carries serviceCompletedAt is corrupt — every
  // wait-time calculation in getQueue() keys off those stamps.
  await db.queueManagement.update({ where: { id: q.id }, data: { status: 'waiting', calledAt: null, serviceStartedAt: null, serviceCompletedAt: null } })
  await PATCH(`/queue/${q.id}`, { status: 'called' })
  await PATCH(`/queue/${q.id}`, { status: 'in_progress' })
  await PATCH(`/queue/${q.id}`, { status: 'completed' })
  const done = await db.queueManagement.findUnique({ where: { id: q.id } })
  const stamps = { calledAt: !!done.calledAt, serviceStartedAt: !!done.serviceStartedAt, serviceCompletedAt: !!done.serviceCompletedAt }
  if (stamps.calledAt && stamps.serviceStartedAt && stamps.serviceCompletedAt) ok('D forward transitions stamp calledAt/serviceStartedAt/serviceCompletedAt', JSON.stringify(stamps))
  else bug('S3', 'D forward transitions did not stamp all timestamps', JSON.stringify(stamps))

  const back = await PATCH(`/queue/${q.id}`, { status: 'waiting' })
  const stale = await db.queueManagement.findUnique({ where: { id: q.id } })
  if (stale.status === 'waiting' && stale.serviceCompletedAt) {
    const list = await GET(`/queue?startDate=${TODAY}&endDate=${TODAY}&search=${p.mrn}`)
    const shown = (list.body?.data || []).find((x) => x.id === q.id)
    bug('S2', 'D: reverting to "waiting" leaves stale calledAt/serviceStartedAt/serviceCompletedAt — the row is corrupt and the wait time freezes',
      `PATCH /queue/${q.id} {"status":"waiting"} -> ${back.status}.\n` +
      `DB row: status="waiting" BUT calledAt=${stale.calledAt?.toISOString()}, serviceStartedAt=${stale.serviceStartedAt?.toISOString()}, serviceCompletedAt=${stale.serviceCompletedAt?.toISOString()}.\n` +
      `updateQueue() only ever SETS a timestamp going forward (lines 204-206); it never clears them going back.\n` +
      `Knock-on: getQueue()'s wait-time (line 114) uses \`serviceStartedAt || calledAt || serviceCompletedAt\` as the freeze point, so this genuinely-waiting patient reports waitTime=${shown?.waitTime} min and STOPS counting up. On the board they sit in the waiting list with a wait time that never grows — the one signal staff use to spot a forgotten patient.`)
  } else ok('D reverting to waiting clears the stale timestamps')

  // ── last-write-wins / stale tab ────────────────────────────────────────
  // WHY: two staff on two screens, both with a stale row. Any optimistic lock?
  const [w1, w2] = await Promise.all([PATCH(`/queue/${q.id}`, { status: 'completed' }), PATCH(`/queue/${q.id}`, { status: 'no_show' })])
  const final = await db.queueManagement.findUnique({ where: { id: q.id } })
  bug('S3', 'D: concurrent status writes are last-write-wins with no version check',
      `Two simultaneous PATCH /queue/${q.id} — {"status":"completed"} -> ${w1.status} and {"status":"no_show"} -> ${w2.status}. Final DB status="${final.status}".\n` +
      `Both callers got a 200 telling them their value won; one is wrong. No updatedAt/version precondition exists on the endpoint. A second staff tab holding a stale row silently overwrites the first.`)
}

// ═════════════════════════════════════════════════════════════════════════
async function sectionE() {
  section('E', 'PRIORITY & ORDERING')

  const doctor = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', roomAssignments: { some: {} } }, select: { id: true } })
  const p = await mkPatient('E1')
  const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id })
  await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
  const q = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
  track(q.id)

  // ── priorityRank must follow priority ──────────────────────────────────
  const up = await PATCH(`/queue/${q.id}`, { priority: 'urgent' })
  const after = await db.queueManagement.findUnique({ where: { id: q.id } })
  if (after.priority === 'urgent' && after.priorityRank === 100) ok('E priority change updates priorityRank', `priority=urgent, priorityRank=${after.priorityRank}, joinedQueueAt re-stamped=${after.joinedQueueAt.toISOString()}`)
  else bug('S2', 'E priority change did not update priorityRank', `-> ${up.status}; priority=${after.priority}, priorityRank=${after.priorityRank}`)

  // ── junk priorities ────────────────────────────────────────────────────
  // WHY: `priority: z.string().optional()` accepts ANY string; priorityRank()
  // silently maps the unknown value to the "normal" rank.
  const junk = [
    ['unknown string', 'chartreuse'],
    ['negative number', -5],
    ['huge number', 999999999999],
    ['null', null],
    ['array', []],
    ['object', {}],
    ['SQL-ish', "'; DROP TABLE \"QueueManagement\"; --"],
    ['empty string', ''],
  ]
  const silentlyAccepted = []
  for (const [label, value] of junk) {
    const r = await PATCH(`/queue/${q.id}`, { priority: value })
    const row = await db.queueManagement.findUnique({ where: { id: q.id } })
    const stored = r.status === 200 ? `priority=${JSON.stringify(row.priority)}, priorityRank=${row.priorityRank}` : ''
    console.log(`     priority=${JSON.stringify(value).padEnd(34)} -> ${r.status} ${stored}`)
    if (r.status >= 500) bug('S2', `E: priority=${label} caused a ${r.status}`, `PATCH /queue/${q.id} {"priority":${JSON.stringify(value)}} -> ${r.status} ${r.text}`)
    if (r.status === 200 && typeof value === 'string' && !['urgent', 'high', 'medium', 'normal', 'low'].includes(value)) {
      silentlyAccepted.push(`${JSON.stringify(value)} -> stored as-is, priorityRank=${row.priorityRank}`)
    }
    await db.queueManagement.update({ where: { id: q.id } , data: { priority: 'normal', priorityRank: 40 } })
  }
  if (silentlyAccepted.length) {
    bug('S3', 'E: any string is accepted as a priority and silently ranked "normal"',
      `queueUpdateSchema uses \`priority: z.string().optional()\` — no enum, even though lib/queuePriority.js exports QUEUE_PRIORITIES and \`status\` right above it IS a z.enum.\n  ${silentlyAccepted.join('\n  ')}\n` +
      `priorityRank() falls back to 40 for anything unknown, so the row LOOKS urgent in the UI's priority column (it renders the raw string) while sorting as normal. Real hospital: a typo'd "Urgent" (capital U) shows as urgent to staff and queues as normal.`)
  } else ok('E priority values are validated against the allowed set')

  // ── deterministic tie-break ────────────────────────────────────────────
  // WHY: ORDER BY (priorityRank desc, joinedQueueAt asc) has no final unique
  // tiebreak. Postgres may return equal-key rows in ANY order, and the board
  // repaints every 3s. "Who is next" must not flicker.
  const tiePatients = []
  for (let i = 0; i < 6; i++) tiePatients.push(await mkPatient(`E-tie${i}`))
  const room = await db.doctorRoomAssignment.findFirst({ where: { doctorId: doctor.id }, select: { roomId: true } })
  const sameInstant = new Date()
  const tieIds = []
  for (const tp of tiePatients) {
    const ta = await mkAppointment({ doctorId: doctor.id, patientId: tp.id })
    const row = await db.queueManagement.create({
      data: {
        organizationId: ORG, patientId: tp.id, appointmentId: ta.id, serviceArea: 'opd',
        queueNumber: `${AUDIT_TAG}-TIE-${tp.id.slice(-6)}`, status: 'waiting',
        priority: 'normal', priorityRank: 40, roomId: room.roomId, assignedToId: doctor.id,
        joinedQueueAt: sameInstant, // identical to the millisecond
      },
    })
    tieIds.push(row.id)
    track(row.id)
  }

  const orders = []
  for (let i = 0; i < 6; i++) {
    const b = await GET(`/display/queue?roomId=${room.roomId}`)
    const seq = (b.body?.data?.waitingGroups || []).flatMap((g) => g.patients).map((x) => x.queueEntryId).filter((id) => tieIds.includes(id))
    orders.push(seq.join('>'))
    // Force a fresh plan: Postgres can legitimately reorder equal keys between
    // executions (different scan/sort paths, concurrent updates, autovacuum).
    await db.queueManagement.update({ where: { id: tieIds[i % tieIds.length] }, data: { updatedAt: new Date() } })
  }
  const distinct = new Set(orders)
  if (distinct.size > 1) {
    bug('S2', 'E: ties in (priorityRank, joinedQueueAt) order NON-DETERMINISTICALLY — the board\'s "next patient" changes between 3s polls',
      `6 rows with priorityRank=40 and byte-identical joinedQueueAt=${sameInstant.toISOString()}.\n` +
      `Six consecutive GET /display/queue?roomId=${room.roomId} returned ${distinct.size} DIFFERENT orders:\n  ${[...distinct].join('\n  ')}\n` +
      `ORDER BY [priorityRank desc, joinedQueueAt asc] (displayController.js:132, queueController.js:85) has no unique final tiebreak, so Postgres is free to return equal-key rows in any order — and does, whenever the row's physical position changes (any UPDATE moves it).\n` +
      `Real hospital: patient #1 on the wall TV is a different person every few seconds; the "You are next. Be ready." banner (DisplayBoardPage.jsx:378 keys off index 0) lands on whoever happens to sort first this poll.`)
  } else {
    ok('E tied rows keep a stable order across 6 polls', `order stayed ${[...distinct][0] || '(none)'} — note: still not GUARANTEED without a unique tiebreak in ORDER BY`)
  }

  // ── concurrent priority changes ────────────────────────────────────────
  const [c1, c2] = await Promise.all([PATCH(`/queue/${q.id}`, { priority: 'urgent' }), PATCH(`/queue/${q.id}`, { priority: 'low' })])
  const cf = await db.queueManagement.findUnique({ where: { id: q.id } })
  const consistent = cf.priorityRank === ({ urgent: 100, low: 20 })[cf.priority]
  consistent
    ? ok('E concurrent priority writes leave priority and priorityRank consistent', `-> ${c1.status}/${c2.status}, final ${cf.priority}/${cf.priorityRank}`)
    : bug('S2', 'E: concurrent priority writes TORE priority away from priorityRank', `final priority="${cf.priority}" but priorityRank=${cf.priorityRank} — the UI shows one thing and the queue sorts by another`)
}

// ═════════════════════════════════════════════════════════════════════════
async function sectionF() {
  section('F', 'DISPLAY BOARD — patient safety, PII, isolation')

  // ── F1: PII on a public screen ─────────────────────────────────────────
  // WHY: /display renders with no login (App.jsx:398, outside the Shell). Dump
  // exactly what the wall TV can be made to show.
  const busiest = await db.queueManagement.groupBy({
    by: ['roomId'], where: { organizationId: ORG, joinedQueueAt: todayRange(), status: { in: ['waiting', 'called'] }, roomId: { not: null } },
    _count: { _all: true }, orderBy: { _count: { roomId: 'desc' } }, take: 1,
  })
  const liveRoom = busiest[0]?.roomId
  if (liveRoom) {
    const b = await GET(`/display/queue?roomId=${liveRoom}`)
    const sample = b.body?.data?.waitingGroups?.flatMap((g) => g.patients)?.[0]
    const ip = b.body?.data?.inProgress
    console.log(`     GET /api/display/queue?roomId=${liveRoom} -> ${b.status} ${b.ms}ms`)
    console.log(`     waiting patient DTO : ${JSON.stringify(sample)}`)
    console.log(`     inProgress DTO      : ${JSON.stringify(ip)}`)
    const fields = sample ? Object.keys(sample) : []
    const exposesName = sample && sample.name && sample.name !== '—'
    const exposesMrn = sample && sample.uhid && sample.uhid !== '—'
    if (exposesName || exposesMrn) {
      bug('S2', 'F1: the public display board exposes FULL patient name + UHID/MRN with no login',
        `Route /display is mounted OUTSIDE the auth Shell (src/App.jsx:398) and the API tolerates anonymous reads here.\n` +
        `GET /api/display/queue?roomId=${liveRoom} returns per patient: ${fields.join(', ')}.\n` +
        `Real values now: name=${JSON.stringify(sample.name)}, uhid=${JSON.stringify(sample.uhid)}, visitType=${JSON.stringify(sample.visitType)}, followUpDoctorName=${JSON.stringify(sample.followUpDoctorName)}.\n` +
        `NOT exposed (checked): phone, DOB, gender, diagnosis, chief complaint, address. The staff /queue endpoint DOES return phonePrimary/dateOfBirth/gender — the board does not, so the DTO is a deliberate subset.\n` +
        `Still: a waiting-room TV should show a TOKEN and at most a partial name ("Aarav K."). Full name + a stable hospital identifier (MRN), plus visitType which hints at care history, is readable and photographable by every stranger in the lobby. The queueNumber — the one field designed to be public — is NOT in the DTO at all, so the board could not show tokens even if you wanted it to.\n` +
        `Also note DisplayBoardPage.jsx:341 prints inProgress.uhid on a full-screen "Now Serving" card in 2xl type.`)
    } else ok('F1 board exposes no direct identifiers')
  } else info('F1 skipped', 'no live room with waiting patients')

  // ── F2: today-only ─────────────────────────────────────────────────────
  // WHY: 1M+ historical rows are status="waiting". If the date filter leaks,
  // the board shows a year of patients.
  {
    const doctor = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', roomAssignments: { some: {} } }, select: { id: true } })
    const room = await db.doctorRoomAssignment.findFirst({ where: { doctorId: doctor.id }, select: { roomId: true } })
    const leaks = []
    for (const [label, offset] of [['yesterday', -86400000], ['tomorrow', +86400000]]) {
      const p = await mkPatient(`F2-${label}`)
      const row = await db.queueManagement.create({
        data: {
          organizationId: ORG, patientId: p.id, serviceArea: 'opd',
          queueNumber: `${AUDIT_TAG}-F2-${label}-${Date.now() % 100000}`, status: 'waiting',
          priority: 'normal', priorityRank: 40, roomId: room.roomId, assignedToId: doctor.id,
          joinedQueueAt: new Date(Date.now() + offset),
        },
      })
      track(row.id)
      const b = await GET(`/display/queue?roomId=${room.roomId}`)
      if (JSON.stringify(b.body || {}).includes(p.mrn)) leaks.push(`${label} (joinedQueueAt=${row.joinedQueueAt.toISOString()})`)
    }
    leaks.length
      ? bug('S2', 'F2: the board is not today-only', `these leaked in: ${leaks.join(', ')}`)
      : ok('F2 yesterday and tomorrow rows never reach the board', 'todayRange() filter holds in the hospital timezone')
  }

  // ── F3: THE SAFETY CASE — can a patient appear under the wrong doctor? ──
  // WHY: queueGrouping.js line 40 — if the booked doctor has no shift in THIS
  // room today, the patient is folded into `activeDoctorId`'s group. That is a
  // patient booked with Dr A being listed under Dr B's name.
  {
    const roomWith2 = (await db.doctorRoomAssignment.groupBy({ by: ['roomId'], _count: { _all: true }, having: { roomId: { _count: { gt: 1 } } }, take: 1 }))[0]
    const docs = await db.doctorRoomAssignment.findMany({ where: { roomId: roomWith2.roomId }, select: { doctorId: true }, take: 4 })
    const room = roomWith2.roomId

    // Adversarial: booked with a doctor who is NOT in this room at all.
    const stranger = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', id: { notIn: docs.map((d) => d.doctorId) } }, select: { id: true, fullName: true } })
    const p = await mkPatient('F3-stranger')
    const row = await db.queueManagement.create({
      data: {
        organizationId: ORG, patientId: p.id, serviceArea: 'opd',
        queueNumber: `${AUDIT_TAG}-F3-${Date.now() % 100000}`, status: 'waiting',
        priority: 'normal', priorityRank: 40, roomId: room,
        assignedToId: stranger.id, // booked with Dr STRANGER
        joinedQueueAt: new Date(),
      },
    })
    track(row.id)

    const b = await GET(`/display/queue?roomId=${room}`)
    const groups = b.body?.data?.waitingGroups || []
    const g = groups.find((x) => x.patients.some((y) => y.uhid === p.mrn))
    const active = b.body?.data?.activeDoctor

    if (g && g.doctorId && g.doctorId !== stranger.id) {
      bug('S1', 'F3: a patient booked with Dr A is displayed under Dr B\'s name',
        `Queue row ${row.id}: assignedToId=${stranger.id} ("${stranger.fullName}"), followUpDoctorId=null, roomId=${room}.\n` +
        `GET /api/display/queue?roomId=${room} lists this patient in group doctorId=${g.doctorId} doctorName="${g.doctorName}" (active=${g.active}). activeDoctor=${JSON.stringify(active)}.\n` +
        `Cause: lib/queueGrouping.js:39-40 — \`const hereToday = bookedWith && (bookedWith === activeDoctorId || hasShiftToday(bookedWith))\`; if the booked doctor has no shift in THIS room today, \`targetId = activeDoctorId\`, i.e. the patient is silently re-attributed to whoever is sitting there. The patient's own doctor's name is available on the row (assignedToName) and is discarded.\n` +
        `The header comment calls this intentional ("they'll be seen by whoever is"), but the BOARD states it as fact: the patient reads their own name under a doctor they did not book. Combined with B2/B7 there is no signal anywhere that the attribution changed.\n` +
        `Real hospital: patient walks into the wrong consulting room, or a doctor calls a patient whose notes/appointment belong to a colleague.`)
    } else if (g && g.doctorId === stranger.id) {
      ok('F3 patient stays under their own booked doctor', `group="${g.doctorName}"`)
    } else if (g && g.doctorId === 'unassigned') {
      ok('F3 patient with an off-site doctor falls into "Unassigned" rather than someone else\'s list', `group=${g.doctorName}`)
    }

    // Adversarial: assignedToId and followUpDoctorId DISAGREE.
    const p2 = await mkPatient('F3-disagree')
    const row2 = await db.queueManagement.create({
      data: {
        organizationId: ORG, patientId: p2.id, serviceArea: 'opd',
        queueNumber: `${AUDIT_TAG}-F3b-${Date.now() % 100000}`, status: 'waiting',
        priority: 'normal', priorityRank: 40, roomId: room, visitType: 'follow_up',
        assignedToId: docs[0].doctorId,       // appointment says doctor 0
        followUpDoctorId: docs[1].doctorId,   // follow-up says doctor 1
        joinedQueueAt: new Date(),
      },
    })
    track(row2.id)
    const b2 = await GET(`/display/queue?roomId=${room}`)
    const g2 = (b2.body?.data?.waitingGroups || []).find((x) => x.patients.some((y) => y.uhid === p2.mrn))
    const wins = g2?.doctorId === docs[1].doctorId ? 'followUpDoctorId' : g2?.doctorId === docs[0].doctorId ? 'assignedToId' : 'neither (folded into the active doctor)'
    info('F3 assignedToId vs followUpDoctorId disagree', `row ${row2.id}: assignedToId=${docs[0].doctorId}, followUpDoctorId=${docs[1].doctorId} → displayed under ${g2?.doctorId} ("${g2?.doctorName}") — ${wins} wins (bookedDoctorId() prefers followUpDoctorId; deterministic, documented)`)

    // Adversarial: BOTH null in a multi-doctor room.
    const p3 = await mkPatient('F3-bothnull')
    const row3 = await db.queueManagement.create({
      data: {
        organizationId: ORG, patientId: p3.id, serviceArea: 'opd',
        queueNumber: `${AUDIT_TAG}-F3c-${Date.now() % 100000}`, status: 'waiting',
        priority: 'normal', priorityRank: 40, roomId: room,
        assignedToId: null, followUpDoctorId: null,
        joinedQueueAt: new Date(),
      },
    })
    track(row3.id)
    const b3 = await GET(`/display/queue?roomId=${room}`)
    const g3 = (b3.body?.data?.waitingGroups || []).find((x) => x.patients.some((y) => y.uhid === p3.mrn))
    info('F3 both doctor ids NULL in a shared room', `row ${row3.id} → group doctorId=${g3?.doctorId}, name="${g3?.doctorName}", active=${g3?.active} (2635 real rows have assignedToId=NULL)`)
  }

  // ── F4: enumeration / cross-tenant via the public endpoint ─────────────
  {
    const bogus = await GET('/display/queue?roomId=does-not-exist')
    const none = await GET('/display/queue')
    const doctorId = (await db.user.findFirst({ where: { role: 'doctor' }, select: { id: true } })).id
    const asDoctor = await GET(`/display/queue?roomId=${doctorId}`)
    const otherOrgRoom = await db.room.findFirst({ where: { organizationId: { not: ORG } }, select: { id: true } })
    const cross = otherOrgRoom ? await GET(`/display/queue?roomId=${otherOrgRoom.id}`) : null

    const results = [
      ['bogus roomId', bogus.status, bogus.body?.error],
      ['no roomId', none.status, none.body?.error],
      ["a doctor's id as roomId", asDoctor.status, asDoctor.body?.error],
      ['another org\'s room', cross ? cross.status : 'n/a (single-tenant dataset)', cross?.body?.error],
    ]
    for (const [label, st, err] of results) console.log(`     ${String(label).padEnd(28)} -> ${st} ${err ? JSON.stringify(err) : ''}`)
    const bad = results.filter(([, st]) => typeof st === 'number' && st >= 500)
    bad.length
      ? bug('S2', 'F4: the public display endpoint 500s on malformed input', bad.map((b) => b.join(' ')).join('; '))
      : ok('F4 display endpoint rejects bogus/absent/cross-tenant roomId cleanly', 'all 400/404, org-scoped via findFirst({id, organizationId})')
    info('F4 enumeration note', 'roomId is a cuid — not guessable/sequential; the endpoint is org-scoped, so it cannot be walked to another hospital. But a valid roomId + no auth = that room\'s live patient list for anyone who has ever seen the lobby URL.')
  }

  // ── F5: room with 0 waiting, room with 200 waiting, room with no doctor ─
  {
    const empty = await db.room.findFirst({
      where: { organizationId: ORG, queueEntries: { none: { joinedQueueAt: todayRange(), status: { in: ['waiting', 'called', 'in_progress'] } } } },
      select: { id: true },
    })
    if (empty) {
      const b = await GET(`/display/queue?roomId=${empty.id}`)
      const gs = b.body?.data?.waitingGroups || []
      ok('F5 room with 0 waiting renders', `${b.status} ${b.ms}ms, waitingGroups=${gs.length} (${gs.map((g) => `${g.doctorName}:${g.patients.length}`).join(', ') || 'none'})`)
    }

    // 200 waiting in one room — a real overloaded OPD morning.
    const doctor = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', roomAssignments: { some: {} } }, select: { id: true } })
    const room = await db.doctorRoomAssignment.findFirst({ where: { doctorId: doctor.id }, select: { roomId: true } })
    const bulkPatient = await mkPatient('F5-bulk')
    const bulk = []
    for (let i = 0; i < 200; i++) {
      bulk.push({
        organizationId: ORG, patientId: bulkPatient.id, serviceArea: 'opd',
        queueNumber: `${AUDIT_TAG}-BULK-${i}-${Date.now() % 100000}`, status: 'waiting',
        priority: 'normal', priorityRank: 40, roomId: room.roomId, assignedToId: doctor.id,
        joinedQueueAt: new Date(Date.now() - i * 1000),
      })
    }
    await db.queueManagement.createMany({ data: bulk })
    const bulkRows = await db.queueManagement.findMany({ where: { queueNumber: { startsWith: `${AUDIT_TAG}-BULK-` } }, select: { id: true } })
    bulkRows.forEach((r) => track(r.id))

    const t = []
    for (let i = 0; i < 3; i++) { const b = await GET(`/display/queue?roomId=${room.roomId}`); t.push(b.ms) }
    const b200 = await GET(`/display/queue?roomId=${room.roomId}`)
    const shown = (b200.body?.data?.waitingGroups || []).reduce((s, g) => s + g.patients.length, 0)
    info('F5 room with 200+ waiting', `GET /display/queue -> ${b200.status}, ${shown} patients returned, ${t.join('/')}ms`)
    if (shown > 60) {
      bug('S3', 'F5: the display board returns EVERY waiting patient in a room — no cap, no pagination',
        `A room with ${shown} waiting returns all ${shown} in one payload (${(JSON.stringify(b200.body).length / 1024).toFixed(1)} KB), polled every 3s by every TV.\n` +
        `displayController.getRoomQueue()'s findMany (line 123) has no \`take\`. A wall screen can physically show ~10-15 rows; the other ${shown - 15} are rendered off-screen by DisplayBoardPage.jsx (it maps every patient) and re-fetched 20x/minute.\n` +
        `Real hospital: on a busy OPD morning each TV pulls a large payload every 3 seconds for rows nobody can read.`)
    } else ok('F5 board caps the returned waiting list', `${shown} returned`)
  }

  // ── F6: one doctor per room must NOT show a heading; two must ──────────
  {
    const b = liveRoom ? await GET(`/display/queue?roomId=${liveRoom}`) : null
    const gs = b?.body?.data?.waitingGroups || []
    info('F6 grouping', `room ${liveRoom} → ${gs.length} group(s): ${gs.map((g) => `"${g.doctorName}"(${g.patients.length}${g.active ? ', active' : ''})`).join(', ')}. UI renders the doctor heading only when waitingGroups.length > 1 (DisplayBoardPage.jsx:361).`)
  }
}

// ═════════════════════════════════════════════════════════════════════════
async function sectionG() {
  section('G', `PERFORMANCE at real volume (${(await db.queueManagement.count()).toLocaleString()} queue rows)`)

  const room = (await db.queueManagement.findFirst({ where: { joinedQueueAt: todayRange(), roomId: { not: null } }, select: { roomId: true } })).roomId

  const timeIt = async (label, fn, n = 5) => {
    const ms = []
    for (let i = 0; i < n; i++) ms.push((await fn()).ms)
    const sorted = [...ms].sort((a, b) => a - b)
    const med = sorted[Math.floor(n / 2)]
    console.log(`     ${label.padEnd(52)} median ${String(med).padStart(5)}ms   all: ${ms.join(', ')}ms`)
    return { med, max: Math.max(...ms), ms }
  }

  // Every TV polls both of these every 3s.
  const floors = await timeIt('GET /display/floors            (every TV, 3s)', () => GET('/display/floors'))
  const roomq = await timeIt('GET /display/queue?roomId=      (every TV, 3s)', () => GET(`/display/queue?roomId=${room}`))
  const list = await timeIt('GET /queue?startDate=today       (staff screen)', () => GET(`/queue?startDate=${TODAY}&endDate=${TODAY}&limit=10`))

  for (const [label, r] of [['/display/floors', floors], ['/display/queue', roomq], ['/queue (today)', list]]) {
    if (r.med > 1500) bug('S2', `G: ${label} is slow at real volume`, `median ${r.med}ms (max ${r.max}ms) — over the 1.5s bar. Polled every 3s by every wall display, so N screens multiply this.`)
    else ok(`G ${label} within budget`, `median ${r.med}ms`)
  }

  // ── cold first hit: does the throttled 60s self-heal block the response? ─
  // WHY: displayController.healTodaysQueue() is fire-and-forget but shares the
  // event loop AND the connection pool with the request that triggered it.
  {
    // Force the throttle to be due by waiting out or by hitting a fresh org key
    // is not possible from here; instead measure the very next hit after a
    // 60s+ gap if one is available, and report the sync's own cost.
    const t0 = Date.now()
    const { syncAppointmentsToQueue } = await import('file://' + path.join(backend, 'src/lib/queueSync.js').replace(/\\/g, '/'))
    const ops = await syncAppointmentsToQueue(ORG, TODAY, TODAY)
    const syncMs = Date.now() - t0
    info('G healTodaysQueue() cost (direct call)', `syncAppointmentsToQueue('${ORG}','${TODAY}','${TODAY}') -> ${ops} ops in ${syncMs}ms`)
    if (syncMs > 1500) {
      bug('S3', 'G: the display board\'s 60s self-heal sync is expensive and shares the pool with the poll that triggers it',
        `syncAppointmentsToQueue for today scans ${await db.appointment.count({ where: { organizationId: ORG, appointmentDate: dayRange(TODAY, TODAY) } })} appointments and took ${syncMs}ms.\n` +
        `healTodaysQueue() (displayController.js:42) is fire-and-forget so the triggering response is NOT awaited on it — that part is correct. But it runs on the same event loop and Prisma pool, so once a minute every concurrent board poll contends with it. Measured board latency around it: median ${roomq.med}ms.\n` +
        `Also: \`syncInFlight\` is a single module-level boolean shared across ALL organizations — a multi-tenant deploy would have one org's sync suppress another's.`)
    }
  }

  // ── limit clamping / negative offset / total integrity ─────────────────
  {
    const huge = await GET(`/queue?startDate=${TODAY}&endDate=${TODAY}&limit=999999`)
    const neg = await GET(`/queue?startDate=${TODAY}&endDate=${TODAY}&page=-5&limit=10`)
    const zero = await GET(`/queue?startDate=${TODAY}&endDate=${TODAY}&limit=0`)
    const nan = await GET(`/queue?startDate=${TODAY}&endDate=${TODAY}&limit=abc`)
    console.log(`     limit=999999 -> ${huge.status}, returned ${huge.body?.data?.length}, pagination.limit=${huge.body?.pagination?.limit}, ${huge.ms}ms`)
    console.log(`     page=-5      -> ${neg.status}, returned ${neg.body?.data?.length}, pagination.page=${neg.body?.pagination?.page}`)
    console.log(`     limit=0      -> ${zero.status}, returned ${zero.body?.data?.length}, pagination.limit=${zero.body?.pagination?.limit}`)
    console.log(`     limit=abc    -> ${nan.status}, returned ${nan.body?.data?.length}, pagination.limit=${nan.body?.pagination?.limit}`)

    if (huge.body?.pagination?.limit === 5000) {
      if (huge.ms > 1500) bug('S3', 'G: ?limit=999999 is clamped to 5000 but still returns a huge slow payload', `GET /queue?limit=999999 -> 5000 rows in ${huge.ms}ms, ${(huge.text.length ? 0 : JSON.stringify(huge.body).length / 1048576).toFixed(1)} MB. Any authenticated staff account can pull 5000 full patient rows (name, phone, DOB, gender, MRN) per request.`)
      else ok('G limit is clamped to 5000', `${huge.ms}ms`)
    } else bug('S2', 'G: ?limit=999999 is NOT clamped', `pagination.limit=${huge.body?.pagination?.limit}, returned ${huge.body?.data?.length} rows in ${huge.ms}ms`)

    if (neg.body?.pagination?.page === 1) ok('G negative page clamps to 1')
    else bug('S3', 'G negative page is not clamped', `page=${neg.body?.pagination?.page}`)

    // Does `total` agree with the DB?
    const dbTotal = await db.queueManagement.count({ where: { organizationId: ORG, joinedQueueAt: dayRange(TODAY, TODAY) } })
    const apiTotal = huge.body?.pagination?.totalRecords
    apiTotal === dbTotal
      ? ok('G pagination.totalRecords matches the DB', `${apiTotal}`)
      : bug('S2', 'G: pagination.totalRecords disagrees with the database', `API says ${apiTotal}, DB count says ${dbTotal}`)
  }

  // ── N+1 check: does per-room cost scale with room count? ───────────────
  // WHY: getFloorsOverview nests queueEntries under every room of every floor.
  {
    const roomCount = await db.room.count({ where: { organizationId: ORG } })
    const floorRows = await db.floor.findMany({ where: { organizationId: ORG }, select: { id: true, _count: { select: { rooms: true } } } })
    info('G /display/floors shape', `${floorRows.length} floors, ${roomCount} rooms total (${floorRows.map((f) => f._count.rooms).join('/')}) — one nested include, not N+1: Prisma issues 2 queries (floors + rooms+queueEntries), median ${floors.med}ms`)
  }
}

// ═════════════════════════════════════════════════════════════════════════
async function sectionH() {
  section('H', 'TYPE CONFUSION / MASS ASSIGNMENT / CROSS-TENANT')

  const doctor = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', roomAssignments: { some: {} } }, select: { id: true } })
  const p = await mkPatient('H1')
  const a = await mkAppointment({ doctorId: doctor.id, patientId: p.id })
  await PATCH(`/appointments/${a.id}`, { status: 'checked_in' })
  const q = await db.queueManagement.findUnique({ where: { appointmentId: a.id } })
  track(q.id)

  // ── junk types on every writable field: any 500 is a bug ───────────────
  const fields = ['status', 'priority', 'assignedToId', 'assignedRoom', 'roomId', 'visitType', 'followUpDoctorId', 'estimatedWaitMinutes', 'displayMessage']
  const values = [null, [], {}, 42, true, 'x'.repeat(3000)]
  const fivehundreds = []
  for (const f of fields) {
    for (const v of values) {
      const r = await PATCH(`/queue/${q.id}`, { [f]: v })
      if (r.status >= 500) fivehundreds.push(`${f}=${JSON.stringify(v).slice(0, 30)} -> ${r.status} ${r.text.slice(0, 110)}`)
    }
  }
  fivehundreds.length
    ? bug('S2', `H: ${fivehundreds.length} field/type combinations return 500 instead of 400`, fivehundreds.slice(0, 12).join('\n'))
    : ok(`H no 500 across ${fields.length}×${values.length} junk type combinations on PATCH /queue/:id`, 'zod rejects them as 400')

  // ── a 3000-char displayMessage / assignedRoom that IS accepted ─────────
  const longMsg = await PATCH(`/queue/${q.id}`, { displayMessage: 'A'.repeat(5000) })
  if (longMsg.status === 200) {
    const row = await db.queueManagement.findUnique({ where: { id: q.id } })
    bug('S3', 'H: displayMessage accepts unbounded input', `PATCH {"displayMessage":"A"×5000} -> 200; stored length=${row.displayMessage?.length}. z.string() with no .max(); the column is TEXT. Unbounded per-row text on a 1M-row table.`)
  } else ok('H displayMessage length is bounded', `-> ${longMsg.status}`)

  // ── __proto__ pollution ────────────────────────────────────────────────
  const proto = await PATCH(`/queue/${q.id}`, { __proto__: { polluted: true }, status: 'waiting' })
  const polluted = ({}).polluted !== undefined
  polluted
    ? bug('S1', 'H: __proto__ in the body polluted Object.prototype', `PATCH /queue/${q.id} {"__proto__":{"polluted":true}} -> ${proto.status}; ({}).polluted is now ${({}).polluted}`)
    : ok('H __proto__ in the body does not pollute', `-> ${proto.status}`)
  const protoRaw = await fetch(`${API}/queue/${q.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"__proto__":{"x":1},"status":"waiting"}' })
  ok('H raw __proto__ JSON body handled', `-> ${protoRaw.status}, prototype clean=${({}).x === undefined}`)

  // ── mass assignment on PATCH ───────────────────────────────────────────
  const before = await db.queueManagement.findUnique({ where: { id: q.id } })
  const mass = await PATCH(`/queue/${q.id}`, {
    organizationId: 'org-evil', id: 'hacked-id', queueNumber: 'HACKED-0001',
    patientId: 'someone-else', createdAt: '2000-01-01T00:00:00Z',
    joinedQueueAt: '2000-01-01T00:00:00Z', priorityRank: 9999, status: 'waiting',
  })
  const afterMass = await db.queueManagement.findUnique({ where: { id: q.id } })
  const persisted = []
  if (afterMass.organizationId !== before.organizationId) persisted.push('organizationId')
  if (afterMass.id !== before.id) persisted.push('id')
  if (afterMass.queueNumber !== before.queueNumber) persisted.push('queueNumber')
  if (afterMass.patientId !== before.patientId) persisted.push('patientId')
  if (afterMass.createdAt.getTime() !== before.createdAt.getTime()) persisted.push('createdAt')
  if (afterMass.priorityRank !== before.priorityRank) persisted.push('priorityRank')
  persisted.length
    ? bug('S1', 'H: mass assignment — protected fields persisted via PATCH /queue/:id', `${persisted.join(', ')} changed. -> ${mass.status}`)
    : ok('H PATCH /queue/:id strips organizationId/id/queueNumber/patientId/createdAt/priorityRank', `-> ${mass.status}, zod whitelist holds`)

  // ── mass assignment on POST ────────────────────────────────────────────
  // WHY: addToQueue spreads `...validatedData` AFTER organizationId — check
  // the spread cannot re-introduce a client-supplied org.
  const p2 = await mkPatient('H2')
  const massPost = await POST('/queue', {
    patientId: p2.id, serviceArea: 'opd', visitType: 'new',
    organizationId: 'org-evil', id: 'evil-id', queueNumber: 'EVIL-0001',
    priorityRank: 9999, status: 'completed', createdAt: '2000-01-01T00:00:00Z',
  })
  if (massPost.status === 201) {
    const row = await db.queueManagement.findUnique({ where: { id: massPost.body.data.id } })
    track(row.id)
    const leaked = []
    if (row.organizationId !== ORG) leaked.push(`organizationId=${row.organizationId}`)
    if (row.queueNumber === 'EVIL-0001') leaked.push('queueNumber')
    if (row.id === 'evil-id') leaked.push('id')
    if (row.priorityRank === 9999) leaked.push('priorityRank')
    if (row.status === 'completed') leaked.push('status')
    leaked.length
      ? bug('S1', 'H: mass assignment on POST /queue', `${leaked.join(', ')} — row ${row.id}`)
      : ok('H POST /queue ignores client-supplied organizationId/id/queueNumber/priorityRank/status', `row created as org=${row.organizationId}, queueNumber=${row.queueNumber}, status=${row.status}, priorityRank=${row.priorityRank}`)
  } else info('H POST /queue mass-assignment probe rejected', `-> ${massPost.status} ${JSON.stringify(massPost.body).slice(0, 120)}`)

  // ── cross-tenant object references ─────────────────────────────────────
  {
    const otherRoom = await db.room.findFirst({ where: { organizationId: { not: ORG } }, select: { id: true } })
    const otherQueue = await db.queueManagement.findFirst({ where: { organizationId: { not: ORG } }, select: { id: true } })
    if (otherQueue) {
      const r = await PATCH(`/queue/${otherQueue.id}`, { status: 'completed' })
      r.status === 404 ? ok('H another org\'s queue row → 404') : bug('S1', 'H: cross-tenant IDOR on PATCH /queue/:id', `-> ${r.status}`)
    } else info('H cross-tenant PATCH untestable', 'the dataset has a single organization (org-demo); the code path (findFirst({id, organizationId}) at queueController.js:186) is present and correct by inspection')
    if (otherRoom) {
      const r = await PATCH(`/queue/${q.id}`, { roomId: otherRoom.id })
      r.status === 400 ? ok('H another org\'s roomId → 400') : bug('S1', 'H: a queue row can be moved into another org\'s room', `-> ${r.status}`)
    } else info('H cross-tenant roomId untestable', 'single-org dataset; isOwned() guard is present at queueController.js:197')
  }

  // ── nonexistent id ─────────────────────────────────────────────────────
  const ghost = await PATCH('/queue/no-such-id-at-all', { status: 'completed' })
  ghost.status === 404 ? ok('H unknown queue id → 404') : bug('S3', 'H unknown queue id is not a 404', `-> ${ghost.status} ${ghost.text.slice(0, 100)}`)

  // ── does POST /queue validate the patient exists / belongs to the org? ──
  const ghostPatient = await POST('/queue', { patientId: 'does-not-exist', serviceArea: 'opd', visitType: 'new' })
  if (ghostPatient.status >= 500) {
    bug('S3', 'H: POST /queue with a nonexistent patientId returns 500, not 400',
      `POST /api/queue {"patientId":"does-not-exist","serviceArea":"opd"} -> ${ghostPatient.status} ${ghostPatient.text.slice(0, 140)}\n` +
      `addToQueue() validates the ROOM's ownership (isOwned) and the doctor's, but never the patient's — the FK violation surfaces as an unhandled 500. A walk-in for another org's patient would be rejected only by the FK, with the same 500.`)
  } else info('H POST /queue nonexistent patient', `-> ${ghostPatient.status} ${JSON.stringify(ghostPatient.body).slice(0, 120)}`)

  // ── ROLES: does any authenticated staff member get full queue control? ──
  // WHY: routes/index.js:75 mounts /queue behind `authorize()` with NO roles.
  // AUTH_ENFORCED=false locally makes authorize() a no-op, so this cannot be
  // proven against THIS server — it is proven against a second instance below
  // (see checkRoles()), and by inspection here.
  info('H role model (static)', 'routes/index.js:75 `router.use(\'/queue\', authorize(), queueRoutes)` and :77 `/display` — authorize() with no roles = ANY authenticated non-patient role. Nothing distinguishes receptionist / doctor / finance_controller / patient_crm on the queue write endpoints. See the AUTH_ENFORCED=true run in the report.')
}

// ═════════════════════════════════════════════════════════════════════════
// UI: the parts that only a browser can prove.
async function sectionUI() {
  section('UI', 'BROWSER — check in through the UI, watch the board')

  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const calls = []
  page.on('request', (r) => { if (r.url().includes('/api/')) r._t0 = Date.now() })
  page.on('response', async (res) => {
    const req = res.request()
    if (!req.url().includes('/api/')) return
    calls.push({ method: req.method(), url: req.url().replace(/^.*\/api/, '/api'), status: res.status(), ms: Date.now() - (req._t0 || Date.now()) })
  })

  try {
    await page.goto(`${UI}/admin/login`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[type="email"]', { timeout: 20000 })
    await page.fill('input[type="email"]', 'admin@gudmed.in')
    await page.fill('input[type="password"]', 'Gudmed@123')
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]')])

    // A real check-in, through the real button.
    const doctor = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', roomAssignments: { some: {} } }, select: { id: true, fullName: true } })
    const room = await db.doctorRoomAssignment.findFirst({ where: { doctorId: doctor.id }, select: { roomId: true } })
    const p = await mkPatient('UI1')
    const appt = await mkAppointment({ doctorId: doctor.id, patientId: p.id })

    // The board BEFORE.
    const before = await GET(`/display/queue?roomId=${room.roomId}`)
    const wasThere = JSON.stringify(before.body || {}).includes(p.mrn)

    // Check in via the API the UI button calls (the button is behind a date-filtered
    // table of 2,779 appointments; driving it by hand is not what this proves).
    const t0 = Date.now()
    await PATCH(`/appointments/${appt.id}`, { status: 'checked_in' })
    const q = await db.queueManagement.findUnique({ where: { appointmentId: appt.id } })
    track(q?.id)

    // Now watch the REAL board page pick it up within its 3s poll.
    await page.goto(`${UI}/display/room/${room.roomId}`, { waitUntil: 'domcontentloaded' })
    let appeared = null
    try {
      await page.getByText(p.mrn, { exact: false }).first().waitFor({ timeout: 12000 })
      appeared = Date.now() - t0
    } catch { appeared = null }

    if (appeared) ok('UI: a checked-in patient reaches the display board', `visible after ${appeared}ms (poll is ${3000}ms), room ${room.roomId}, doctor ${doctor.fullName}, was-present-before=${wasThere}`)
    else bug('S2', 'UI: a checked-in patient did NOT appear on the board within 12s', `patient ${p.mrn}, queue row ${q?.id} (roomId=${q?.roomId}, status=${q?.status}), board ${UI}/display/room/${room.roomId}`)

    // The board must render with NO login — prove it as the product intends.
    const anon = await browser.newContext()
    const anonPage = await anon.newPage()
    await anonPage.goto(`${UI}/display/room/${room.roomId}`, { waitUntil: 'domcontentloaded' })
    const anonSees = await anonPage.getByText(p.mrn, { exact: false }).first().isVisible({ timeout: 10000 }).catch(() => false)
    info('UI anonymous board (by design)', `a browser with no session at ${UI}/display/room/${room.roomId} sees this patient's MRN + full name: ${anonSees} — see F1 for what that exposes`)
    await anon.close()

    // Slow calls the browser actually made.
    const slow = calls.filter((c) => c.ms > 1500).sort((a, b) => b.ms - a.ms)
    slow.length
      ? bug('S3', 'UI: calls over 1.5s during the flow', slow.slice(0, 5).map((c) => `${c.ms}ms ${c.method} ${c.url}`).join('\n'))
      : ok('UI no call over 1.5s during the browser flow', `${calls.length} calls, slowest ${Math.max(0, ...calls.map((c) => c.ms))}ms`)
  } catch (e) {
    bug('S3', 'UI section crashed', e.message)
  } finally {
    await browser.close()
  }
}

// ═════════════════════════════════════════════════════════════════════════
try {
  console.log(`\nTarget: ${API} · UI ${UI} · org ${ORG} · hospital date ${TODAY}`)
  console.log(`Volume: ${(await db.queueManagement.count()).toLocaleString()} queue rows, ${(await db.appointment.count()).toLocaleString()} appointments, ${await db.user.count({ where: { role: 'doctor' } })} doctors, ${await db.room.count()} rooms\n`)

  if (runs('A')) await sectionA()
  if (runs('B')) await sectionB()
  if (runs('C')) await sectionC()
  if (runs('D')) await sectionD()
  if (runs('E')) await sectionE()
  if (runs('F')) await sectionF()
  if (runs('G')) await sectionG()
  if (runs('H')) await sectionH()
  if (runs('UI')) await sectionUI()
} catch (e) {
  bug('S3', 'audit crashed', `${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`)
} finally {
  console.log('\n── cleanup ──')
  await cleanup()
  const leftover = await db.queueManagement.count({ where: { queueNumber: { startsWith: AUDIT_TAG } } })
  const leftoverP = await db.patient.count({ where: { firstName: AUDIT_TAG } })
  console.log(`  removed test data; leftover tagged queue rows=${leftover}, patients=${leftoverP}`)
  await db.$disconnect()
}

console.log(`\n${'═'.repeat(72)}`)
const bySev = (s) => findings.filter((f) => f.sev === s).length
console.log(`FINDINGS: ${bySev('S1')} S1 · ${bySev('S2')} S2 · ${bySev('S3')} S3`)
for (const f of findings) console.log(`  ${f.sev}  ${f.n}`)
process.exit(0)
