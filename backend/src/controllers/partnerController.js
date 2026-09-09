// Read-only appointment feed for the GudMed Doctor Portal.
//
// The portal's own backend calls this and hands the result to its existing
// appointment screen. That screen already parses a very specific shape, so this
// endpoint RETURNS THAT SHAPE EXACTLY — envelope, field names and formats — and
// the portal's backend can pass it straight through without transforming
// anything. Verified against the live API on 9 Sept 2026: a row it returns
// carries patname / scheduleDate / scheduleTime / endTime / mobileNo /
// callbackNumber, and its calendar parses the dates and times by string layout.
//
// WHY THIS DIRECTION. The alternative was pushing appointments into their
// database, which needs a doctor's password stored here and leaves two copies
// that drift the moment a case is cancelled. Answering a read keeps one copy,
// keeps the credential ours to revoke, and means a cancellation in the HMS is
// gone from the portal the next time it asks.
//
// READ ONLY on purpose. There is no create, update or cancel here. A partner
// key that leaks can read a doctor's list for a date range; it can never change
// a record, bill anything, or reach another hospital.
import { db } from '../config/db.js'
import crypto from 'node:crypto'
import { PATIENT_NAME_SELECT, patientFullName } from '../lib/patientName.js'
import { parseUserDate, normalizeTimeHHMM, dayRange } from '../lib/dates.js'

// Statuses that are still going to happen, and those that are over. A cancelled
// or no-show appointment appears in neither: the portal has no column for
// "cancelled", so a cancelled case listed as upcoming would read as a live
// booking to the doctor reading it.
const UPCOMING = ['scheduled', 'confirmed', 'checked_in', 'in_progress']
const COMPLETED = ['completed']

// A date range has to be bounded or one key pulls the whole appointment history
// in a single call.
const MAX_RANGE_DAYS = 90

