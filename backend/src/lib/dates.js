// Shared date helpers — all day boundaries are computed in the HOSPITAL's
// timezone, never the server's.
//
// WHY: `new Date("2026-07-13T00:00:00")` and `d.setHours(0,0,0,0)` both resolve
// against the SERVER's local timezone. A dev laptop runs in IST, Render runs in
// UTC — so "today" silently shifted by 5h30m in production. A patient who joined
// the queue at 03:00 IST landed at 21:30 UTC the *previous* day and vanished from
// the queue's "today" filter in production while showing up fine locally.
//
// Everything here takes/returns real UTC instants; only the wall-clock boundary
// is interpreted in the hospital timezone.

// The hospital's timezone. Override per-deployment with HOSPITAL_TIMEZONE.
export const HOSPITAL_TZ = process.env.HOSPITAL_TIMEZONE || 'Asia/Kolkata'

/** How far `instant`'s wall-clock in `timeZone` sits from UTC, in ms. */
function tzOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]))
  const hour = p.hour === '24' ? 0 : Number(p.hour) // some ICU builds render midnight as 24
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second))
  return asIfUtc - instant.getTime()
}

/**
 * A wall-clock time in `timeZone` → the real UTC instant it refers to.
 * The offset is measured on a millisecond-free instant: Intl.formatToParts has no
 * millisecond field, so feeding it 23:59:59.999 lost the .999 and skewed the
 * result by a second.
 */
function zonedWallTimeToUtc(y, m, d, hh, mm, ss, ms, timeZone) {
  const whole = new Date(Date.UTC(y, m - 1, d, hh, mm, ss, 0))
  const offset = tzOffsetMs(whole, timeZone)
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss, ms) - offset)
}

/** The calendar date (YYYY-MM-DD) that `instant` falls on in `timeZone`. */
export function ymdInZone(instant = new Date(), timeZone = HOSPITAL_TZ) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant)
}

/**
 * A Prisma `{ gte, lte }` filter covering whole calendar days in the hospital's
 * timezone. Pass 'YYYY-MM-DD' strings (either may be omitted).
 *
 *   where.joinedQueueAt = dayRange(startDate, endDate)
 */
export function dayRange(startDate, endDate, timeZone = HOSPITAL_TZ) {
  const range = {}
  if (startDate) {
    const [y, m, d] = String(startDate).slice(0, 10).split('-').map(Number)
    range.gte = zonedWallTimeToUtc(y, m, d, 0, 0, 0, 0, timeZone)
  }
  if (endDate) {
    const [y, m, d] = String(endDate).slice(0, 10).split('-').map(Number)
    range.lte = zonedWallTimeToUtc(y, m, d, 23, 59, 59, 999, timeZone)
  }
  return range
}

/** `{ gte, lte }` covering the whole of TODAY in the hospital's timezone. */
export function todayRange(timeZone = HOSPITAL_TZ) {
  const today = ymdInZone(new Date(), timeZone)
  return dayRange(today, today, timeZone)
}

/** The UTC instant at which today began in the hospital's timezone. */
export function startOfToday(timeZone = HOSPITAL_TZ) {
  return todayRange(timeZone).gte
}

/** `{ gte, lte }` covering the single calendar day `date` falls on. */
export function dayRangeOf(date, timeZone = HOSPITAL_TZ) {
  const ymd = ymdInZone(new Date(date), timeZone)
  return dayRange(ymd, ymd, timeZone)
}

/**
 * A clock time → zero-padded 'HH:MM'.
 *
 * Appointment times are stored as a String and sorted as one
 * (`orderBy: { appointmentTime: 'asc' }`), so an unpadded '9:00' sorts AFTER
 * '10:00' — the 9am patient lands at the bottom of the day. Padding is what makes
 * the string sort chronological, so every write must go through this.
 */
export function normalizeTimeHHMM(timeStr) {
  const [h, m] = String(timeStr ?? '').split(':')
  const hh = Number(h)
  const mm = Number(m)
  // Always return a STRING, even on invalid input — every caller does
  // .split(':') on the result, and returning the raw `timeStr` unchanged
  // (which can be undefined, null, a number, ...) crashed toMinutes() in
  // lib/activeDoctor.js with "Cannot read properties of undefined" instead
  // of failing validation cleanly. String(undefined) = 'undefined', which
  // downstream Number()/split() handling turns into a clean NaN instead.
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return String(timeStr ?? '')
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * A wall-clock 'YYYY-MM-DD' + 'H:MM' in the hospital's timezone → the real UTC
 * instant. Appointment times are stored as free-text and come through in both
 * '9:00' and '09:00' form, so the parts are parsed numerically rather than by
 * string layout.
 */
export function zonedDateTimeToUtc(ymd, timeStr, timeZone = HOSPITAL_TZ) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  const [hh, mm] = String(timeStr || '0:0').split(':')
  return zonedWallTimeToUtc(y, m, d, Number(hh) || 0, Number(mm) || 0, 0, 0, timeZone)
}

/**
 * "Right now" as the HOSPITAL's clock reads it: 24h wall-clock 'HH:mm' and
 * day-of-week (0=Sunday..6=Saturday, matching JS Date#getDay()). Used by
 * lib/activeDoctor.js to decide which doctor is active in a shared room —
 * needs the same hospital-timezone fix as the rest of this file, otherwise a
 * UTC server would flip "today" (and the active doctor) up to 5h30m early.
 * Accepts an explicit `instant` so tests can resolve against a fixed time.
 */
export function nowInZone(instant = new Date(), timeZone = HOSPITAL_TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]))
  const hour = p.hour === '24' ? 0 : Number(p.hour) // some ICU builds render midnight as 24
  // Day-of-week is purely a function of the calendar date, so building a
  // date FROM the zoned Y/M/D parts and reading getUTCDay() back off it gives
  // the hospital's weekday regardless of what zone the server itself runs in.
  const dayOfWeek = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay()
  return { hhmm: `${String(hour).padStart(2, '0')}:${p.minute}`, dayOfWeek }
}
