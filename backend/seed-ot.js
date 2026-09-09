// Seed Operation Theatre demo data: theatres, a surgery catalogue, and cases
// built from patients/doctors that ALREADY EXIST in the database.
//
// Mirrors how otController.create() builds a booking (caseNumber from
// nextSeriesNumber, procedureName snapshot, team rows), so what the screen shows
// after seeding is what it will show after a real booking.
//
// Slots are laid out sequentially per theatre with the cleaning gap respected,
// so the seeded day would also have passed assertNoConflict().
//
// Run:  node seed-ot.js
import { db } from './src/config/db.js'
import { nextSeriesNumber } from './src/lib/counters.js'

const CASES_PER_DAY = 4
const DAYS = 3 // yesterday, today, tomorrow — so every status is visible

const THEATRES = [
  { name: 'OT-1 Major', code: 'OT1', theatreType: 'MAJOR', cleaningMinutes: 30 },
  { name: 'OT-2 Major', code: 'OT2', theatreType: 'MAJOR', cleaningMinutes: 30 },
  { name: 'OT-3 Minor', code: 'OT3', theatreType: 'MINOR', cleaningMinutes: 15 },
  { name: 'Emergency OT', code: 'OTE', theatreType: 'EMERGENCY', cleaningMinutes: 20 },
]

const SURGERIES = [
  { name: 'Appendicectomy', code: 'SUR001', specialty: 'General Surgery', defaultMinutes: 60, defaultAnaesthesia: 'GENERAL' },
  { name: 'Laparoscopic Cholecystectomy', code: 'SUR002', specialty: 'General Surgery', defaultMinutes: 90, defaultAnaesthesia: 'GENERAL' },
  { name: 'Caesarean Section (LSCS)', code: 'SUR003', specialty: 'Obstetrics', defaultMinutes: 45, defaultAnaesthesia: 'SPINAL' },
  { name: 'Total Knee Replacement', code: 'SUR004', specialty: 'Orthopaedics', defaultMinutes: 120, defaultAnaesthesia: 'SPINAL' },
  { name: 'Cataract Surgery (Phaco)', code: 'SUR005', specialty: 'Ophthalmology', defaultMinutes: 30, defaultAnaesthesia: 'LOCAL' },
  { name: 'Inguinal Hernia Repair', code: 'SUR006', specialty: 'General Surgery', defaultMinutes: 75, defaultAnaesthesia: 'SPINAL' },
  { name: 'Tonsillectomy', code: 'SUR007', specialty: 'ENT', defaultMinutes: 45, defaultAnaesthesia: 'GENERAL' },
  { name: 'Fracture Fixation (ORIF)', code: 'SUR008', specialty: 'Orthopaedics', defaultMinutes: 90, defaultAnaesthesia: 'GENERAL' },
]

// Past days are finished, today is live, tomorrow is still ahead — one row of
// each so every colour on the screen has something to show.
const STATUS_BY_DAY = {
  '-1': ['COMPLETED', 'COMPLETED', 'CANCELLED', 'COMPLETED'],
  0: ['COMPLETED', 'IN_THEATRE', 'CHECKED_IN', 'CONFIRMED'],
  1: ['SCHEDULED', 'SCHEDULED', 'CONFIRMED', 'POSTPONED'],
}

const PRIORITIES = ['ELECTIVE', 'ELECTIVE', 'ELECTIVE', 'URGENT', 'EMERGENCY']

// The site is the side plus the part: "Right knee", not just "Right". Written per
// surgery, because a demo where every case reads "Right knee" reads as filler.
const SITE_BY_SURGERY = {
  'Appendicectomy': 'Right iliac fossa',
  'Laparoscopic Cholecystectomy': 'Right upper quadrant',
  'Caesarean Section (LSCS)': 'Lower abdomen',
  'Total Knee Replacement': 'Right knee',
  'Cataract Surgery (Phaco)': 'Left eye',
  'Inguinal Hernia Repair': 'Right inguinal region',
  'Tonsillectomy': 'Oropharynx',
  'Fracture Fixation (ORIF)': 'Left forearm',
}

