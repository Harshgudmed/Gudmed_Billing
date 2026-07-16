// Renumbers every room into its floor's own block.
//
//   node scripts/renumber-rooms.mjs                 # dry run
//   node scripts/renumber-rooms.mjs --apply
//   REMOTE_DATABASE_URL="..." node scripts/renumber-rooms.mjs --apply   # a remote db
//
// A floor's block is its OWN number, the way a building numbers rooms: 1st
// floor is the 100s, 2nd the 200s, 3rd the 300s, and the ground floor takes
// 1-99. The seed and the suggest-number endpoint both computed the block as
// (position + 1) * 100, which shifted every floor up by one — the ground floor
// took the 100s, and the 2nd floor ended up holding rooms 300-399.
//
// Renumbering is done in two passes. Room numbers are unique per (org, floor),
// so writing 200 while another room on that floor still holds 200 would collide
// mid-run; everything is parked on a temporary number first, then written to its
// final one.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const url = process.env.REMOTE_DATABASE_URL || process.env.DATABASE_URL
const isRemote = Boolean(process.env.REMOTE_DATABASE_URL)
const APPLY = process.argv.includes('--apply')

const db = new PrismaClient(isRemote ? { datasources: { db: { url } } } : undefined)

try {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } })
  if (orgs.length !== 1) throw new Error(`Expected one organization, found ${orgs.length}`)
  const ORG_ID = orgs[0].id
  console.log(`\n${isRemote ? 'REMOTE' : 'LOCAL'} — ${orgs[0].name}`)
  console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: DRY RUN — nothing will be written\n')

  const floors = await db.floor.findMany({ where: { organizationId: ORG_ID }, orderBy: { sortOrder: 'asc' } })

  const plan = []
  for (const [idx, floor] of floors.entries()) {
    const blockStart = idx === 0 ? 1 : idx * 100
    const rooms = await db.room.findMany({ where: { floorId: floor.id }, orderBy: { roomNumber: 'asc' } })
    // Keep the existing order so a room's position on its floor does not change.
    const sorted = rooms.sort((a, b) => (Number(a.roomNumber) || 0) - (Number(b.roomNumber) || 0))

    const before = sorted.map((r) => Number(r.roomNumber)).filter(Number.isFinite)
    const moves = sorted.map((r, i) => ({ id: r.id, from: r.roomNumber, to: String(blockStart + i) }))
    const changed = moves.filter((m) => m.from !== m.to)

    console.log(`  ${floor.name.padEnd(14)} ${rooms.length.toString().padStart(3)} rooms   ${before.length ? `${before[0]}-${before[before.length - 1]}` : '—'}  ->  ${moves.length ? `${moves[0].to}-${moves[moves.length - 1].to}` : '—'}   (${changed.length} renumbered)`)

    if (blockStart + rooms.length - 1 > (idx === 0 ? 99 : blockStart + 99)) {
      console.log(`     ⚠️  ${rooms.length} rooms do not fit this floor's 100-number block; the overflow keeps counting past it.`)
    }
    plan.push(...changed)
  }

  if (!APPLY) {
    console.log(`\n${plan.length} room(s) would be renumbered. Nothing written — re-run with --apply.\n`)
  } else if (plan.length === 0) {
    console.log('\nAlready correct — nothing to do.\n')
  } else {
    // Pass 1: park on temporaries so no two rooms fight over one number.
    for (const m of plan) {
      await db.room.update({ where: { id: m.id }, data: { roomNumber: `TMP-${m.id.slice(-8)}` } })
    }
    // Pass 2: write the real numbers.
    for (const m of plan) {
      await db.room.update({ where: { id: m.id }, data: { roomNumber: m.to } })
    }
    console.log(`\n✅ Renumbered ${plan.length} room(s).`)

    for (const [idx, floor] of floors.entries()) {
      const rooms = await db.room.findMany({ where: { floorId: floor.id }, select: { roomNumber: true } })
      const nums = rooms.map((r) => Number(r.roomNumber)).filter(Number.isFinite).sort((a, b) => a - b)
      console.log(`  ${floor.name.padEnd(14)} ${nums[0]}-${nums[nums.length - 1]}`)
    }
    console.log('')
  }
} catch (e) {
  console.error('FAILED:', e?.stack || e?.message || e)
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
