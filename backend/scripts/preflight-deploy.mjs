// Read-only pre-deploy check. Run this against the TARGET database (Render)
// BEFORE `prisma migrate deploy`, so a migration never fails half-way through
// a real deployment.
//
//   DATABASE_URL="<render postgres url>" node backend/scripts/preflight-deploy.mjs
//
// It writes nothing. It answers: will the pending migrations apply to THIS
// database's existing data, and how long will they take?
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const bytes = (n) => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(0) + ' MB')
let blockers = 0
let warnings = 0

const ok = (m, d = '') => console.log(`  ✅ ${m}${d ? `\n       ${d}` : ''}`)
const warn = (m, d = '') => { warnings++; console.log(`  ⚠️  ${m}${d ? `\n       ${d}` : ''}`) }
const block = (m, d = '') => { blockers++; console.log(`  ❌ BLOCKER: ${m}${d ? `\n       ${d}` : ''}`) }

console.log('\n═══ PRE-DEPLOY CHECK ═══')
const [{ db: dbname }] = await db.$queryRawUnsafe('SELECT current_database() AS db')
const [{ size }] = await db.$queryRawUnsafe('SELECT pg_database_size(current_database())::bigint AS size')
console.log(`database: ${dbname}  (${bytes(Number(size))})\n`)

// ── 1. Which of the new migrations are still pending? ────────────────────
console.log('1. Migration state')
let applied = new Set()
try {
  const rows = await db.$queryRawUnsafe(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`
  )
  applied = new Set(rows.map((r) => r.migration_name))
  ok(`${applied.size} migrations already applied`)
} catch {
  warn('no _prisma_migrations table — this database has never been migrated by Prisma')
}
const NEW = [
  '20260715170420_add_room_floor_doctor_schedule',
  '20260715173000_room_doctor_override',
  '20260715174500_queue_room_link',
  '20260716100000_queue_number_unique',
  '20260716100500_appointment_slot_unique',
  '20260716110000_floor_sort_order',
  '20260716120000_queue_today_index',
]
const pending = NEW.filter((m) => !applied.has(m))
console.log(pending.length ? `     pending: ${pending.length}\n       - ${pending.join('\n       - ')}` : '     nothing pending')

// ── 2. THE HARD BLOCKER: existing double-booked appointments ─────────────
console.log('\n2. Double-booked appointments (blocks Appointment_doctor_active_slot_key)')
try {
  const rows = await db.$queryRawUnsafe(`
    SELECT "organizationId", "doctorId", "appointmentDate", "appointmentTime", COUNT(*)::int AS n
    FROM "Appointment"
    WHERE "doctorId" IS NOT NULL AND status NOT IN ('cancelled','no_show','rescheduled')
    GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
    ORDER BY n DESC LIMIT 5`)
  if (rows.length === 0) ok('no clashing live appointments — the guard will apply cleanly')
  else {
    const [{ total }] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total FROM (
        SELECT 1 FROM "Appointment"
        WHERE "doctorId" IS NOT NULL AND status NOT IN ('cancelled','no_show','rescheduled')
        GROUP BY "organizationId","doctorId","appointmentDate","appointmentTime" HAVING COUNT(*) > 1
      ) x`)
    block(`${total} slot(s) hold more than one live appointment — the migration will stop the deploy`,
      'These are real bookings; the migration will NOT auto-cancel them. Cancel or reschedule the\n       duplicates first. Worst offenders:')
    for (const r of rows) console.log(`         doctor ${r.doctorId} @ ${new Date(r.appointmentDate).toISOString().slice(0, 10)} ${r.appointmentTime} → ${r.n} appointments`)
  }
} catch (e) { warn(`could not check: ${e.message.split('\n')[0]}`) }

// ── 3. Duplicate queueNumbers (handled automatically, but slow) ──────────
console.log('\n3. Duplicate queue numbers (auto-fixed by the migration)')
try {
  const [{ groups, rows: dupRows }] = await db.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS groups, COALESCE(SUM(c),0)::int AS rows FROM (
      SELECT COUNT(*) AS c FROM "QueueManagement"
      GROUP BY "organizationId","queueNumber" HAVING COUNT(*) > 1
    ) x`)
  if (groups === 0) ok('no duplicates — nothing to renumber')
  else warn(`${groups} duplicate group(s), ${dupRows} rows will be renumbered`,
    `The migration rewrites ~${dupRows - groups} rows. Expect roughly ${Math.ceil((dupRows - groups) / 20000)}–${Math.ceil((dupRows - groups) / 5000)} min on this table.`)
} catch (e) { warn(`could not check: ${e.message.split('\n')[0]}`) }

// ── 4. How long will the new indexes lock the big tables? ────────────────
console.log('\n4. Index build time (tables get a write lock while CREATE INDEX runs)')
for (const t of ['QueueManagement', 'Appointment']) {
  try {
    const [{ n, sz }] = await db.$queryRawUnsafe(
      `SELECT (SELECT COUNT(*) FROM "${t}")::bigint AS n, pg_total_relation_size('"${t}"')::bigint AS sz`
    )
    const rows = Number(n)
    const msg = `${t}: ${rows.toLocaleString()} rows, ${bytes(Number(sz))}`
    if (rows > 500000) warn(msg, 'CREATE INDEX will lock writes for roughly 30s–3min. Deploy in a quiet window.')
    else ok(msg)
  } catch (e) { warn(`${t}: could not size (${e.message.split('\n')[0]})`) }
}

// ── 5. Anything that would break the new code, not the migration ─────────
console.log('\n5. Data the new code depends on')
try {
  const orgs = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Organization"`)
  ok(`${orgs[0].n} organization(s)`)
  const bc = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "BillCounter"`)
  ok(`BillCounter present (${bc[0].n} rows) — backs the new atomic queue numbers`)
} catch (e) { block(`BillCounter/Organization missing: ${e.message.split('\n')[0]}`) }

// ── verdict ─────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(52))
if (blockers) {
  console.log(`❌ DO NOT DEPLOY — ${blockers} blocker(s), ${warnings} warning(s).`)
  console.log('   Fix the blockers above, re-run this, then deploy.')
} else {
  console.log(`✅ SAFE TO DEPLOY — 0 blockers${warnings ? `, ${warnings} warning(s) (slow steps, not failures)` : ''}.`)
  console.log('   Take a database backup first regardless.')
}
console.log('═'.repeat(52) + '\n')

await db.$disconnect()
process.exit(blockers ? 1 : 0)
