// Hunts for real defects in real data — logic that is wrong, not style.
//
//   node scripts/bug-hunt.mjs                      # local
//   REMOTE_DATABASE_URL="..." node scripts/bug-hunt.mjs   # production
//
// Read-only. Each check states the invariant it is testing and prints the rows
// that break it, so a hit is actionable rather than a number.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const url = process.env.REMOTE_DATABASE_URL || process.env.DATABASE_URL
const isRemote = Boolean(process.env.REMOTE_DATABASE_URL)
const db = new PrismaClient(isRemote ? { datasources: { db: { url } } } : undefined)

let bugs = 0
const q = (sql) => db.$queryRawUnsafe(sql)
const ok = (name, detail = '') => console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`)
const bug = (name, detail) => { bugs++; console.log(`  ❌ ${name}\n       ${detail}`) }

console.log(`\n═══ BUG HUNT — ${isRemote ? 'PRODUCTION' : 'LOCAL'} ═══\n`)

// 1. A patient cannot be in two rooms at once.
{
  const r = await q(`
    SELECT COUNT(*)::int c FROM (
      SELECT 1 FROM "Appointment"
      WHERE status NOT IN ('cancelled','no_show','rescheduled') AND "doctorId" IS NOT NULL
      GROUP BY "patientId","appointmentDate","appointmentTime" HAVING COUNT(*) > 1
    ) x`)
  r[0].c === 0
    ? ok('no patient booked with two doctors at the same minute')
    : bug('patient booked with two doctors at the same minute', `${r[0].c} slot(s) — nothing in the app or DB prevents this; the unique index guards the DOCTOR's slot only`)
}

// 2. A doctor cannot be in two rooms at once (same day, overlapping shifts).
{
  const docs = await db.user.findMany({ where: { role: 'doctor' }, select: { id: true, fullName: true, preferences: true } })
  const offenders = []
  for (const d of docs) {
    let tt
    try { tt = JSON.parse(d.preferences || '{}').timetable } catch { continue }
    for (const [day, cfg] of Object.entries(tt?.weeklySlots || {})) {
      const shifts = (cfg?.shifts || []).filter((s) => s.start && s.end)
      const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m }
      const sorted = [...shifts].sort((a, b) => mins(a.start) - mins(b.start))
      for (let i = 1; i < sorted.length; i++) {
        if (mins(sorted[i].start) < mins(sorted[i - 1].end)) {
          offenders.push(`${d.fullName} ${day}: ${sorted[i - 1].start}-${sorted[i - 1].end} overlaps ${sorted[i].start}-${sorted[i].end}`)
        }
      }
    }
  }
  offenders.length === 0
    ? ok('no doctor has overlapping shifts on one day', `${docs.length} doctors checked`)
    : bug('doctor scheduled in two places at once', offenders.slice(0, 3).join('\n       ') + (offenders.length > 3 ? `\n       …and ${offenders.length - 3} more` : ''))
}

// 3. A shift must point at a room that exists and belongs to this org.
{
  const rooms = new Set((await db.room.findMany({ select: { id: true } })).map((r) => r.id))
  const docs = await db.user.findMany({ where: { role: 'doctor' }, select: { fullName: true, preferences: true } })
  const dangling = []
  for (const d of docs) {
    let tt
    try { tt = JSON.parse(d.preferences || '{}').timetable } catch { continue }
    for (const cfg of Object.values(tt?.weeklySlots || {})) {
      for (const s of cfg?.shifts || []) {
        if (s.roomId && !rooms.has(s.roomId)) dangling.push(`${d.fullName} -> room ${s.roomId}`)
      }
    }
  }
  dangling.length === 0
    ? ok('every shift points at a real room')
    : bug('shift points at a room that no longer exists', dangling.slice(0, 3).join('\n       '))
}

// 4. Queue rows must not exist for appointments that were cancelled.
{
  const r = await q(`
    SELECT COUNT(*)::int c FROM "QueueManagement" q
    JOIN "Appointment" a ON a.id = q."appointmentId"
    WHERE a.status IN ('cancelled','no_show','rescheduled')
      AND q.status IN ('waiting','called','in_progress')`)
  r[0].c === 0
    ? ok('no live queue row for a cancelled/no-show appointment')
    : bug('cancelled appointment still sitting in the queue', `${r[0].c} row(s) — cancelling an appointment does not remove its queue entry, so the board still calls the patient`)
}

