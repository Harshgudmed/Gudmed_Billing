// Fails if `prisma/migrations` does not fully reproduce `schema.prisma`.
//
//   npm run check:drift            (from backend/)
//
// WHY THIS EXISTS — the single recurring cause of broken deploys here:
//
//   dev DB   <- `db push` / `db execute`  <- schema.prisma
//   prod DB  <- `migrate deploy`          <- migrations/*.sql
//
// Those are two different paths, and nothing forces them to agree. Anything
// that reached dev via `db push` exists ONLY in dev. It is tested, it works
// locally, and it is simply absent in production — which is a database built
// from migrations alone.
//
// This has already shipped twice:
//   - Invoice.taxPercentage: declared in schema.prisma, created by no
//     migration, reached dev via `db push`. Prod lacked the column while the
//     client selected it, so every invoice read failed. (commit d97556f,
//     described in its own message as "a live deploy bomb")
//   - idx_patient_{firstname,lastname,mrn}_trgm: same story; migrations only
//     ever created the phone one. Patient search is silently slow in prod.
//
// A missing INDEX is slow. A missing COLUMN is a crash. Both come from the
// same gap, so catch the gap rather than each symptom.
//
// Needs a scratch database to diff against; set SHADOW_DATABASE_URL, or this
// derives one next to DATABASE_URL.
import 'dotenv/config'
import { execFileSync } from 'node:child_process'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(2)
}
const shadow = process.env.SHADOW_DATABASE_URL || url.replace(/\/([^/?]+)(\?|$)/, '/prisma_drift_shadow$2')
const admin = url.replace(/\/([^/?]+)(\?|$)/, '/postgres$2')

const psql = (target, sql) =>
  execFileSync('npx', ['prisma', 'db', 'execute', '--url', target, '--stdin'], {
    input: sql, stdio: ['pipe', 'pipe', 'pipe'], shell: true,
  })

try {
  psql(admin, 'DROP DATABASE IF EXISTS prisma_drift_shadow;')
  psql(admin, 'CREATE DATABASE prisma_drift_shadow;')
} catch (e) {
  console.error('Could not create the shadow database:', String(e.stderr || e).slice(0, 300))
  process.exit(2)
}

let diff = ''
try {
  diff = execFileSync('npx', [
    'prisma', 'migrate', 'diff',
    '--from-migrations', 'prisma/migrations',
    '--to-schema-datamodel', 'prisma/schema.prisma',
    '--shadow-database-url', shadow,
    '--script',
  ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: true })
} catch (e) {
  console.error('migrate diff failed:', String(e.stderr || e).slice(0, 400))
  process.exit(2)
} finally {
  try { psql(admin, 'DROP DATABASE IF EXISTS prisma_drift_shadow;') } catch { /* best effort */ }
}

// Prisma prints this exact line when the two sides already agree.
const clean = /empty migration|No difference/i.test(diff) || diff.trim() === ''

if (clean) {
  console.log('✅ No drift — the migrations fully reproduce schema.prisma.')
  console.log('   A database built from migrations alone (production) will match dev.')
  process.exit(0)
}

console.error('❌ DRIFT — schema.prisma and the migrations disagree.\n')
console.error('Production is built from migrations ONLY. Everything below exists in')
console.error('schema.prisma (and probably your dev DB, via `db push`) but NO migration')
console.error('creates it — so production will not have it:\n')
console.error(diff.trim().split('\n').map((l) => '    ' + l).join('\n'))
console.error('\nFix: write a migration that makes this true, then re-run.')
console.error('Never close the gap with `prisma db push` — that only changes YOUR database.')
process.exit(1)
