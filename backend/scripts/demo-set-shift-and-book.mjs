// Demo setup: give named doctors one long shift on a given weekday, then book
// appointments into it so the display board has something live to show.
//
//   node scripts/demo-set-shift-and-book.mjs --doctors=atul,dhruv --day=Friday --from=00:00 --to=17:00 --date=2026-07-17 --each=5
//   ... --apply                     # write it
//   REMOTE_DATABASE_URL="..." ...   # against a remote database
//
// Dry run by default: it prints who it found, what their timetable would become
// and which slots it would book, and writes nothing.
//
// Overwrites ONLY the named weekday for the named doctors — their other days are
// left alone. Appointments are created through the same shape the app uses, so
// the queue sync picks them up normally.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const arg = (n, d = null) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d }
const APPLY = process.argv.includes('--apply')

const NAMES = (arg('doctors') || '').split(',').map((s) => s.trim()).filter(Boolean)
const DAY = arg('day')
const FROM = arg('from', '00:00')
const TO = arg('to', '17:00')
const DATE = arg('date')            // YYYY-MM-DD — the appointments' date
const EACH = Number(arg('each', '5'))

if (!NAMES.length || !DAY || !DATE) {
  console.error('need --doctors=a,b --day=Friday --date=YYYY-MM-DD [--from=00:00 --to=17:00 --each=5]')
  process.exit(1)
}

const url = process.env.REMOTE_DATABASE_URL || process.env.DATABASE_URL
const isRemote = Boolean(process.env.REMOTE_DATABASE_URL)
const db = new PrismaClient(isRemote ? { datasources: { db: { url } } } : undefined)

/** Evenly spaced HH:mm slots across [from, to). */
function slots(from, to, n) {
  const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const start = mins(from), end = mins(to)
  const step = Math.floor((end - start) / n)
  return Array.from({ length: n }, (_, i) => fmt(start + i * step))
}

