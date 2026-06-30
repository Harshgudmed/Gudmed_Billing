// Phase 3C — Scheduled Order Tasks.
//
// Expands a repeating ClinicalOrder (frequency + duration) into individual
// occurrences ("tasks") that a nurse ticks off in the Treatment Chart. One
// OrderTask row per occurrence, shared across LAB / RADIOLOGY / PHARMACY /
// PROCEDURE so every order type uses the same chart and mechanism.
import { db } from '../config/db.js'

// Daily clock-times per standard frequency code. Kept in sync with the eMAR
// slots in the frontend (NursingStation MAR_SLOTS).
const FREQ_TIMES = {
  OD: ['08:00'],
  QD: ['08:00'],
  BD: ['08:00', '20:00'],
  BID: ['08:00', '20:00'],
  TDS: ['08:00', '14:00', '20:00'],
  TID: ['08:00', '14:00', '20:00'],
  QID: ['08:00', '14:00', '20:00', '22:00'],
  HS: ['22:00'],
}

// Safety caps so a typo ("for 200 days") can't generate a runaway number of rows.
const MAX_DAYS = 14
const MAX_TASKS = 200

/** "2 days" | "2d" | "x2" | "2" → 2 (whole days). Defaults to 1, capped at MAX_DAYS. */
export function parseDurationDays(duration) {
  if (!duration) return 1
  const m = String(duration).match(/\d+/)
  let days = m ? parseInt(m[0], 10) : 1
  if (!Number.isFinite(days) || days < 1) days = 1
  return Math.min(days, MAX_DAYS)
}

/**
 * Daily clock-times for a frequency string. Returns [] for SOS/PRN/STAT/blank
 * (those are single ad-hoc occurrences, handled by the caller).
 */
export function dailyTimes(frequency) {
  const f = String(frequency || '').toUpperCase()
  // "every N hours": qNh / q6h / "every 8 hr"
  const everyN = f.match(/Q\s*(\d+)\s*H|EVERY\s*(\d+)\s*H/)
  if (everyN) {
    const n = parseInt(everyN[1] || everyN[2], 10)
    if (Number.isFinite(n) && n >= 1 && n <= 24) {
      const times = []
      for (let h = 8; h < 24; h += n) times.push(`${String(h).padStart(2, '0')}:00`)
      return times.length ? times : ['08:00']
    }
  }
  // Standard codes — match longest first so "TDS" isn't caught by a stray "D".
  for (const code of ['QID', 'TDS', 'TID', 'BID', 'BD', 'QD', 'OD', 'HS']) {
    if (f.includes(code)) return FREQ_TIMES[code]
  }
  return []
}

/**
 * Expand (frequency, duration, startAt) into an array of occurrence Dates.
 * - Recurring frequency → one Date per daily time, per day of duration.
 * - SOS / PRN / STAT / blank → a single occurrence at startAt.
 * Result is capped at MAX_TASKS.
 */
export function expandSchedule({ frequency, duration, startAt } = {}) {
  const start = startAt ? new Date(startAt) : new Date()
  const times = dailyTimes(frequency)

  // Non-recurring: a single task at the order time.
  if (times.length === 0) return [start]

  const days = parseDurationDays(duration)
  const out = []
  // Day 0 begins on the order's calendar date.
  const day0 = new Date(start)
  day0.setHours(0, 0, 0, 0)

  for (let d = 0; d < days && out.length < MAX_TASKS; d++) {
    for (const t of times) {
      if (out.length >= MAX_TASKS) break
      const [hh, mm] = t.split(':')
      const occ = new Date(day0)
      occ.setDate(day0.getDate() + d)
      occ.setHours(Number(hh), Number(mm), 0, 0)
      // Skip occurrences that fall before the order was actually placed on day 0.
      if (d === 0 && occ < start) continue
      out.push(occ)
    }
  }
  // Guard: if everything on day 0 was in the past, still give one task at start.
  return out.length ? out : [start]
}

/**
 * Generate and persist OrderTask rows for a freshly created order.
 * Idempotent-ish: skips if tasks already exist for the order. Returns the count.
 * Throws nothing fatal — the caller treats failures as non-blocking.
 */
export async function generateTasksForOrder(organizationId, order) {
  // Medicines are handled by the eMAR (MedicationAdministration), not the
  // Treatment Chart — skip PHARMACY so a drug never appears in two charts.
  if (order.orderType === 'PHARMACY') return 0

  const existing = await db.orderTask.count({ where: { orderId: order.id } })
  if (existing > 0) return 0

  const occurrences = expandSchedule({
    frequency: order.frequency,
    duration: order.duration,
    startAt: order.orderedAt || order.createdAt || new Date(),
  })

  await db.orderTask.createMany({
    data: occurrences.map((scheduledAt) => ({
      organizationId,
      admissionId: order.admissionId,
      orderId: order.id,
      orderType: order.orderType,
      itemName: order.itemName,
      scheduledAt,
      status: 'DUE',
    })),
  })
  return occurrences.length
}
