// Builds a complete Floors/Rooms/Timetables layout: every doctor in each mapped
// department gets a room and a weekly timetable, numbered the way a hospital
// numbers rooms (1st floor 100-199, 2nd 200-299, ...). Rooms take up to 4
// doctors across four non-overlapping daily shifts, so single rooms, shared
// rooms and schedule-driven switching all appear — on real doctors, not a
// hand-picked handful.
//
//   node scripts/seed-full-timetables.js                 # dry run: shows the plan
//   node scripts/seed-full-timetables.js --apply         # writes it
//   node scripts/seed-full-timetables.js --apply --org=<id>
//
// DESTRUCTIVE. It deletes every Floor/Room/DoctorRoomAssignment for the org and
// clears every doctor's saved timetable, then rebuilds. That is fine on a fresh
// database and wrong anywhere someone has since set rooms or timetables by hand
// in the UI — so it refuses to run unless --apply is passed, prints exactly what
// it will destroy first, and needs --force once real timetables exist.
//
// The org is detected automatically when the database holds exactly one; pass
// --org otherwise. It used to default to the hardcoded 'org-demo', which on any
// other database silently matched nothing.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : null
}
const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

async function resolveOrg() {
  const explicit = arg('org')
  if (explicit) {
    const o = await db.organization.findUnique({ where: { id: explicit }, select: { id: true, name: true } })
    if (!o) throw new Error(`No organization with id "${explicit}".`)
    return o
  }
  const orgs = await db.organization.findMany({ select: { id: true, name: true } })
  if (orgs.length === 0) throw new Error('This database has no organizations — nothing to seed.')
  if (orgs.length > 1) {
    throw new Error(`This database has ${orgs.length} organizations; pass --org=<id>:\n` +
      orgs.map((o) => `    --org=${o.id}   (${o.name})`).join('\n'))
  }
  return orgs[0]
}

const ORG = await resolveOrg()
const ORG_ID = ORG.id

const FLOOR_PLAN = [
  { floor: 'Ground Floor', departments: ['General Medicine', 'Ophthalmology'] },
  { floor: '1st Floor', departments: ['Cardiology', 'Orthopedics'] },
  { floor: '2nd Floor', departments: ['Pediatrics', 'Dermatology'] },
  { floor: '3rd Floor', departments: ['Neurology', 'ENT', 'Psychiatry', 'Oncology'] },
]

const FLOOR_BLOCK_SIZE = 100 // 1st floor listed: 100-199, 2nd: 200-299, 3rd: 300-399, ...
// Cycled per room instead of a fixed size, so the demo actually shows BOTH
// sitting types the client asked for — single-doctor rooms AND rooms shared
// by 2/3/4 doctors — instead of every room being identically 4-shared.
const GROUP_SIZE_PATTERN = [1, 2, 4, 3]
const ACTIVE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// Four back-to-back, non-overlapping daily shifts — up to 4 doctors per room
// with zero risk of two of them claiming the same room+time.
const SHIFT_SLOTS = [
  { start: '08:00', end: '11:00' },
  { start: '11:00', end: '14:00' },
  { start: '14:00', end: '17:00' },
  { start: '17:00', end: '20:00' },
]

function buildTimetable(roomId, slot) {
  const weeklySlots = { Sunday: { active: false, shifts: [] } }
  for (const day of ACTIVE_DAYS) {
    weeklySlots[day] = { active: true, shifts: [{ start: slot.start, end: slot.end, roomId }] }
  }
  return { weeklySlots, exceptions: [], slotDuration: 15, maxPatientsPerDay: 30 }
}

async function resetPreviousSeed() {
  await db.doctorRoomAssignment.deleteMany({ where: { organizationId: ORG_ID } })
  await db.room.deleteMany({ where: { organizationId: ORG_ID } })
  await db.floor.deleteMany({ where: { organizationId: ORG_ID } })

  // Clear only the `timetable` key so any other stored preference survives.
  const doctors = await db.user.findMany({ where: { organizationId: ORG_ID, role: 'doctor' }, select: { id: true, preferences: true } })
  for (const d of doctors) {
    if (!d.preferences) continue
    let prefs = {}
    try { prefs = JSON.parse(d.preferences) } catch { /* leave as {} */ }
    if (!('timetable' in prefs)) continue
    delete prefs.timetable
    await db.user.update({ where: { id: d.id }, data: { preferences: Object.keys(prefs).length ? JSON.stringify(prefs) : null } })
  }
}

/** What exists now, and what this run would destroy. */
async function survey() {
  const [floors, rooms, links, doctors] = await Promise.all([
    db.floor.count({ where: { organizationId: ORG_ID } }),
    db.room.count({ where: { organizationId: ORG_ID } }),
    db.doctorRoomAssignment.count({ where: { organizationId: ORG_ID } }),
    db.user.findMany({ where: { organizationId: ORG_ID, role: 'doctor' }, select: { preferences: true } }),
  ])
  const withTimetable = doctors.filter((d) => {
    if (!d.preferences) return false
    try { return 'timetable' in JSON.parse(d.preferences) } catch { return false }
  }).length

  const departments = await db.department.findMany({ where: { organizationId: ORG_ID }, select: { name: true } })
  const have = new Set(departments.map((d) => d.name))
  const wanted = [...new Set(FLOOR_PLAN.flatMap((f) => f.departments))]

  return { floors, rooms, links, doctorCount: doctors.length, withTimetable, missingDepts: wanted.filter((w) => !have.has(w)), have }
}

