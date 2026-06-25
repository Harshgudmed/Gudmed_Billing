// Creates IPD partial-unique indexes that Prisma's schema can't express (db push
// won't manage these). Idempotent — safe to run on every deploy. Wired into the
// Render buildCommand AFTER `prisma db push`.
//
//   node scripts/ensure-ipd-indexes.mjs
//
// Guarantees (DB-level, not just application-level):
//   - one active admission per patient per org
//   - one open occupancy segment per bed
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  // If legacy data violates a guard, log it loudly but don't crash the deploy.
  const dupAdm = await db.$queryRawUnsafe(
    `SELECT "organizationId","patientId",count(*) c FROM "Admission" WHERE status='admitted' GROUP BY 1,2 HAVING count(*)>1`
  )
  const dupBed = await db.$queryRawUnsafe(
    `SELECT "bedId",count(*) c FROM "BedOccupancy" WHERE "endAt" IS NULL GROUP BY 1 HAVING count(*)>1`
  )
  if (dupAdm.length) console.warn(`⚠ ${dupAdm.length} patient(s) have >1 active admission — index will fail until resolved`)
  if (dupBed.length) console.warn(`⚠ ${dupBed.length} bed(s) have >1 open occupancy — index will fail until resolved`)

  try {
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_admission_per_patient ON "Admission"("organizationId","patientId") WHERE status = 'admitted'`
    )
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_occupancy_per_bed ON "BedOccupancy"("bedId") WHERE "endAt" IS NULL`
    )
    // At most ONE open DRAFT bill per admission (one-to-many bills, single editable draft).
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_bill_per_admission ON "Bill"("admissionId") WHERE status = 'DRAFT'`
    )
    // At most ONE migrated legacy-deposit ADVANCE per admission (race-safe deposit backfill).
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_advance_migrated_per_admission ON "BillPayment"("admissionId") WHERE type = 'ADVANCE' AND reference = 'legacy-deposit'`
    )
    const idx = await db.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('uniq_active_admission_per_patient','uniq_open_occupancy_per_bed','uniq_open_bill_per_admission','uniq_advance_migrated_per_admission')`
    )
    console.log('IPD partial-unique indexes ensured:', idx.map((i) => i.indexname).join(', ') || 'none')
  } catch (e) {
    console.error('Failed to create IPD indexes (resolve duplicates above, then redeploy):', e.message)
    // Do not fail the deploy on this — the application-level guards still hold.
  }
}
main().catch((e) => { console.error(e); process.exit(0) }).finally(() => db.$disconnect())