const EQUIPMENT_BY_SURGERY = {
  'Appendicectomy': 'Electrocautery',
  'Laparoscopic Cholecystectomy': 'Laparoscopy Stack, Electrocautery, Harmonic Scalpel',
  'Caesarean Section (LSCS)': 'Electrocautery, Ultrasound',
  'Total Knee Replacement': 'C-Arm, Tourniquet, Image Intensifier',
  'Cataract Surgery (Phaco)': 'Operating Microscope',
  'Inguinal Hernia Repair': 'Electrocautery, Laparoscopy Stack',
  'Tonsillectomy': 'Electrocautery, Endoscopy Tower',
  'Fracture Fixation (ORIF)': 'C-Arm, Image Intensifier, Tourniquet',
}

const LOCATIONS = ['Ward', 'Private Room', 'Day Care', 'ICU', 'Emergency', 'Pre-op Holding']

// Laterality is READ OFF the site, never picked separately. Chosen at random it
// produced "RIGHT · Left eye" and "BILATERAL · Right inguinal region" — a demo
// contradicting itself on the one field that exists to prevent wrong-side surgery.
const lateralityFor = (site) => {
  const text = (site || '').toLowerCase()
  if (text.includes('left')) return 'LEFT'
  if (text.includes('right')) return 'RIGHT'
  return 'NA'
}

const pick = (arr, i) => arr[i % arr.length]

// 09:00 on the day `offset` days from today, in the server's local time.
function dayAt9am(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(9, 0, 0, 0)
  return d
}

async function seedMasters(organizationId) {
  for (const theatre of THEATRES) {
    await db.operatingTheatre.upsert({
      where: { organizationId_name: { organizationId, name: theatre.name } },
      create: { organizationId, ...theatre },
      update: {},
    })
  }
  for (const surgery of SURGERIES) {
    const existing = await db.surgeryCatalog.findFirst({
      where: { organizationId, name: surgery.name },
      select: { id: true },
    })
    if (!existing) await db.surgeryCatalog.create({ data: { organizationId, ...surgery } })
  }

  const theatres = await db.operatingTheatre.findMany({ where: { organizationId }, orderBy: { name: 'asc' } })
  const surgeries = await db.surgeryCatalog.findMany({ where: { organizationId }, orderBy: { name: 'asc' } })
  console.log(`  Theatres: ${theatres.length}   Surgeries: ${surgeries.length}\n`)
  return { theatres, surgeries }
}

