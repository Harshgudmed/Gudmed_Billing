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

// Intl.DateTimeFormat construction (locale/timezone data lookup) is far more
// expensive than actually calling an already-built formatter — building one
// fresh per row in a hot loop (e.g. getCalendarCounts bucketing hundreds of
// grouped rows) dominated the request. Formatters are stateless once built
// and only ever vary by timeZone (effectively constant per process), so they
// are built once and reused.
const offsetFormatterCache = new Map()
function offsetFormatter(timeZone) {
  let dtf = offsetFormatterCache.get(timeZone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    offsetFormatterCache.set(timeZone, dtf)
  }
  return dtf
}

const ymdFormatterCache = new Map()
function ymdFormatter(timeZone) {
  let dtf = ymdFormatterCache.get(timeZone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    ymdFormatterCache.set(timeZone, dtf)
  }
  return dtf
}

/** How far `instant`'s wall-clock in `timeZone` sits from UTC, in ms. */
function tzOffsetMs(instant, timeZone) {
  const p = Object.fromEntries(offsetFormatter(timeZone).formatToParts(instant).map((x) => [x.type, x.value]))
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
  return ymdFormatter(timeZone).format(instant)
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
    const [y, m, d] = ymdParts(startDate, 'startDate')
    range.gte = zonedWallTimeToUtc(y, m, d, 0, 0, 0, 0, timeZone)
  }
  if (endDate) {
    const [y, m, d] = ymdParts(endDate, 'endDate')
    range.lte = zonedWallTimeToUtc(y, m, d, 23, 59, 59, 999, timeZone)
  }
  return range
}

// 'YYYY-MM-DD' (or an ISO string starting with one) → [y, m, d]. Anything else
// is the caller's mistake, so a 400 that names the field — it used to become an
// Invalid Date deep in the query and every list screen answered with a 500.
function ymdParts(value, label) {
  const text = String(value).slice(0, 10)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const [y, m, d] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : []
  const real = match && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (!real) throw Object.assign(new Error(`${label} must be a date like 2026-09-25`), { status: 400 })
  return [y, m, d]
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
 * '10:15' → '10:15 AM', '09:00' → '9:00 AM' — a time as a person reads it, for
 * messages shown to staff and patients.
 *
 * `padHour` keeps the hour two digits ('09:00 AM'): the partner portal parses
 * this string back (split on the space, then the colon), so its output must not
 * change shape. Returns null for a time that is not a time.
 */
export function formatTime12h(time, { padHour = false } = {}) {
  const [h, m] = normalizeTimeHHMM(time).split(':')
  const hour = Number(h)
  const minute = Number(m)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  const modifier = hour >= 12 ? 'PM' : 'AM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${padHour ? String(twelve).padStart(2, '0') : twelve}:${String(minute).padStart(2, '0')} ${modifier}`
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A hospital day → '22 Sep'. Takes 'YYYY-MM-DD', a browser ISO instant or a
 * stored Date, and reads each in the hospital's timezone — the same way
 * startOfDay() decides which day an appointment is stored on.
 * Built by hand rather than with Intl: en-GB now renders September as "Sept",
 * which is not how anyone writes it on a hospital slip.
 */
export function formatDayMonth(date) {
  const ymd = ymdInZone(new Date(date))
  const [, m, d] = ymd.split('-').map(Number)
  return `${d} ${SHORT_MONTHS[m - 1]}`
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

/**
 * Parse a date a user typed, and refuse the three ways JavaScript accepts one it
 * should not. Returns a Date; throws a 400-shaped error naming the field.
 *
 *   new Date("hello")          -> Invalid Date, and stored as NULL if unchecked
 *   new Date("2032-02-30")     -> 2 March. A calendar overflow rolls FORWARD
 *                                 silently, so a case is booked on a day nobody
 *                                 chose and nobody is told.
 *   new Date("99999-01-01")    -> year 99998 — a valid JS Date that Postgres
 *                                 then refuses, turning a typo into a 500.
 *
 * Lives here because two controllers needed it and the second one was written
 * without the rollover check: OT bookings rejected 30 February while the OT case
 * record accepted it, on the same screen.
 */
export function parseUserDate(value, label, { minYear = 1900, maxYear = 2200 } = {}) {
  const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }) }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) fail(`${label} is not a valid date and time`)

  // Read the parsed date back against the text. A Date object being re-used has
  // no such text, so it is skipped.
  const written = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (written) {
    const [, year, month, day] = written
    const rolled = date.getFullYear() !== Number(year)
      || date.getMonth() + 1 !== Number(month)
      || date.getDate() !== Number(day)
    if (rolled) fail(`${label} is not a real calendar date`)
  }

  const year = date.getFullYear()
  if (year < minYear || year > maxYear) fail(`${label} is outside the years a hospital record can cover`)

  return date
}

/**
 * The day a patient is booked to come for a test ('YYYY-MM-DD' from a date box)
 * → the start of that day in the hospital's timezone. Refuses a day already
 * past: booking or moving a visit to yesterday is always a mistake. A year
 * ahead is the far limit — anything later is a typo in the year.
 * Shared by Laboratory and Radiology so both accept exactly the same days.
 */
export function parseScheduleDay(value, label = 'Scheduled date') {
  const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }) }
  parseUserDate(value, label)
  const ymd = String(value).slice(0, 10)
  const today = ymdInZone()
  if (ymd < today) fail(`${label} cannot be in the past`)
  const [y, m, d] = today.split('-').map(Number)
  const limit = new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10)
  if (ymd > limit) fail(`${label} can be at most one year ahead`)
  return dayRange(ymd, ymd).gte
}
