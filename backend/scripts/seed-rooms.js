// Seeds Floor/Room/DoctorRoomAssignment/ConsultationSchedule against the
// REAL departments and REAL doctors already in the database — it looks the
// doctors up at run time (by specialization) rather than hardcoding ids, so
// it stays correct if the underlying doctor data is ever reseeded.
//
// Idempotent: safe to re-run. Existing floors/rooms/links are detected by
// their unique keys and left alone rather than duplicated.
//
// Usage: node seed-rooms.js [organizationId]   (defaults to org-demo)
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const ORG_ID = process.argv[2] || 'org-demo'

// Floor layout — purely a physical/organisational grouping; the department
// list itself is the real one from seed-complete-demo.js, not invented here.
const FLOOR_PLAN = [
  { floor: 'Ground Floor', departments: ['General Medicine', 'Ophthalmology'] },
  { floor: '1st Floor', departments: ['Cardiology', 'Orthopedics'] },
  { floor: '2nd Floor', departments: ['Pediatrics', 'Dermatology'] },
  { floor: '3rd Floor', departments: ['Neurology', 'ENT', 'Psychiatry', 'Oncology'] },
]

// department name -> starting room number, so numbers read sensibly grouped
// by department instead of just counting 101, 102, 103...
const ROOM_NUMBER_BASE = {
  'General Medicine': 101, Ophthalmology: 108,
  Cardiology: 204, Orthopedics: 210,
  Pediatrics: 220, Dermatology: 225,
  Neurology: 301, ENT: 305, Psychiatry: 308, Oncology: 312,
}

async function findOrCreateFloor(name) {
  const existing = await db.floor.findFirst({ where: { organizationId: ORG_ID, name } })
  if (existing) return existing
  return db.floor.create({ data: { organizationId: ORG_ID, name } })
}

async function findOrCreateRoom(floorId, departmentId, roomNumber, sittingType) {
  roomNumber = String(roomNumber)
  const existing = await db.room.findFirst({ where: { organizationId: ORG_ID, floorId, roomNumber } })
  if (existing) return existing
  return db.room.create({ data: { organizationId: ORG_ID, floorId, departmentId, roomNumber, sittingType } })
}

async function ensureDoctorLinked(roomId, doctorId) {
  const existing = await db.doctorRoomAssignment.findFirst({ where: { roomId, doctorId } })
  if (existing) return existing
  return db.doctorRoomAssignment.create({ data: { organizationId: ORG_ID, roomId, doctorId } })
}

async function ensureSchedule(roomId, doctorId, dayOfWeek, startTime, endTime) {
  const existing = await db.consultationSchedule.findFirst({ where: { roomId, doctorId, dayOfWeek } })
  if (existing) return existing
  return db.consultationSchedule.create({ data: { organizationId: ORG_ID, roomId, doctorId, dayOfWeek, startTime, endTime } })
}

async function main() {
  const org = await db.organization.findUnique({ where: { id: ORG_ID } })
  if (!org) throw new Error(`Organization "${ORG_ID}" not found — pass the right org id as an argument`)
  console.log(`Seeding rooms for "${org.name}" (${ORG_ID})`)

  for (const { floor: floorName, departments } of FLOOR_PLAN) {
    const floor = await findOrCreateFloor(floorName)

    for (const deptName of departments) {
      const dept = await db.department.findFirst({ where: { organizationId: ORG_ID, name: deptName } })
      if (!dept) { console.warn(`  ! Department "${deptName}" not found — skipping`); continue }

      // Real doctors for this department, oldest-first so a re-run is stable.
      const doctors = await db.user.findMany({
        where: { organizationId: ORG_ID, role: 'doctor', specialization: deptName },
        orderBy: { id: 'asc' },
        take: 2,
        select: { id: true, fullName: true },
      })
      if (doctors.length === 0) { console.warn(`  ! No doctors found for "${deptName}" — room left unassigned`); }

      const baseNumber = ROOM_NUMBER_BASE[deptName] ?? 100

      // Cardiology's SECOND room demonstrates "Multiple Doctors" sitting type
      // with a real non-overlapping weekly schedule; every other department
      // gets one plain single-doctor room.
      const wantsSharedRoom = deptName === 'Cardiology' && doctors.length >= 2

      const room1 = await findOrCreateRoom(floor.id, dept.id, baseNumber, 'single')
      if (doctors[0]) await ensureDoctorLinked(room1.id, doctors[0].id)

      if (wantsSharedRoom) {
        const room2 = await findOrCreateRoom(floor.id, dept.id, baseNumber + 1, 'multiple')
        await ensureDoctorLinked(room2.id, doctors[0].id)
        await ensureDoctorLinked(room2.id, doctors[1].id)
        // Monday–Saturday (1–6), morning/afternoon split — a realistic OPD
        // shared-room pattern, and deliberately non-overlapping.
        for (let day = 1; day <= 6; day++) {
          await ensureSchedule(room2.id, doctors[0].id, day, '09:00', '13:00')
          await ensureSchedule(room2.id, doctors[1].id, day, '14:00', '18:00')
        }
        console.log(`  Cardiology: Room ${baseNumber} (single, ${doctors[0].fullName}) + Room ${baseNumber + 1} (shared: ${doctors[0].fullName} 9-1, ${doctors[1].fullName} 2-6)`)
      } else {
        console.log(`  ${deptName}: Room ${baseNumber}${doctors[0] ? ` (${doctors[0].fullName})` : ' (unassigned)'}`)
      }
    }
  }

  const [floorCount, roomCount, linkCount, scheduleCount] = await Promise.all([
    db.floor.count({ where: { organizationId: ORG_ID } }),
    db.room.count({ where: { organizationId: ORG_ID } }),
    db.doctorRoomAssignment.count({ where: { organizationId: ORG_ID } }),
    db.consultationSchedule.count({ where: { organizationId: ORG_ID } }),
  ])
  console.log(`\nDone. Now in "${org.name}": ${floorCount} floors, ${roomCount} rooms, ${linkCount} doctor links, ${scheduleCount} schedule rows.`)
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => db.$disconnect())
