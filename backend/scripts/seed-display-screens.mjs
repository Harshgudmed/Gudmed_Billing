// One-off seed: creates DisplayScreens for every floor that has rooms and
// assigns that floor's rooms to them (~20 rooms per screen, so a floor with
// 90 rooms gets ~5 screens — enough to actually exercise the multi-screen
// admin panel and the per-screen TV board instead of testing against one
// empty screen). Floors with zero rooms (seen: "4th floor", "xyz") are
// skipped — nothing to assign yet.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

const ROOMS_PER_SCREEN = 20

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const existing = await db.displayScreen.count()
if (existing > 0) {
  console.log(`Aborting: ${existing} DisplayScreen(s) already exist. Delete them first if you want a clean re-seed.`)
  await db.$disconnect()
  process.exit(1)
}

const org = await db.organization.findFirst({ select: { id: true, name: true } })
if (!org) { console.log('No organization found.'); await db.$disconnect(); process.exit(1) }

const floors = await db.floor.findMany({
  where: { organizationId: org.id },
  orderBy: { sortOrder: 'asc' },
  include: { rooms: { select: { id: true, roomNumber: true } } },
})

let screensCreated = 0
let roomsAssigned = 0

for (const floor of floors) {
  if (floor.rooms.length === 0) {
    console.log(`Skipping ${floor.name} — 0 rooms`)
    continue
  }

  const sorted = [...floor.rooms].sort((a, b) =>
    (Number(a.roomNumber) || 0) - (Number(b.roomNumber) || 0)
    || String(a.roomNumber).localeCompare(String(b.roomNumber)))

  const groups = chunk(sorted, ROOMS_PER_SCREEN)

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const name = groups.length === 1 ? `${floor.name} — Display` : `${floor.name} — Screen ${i + 1}`
    const screen = await db.displayScreen.create({
      data: {
        organizationId: org.id,
        name,
        maxDoctors: 5,
        sliderSpeedSeconds: 30,
        // One demo ticker so the footer bar is visible on at least one board.
        announcementText: i === 0 && floor.sortOrder === 0 ? 'OPD Registration closes at 5:00 PM' : null,
      },
    })
    await db.room.updateMany({ where: { id: { in: group.map((r) => r.id) } }, data: { displayScreenId: screen.id } })
    screensCreated++
    roomsAssigned += group.length
    console.log(`  ${name}: rooms ${group[0].roomNumber}-${group[group.length - 1].roomNumber} (${group.length} rooms)`)
  }
}

console.log(`\nDone: ${screensCreated} screens created, ${roomsAssigned} rooms assigned, org "${org.name}".`)
await db.$disconnect()
