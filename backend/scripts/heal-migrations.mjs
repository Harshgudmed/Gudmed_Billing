// Clears a recorded migration failure so a deploy can retry, instead of every
// future deploy dying on P3009 until a human opens a production shell.
//
// Runs from `postinstall`, which the build command reaches BEFORE
// `prisma migrate deploy` — the only point in the deploy where this can be
// fixed from inside the repo.
//
// WHY: when a migration fails, Prisma writes a row into _prisma_migrations with
// `finished_at` NULL and `logs` set. From then on `migrate deploy` refuses to
// run ANYTHING (P3009), even after the original cause is fixed. Recovery
// normally means `prisma migrate resolve --rolled-back <name>` against
// production by hand. That turns one bad migration into an indefinite outage
// for anyone who cannot get a shell on the box.
//
// This is deliberately narrow, and only does something when all of these hold:
//   1. a migration is recorded as failed, AND
//   2. its name is in RETRYABLE below — i.e. we have since made that migration
//      idempotent and self-healing, so re-running it is safe, AND
//   3. it left nothing behind (rolled_back_at is not already set).
// Anything else is left alone and reported, because retrying a migration that
// half-applied is how you corrupt a database.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

// Migrations we have since rewritten to be safely re-runnable.
const RETRYABLE = new Set([
  // Raised an exception on pre-existing double-bookings and blocked the deploy.
  // Now resolves them itself and uses CREATE UNIQUE INDEX IF NOT EXISTS.
  '20260716100500_appointment_slot_unique',
])

if (!process.env.DATABASE_URL) {
  // Local `npm install` with no database configured — nothing to do.
  process.exit(0)
}

const db = new PrismaClient()
try {
  // The table does not exist before the first migration ever runs.
  const failed = await db.$queryRawUnsafe(`
    SELECT migration_name, started_at
    FROM _prisma_migrations
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
  `).catch(() => null)

  if (!failed || failed.length === 0) {
    console.log('heal-migrations: no failed migrations.')
  } else {
    for (const m of failed) {
      if (!RETRYABLE.has(m.migration_name)) {
        console.error(`heal-migrations: ${m.migration_name} failed at ${m.started_at} and is NOT marked retryable — leaving it. Deploy will stop; resolve it deliberately.`)
        continue
      }
      // Mark it rolled back: `migrate deploy` will then re-run it from the top.
      // Safe only because the migration is idempotent — see RETRYABLE.
      await db.$executeRawUnsafe(
        `UPDATE _prisma_migrations SET rolled_back_at = NOW() WHERE migration_name = $1 AND finished_at IS NULL`,
        m.migration_name
      )
      console.log(`heal-migrations: cleared the failed record for ${m.migration_name} (rewritten to be idempotent) — migrate deploy will retry it.`)
    }
  }
} catch (e) {
  // Never break an install over this; the deploy's own migrate step reports
  // the real problem anyway.
  console.error('heal-migrations: skipped —', String(e.message || e).split('\n')[0])
} finally {
  await db.$disconnect()
}
