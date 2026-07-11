// Shared date helpers. Kept tiny and pure so any controller can reuse them
// instead of re-declaring the same range logic (lab + radiology both did).

/**
 * A Prisma date filter covering the whole of the local "today" — from
 * 00:00:00.000 to 23:59:59.999 — for `{ gte, lte }` range queries.
 */
export function todayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { gte: start, lte: end }
}
