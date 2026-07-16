// Pushes the SETUP the display board runs on — doctors, departments, floors,
// rooms, doctor-room links and each doctor's timetable — from this database to
// a remote one.
//
//   REMOTE_DATABASE_URL="<render external url>" node scripts/push-setup-to-remote.mjs
//   REMOTE_DATABASE_URL="..." node scripts/push-setup-to-remote.mjs --apply
//
// WHY: migrate-to-render.mjs copies patients and their activity, and nothing
// else. It has no idea about Organization, Department, User, Floor, Room or
// DoctorRoomAssignment — so a remote database gets the migrations (empty tables)
// and no configuration, and the display board is blank with nothing to explain
// why.
//
// Additive only: `skipDuplicates` everywhere, and a doctor's timetable is only
// written when the remote copy has none. Nothing here deletes or overwrites, so
// re-running is safe and configuration set on the remote by hand survives.
//
// Reads REMOTE_DATABASE_URL from the environment and never prints it. Needs the
// EXTERNAL url — Render's internal `dpg-xxxx-a` hostname only resolves inside
// Render's own network.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

let remoteUrl = process.env.REMOTE_DATABASE_URL
if (!remoteUrl) {
  console.error('REMOTE_DATABASE_URL is not set.')
  console.error('Render → your database → "External Database URL" (not the internal one).')
  process.exit(1)
}
// Managed Postgres (Render, Neon, Supabase) requires TLS; a plain local one
// does not support it at all, and forcing sslmode=require there fails the
// handshake. Default to requiring it — the remote is the normal case — but
// leave any sslmode the caller already set, so pointing this at a local
// database to rehearse the run still works.
if (!remoteUrl.includes('sslmode=')) {
  const localHost = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(remoteUrl)
  const params = [localHost ? null : 'sslmode=require', 'connect_timeout=30', 'pool_timeout=30'].filter(Boolean)
  remoteUrl += (remoteUrl.includes('?') ? '&' : '?') + params.join('&')
}
const APPLY = process.argv.includes('--apply')

const local = new PrismaClient()
const remote = new PrismaClient({ datasources: { db: { url: remoteUrl } } })

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

async function push(label, model, rows) {
  if (rows.length === 0) return console.log(`  ${label.padEnd(22)} nothing to send`)
  if (!APPLY) return console.log(`  ${label.padEnd(22)} would send ${rows.length}`)
  let done = 0
  for (const batch of chunk(rows, 200)) {
    await remote[model].createMany({ data: batch, skipDuplicates: true })
    done += batch.length
    process.stdout.write(`\r  ${label.padEnd(22)} ${done}/${rows.length}`)
  }
  console.log(`\r  ${label.padEnd(22)} ${rows.length} sent`)
}

try {
  const orgs = await local.organization.findMany()
  if (orgs.length !== 1) throw new Error(`Expected exactly one local organization, found ${orgs.length}.`)
  const ORG_ID = orgs[0].id
  console.log(`\nSource org: ${orgs[0].name} (${ORG_ID})`)
  console.log(APPLY ? 'Mode: APPLY — writing to the remote\n' : 'Mode: DRY RUN — nothing will be written\n')

  // Order matters: every row below depends on the ones above it.
  await push('organization', 'organization', orgs)
  await push('departments', 'department', await local.department.findMany({ where: { organizationId: ORG_ID } }))

  // Doctors carry their timetable inside `preferences`, so this one table is
  // both "the staff" and "the schedule".
  const doctors = await local.user.findMany({ where: { organizationId: ORG_ID, role: 'doctor' } })
  await push('doctors', 'user', doctors)

  await push('floors', 'floor', await local.floor.findMany({ where: { organizationId: ORG_ID } }))
  await push('rooms', 'room', await local.room.findMany({ where: { organizationId: ORG_ID } }))
  await push('doctor-room links', 'doctorRoomAssignment', await local.doctorRoomAssignment.findMany({ where: { organizationId: ORG_ID } }))

  // createMany --skipDuplicates ignores rows whose id already exists, so a
  // doctor the remote already knows keeps whatever timetable it has. Fill in
  // only the ones that have none, or the board shows rooms with nobody in them.
  if (APPLY) {
    const withTt = doctors.filter((d) => {
      try { return d.preferences && 'timetable' in JSON.parse(d.preferences) } catch { return false }
    })
    let filled = 0
    for (const d of withTt) {
      const r = await remote.user.findUnique({ where: { id: d.id }, select: { preferences: true } })
      if (!r) continue
      let has = false
      try { has = r.preferences && 'timetable' in JSON.parse(r.preferences) } catch { /* treat as none */ }
      if (has) continue
      await remote.user.update({ where: { id: d.id }, data: { preferences: d.preferences } })
      filled++
    }
    console.log(`  timetables              ${filled} filled in (${withTt.length - filled} already had one)`)
  }

  console.log('\nRemote now has:')
  for (const [label, model] of [['departments', 'department'], ['doctors', 'user'], ['floors', 'floor'], ['rooms', 'room'], ['doctor-room links', 'doctorRoomAssignment']]) {
    const where = model === 'user' ? { organizationId: ORG_ID, role: 'doctor' } : { organizationId: ORG_ID }
    console.log(`  ${label.padEnd(22)} ${await remote[model].count({ where })}`)
  }
  if (!APPLY) console.log('\nNothing was written — re-run with --apply.\n')
  else console.log('\nDone. Open the display board.\n')
} catch (e) {
  console.error('\nFAILED:', e?.stack || e?.message || e)
  process.exitCode = 1
} finally {
  await local.$disconnect()
  await remote.$disconnect()
}
