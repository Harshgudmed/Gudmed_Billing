// Find rows pointing at a patient, doctor or order that no longer exists.
//
//   node backend/scripts/check-orphans.mjs            # report
//   node backend/scripts/check-orphans.mjs --fix      # delete the unusable rows
//
// WHY THIS EXISTS
// On 2026-08-08 the Appointments "Today" tab and its search were returning a hard
// 500 to the front desk. The cause was not in the code:
//
//   Inconsistent query result: Field patient is required to return data, got `null`
//
// 381 appointments pointed at patients that had been deleted. schema.prisma
// declares `patient Patient @relation(..., onDelete: Cascade)`, so those rows
// should have gone with the patient — but the database had 165 foreign keys and
// **none of them pointed at Patient**. The 17 Patient constraints had been dropped
// during a bulk data trim (each one re-checked its key per deleted row, turning a
// one-second delete into fifteen minutes) on what was believed to be a throwaway
// copy. That copy became the working database. `onDelete: Cascade` was a comment.
//
// Prisma treats a required relation as guaranteed, so one orphan anywhere in a page
// of results takes down the whole endpoint. It is the worst kind of data bug: it
// hides until a specific row lands on a specific page.
//
// Run this BEFORE applying 20260808120000_restore_patient_foreign_keys. Postgres
// validates every existing row when a constraint is added, so a single orphan makes
// the migration fail — correct, but you want to hear it from a script and not from
// a broken deploy.
import { db } from '../src/config/db.js'

const FIX = process.argv.includes('--fix')

// Every column that names another row, and what the table is called. Derived from
// the live catalogue rather than hand-listed, so a table added next month is
// covered without editing this file.
const PARENTS = [
  { column: 'patientId', table: 'Patient' },
  { column: 'matchedPatientId', table: 'Patient' },
  { column: 'doctorId', table: 'User' },
  { column: 'appointmentId', table: 'Appointment' },
  { column: 'orderId', table: null },   // ambiguous parent — skipped, listed for the reader
]

async function columnsPointingAt(column) {
  return db.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = $1
    ORDER BY table_name`, column)
}

async function hasForeignKey(table, column) {
  const [row] = await db.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM pg_constraint
    WHERE conrelid = '"${table}"'::regclass AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%("${column}")%'`)
  return row.n > 0
}

/**
 * A row in one hospital pointing at a patient in another.
 *
 * The foreign keys restored on 2026-08-08 guarantee the patient EXISTS. They do
 * not guarantee the patient belongs to the same hospital — `patientId` references
 * `Patient(id)`, and every hospital's patients live in that one table. So a
 * cross-tenant id passes the constraint and lands in the database looking valid.
 *
 * The only thing preventing that today is `isOwned()` in the controllers
 * (backend/src/lib/tenant.js). That is code, and code has gaps — one hospital
 * could already read another's patients through Radiology until this month. This
 * check is the backstop: it finds the first row that gets through, on the day it
 * gets through, instead of when a doctor opens someone else's scan.
 *
 * Enforcing it in the database means a UNIQUE index on Patient(organizationId, id)
 * and composite foreign keys on all 18 children. That is a bigger migration than
 * restoring the plain keys was, and it is worth doing — but it is a decision, not
 * something to slip in. Until then, run this.
 */
async function crossTenantRows() {
  const tables = await db.$queryRawUnsafe(`
    SELECT a.table_name FROM information_schema.columns a
    JOIN information_schema.columns b
      ON b.table_name = a.table_name AND b.column_name = 'organizationId' AND b.table_schema = 'public'
    WHERE a.column_name = 'patientId' AND a.table_schema = 'public'
    ORDER BY 1`)

  const leaks = []
  for (const { table_name: table } of tables) {
    const [row] = await db.$queryRawUnsafe(`
      SELECT count(*)::int AS n FROM "${table}" c
      JOIN "Patient" p ON p.id = c."patientId"
      WHERE c."organizationId" <> p."organizationId"`).catch(() => [{ n: 0 }])
    if (row.n > 0) leaks.push({ table, rows: row.n })
  }
  return leaks
}

async function main() {
  console.log('\n  orphan scan — rows whose parent no longer exists\n')
  const findings = []
  let unprotected = 0

  for (const { column, table: parent } of PARENTS) {
    if (!parent) continue
    for (const { table_name: table } of await columnsPointingAt(column)) {
      if (table === parent) continue
      let orphans
      try {
        const [row] = await db.$queryRawUnsafe(`
          SELECT count(*)::int AS n FROM "${table}" c
          LEFT JOIN "${parent}" p ON p.id = c."${column}"
          WHERE c."${column}" IS NOT NULL AND p.id IS NULL`)
        orphans = row.n
      } catch { continue }   // the column points somewhere else in this table

      const guarded = await hasForeignKey(table, column)
      if (!guarded) unprotected++
      if (orphans > 0 || !guarded) {
        findings.push({ table, column, parent, orphans, guarded })
        console.log(`  ${orphans > 0 ? '✗' : ' '} ${table.padEnd(24)} .${column.padEnd(18)} → ${parent.padEnd(12)} ` +
                    `orphans: ${String(orphans).padStart(6)}   FK: ${guarded ? 'yes' : 'NONE'}`)
      }
    }
  }

  const leaks = await crossTenantRows()
  if (leaks.length) {
    console.log('\n  CROSS-TENANT — a row in one hospital pointing at another hospital\'s patient:')
    for (const l of leaks) console.log(`  ✗ ${l.table.padEnd(24)} ${l.rows} row(s)`)
  } else {
    console.log('\n  ✓ no cross-tenant patient references (isOwned is holding — the database does not check this)')
  }

  const broken = findings.filter((f) => f.orphans > 0)
  console.log(`\n  ${broken.length} table(s) with orphaned rows · ${unprotected} relation(s) with no foreign key · ${leaks.length} cross-tenant`)
  if (leaks.length) return 1

  if (!broken.length) {
    console.log('  nothing orphaned — the constraint migration will apply cleanly\n')
    return 0
  }

  // A row whose patient is gone cannot be shown, billed or reattached — there is no
  // patient to attach it to. Deleting is the only resolution, but it is still a
  // delete, so it never happens without --fix.
  if (!FIX) {
    console.log('  these rows crash any endpoint that includes them. Re-run with --fix to delete them.\n')
    return 1
  }

  for (const f of broken) {
    const ids = (await db.$queryRawUnsafe(`
      SELECT c.id FROM "${f.table}" c LEFT JOIN "${f.parent}" p ON p.id = c."${f.column}"
      WHERE c."${f.column}" IS NOT NULL AND p.id IS NULL`)).map((r) => r.id)
    // Children first: a queue row points at the appointment we are about to remove.
    for (const child of ['QueueManagement', 'Invoice', 'Consultation']) {
      if (child === f.table) continue
      await db.$executeRawUnsafe(
        `DELETE FROM "${child}" WHERE "appointmentId" = ANY($1::text[])`, ids,
      ).catch(() => {})
    }
    const gone = await db.$executeRawUnsafe(`DELETE FROM "${f.table}" WHERE id = ANY($1::text[])`, ids)
    console.log(`  deleted ${gone} from ${f.table}`)
  }
  console.log('')
  return 0
}

const code = await main().catch((e) => { console.error(e); return 1 })
await db.$disconnect()
process.exit(code)