try {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } })
  if (orgs.length !== 1) throw new Error(`expected one organization, found ${orgs.length}`)
  const ORG_ID = orgs[0].id
  console.log(`\n${isRemote ? 'REMOTE (production)' : 'LOCAL'} — ${orgs[0].name}`)
  console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: DRY RUN — nothing will be written\n')

  const doctors = []
  for (const name of NAMES) {
    const found = await db.user.findMany({
      where: { organizationId: ORG_ID, role: 'doctor', fullName: { contains: name, mode: 'insensitive' } },
      select: { id: true, fullName: true, preferences: true },
    })
    if (found.length === 0) { console.error(`  ❌ no doctor matching "${name}"`); continue }
    if (found.length > 1) { console.error(`  ❌ "${name}" matches ${found.length} doctors: ${found.map((f) => f.fullName).join(', ')} — be more specific`); continue }
    doctors.push(found[0])
  }
  if (doctors.length !== NAMES.length) throw new Error('could not resolve every doctor uniquely')

  const times = slots(FROM, TO, EACH)
  console.log(`Booking slots: ${times.join(', ')}\n`)

  // --share-patients: the SAME patients see every doctor on the same day, each
  // doctor's block pushed later by --gap hours. This is the real thing — one
  // patient does Cardiology at 10 and Orthopaedics at 12 — and it must work.
  // What must NOT work is the same patient with two doctors at the same minute:
  // nobody is in two rooms at once. Without --share-patients each doctor gets
  // its own block of patients instead.
  // Minutes, not hours: a consultation is ~15 min, so 20-30 between two doctors
  // is as real as a 2-hour gap. Anything > 0 is fine; 0 would put the patient in
  // two rooms at once, which the check below refuses.
  const GAP_MINS = Number(arg('gap', '30'))
  const SHARE = process.argv.includes('--share-patients')
  const plannedByPatient = []

  const needed = SHARE ? EACH : EACH * doctors.length
  const allPatients = await db.patient.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { createdAt: 'asc' },
    take: needed,
  })
  if (allPatients.length < needed) {
    console.log(`⚠️  need ${needed} patients, found ${allPatients.length}\n`)
  }
  if (SHARE) console.log(`Same patients see every doctor, ${GAP_MINS} min apart.\n`)

  /** Push a HH:mm time later by n minutes; null if it runs past the shift's end. */
  const shiftBy = (hhmm, mins) => {
    const [h, m] = hhmm.split(':').map(Number)
    const total = h * 60 + m + mins
    const [eh, em] = TO.split(':').map(Number)
    if (total >= eh * 60 + em) return null
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  for (const [docIdx, doc] of doctors.entries()) {
    let prefs = {}
    try { prefs = JSON.parse(doc.preferences || '{}') } catch { /* start fresh */ }
    const tt = prefs.timetable || { weeklySlots: {}, exceptions: [], slotDuration: 15, maxPatientsPerDay: 30 }

    // Which room does this doctor already sit in? Reuse it, so the board keeps
    // showing them where they belong instead of inventing a new room.
    const link = await db.doctorRoomAssignment.findFirst({ where: { doctorId: doc.id }, select: { roomId: true } })
    const room = link ? await db.room.findUnique({ where: { id: link.roomId }, select: { roomNumber: true, floor: { select: { name: true } } } }) : null

    const before = tt.weeklySlots?.[DAY]?.shifts?.map((s) => `${s.start}-${s.end}`).join(', ') || '(none)'
    console.log(`${doc.fullName}`)
    console.log(`  room:          ${room ? `${room.roomNumber} (${room.floor?.name})` : '❌ no room linked — the board cannot show them'}`)
    console.log(`  ${DAY} before:  ${before}`)
    console.log(`  ${DAY} after:   ${FROM}-${TO}`)

    if (APPLY) {
      tt.weeklySlots = { ...tt.weeklySlots, [DAY]: { active: true, shifts: [{ start: FROM, end: TO, roomId: link?.roomId || null }] } }
      prefs.timetable = tt
      await db.user.update({ where: { id: doc.id }, data: { preferences: JSON.stringify(prefs) } })
    }

    // Shared: everyone sees this doctor, docIdx * gap hours later than the last.
    // Otherwise: this doctor's own block, no overlap with the others.
    const patients = SHARE ? allPatients : allPatients.slice(docIdx * EACH, docIdx * EACH + EACH)

    const booked = []
    for (const [i, p] of patients.entries()) {
      const time = SHARE ? shiftBy(times[i], docIdx * GAP_MINS) : times[i]
      if (!time) { booked.push(`(${p.firstName}: no slot left inside ${FROM}-${TO})`); continue }
      if (APPLY) {
        // The partial unique index rejects a second LIVE appointment for the
        // same doctor+slot, so clear any existing one first — this is a demo
        // reset, run more than once.
        await db.appointment.deleteMany({
          where: { organizationId: ORG_ID, doctorId: doc.id, appointmentDate: new Date(`${DATE}T00:00:00.000Z`), appointmentTime: time },
        })
        await db.appointment.create({
          data: {
            organizationId: ORG_ID, patientId: p.id, doctorId: doc.id,
            appointmentDate: new Date(`${DATE}T00:00:00.000Z`), appointmentTime: time,
            appointmentType: 'new_patient', status: 'scheduled', priority: 'normal',
          },
        })
      }
      booked.push(`${time} ${p.firstName} ${p.lastName || ''}`.trim())
      plannedByPatient.push({ patientId: p.id, name: `${p.firstName} ${p.lastName || ''}`.trim(), time, doctor: doc.fullName })
    }
    console.log(`  appointments:  ${booked.join(' | ')}\n`)
  }

  // A patient cannot be in two rooms at once. Booking them with two doctors at
  // the SAME minute is the one thing this must never produce — and nothing in
  // the app or the database stops it: the unique index guards the DOCTOR's slot
  // only. So check it here rather than write it and find out later.
  const seen = new Map()
  const patientClashes = []
  for (const b of plannedByPatient) {
    const key = `${b.patientId}|${b.time}`
    if (seen.has(key)) patientClashes.push(`${b.name} at ${b.time} — with both ${seen.get(key)} and ${b.doctor}`)
    else seen.set(key, b.doctor)
  }
  if (patientClashes.length) {
    console.error('❌ REFUSING: these patients would be with two doctors at the same minute:')
    for (const c of patientClashes) console.error('   ' + c)
    console.error('   Increase --gap, or drop --share-patients.\n')
    process.exitCode = 1
    await db.$disconnect()
    process.exit(1)
  }

  if (!APPLY) {
    console.log('Nothing written — re-run with --apply.\n')
  } else {
    console.log('✅ Applied. Syncing the queue so the board picks them up…')
    const { syncAppointmentsToQueue } = await import('../src/lib/queueSync.js')
    const n = await syncAppointmentsToQueue(ORG_ID, DATE, DATE)
    console.log(`   queue rows created/updated: ${n}\n`)
  }
} catch (e) {
  console.error('FAILED:', e?.stack || e?.message || e)
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
