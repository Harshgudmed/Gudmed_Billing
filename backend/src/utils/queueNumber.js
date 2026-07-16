// Shared by triageController.js (walk-in queue entries), appointmentController.js
// (check-in-derived queue entries), and lib/queueSync.js (appointment→queue sync)
// so every path generates queue numbers the same, collision-proof way.
//
// The old implementation (`PREFIX + date + Math.random()`) had no DB constraint
// behind it — two patients could be issued the identical token. This wasn't
// theoretical: a full-history resync of this exact dataset produced 127,073
// rows sharing a queueNumber with at least one other row, because the random
// 4-digit space (10,000 values) collides constantly once a single org+day
// carries hundreds of entries (birthday paradox). See lib/counters.js for the
// same problem already solved once for Invoice/LabOrder/RadiologyOrder numbers.
import { financialYear } from '../lib/money.js'

/**
 * Draw the next queue number for an org+service-area+day, atomically.
 * Backed by the existing `BillCounter` table's upsert-and-increment (same
 * mechanism as lib/counters.js#nextSeriesNumber), but keyed per calendar day
 * instead of financial year — queue tokens only need per-day uniqueness, not
 * gap-free audit numbering, so `nextSeriesNumber` itself (hardcoded to
 * `financialYear()`) isn't reused directly; the day is folded into the
 * `series` half of the same `(organizationId, series, year)` unique key
 * instead, with `year` fixed to a constant marker.
 *
 * Does NOT need to run inside the caller's transaction — gaps in queue
 * numbers are harmless (unlike invoice numbers), only uniqueness matters, so
 * a plain `db` client is fine; pass `tx` when one is already open nearby.
 *
 * @param client          Prisma client or transaction client
 * @param organizationId  tenant
 * @param serviceArea     e.g. 'opd', 'emergency', 'mch'
 * @returns e.g. "OPD20260716-000123"
 */
export async function nextQueueNumber(client, organizationId, serviceArea) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = (serviceArea || 'gen').substring(0, 3).toUpperCase()
  const series = `QUEUE_${prefix}_${ymd}`
  const counter = await client.billCounter.upsert({
    where: { organizationId_series_year: { organizationId, series, year: 'D' } },
    create: { organizationId, series, year: 'D', value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${prefix}${ymd}-${String(counter.value).padStart(6, '0')}`
}

// financialYear import kept unused-free: not needed here, this module only
// needs the calendar day. (Left out intentionally — see nextSeriesNumber for
// the financial-year-keyed sibling used by billing documents.)
void financialYear