// 5. Every queue row must belong to the org its patient belongs to.
{
  const r = await q(`
    SELECT COUNT(*)::int c FROM "QueueManagement" q
    JOIN "Patient" p ON p.id = q."patientId"
    WHERE p."organizationId" <> q."organizationId"`)
  r[0].c === 0 ? ok('no cross-tenant queue rows') : bug('queue row belongs to a different org than its patient', `${r[0].c} row(s)`)
}

// 6. A room's doctors should all be from the room's department.
{
  const rooms = await db.room.findMany({
    include: { department: { select: { name: true } }, doctorLinks: { include: { doctor: { select: { specialization: true } } } } },
  })
  const mixed = rooms.filter((r) => new Set(r.doctorLinks.map((l) => l.doctor.specialization).filter(Boolean)).size > 1)
  const mismatch = rooms.filter((r) => r.department && r.doctorLinks.some((l) => l.doctor.specialization && l.doctor.specialization !== r.department.name))
  mixed.length === 0 && mismatch.length === 0
    ? ok('every room holds one department only', `${rooms.length} rooms`)
    : bug('room mixes departments', `${mixed.length} with >1 specialization, ${mismatch.length} whose doctors do not match the room's department`)
}

// 7. queueNumber must be unique per org.
{
  const r = await q(`SELECT COUNT(*)::int c FROM (SELECT 1 FROM "QueueManagement" GROUP BY "organizationId","queueNumber" HAVING COUNT(*)>1) x`)
  r[0].c === 0 ? ok('no duplicate queue numbers') : bug('two patients share a queue number', `${r[0].c} group(s)`)
}

// 8. An appointment's invoice must be for the same patient.
{
  const r = await q(`
    SELECT COUNT(*)::int c FROM "Invoice" i
    JOIN "Appointment" a ON a.id = i."appointmentId"
    WHERE i."patientId" <> a."patientId"`)
  r[0].c === 0 ? ok('every appointment invoice bills the right patient') : bug('invoice billed to the wrong patient', `${r[0].c} invoice(s)`)
}

// 9. Room numbers must be unique on a floor.
{
  const r = await q(`SELECT COUNT(*)::int c FROM (SELECT 1 FROM "Room" GROUP BY "organizationId","floorId","roomNumber" HAVING COUNT(*)>1) x`)
  r[0].c === 0 ? ok('room numbers unique per floor') : bug('two rooms share a number on one floor', `${r[0].c}`)
}

// 10. Today's queue rows that have a doctor should have a room.
{
  const r = await q(`
    SELECT COUNT(*)::int c FROM "QueueManagement"
    WHERE "assignedToId" IS NOT NULL AND "roomId" IS NULL
      AND "joinedQueueAt" >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata')`)
  r[0].c === 0 ? ok("today's queue rows all have a room") : bug('queue row has a doctor but no room', `${r[0].c} row(s) — they cannot appear on the board`)
}

// 11. A follow-up should point at a doctor the patient has actually seen.
{
  const r = await q(`
    SELECT COUNT(*)::int c FROM "QueueManagement" q
    WHERE q."followUpDoctorId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Consultation" c
        WHERE c."patientId" = q."patientId" AND c."doctorId" = q."followUpDoctorId"
      )`)
  r[0].c === 0
    ? ok('every follow-up points at a doctor the patient has seen')
    : bug('follow-up to a doctor the patient never consulted', `${r[0].c} row(s) — visitType/followUpDoctorId was set without a prior consultation to back it`)
}

// 12. Appointment times must be zero-padded, or string sorting breaks the queue order.
{
  const r = await q(`SELECT COUNT(*)::int c FROM "Appointment" WHERE "appointmentTime" !~ '^[0-9]{2}:[0-9]{2}$'`)
  r[0].c === 0
    ? ok('every appointment time is zero-padded HH:mm')
    : bug('unpadded appointment time', `${r[0].c} row(s) — "9:00" sorts after "10:00", so the 9am patient drops to the bottom of the queue`)
}

console.log(`\n${'─'.repeat(56)}`)
console.log(bugs === 0 ? '✅ No defects found.' : `❌ ${bugs} defect(s) found.`)
console.log('')
await db.$disconnect()
process.exit(bugs ? 1 : 0)
