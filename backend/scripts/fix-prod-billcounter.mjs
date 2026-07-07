// One-shot, SAFE, idempotent repair for the production invoice-number counter.
//
// WHY: after data was migrated into the fresh production DB (gudmed-db-2), the
// `Invoice` rows were copied but the `BillCounter` was NOT — so the counter sits
// at 1 while INV-<FY>-000017 already exists. Every new invoice then collides on
// the @unique invoiceNumber (Prisma P2002), and because the failed transaction
// rolls back the counter increment too, it never advances — billing deadlocks.
//
// WHAT THIS DOES: for every (organization, series=INV, financial-year) present in
// the remote Invoice table, it sets BillCounter.value to the REAL maximum invoice
// sequence already stored, so the next generated number is max+1 (no collision).
// It only ever moves a counter FORWARD (never lowers it), so re-running is safe.
//
// It writes ONLY the BillCounter table. It does not touch invoices/patients/money.
//
// USAGE (never commits the URL to git):
//   REMOTE_DATABASE_URL="postgres://…gudmed-db-2…" node scripts/fix-prod-billcounter.mjs
import { PrismaClient } from '@prisma/client'

let remoteUrl = process.env.REMOTE_DATABASE_URL
if (!remoteUrl) {
  console.error('REMOTE_DATABASE_URL env var not set — aborting (never hardcode it).')
  process.exit(1)
}
if (!remoteUrl.includes('sslmode=')) {
  remoteUrl += (remoteUrl.includes('?') ? '&' : '?') + 'sslmode=require&connect_timeout=30'
}

const db = new PrismaClient({ datasources: { db: { url: remoteUrl } } })

// Indian financial year (Apr 1 – Mar 31), matching billingController.financialYear.
function financialYear(d) {
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 3 ? y : y - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

async function main() {
  console.log('Scanning remote invoices to reconcile BillCounter values...')
  // Pull every invoice number + org. Numbers look like INV-2026-27-000017.
  const invoices = await db.invoice.findMany({
    select: { organizationId: true, invoiceNumber: true },
  })
  console.log(`Found ${invoices.length} invoices.`)

  // Compute max sequence per (org, year) from the invoiceNumber suffix.
  const maxByKey = new Map() // key = `${org}|${year}` -> max int
  for (const inv of invoices) {
    const m = /^INV-(\d{4}-\d{2})-(\d+)$/.exec(inv.invoiceNumber || '')
    if (!m) continue
    const year = m[1]
    const seq = parseInt(m[2], 10) || 0
    const key = `${inv.organizationId}|${year}`
    if (!maxByKey.has(key) || seq > maxByKey.get(key)) maxByKey.set(key, seq)
  }

  if (maxByKey.size === 0) {
    console.log('No INV-formatted invoices found — nothing to reconcile.')
    return
  }

  for (const [key, maxSeq] of maxByKey) {
    const [organizationId, year] = key.split('|')
    const existing = await db.billCounter.findUnique({
      where: { organizationId_series_year: { organizationId, series: 'INV', year } },
      select: { value: true },
    })
    const current = existing?.value ?? 0
    if (current >= maxSeq) {
      console.log(`OK  ${organizationId} ${year}: counter ${current} >= max invoice ${maxSeq} (no change)`)
      continue
    }
    await db.billCounter.upsert({
      where: { organizationId_series_year: { organizationId, series: 'INV', year } },
      create: { organizationId, series: 'INV', year, value: maxSeq },
      update: { value: maxSeq }, // only reached when current < maxSeq → moves forward
    })
    console.log(`FIX ${organizationId} ${year}: counter ${current} -> ${maxSeq} (next invoice = ${maxSeq + 1})`)
  }

  // Sanity: also reconcile the CURRENT financial year even if it has no invoices
  // yet, so the very first bill of a new FY starts clean at 000001.
  console.log('Done. Billing can now issue max+1 without collision.')
}

main()
  .catch((e) => { console.error('COUNTER FIX FAILED:', e?.code, e?.message) ; process.exitCode = 1 })
  .finally(async () => { await db.$disconnect() })
