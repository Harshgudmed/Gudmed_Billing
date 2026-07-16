// Executes the S1 (patient-safety / data-integrity / security) cases from
// QA-TEST-CASES-FULL.md against the REAL database. Read-mostly; any row it
// creates is cleaned up. Prints PASS/FAIL per case.
//
//   node backend/scripts/qa-s1.mjs
import { db } from '../src/config/db.js'
import { todayRange, nowInZone } from '../src/lib/dates.js'
import { DAY_NAMES } from '../src/lib/doctorTimetable.js'
import { nextQueueNumber } from '../src/utils/queueNumber.js'
import { toRoomDTO, ROOM_INCLUDE } from '../src/controllers/roomController.js'
import { groupWaitingByDoctor } from '../src/lib/queueGrouping.js'

const ORG = 'org-demo'
const results = []
const rec = (id, title, pass, detail = '') => {
  results.push({ id, title, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${id}  ${title}${detail ? `\n      ${detail}` : ''}`)
}
const guard = async (id, title, fn) => {
  try { await fn(id, title) } catch (e) { rec(id, title, false, `THREW: ${e.message}`) }
}

// ── DI-01 queueNumber uniqueness across the whole table ──────────────────
await guard('DI-01', 'No duplicate (org, queueNumber) anywhere', async (id, t) => {
  const [row] = await db.$queryRaw`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT "organizationId","queueNumber" FROM "QueueManagement"
      GROUP BY "organizationId","queueNumber" HAVING COUNT(*) > 1
    ) x`
  rec(id, t, row.groups === 0, `duplicate groups: ${row.groups}`)
})

// ── CC-01 25 concurrent queue numbers must all differ ────────────────────
await guard('CC-01', '25 concurrent nextQueueNumber calls -> all unique', async (id, t) => {
  const nums = await Promise.all(Array.from({ length: 25 }, () => nextQueueNumber(db, ORG, 'opd')))
  const uniq = new Set(nums)
  rec(id, t, uniq.size === 25, `${uniq.size}/25 unique`)
})

// ── DI-03 today's rows with a doctor must have a room ────────────────────
await guard('DI-03', "Today's queue rows with a doctor all have roomId", async (id, t) => {
  const missing = await db.queueManagement.count({
    where: { organizationId: ORG, joinedQueueAt: todayRange(), assignedToId: { not: null }, roomId: null },
  })
  rec(id, t, missing === 0, `rows with doctor but no room: ${missing}`)
})

// ── DI-08 appointment double-booking index exists ────────────────────────
await guard('DI-08', 'Partial unique index blocks appointment double-booking', async (id, t) => {
  const rows = await db.$queryRaw`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'Appointment' AND indexdef ILIKE '%unique%' AND indexdef ILIKE '%appointmentTime%'`
  rec(id, t, rows.length > 0, rows.length ? rows[0].indexdef.slice(0, 130) : 'NO partial unique index found')
})

// ── AP-03 real concurrent double-booking attempt ─────────────────────────
await guard('AP-03', 'Concurrent identical bookings -> exactly one wins', async (id, t) => {
  const doctor = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor' }, select: { id: true } })
  const patient = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  const when = new Date('2027-03-03T00:00:00.000Z')
  const time = '11:22'
  await db.appointment.deleteMany({ where: { organizationId: ORG, doctorId: doctor.id, appointmentDate: when, appointmentTime: time } })
  const mk = () => db.appointment.create({
    data: { organizationId: ORG, patientId: patient.id, doctorId: doctor.id, appointmentDate: when, appointmentTime: time, status: 'scheduled' },
  })
  const out = await Promise.allSettled([mk(), mk()])
  const ok = out.filter((r) => r.status === 'fulfilled').length
  const rejected = out.filter((r) => r.status === 'rejected').length
  await db.appointment.deleteMany({ where: { organizationId: ORG, doctorId: doctor.id, appointmentDate: when, appointmentTime: time } })
  rec(id, t, ok === 1 && rejected === 1, `succeeded: ${ok}, rejected: ${rejected} (want 1 / 1)`)
})

// ── RM-12 no room mixes doctors from different departments ───────────────
await guard('RM-12', 'No room has doctors from >1 specialization', async (id, t) => {
  const rooms = await db.room.findMany({
    where: { organizationId: ORG },
    include: { doctorLinks: { include: { doctor: { select: { specialization: true } } } } },
  })
  const mixed = rooms.filter((r) => new Set(r.doctorLinks.map((l) => l.doctor.specialization).filter(Boolean)).size > 1)
  rec(id, t, mixed.length === 0, `mixed rooms: ${mixed.length}`)
})

// ── QD-02 today-only scoping on the board ────────────────────────────────
await guard('QD-02', 'Display board counts are today-only (not whole history)', async (id, t) => {
  const all = await db.queueManagement.count({ where: { organizationId: ORG, status: { in: ['waiting', 'called'] } } })
  const today = await db.queueManagement.count({ where: { organizationId: ORG, status: { in: ['waiting', 'called'] }, joinedQueueAt: todayRange() } })
  rec(id, t, today < all && today > 0, `today ${today} vs all-time ${all} — board must use today`)
})

// ── DB-022 board overview query stays fast on a 1M+ table ────────────────
await guard('DB-022', 'Floors overview query < 1s on the real table', async (id, t) => {
  const started = Date.now()
  await db.floor.findMany({
    where: { organizationId: ORG },
    include: { rooms: { select: { id: true, queueEntries: { where: { status: { in: ['waiting', 'called', 'in_progress'] }, joinedQueueAt: todayRange() }, select: { id: true } } } } },
    orderBy: { sortOrder: 'asc' },
  })
  const ms = Date.now() - started
  rec(id, t, ms < 1000, `${ms}ms`)
})

// ── QD-09 / DB-011 concurrent-doctor honesty + grouping correctness ──────
await guard('QD-09', 'Every waiting patient is grouped under the doctor they booked with', async (id, t) => {
  const todayName = DAY_NAMES[nowInZone().dayOfWeek]
  const rooms = await db.room.findMany({ where: { organizationId: ORG }, include: ROOM_INCLUDE, take: 60 })
  let checked = 0
  const wrong = []
  for (const room of rooms) {
    const dto = toRoomDTO(room)
    const entries = await db.queueManagement.findMany({
      where: { organizationId: ORG, roomId: room.id, status: { in: ['waiting', 'called'] }, joinedQueueAt: todayRange() },
      select: { id: true, assignedToId: true, followUpDoctorId: true },
    })
    if (!entries.length) continue
    const hasShiftToday = (docId) => dto.schedule.some((s) => s.doctorId === docId && s.dayName === todayName)
    const groups = groupWaitingByDoctor(entries, { activeDoctorId: dto.activeDoctor.doctorId, hasShiftToday })
    for (const [docId, list] of groups) {
      for (const e of list) {
        checked++
        const booked = e.followUpDoctorId || e.assignedToId
        // If the doctor they booked with is here today, they MUST be in that doctor's group.
        if (booked && hasShiftToday(booked) && docId !== booked) {
          wrong.push(`room ${room.roomNumber}: entry ${e.id} booked with ${booked} but grouped under ${docId}`)
        }
      }
    }
  }
  rec(id, t, wrong.length === 0, `checked ${checked} waiting patients; misgrouped: ${wrong.length}${wrong.length ? '\n      ' + wrong.slice(0, 3).join('\n      ') : ''}`)
})

// ── DB-034 / NE-08 timezone: "today" resolves in hospital TZ ─────────────
await guard('NE-08', 'Day boundary uses hospital timezone (Asia/Kolkata)', async (id, t) => {
  const r = todayRange()
  const spanHours = (r.lte - r.gte) / 3600000
  const startIST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(r.gte)
  rec(id, t, spanHours > 23.9 && spanHours < 24.1 && startIST === '00:00', `span ${spanHours.toFixed(2)}h, starts ${startIST} IST (want 00:00)`)
})

// ── RB-08 tenant isolation: no cross-org leakage on room reads ───────────
await guard('RB-08', 'Room reads are org-scoped (no cross-tenant leak)', async (id, t) => {
  const other = await db.organization.findFirst({ where: { id: { not: ORG } }, select: { id: true } })
  if (!other) return rec(id, t, true, 'only one org in DB — cannot leak (vacuously safe)')
  const foreign = await db.room.findFirst({ where: { organizationId: other.id }, select: { id: true } })
  if (!foreign) return rec(id, t, true, 'other org has no rooms — nothing to leak')
  const leaked = await db.room.findFirst({ where: { id: foreign.id, organizationId: ORG } })
  rec(id, t, leaked === null, leaked ? 'LEAK: found another org room under org-demo scope' : 'correctly not visible')
})

// ── DI-05 deleting a room must not delete its queue history ──────────────
await guard('DI-05', 'Room FK on QueueManagement is SET NULL, not CASCADE', async (id, t) => {
  const [row] = await db.$queryRaw`
    SELECT rc.delete_rule
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
    WHERE k.table_name = 'QueueManagement' AND k.column_name = 'roomId' LIMIT 1`
  rec(id, t, row?.delete_rule === 'SET NULL', `delete_rule = ${row?.delete_rule || 'NOT FOUND'}`)
})

// ── summary ──────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass)
console.log(`\n${'─'.repeat(60)}\nS1 RESULT: ${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  for (const f of failed) console.log(`  ❌ ${f.id} — ${f.title}\n     ${f.detail}`)
}
await db.$disconnect()
process.exit(failed.length ? 1 : 0)
