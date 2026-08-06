// Atomic, gap-free, per-org + per-financial-year document numbers, backed by the
// BillCounter table. Single source of truth so OPD invoices, OPD receipts and IPD
// bills can never drift into three different numbering schemes again.
//
// Replaces `'RCP' + Date.now()` / `'REF' + Date.now()`, which collided on the
// @unique receiptNumber whenever two documents were created in the same millisecond.
import { financialYear } from './money.js'

/**
 * Draw the next number in a series. MUST be called inside the caller's `$transaction`
 * so a concurrent create can never hand out the same number.
 *
 * @param tx              Prisma transaction client
 * @param organizationId  tenant
 * @param series          BillCounter.series key (e.g. 'INV', 'OPD_RCP')
 * @param label           text prefix used in the number itself (e.g. 'INV', 'RCP')
 * @param probeMax        optional `async (prefix) => highestSequenceAlreadyInUse`.
 *                        Pass this when rows may exist that the counter doesn't know
 *                        about (e.g. after a data migration copied invoices but not
 *                        the counter). The counter then jumps past the real max
 *                        instead of colliding forever.
 * @returns e.g. "INV-2026-27-000123"
 */
export async function nextSeriesNumber(tx, organizationId, series, label = series, probeMax = null) {
  const year = financialYear()
  const prefix = `${label}-${year}-`

  const lastSeq = probeMax ? await probeMax(prefix) : 0

  const counter = await tx.billCounter.upsert({
    where: { organizationId_series_year: { organizationId, series, year } },
    create: { organizationId, series, year, value: lastSeq + 1 },
    update: { value: { increment: 1 } },
  })

  // If the counter had lagged behind pre-existing rows, jump it past the real max
  // so the number we hand out cannot already exist.
  let value = counter.value
  if (value <= lastSeq) {
    const fixed = await tx.billCounter.update({
      where: { organizationId_series_year: { organizationId, series, year } },
      data: { value: lastSeq + 1 },
    })
    value = fixed.value
  }

  return `${prefix}${String(value).padStart(6, '0')}`
}

// Patient UHIDs come from the same atomic BillCounter, so two simultaneous
// registrations can never be handed the same one. Starting at 1,000,000,000
// keeps every UHID exactly 10 digits.
//
// Lives here (not in patientController) because pre-triage also mints a UHID
// when it converts a screening into a patient; its own `UHID${Date.now()}`
// bypassed this counter, produced a different shape, and — since only the last
// 8 digits of the clock were used — wrapped around every ~27.8 hours, so a
// conversion could collide with one from the previous day on the @unique mrn.
const UHID_BASE = 1_000_000_000

export async function generateUHID(tx, organizationId) {
  const counter = await tx.billCounter.upsert({
    where: { organizationId_series_year: { organizationId, series: 'UHID', year: 'P' } },
    create: { organizationId, series: 'UHID', year: 'P', value: 1 },
    update: { value: { increment: 1 } },
  })
  return String(UHID_BASE + counter.value)
}

/** Highest invoice sequence already used for this org+FY. Numbers are zero-padded, so
 *  lexicographic DESC == numeric order → the top row is the true max. */
export function invoiceProbe(tx, organizationId) {
  return async (prefix) => {
    const last = await tx.invoice.findFirst({
      where: { organizationId, invoiceNumber: { startsWith: prefix } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    })
    return last ? parseInt(last.invoiceNumber.slice(prefix.length), 10) || 0 : 0
  }
}