// Same shape as importController's check: the secret lives ONLY in the
// environment, a missing secret refuses everything rather than allowing it, and
// the comparison is constant-time so the value cannot be recovered by timing.
//
// A SEPARATE secret from IMPORT_SECRET, deliberately. That one can create
// administrators and overwrite data; a partner that only reads must hold a
// credential that can only read.
function partnerKeyValid(provided) {
  const expected = process.env.DOCTOR_PORTAL_PARTNER_SECRET
  if (!expected || !provided) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(String(expected))
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// 'DD-MM-YYYY' in the hospital's own day, which is how the portal's calendar
// reads it: schedule.split('-') → [day, month, year].
function ddmmyyyy(date) {
  const d = new Date(date)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`
}

// '10:15' → '10:15 AM'. The portal splits on the space, then on the colon, and
// tests the modifier against 'PM' — so the space and the case both matter.
function hhmmAmPm(time) {
  const [h, m] = normalizeTimeHHMM(time).split(':')
  const hour = Number(h)
  const minute = Number(m)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  const modifier = hour >= 12 ? 'PM' : 'AM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${String(twelve).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${modifier}`
}

// The HMS has no end time — an appointment is a start and a duration. The
// duration is per hospital, in its own settings blob, so a clinic running 15
// minute slots is not given 30.
function appointmentMinutes(organization) {
  try {
    const stored = typeof organization?.settings === 'string'
      ? JSON.parse(organization.settings)
      : (organization?.settings || {})
    const n = Number(stored.appointmentDuration)
    return Number.isFinite(n) && n > 0 ? n : 30
  } catch { return 30 }
}

function addMinutes(time, minutes) {
  const [h, m] = normalizeTimeHHMM(time).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  const total = h * 60 + m + minutes
  const hh = Math.floor(total / 60) % 24
  return `${String(hh).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// One appointment, in the portal's words.
//
// Returns null when the row cannot be rendered. The portal's calendar calls
// .split() on scheduleDate, scheduleTime and endTime without guarding them —
// its optional chaining sits on the array element, not the field — so a null in
// any of the three takes the whole page down. Dropping the row is the only safe
// answer; a row nobody can read is worth less than a page that still loads.
function toPortalRow(appointment, minutes) {
  const scheduleTime = hhmmAmPm(appointment.appointmentTime)
  const endTime = hhmmAmPm(addMinutes(appointment.appointmentTime, minutes))
  if (!scheduleTime || !endTime) return null

  return {
    patname: patientFullName(appointment.patient) || '',
    callbackNumber: '',
    mobileNo: appointment.patient?.phonePrimary || '',
    hospitalName: '',
    city: '',
    pincode: '',
    scheduleDate: ddmmyyyy(appointment.appointmentDate),
    scheduleTime,
    endTime,
    appointmentFlag: 'hms',
  }
}

/**
 * GET /api/partner/appointments
 *   ?doctorEmail=dr.sharma@hospital.in   required
 *   &from=2026-09-09  &to=2026-09-16     required, YYYY-MM-DD, ≤ 90 days apart
 * Header: x-partner-key
 *
 * → { status: 200, body: { upcomingData: [...], completedData: [...] } }
 */
export async function getAppointments(req, res) {
  if (!partnerKeyValid(req.headers['x-partner-key'])) {
    return res.status(401).json({ status: 401, message: 'Unauthorized', body: {} })
  }

  const { doctorEmail, from, to } = req.query
  if (!doctorEmail) {
    return res.status(400).json({ status: 400, message: 'doctorEmail is required', body: {} })
  }
  if (!from || !to) {
    return res.status(400).json({ status: 400, message: 'from and to are required (YYYY-MM-DD)', body: {} })
  }

  // Validated first, so a typo comes back naming the field that is wrong rather
  // than as a silently empty list.
  try {
    parseUserDate(`${from}T00:00`, 'from')
    parseUserDate(`${to}T23:59`, 'to')
  } catch (e) {
    return res.status(400).json({ status: 400, message: e.message, body: {} })
  }

  // The BOUNDARIES come from dayRange, not from the dates parsed above.
  //
  // appointmentDate is stored as midnight in the HOSPITAL's timezone —
  // appointmentController pins it with startOfDay() on create — so the window
  // has to be built the same way or it does not line up with the rows.
  // `new Date('2026-09-01T00:00')` resolves against the SERVER's zone instead:
  // identical on an IST laptop, but 5.5 hours late on a UTC host like Render,
  // which silently drops the first day of every range and leaks in an extra one
  // at the end. Same helper the appointment module uses, for the same reason.
  const { gte: start, lte: end } = dayRange(from, to)
  if (end < start) {
    return res.status(400).json({ status: 400, message: 'to must not be before from', body: {} })
  }
  if ((end - start) / 86_400_000 > MAX_RANGE_DAYS) {
    return res.status(400).json({ status: 400, message: `Range must be ${MAX_RANGE_DAYS} days or fewer`, body: {} })
  }

  // The doctor is resolved HERE, from a key the caller cannot forge into
  // someone else's data — never from a doctor id in the request. Their portal
  // supports one login seeing several doctors (mappedDoctors), so a doctorId
  // arriving from it proves nothing about who may be asked about.
  //
  // email is the join: it is the only identifier that is unique in the schema
  // and present on every one of the 1,131 doctors. Phone is on 6 of them and
  // one of those numbers belongs to two people.
  const doctor = await db.user.findFirst({
    where: { email: String(doctorEmail).trim().toLowerCase(), role: 'doctor' },
    select: { id: true, organizationId: true, isActive: true },
  })
  // The same answer whether the address is unknown or belongs to someone who is
  // not a doctor — an error that distinguishes them is an address checker.
  if (!doctor) {
    return res.status(404).json({ status: 404, message: 'No doctor found', body: {} })
  }

  // The hospital comes from the doctor, never from a parameter. The caller does
  // not get to choose a tenant.
  const organization = await db.organization.findUnique({
    where: { id: doctor.organizationId },
    select: { settings: true },
  })
  const minutes = appointmentMinutes(organization)

  const rows = await db.appointment.findMany({
    where: {
      organizationId: doctor.organizationId,
      doctorId: doctor.id,
      appointmentDate: { gte: start, lte: end },
      status: { in: [...UPCOMING, ...COMPLETED] },
    },
    select: {
      appointmentDate: true,
      appointmentTime: true,
      status: true,
      patient: { select: { ...PATIENT_NAME_SELECT, phonePrimary: true } },
    },
    orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
    // A ceiling under the date cap, so a single busy doctor cannot return an
    // unbounded payload.
    take: 500,
  })

  const upcomingData = []
  const completedData = []
  for (const row of rows) {
    const mapped = toPortalRow(row, minutes)
    if (!mapped) continue // unrenderable — see toPortalRow
    ;(COMPLETED.includes(row.status) ? completedData : upcomingData).push(mapped)
  }

  return res.json({ status: 200, message: 'SUCCESS', body: { upcomingData, completedData } })
}
