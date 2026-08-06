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

  // Probe by DEFAULT, for every series — not only when a caller remembers to
  // pass one. Invoices were given a probe after production deadlocked on
  // colliding invoice numbers; lab orders then deadlocked the same way for the
  // same reason ("A record with this value already exists" on every attempt),
  // because the counter and the rows it numbers live in different tables and a
  // data migration moved one without the other. Leaving that opt-in meant each
  // series waited its turn to fail. An explicit probeMax still wins, so nothing
  // that passes its own is changed.
  const probe = probeMax ?? probeFor(tx, organizationId, series)
  const lastSeq = probe ? await probe(prefix) : 0

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
  return seriesProbe(tx, organizationId, [['invoice', 'invoiceNumber']])
}

/**
 * The same self-heal, for any series.
 *
 * WHY EVERY SERIES NEEDS ONE: the counter and the rows it numbers live in two
 * different tables, and anything that moves rows without moving BillCounter
 * leaves the counter behind — a data migration into a fresh database, a restore
 * from a partial dump, a hand-seeded environment. The counter then hands out a
 * number that already exists, the insert dies on the unique index (P2002), and
 * because the failed transaction ALSO rolls back the counter increment, it never
 * advances: every subsequent attempt fails on the same number, for ever. That is
 * not a degraded feature, it is that document type permanently unusable.
 *
 * It happened in production twice — first on invoices (which is why
 * invoiceProbe exists and why scripts/fix-prod-billcounter.mjs had to be
 * written), then on lab orders, where creating an order returned
 * "A record with this value already exists" on every attempt. Giving one series
 * a probe and leaving the other ten without simply queued the next outage.
 *
 * @param models  [[prismaModel, column], …] — a list, because one series can
 *                number rows in more than one table: OPD_RCP is drawn by both
 *                Payment.receiptNumber and PharmacySale.receiptNumber, so the
 *                probe has to clear the highest of BOTH or it hands back a
 *                number the other table already owns.
 */
export function seriesProbe(tx, organizationId, models) {
  return async (prefix) => {
    let max = 0
    for (const [model, column] of models) {
      const last = await tx[model].findFirst({
        where: { organizationId, [column]: { startsWith: prefix } },
        orderBy: { [column]: 'desc' },
        select: { [column]: true },
      })
      // Zero-padded to a fixed width, so lexicographic DESC is numeric DESC and
      // the first row really is the highest.
      const seq = last ? parseInt(String(last[column]).slice(prefix.length), 10) || 0 : 0
      if (seq > max) max = seq
    }
    return max
  }
}

// One place that knows which table(s) each series numbers, so a call site cannot
// forget the probe or wire it to the wrong column. Keys match the `series`
// argument passed to nextSeriesNumber.
const SERIES_MODELS = {
  INV: [['invoice', 'invoiceNumber']],
  OPD_RCP: [['payment', 'receiptNumber'], ['pharmacySale', 'receiptNumber']],
  OPD_REF: [['payment', 'receiptNumber']],
  LAB_ORDER: [['labOrder', 'orderNumber']],
  RAD_ORDER: [['radiologyOrder', 'orderNumber']],
  PRE_TRIAGE: [['preTriage', 'screeningNumber']],
  DEATH_CERT: [['deathCertificate', 'certificateNumber']],
  DAYCARE_CASE: [['dayCareCase', 'caseNumber']],
  INS_CLAIM: [['insuranceClaim', 'claimNumber']],
  AMBULANCE_TRIP: [['ambulanceTrip', 'tripNumber']],
  PURCHASE_ORDER: [['pharmacyPurchaseOrder', 'poNumber']],
}

/** The probe for a series, or null for a series with no rows to probe. */
export function probeFor(tx, organizationId, series) {
  const models = SERIES_MODELS[series]
  return models ? seriesProbe(tx, organizationId, models) : null
}