async function main() {
  console.log('Seeding Operation Theatre demo data...\n')

  // This install has more than one organization, and the first one created is an
  // empty test tenant. Seed the one that actually has patients — or name it
  // explicitly:  ORGANIZATION_ID=org-demo node seed-ot.js
  const org = process.env.ORGANIZATION_ID
    ? await db.organization.findUnique({
        where: { id: process.env.ORGANIZATION_ID },
        select: { id: true, name: true },
      })
    : (await db.organization.findMany({
        select: { id: true, name: true, _count: { select: { patients: true } } },
      })).sort((a, b) => b._count.patients - a._count.patients)[0]

  if (!org) throw new Error('No organization found — seed the org first.')
  console.log('Organization:', org.name, `(${org.id})`)

  const patients = await db.patient.findMany({
    where: { organizationId: org.id },
    take: CASES_PER_DAY * DAYS,
    orderBy: { createdAt: 'desc' },
    select: { id: true, mrn: true, firstName: true, lastName: true },
  })
  if (patients.length === 0) throw new Error('No patients found in DB for this org.')

  const surgeons = await db.user.findMany({
    where: { organizationId: org.id, role: 'doctor' },
    take: 4,
    select: { id: true, fullName: true },
  })
  if (surgeons.length === 0) throw new Error('No doctors found — a booking needs a surgeon.')

  const nurses = await db.user.findMany({
    where: { organizationId: org.id, role: 'nurse' },
    take: 3,
    select: { id: true, fullName: true },
  })

  console.log(`Patients: ${patients.length}   Surgeons: ${surgeons.length}   Nurses: ${nurses.length}\n`)

  const { theatres, surgeries } = await seedMasters(org.id)

  let created = 0
  let patientIndex = 0

  for (const offset of [-1, 0, 1]) {
    const statuses = STATUS_BY_DAY[String(offset)]
    // Each theatre starts its day at 09:00; each case that follows starts where
    // the last one ended plus that theatre's cleaning gap. Same arithmetic
    // assertNoConflict() uses, so these slots do not clash.
    const nextFreeAt = new Map(theatres.map((t) => [t.id, dayAt9am(offset)]))

    for (let i = 0; i < statuses.length; i++) {
      const patient = patients[patientIndex % patients.length]
      patientIndex++

      const theatre = pick(theatres, i)
      const surgery = pick(surgeries, patientIndex)
      const surgeon = pick(surgeons, i)
      const status = statuses[i]

      const scheduledStart = nextFreeAt.get(theatre.id)
      const minutes = surgery.defaultMinutes || 60
      const scheduledEnd = new Date(scheduledStart.getTime() + minutes * 60_000)
      nextFreeAt.set(
        theatre.id,
        new Date(scheduledEnd.getTime() + (theatre.cleaningMinutes || 0) * 60_000),
      )

      const isDone = status === 'COMPLETED'
      const isRunning = status === 'IN_THEATRE'
      const needsReason = status === 'CANCELLED' || status === 'POSTPONED'

      const caseNumber = await nextSeriesNumber(db, org.id, 'OT', 'OT')

      const booking = await db.otBooking.create({
        data: {
          organizationId: org.id,
          patientId: patient.id,
          theatreId: theatre.id,
          surgeryId: surgery.id,
          caseNumber,
          procedureName: surgery.name,
          siteOfSurgery: SITE_BY_SURGERY[surgery.name] || null,
          laterality: lateralityFor(SITE_BY_SURGERY[surgery.name]),
          patientLocation: pick(LOCATIONS, patientIndex),
          equipmentNeeded: EQUIPMENT_BY_SURGERY[surgery.name] || null,
          priority: pick(PRIORITIES, patientIndex),
          scheduledStart,
          scheduledEnd,
          estimatedMinutes: minutes,
          primarySurgeonId: surgeon.id,
          status,
          actualStart: isDone || isRunning ? scheduledStart : null,
          actualEnd: isDone ? scheduledEnd : null,
          cancelReason: status === 'CANCELLED' ? 'Patient not fit for anaesthesia' : null,
          postponeReason: status === 'POSTPONED' ? 'Theatre list ran over' : null,
          statusChangeNote: needsReason ? 'Seeded demo case' : null,
          bookedById: surgeon.id,
          bookedByName: surgeon.fullName,
        },
      })

      const team = [
        { role: 'PRIMARY_SURGEON', userId: surgeon.id, memberName: surgeon.fullName },
      ]
      if (nurses.length > 0) {
        const nurse = pick(nurses, i)
        team.push({ role: 'SCRUB_NURSE', userId: nurse.id, memberName: nurse.fullName })
      }
      // One external member, because a visiting anaesthetist with no login is the
      // case the isExternal flag exists for — worth seeing on the demo screen.
      team.push({ role: 'ANAESTHETIST', userId: null, memberName: 'Dr. V. Menon (visiting)' })

      await db.otTeamMember.createMany({
        data: team.map((m) => ({
          organizationId: org.id,
          bookingId: booking.id,
          userId: m.userId,
          role: m.role,
          memberName: m.memberName,
          isExternal: m.userId === null,
        })),
        skipDuplicates: true,
      })

      created++
      const when = scheduledStart.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
      })
      console.log(`  ✅ ${caseNumber}  ${patient.firstName} ${patient.lastName}  [MRN ${patient.mrn}]  ${surgery.name} — ${theatre.name} @ ${when} — ${status}`)
    }
  }

  // The board must agree with the cases: a theatre running a case reads OCCUPIED.
  const running = await db.otBooking.findMany({
    where: { organizationId: org.id, status: 'IN_THEATRE' },
    select: { theatreId: true },
  })
  if (running.length > 0) {
    await db.operatingTheatre.updateMany({
      where: { id: { in: running.map((b) => b.theatreId) } },
      data: { status: 'OCCUPIED' },
    })
  }

  const total = await db.otBooking.count({ where: { organizationId: org.id } })
  console.log(`\n🎉 Created ${created} OT cases. Total in org now: ${total}`)
  console.log('   Open the web app → sidebar → Operation Theatre')
}

main()
  .catch((e) => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
