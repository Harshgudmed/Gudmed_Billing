// Small, readable date helpers — no external library needed.
// Each one copies the input first, so the original date is never mutated.
//
// NOTE: day boundaries are the HOSPITAL's, not the server's. `setHours(0,0,0,0)`
// resolves against the server's timezone, so a dev laptop (IST) and Render (UTC)
// disagreed by 5h30m and "today" silently meant different things. These now
// delegate to lib/dates.js, which pins the boundary to the hospital timezone.

import { dayRangeOf } from '../lib/dates.js'

/** Start of the given day (00:00:00.000) in the HOSPITAL's timezone. */
export function startOfDay(date) {
  return dayRangeOf(date).gte
}

/** End of the given day (23:59:59.999) in the HOSPITAL's timezone. */
export function endOfDay(date) {
  return dayRangeOf(date).lte
}

/** A new Date that is `days` days BEFORE the given date (same time of day). */
export function subDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() - days)
  return d
}

/** A new Date that is `days` days AFTER the given date (same time of day). */
export function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** Today's calendar date in IST (Asia/Kolkata), as "YYYY-MM-DD" — independent
 * of whatever timezone the server process itself happens to be running in.
 * Use this instead of `new Date().toISOString()` whenever "today" needs to
 * mean the hospital's local day, not a UTC instant — otherwise day-boundary
 * queries (e.g. "today's appointments") can land on the wrong calendar day
 * near midnight IST if the server isn't pinned to IST. */
export function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}
