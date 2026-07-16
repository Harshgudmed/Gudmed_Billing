// Comprehensive demo seed: every real doctor in every real department gets a
// room + weekly timetable, spread across floors with hospital-style room
// numbering (Ground Floor 1-999, 1st Floor 1000-1999, ...). Rooms are shared
// 4 doctors at a time across four non-overlapping daily shifts, so the
// demo shows single rooms, shared rooms, and schedule-driven switching all
// at once, on real data — not a hand-picked handful.
//
// Resets and rebuilds Floor/Room/DoctorRoomAssignment + each doctor's
// timetable from scratch (idempotent: safe to re-run, but destructive to
// any hand-edits made via Settings → Rooms or Doctor Timetable since the
// last run — this is a demo dataset generator, not an incremental seed).
//
// Usage: node seed-full-timetables.js [organizationId]   (defaults to org-demo)
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const ORG_ID = process.argv[2] || 'org-demo'

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

async function main() {
  const org = await db.organization.findUnique({ where: { id: ORG_ID } })
  if (!org) throw new Error(`Organization "${ORG_ID}" not found`)
  console.log(`Rebuilding rooms + timetables for "${org.name}" (${ORG_ID})\n`)

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