async function main() {
  console.log(`\nOrganization: ${ORG.name}  (${ORG_ID})\n`)
  const s = await survey()

  console.log('Currently in this database:')
  console.log(`  floors ${s.floors} · rooms ${s.rooms} · doctor-room links ${s.links}`)
  console.log(`  doctors ${s.doctorCount}, of which ${s.withTimetable} already have a saved timetable`)

  if (s.missingDepts.length) {
    console.log(`\n⚠️  These departments do not exist here, so their floors/rooms will be SKIPPED:`)
    console.log(`      ${s.missingDepts.join(', ')}`)
    console.log(`    Departments that do exist: ${[...s.have].join(', ') || '(none)'}`)
  }

  if (!APPLY) {
    console.log('\nThis run would DELETE all of the above and rebuild:')
    console.log(`  - ${s.floors} floor(s), ${s.rooms} room(s), ${s.links} doctor-room link(s)`)
    console.log(`  - the saved timetable of ${s.withTimetable} doctor(s)`)
    console.log('\nNothing was changed — this was a dry run.')
    console.log('Re-run with --apply to write it.\n')
    return
  }

  // Rooms/timetables set by hand in the UI are real configuration, not seed
  // output — do not silently rebuild over them.
  if (s.withTimetable > 0 && !FORCE) {
    console.error(`\n❌ ${s.withTimetable} doctor(s) already have a timetable saved.`)
    console.error('   Rebuilding would erase them. If that is genuinely what you want, add --force.')
    console.error('   (On a fresh database this count is 0 and --apply alone is enough.)\n')
    process.exitCode = 1
    return
  }

  console.log('\nRebuilding…\n')
  await resetPreviousSeed()

  let totalRooms = 0
  let totalDoctorsSeated = 0

  for (const [floorIdx, { floor: floorName, departments }] of FLOOR_PLAN.entries()) {
    const floor = await db.floor.create({ data: { organizationId: ORG_ID, name: floorName, sortOrder: floorIdx } })
    // (floorIdx + 1) so the FIRST floor in the list starts its block at 100,
    // not 0 — matches building convention (100s = floor 1, 200s = floor 2, ...).
    const blockStart = (floorIdx + 1) * FLOOR_BLOCK_SIZE
    let nextRoomNumber = blockStart
    let floorRoomCount = 0
    let floorDoctorCount = 0

    for (const deptName of departments) {
      const dept = await db.department.findFirst({ where: { organizationId: ORG_ID, name: deptName } })
      if (!dept) { console.warn(`  ! Department "${deptName}" not found — skipping`); continue }

      const doctors = await db.user.findMany({
        where: { organizationId: ORG_ID, role: 'doctor', specialization: deptName },
        orderBy: { id: 'asc' },
        select: { id: true, fullName: true },
      })
      if (doctors.length === 0) { console.warn(`  ! No doctors for "${deptName}"`); continue }

      let deptRoomCount = 0
      let i = 0
      let patternIdx = 0
      while (i < doctors.length) {
        const size = GROUP_SIZE_PATTERN[patternIdx % GROUP_SIZE_PATTERN.length]
        patternIdx++
        const group = doctors.slice(i, i + size)
        i += size
        const roomNumber = String(nextRoomNumber++)
        const room = await db.room.create({
          data: {
            organizationId: ORG_ID, floorId: floor.id, departmentId: dept.id,
            roomNumber, sittingType: group.length > 1 ? 'multiple' : 'single',
          },
        })
        deptRoomCount++

        await Promise.all(group.map((doc, g) => {
          const timetable = buildTimetable(room.id, SHIFT_SLOTS[g % SHIFT_SLOTS.length])
          return Promise.all([
            db.user.update({ where: { id: doc.id }, data: { preferences: JSON.stringify({ timetable }) } }),
            db.doctorRoomAssignment.create({ data: { organizationId: ORG_ID, doctorId: doc.id, roomId: room.id } }),
          ])
        }))
        floorDoctorCount += group.length
      }
      console.log(`  ${floorName} · ${deptName}: ${doctors.length} doctors → ${deptRoomCount} room(s), numbers ${blockStart + floorRoomCount}-${nextRoomNumber - 1}`)
      floorRoomCount += deptRoomCount
    }
    totalRooms += floorRoomCount
    totalDoctorsSeated += floorDoctorCount
  }

  const [floorCount, roomCount, linkCount, sharedRoomCount] = await Promise.all([
    db.floor.count({ where: { organizationId: ORG_ID } }),
    db.room.count({ where: { organizationId: ORG_ID } }),
    db.doctorRoomAssignment.count({ where: { organizationId: ORG_ID } }),
    db.room.count({ where: { organizationId: ORG_ID, sittingType: 'multiple' } }),
  ])
  console.log(`\nDone. ${floorCount} floors, ${roomCount} rooms (${sharedRoomCount} shared), ${linkCount} doctor-room links, ${totalDoctorsSeated} doctors seated with a timetable.`)
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => db.$disconnect())
