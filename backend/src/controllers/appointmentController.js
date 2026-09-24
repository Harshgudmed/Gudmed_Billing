import { patientSearchWhere } from '../lib/patientSearch.js';
import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { drName } from "../lib/drName.js";
import { nextSeriesNumber, invoiceProbe } from "../lib/counters.js";
import { startOfDay, endOfDay, todayIST } from '../utils/dates.js'
import { normalizeTimeHHMM, zonedDateTimeToUtc, ymdInZone, formatTime12h, formatDayMonth } from '../lib/dates.js'
import { isOnLeave } from '../lib/activeDoctor.js'
import { commissionFor } from '../lib/money.js'
import { parseTimetable } from '../lib/doctorTimetable.js'
import { scopedDoctorId } from '../utils/scope.js'
import { computeConsultationFee } from '../services/appointmentFees.js'
import { upsertQueueForAppointment } from '../lib/queueSync.js'
import { PATIENT_NAME_SELECT, patientFullName } from '../lib/patientName.js'

// Appointment status state-machine. `status` is a free string column, so before
// this any PATCH could jump it to ANY value — cancelled → completed, a no-show
// back to scheduled — corrupting reports and re-attaching money to a visit that
// never happened. This is the single source of truth for which status changes
// are legal. Rules: the four TERMINAL states (completed, cancelled, no_show,
// rescheduled) have NO outgoing edges — once a visit is finished or voided it
// stays that way. The active states move forward only. Re-stating the SAME
// status is always allowed (a no-op) so an edit that resends the current status
// while changing other fields is never rejected. 'rescheduled' is set only by
// the dedicated reschedule() flow (which writes the row directly, bypassing this
// map), so it is intentionally absent as a target here.
export const APPOINTMENT_STATUS_TRANSITIONS = {
  scheduled:   ['confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'],
  confirmed:   ['checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'],
  checked_in:  ['in_progress', 'completed', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled', 'no_show'],
  completed:   [], // terminal
  cancelled:   [], // terminal
  no_show:     [], // terminal
  rescheduled: [], // terminal
}

// Returns null when the transition is legal, or an error string when it is not.
// A same-status change is treated as a legal no-op. An unknown current status
// is treated permissively (fall through) so legacy/imported rows aren't bricked.
export function statusTransitionError(from, to) {
  if (from === to) return null
  const allowed = APPOINTMENT_STATUS_TRANSITIONS[from]
  if (!allowed) return null // unknown source status — don't block
  if (allowed.includes(to)) return null
  return `Cannot change appointment status from '${from}' to '${to}'`
}

/**
 * Every refusal from this controller is written for the person at the counter:
 * a short `title` (the bold line of the toast) and one plain sentence in
 * `error` that says what is wrong and what to do next — never a status code, a
 * field name or a database phrase. `error` alone still reads as a complete
 * message, for the screens that show one line (the QR page, Register Patient).
 *
 *   Time slot unavailable
 *   Dr. Sharma is already booked at 10:00 AM on 22 Sep. Please choose another time.
 */
function refusal(title, error, code) {
  return { success: false, ...(code ? { code } : {}), title, error }
}

// How a status reads in a sentence: "already checked in", "can't be changed to
// a no-show".
const STATUS_WORDS = {
  scheduled: 'scheduled',
  confirmed: 'confirmed',
  checked_in: 'checked in',
  in_progress: 'in consultation',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'a no-show',
  rescheduled: 'rescheduled',
}
const statusWords = (s) => STATUS_WORDS[s] || String(s || '').replace(/_/g, ' ')

/**
 * "This appointment is already completed, so its status can't be changed to
 * checked in." — plus, for a visit that is over, what to do instead.
 */
function statusChangeRefusal(from, to) {
  const over = ['completed', 'cancelled', 'no_show', 'rescheduled'].includes(from)
  return refusal(
    "Status can't be changed",
    `This appointment is already ${statusWords(from)}, so its status can't be changed to ${statusWords(to)}.`
      + (over ? ' Book a new appointment if the patient needs another visit.' : ''),
    'INVALID_STATUS_TRANSITION',
  )
}

const APPOINTMENT_GONE = refusal(
  'Appointment not found',
  'This appointment no longer exists — it may have been deleted. Please refresh the page.',
)
const DOCTOR_GONE = refusal(
  'Doctor not available',
  'This doctor could not be found in your hospital. Please choose another doctor.',
  'DOCTOR_NOT_FOUND',
)

/** The time and day as a person reads them: "10:00 AM on 22 Sep". */
const when = (date, time) => `${formatTime12h(time) || time} on ${formatDayMonth(date)}`

async function doctorLabel(organizationId, doctorId) {
  const doctor = doctorId
    ? await db.user.findFirst({ where: { id: doctorId, organizationId }, select: { fullName: true } })
    : null
  return doctor?.fullName ? drName(doctor.fullName) : 'The doctor'
}

/**
 * The doctor already has someone at that time. Built in one place so the
 * pre-check and the database's race guard below say exactly the same thing.
 */
async function slotTakenBody({ organizationId, doctorId, date, time }) {
  return refusal(
    'Time slot unavailable',
    `${await doctorLabel(organizationId, doctorId)} is already booked at ${when(date, time)}. Please choose another time.`,
    'SLOT_TAKEN',
  )
}

/**
 * Every rule a date + time + doctor has to pass before an appointment may sit
 * on it — booking, editing and rescheduling all ask this one function, so the
 * three cannot drift apart. It answers `null` (fine) or the exact response to
 * send back.
 *
 * Editing and rescheduling used to skip all of it: a PATCH could move a booking
 * into the past, onto a doctor's leave day, or on top of another patient, and a
 * reschedule could do the same plus put one patient with two doctors at once.
 * Only the doctor's own slot was protected, by the database's unique index —
 * which surfaced as "A record with this value already exists" instead of a
 * usable message.
 *
 * @param {string}  [excludeAppointmentId]  the row being edited/moved, so it
 *   does not clash with its own current slot.
 */
async function slotProblem({ organizationId, doctorId, patientId, date, time, excludeAppointmentId }) {
  // `date` arrives as 'YYYY-MM-DD', as a browser ISO instant, or as a stored
  // Date — and has to name the day the appointment is STORED on, which is what
  // startOfDay() picks: the instant read in the hospital's timezone. Taking the
  // first ten characters of an ISO string instead reads the UTC date, which
  // between midnight and 05:30 IST is still yesterday: the New Appointment
  // form's default date (`new Date()`) then had its leave and past-time checks
  // run against the wrong day.
  const ymd = ymdInZone(new Date(date))

  // 1. Not in the past — the DAY and the TIME. At 11:00 a 10:00 slot today is
  //    refused too (1-minute grace for a booking made in the current minute).
  const instant = zonedDateTimeToUtc(ymd, time)
  if (instant.getTime() < Date.now() - 60_000) {
    return {
      status: 400,
      body: refusal('This time has passed', `${when(ymd, time)} has already passed. Please choose a later time.`, 'SLOT_IN_PAST'),
    }
  }

  const day = startOfDay(date)
  const notVoided = { notIn: ['cancelled', 'no_show', 'rescheduled'] }
  const exclude = excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}

  // 2. The doctor is not on leave that day (timetable exceptions are the source
  //    of truth — lib/activeDoctor.js#isOnLeave).
  if (doctorId) {
    const doctor = await db.user.findFirst({
      where: { id: doctorId, organizationId, role: 'doctor' },
      select: { preferences: true, fullName: true },
    })
    const timetable = parseTimetable(doctor?.preferences)
    if (timetable && isOnLeave(timetable, ymd)) {
      return {
        status: 409,
        body: refusal(
          'Doctor on leave',
          `${doctor?.fullName ? drName(doctor.fullName) : 'This doctor'} is on leave on ${formatDayMonth(ymd)}. Please choose another date or doctor.`,
          'DOCTOR_ON_LEAVE',
        ),
      }
    }
  }

  // 3. The doctor is free. Matched across the whole calendar DAY, because rows
  //    written before dates were pinned to midnight carry a creation instant.
  if (doctorId) {
    const clash = await db.appointment.findFirst({
      where: {
        ...exclude,
        organizationId,
        doctorId,
        appointmentDate: { gte: startOfDay(day), lte: endOfDay(day) },
        appointmentTime: time,
        status: notVoided,
      },
      select: { id: true },
    })
    if (clash) {
      return { status: 409, body: await slotTakenBody({ organizationId, doctorId, date: ymd, time }) }
    }
  }

  // 4. The patient is free — with ANY doctor. A person cannot be in two rooms
  //    at once, and the database has no patient-side index to catch it.
  if (patientId) {
    const clash = await db.appointment.findFirst({
      where: {
        ...exclude,
        organizationId,
        patientId,
        appointmentDate: { gte: startOfDay(day), lte: endOfDay(day) },
        appointmentTime: time,
        status: notVoided,
      },
      select: { patient: { select: PATIENT_NAME_SELECT }, doctor: { select: { fullName: true } } },
    })
    if (clash) {
      const who = patientFullName(clash.patient) || 'This patient'
      const withWhom = clash.doctor?.fullName ? ` with ${drName(clash.doctor.fullName)}` : ''
      return {
        status: 409,
        body: refusal(
          'Patient already booked',
          `${who} already has an appointment${withWhom} at ${when(ymd, time)}. Please choose another time.`,
          'PATIENT_DOUBLE_BOOKED',
        ),
      }
    }
  }

  return null
}

// What the consultation line on the invoice says. The line must name WHAT was
// billed, so reception, the patient and an auditor can tell an OPD visit from a
// follow-up on the receipt itself. Written once because both booking and an
// edit that changes the doctor or the visit type have to produce it.
const VISIT_LABEL = {
  follow_up: 'Follow-up Consultation',
  new_patient: 'OPD Consultation (New Patient)',
  emergency: 'Emergency Consultation',
}
function consultationLineDescription(appointmentType, doctorFullName, fallbackServiceName) {
  const type = appointmentType || 'OPD'
  const visitLabel = VISIT_LABEL[type] || fallbackServiceName || `${type} Consultation`
  return doctorFullName ? `${visitLabel} — ${drName(doctorFullName)}` : visitLabel
}

// The doctor's slot is also guarded by a partial unique index
// (migration 20260716100500_appointment_slot_unique), which is the real race
// guard: two requests can both pass the read above within the same instant.
// Prisma reports the FIELD names on this client, hence the appointmentTime
// check — it is the only unique constraint on Appointment that mentions it.
function isSlotConflict(err) {
  const target = String(err.meta?.target || '')
  return err.code === 'P2002'
    && (target.includes('Appointment_doctor_active_slot_key') || target.includes('appointmentTime'))
}

/**
 * GET /appointments/check-slot?doctorId&date&time[&patientId][&appointmentId][&keepCurrent=1]
 *
 * Would this slot be accepted? Asked by the booking forms the moment a time is
 * picked, so the reason appears in red under the Time field straight away —
 * not only as a toast after Save. It runs slotProblem(), the very rules
 * booking, editing and rescheduling apply, so the red line and what Save does
 * can never disagree.
 *
 * Always 200: "that slot is taken" is an answer, not a failed request.
 *
 * @query appointmentId  the appointment being edited or moved — it must not
 *                       clash with its own current slot
 * @query keepCurrent    '1' from the Edit form: leaving the time as it was is
 *                       fine, exactly as update() only re-checks a real move
 */
export async function checkSlot(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { doctorId, patientId, date, appointmentId, keepCurrent } = req.query
    const time = normalizeTimeHHMM(req.query.time)
    const ok = () => res.json({ success: true, data: { ok: true } })

    // Nothing complete to check yet — the form is still being filled in.
    if (!doctorId || !date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || Number.isNaN(new Date(date).getTime())) {
      return ok()
    }

    if (appointmentId && keepCurrent === '1') {
      const current = await db.appointment.findFirst({
        where: { id: String(appointmentId), organizationId },
        select: { doctorId: true, appointmentDate: true, appointmentTime: true, status: true },
      })
      const unchanged = current
        && current.doctorId === doctorId
        && ymdInZone(current.appointmentDate) === ymdInZone(new Date(date))
        && current.appointmentTime === time
      const over = current && ['completed', 'cancelled', 'no_show', 'rescheduled'].includes(current.status)
      if (unchanged || over) return ok()
    }

    const answer = (body) => res.json({
      success: true,
      data: { ok: false, code: body.code, title: body.title, message: body.error },
    })

    const problem = await slotProblem({
      organizationId,
      doctorId: String(doctorId),
      patientId: patientId ? String(patientId) : undefined,
      date: String(date),
      time,
      excludeAppointmentId: appointmentId ? String(appointmentId) : undefined,
    })
    if (problem) return answer(problem.body)

    // Save also refuses a doctor or patient that is not this hospital's (a
    // doctor removed while the form was open, a patient deleted) — checked in
    // the same order create() does, after the slot rules, so the red line and
    // Save give the same answer. "Not found" either way: it reveals nothing
    // about whether the id exists at another hospital.
    const doctor = await db.user.findFirst({
      where: { id: String(doctorId), organizationId, role: 'doctor' },
      select: { id: true },
    })
    if (!doctor) return answer(DOCTOR_GONE)
    if (patientId) {
      const patient = await db.patient.findFirst({
        where: { id: String(patientId), organizationId },
        select: { id: true },
      })
      if (!patient) {
        return answer(refusal(
          'Patient not found',
          "This patient's record could not be found. Please search for the patient again.",
          'PATIENT_NOT_FOUND',
        ))
      }
    }
    return ok()
  } catch (err) {
    next(err)
  }
}

export async function getAll(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { date, dateFrom, dateTo, status, doctorId, patientId, department, search } = req.query
    const limit = Math.min(Number(req.query.limit) || 50, 1000) // hard cap, NaN-safe
    const offset = Math.max(Number(req.query.offset) || 0, 0)   // NaN/negative → 0

    const where = { organizationId }

    if (date) {
      // Match any appointment that falls on the requested calendar day
      where.appointmentDate = { gte: startOfDay(date), lte: endOfDay(date) }
    } else if (dateFrom && dateTo) {
      // Calendar/week views fetch a bounded date range instead of everything
      where.appointmentDate = { gte: startOfDay(dateFrom), lte: endOfDay(dateTo) }
    }
    // `status` accepts one value or a comma-separated list. The Today screen's
    // two panes are each a GROUP of statuses ("upcoming" = scheduled/confirmed/
    // checked_in/in_progress), and with only single-value matching it had to
    // pull the whole day and split it in the browser — which silently lost every
    // appointment past the row cap on a busy day.
    if (status) {
      const wanted = String(status).split(',').map((s) => s.trim()).filter(Boolean)
      if (wanted.length > 1) where.status = { in: wanted }
      else if (wanted.length === 1) where.status = wanted[0]
    }
    if (doctorId) where.doctorId = doctorId
    if (patientId) where.patientId = patientId

    // Filter by the appointment's doctor's department name
    if (department && department !== 'all') {
      where.doctor = { is: { department: { is: { name: department } } } }
    }

    // Free-text search across patient, doctor and chief complaint
    if (search) {
      const searchWhere = patientSearchWhere(search, 'patient', (term) => [
        { doctor:  { is: { fullName:  { contains: term, mode: 'insensitive' } } } },
        { chiefComplaint: { contains: term, mode: 'insensitive' } },
      ])
      if (searchWhere) Object.assign(where, searchWhere)
    }

    // A doctor only sees their own appointments (overrides any doctorId query param).
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    const [appointments, total] = await Promise.all([
      db.appointment.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
        include: {
          patient: {
            select: { ...PATIENT_NAME_SELECT, phonePrimary: true, gender: true, dateOfBirth: true },
          },
          doctor: {
            select: { id: true, fullName: true, specialization: true },
          },
        },
      }),
      db.appointment.count({ where }),
    ])

    res.json({ 
      success: true, 
      data: appointments,
      meta: { total, limit, offset, hasMore: offset + limit < total }
    })
  } catch (err) {
    next(err)
  }
}

// Calendar cells only need counts, not full appointment rows. Uses the same
// Prisma ORM groupBy as getStats, with ymdInZone for date-bucketing, so the
// two APIs always agree on which calendar day an appointment belongs to.
// (The previous raw-SQL implementation used `date_trunc('day', ...)` which
// truncated in UTC — an appointment at 18:30 UTC, which is midnight IST, was
// grouped under the PREVIOUS calendar day, producing a silent off-by-one vs
// the Stats API that defines day boundaries in the hospital timezone.)
export async function getCalendarCounts(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { dateFrom, dateTo } = req.query

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ success: false, error: 'dateFrom and dateTo are required' })
    }

    const from = startOfDay(dateFrom)
    const to = endOfDay(dateTo)
    const where = { organizationId, appointmentDate: { gte: from, lte: to } }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    const grouped = await db.appointment.groupBy({
      by: ['appointmentDate', 'status'],
      where,
      _count: true,
    })

    // Bucket each group into its hospital-timezone calendar day using the same
    // ymdInZone that startOfDay/endOfDay (and thus getStats) rely on.
    const byDay = new Map()
    for (const row of grouped) {
      const date = ymdInZone(row.appointmentDate)
      const count = row._count
      const summary = byDay.get(date) || { date, total: 0, byStatus: {} }
      summary.total += count
      summary.byStatus[row.status] = (summary.byStatus[row.status] || 0) + count
      byDay.set(date, summary)
    }

    res.json({ success: true, data: [...byDay.values()] })
  } catch (err) {
    next(err)
  }
}

// Today's appointment counts by status, computed by the DB (groupBy) instead of
// shipping every row to the browser to count.
export async function getStats(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const day = req.query.date || todayIST()
    const where = { organizationId, appointmentDate: { gte: startOfDay(day), lte: endOfDay(day) } }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    const grouped = await db.appointment.groupBy({ by: ['status'], where, _count: true })
    const by = Object.fromEntries(grouped.map((g) => [g.status, g._count]))
    res.json({
      success: true,
      data: {
        total: grouped.reduce((sum, g) => sum + g._count, 0),
        scheduled: by.scheduled || 0,
        confirmed: by.confirmed || 0,
        checkedIn: by.checked_in || 0,
        inProgress: by.in_progress || 0,
        completed: by.completed || 0,
        cancelled: by.cancelled || 0,
        noShows: by.no_show || 0,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getOne(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params

    // Scope single-appointment reads to the doctor's own (others → 404 below).
    const where = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    const appointment = await db.appointment.findFirst({
      where,
      include: {
        patient: true,
        doctor: { select: { id: true, fullName: true, specialization: true } },
        consultations: true,
      },
    })

    if (!appointment) {
      return res.status(404).json(APPOINTMENT_GONE)
    }

    res.json({ success: true, data: appointment })
  } catch (err) {
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const validatedData = req.validatedBody
    // Pad once, here: the slot-clash lookup below and the row we store must agree,
    // and the stored value is string-sorted (see normalizeTimeHHMM).
    validatedData.appointmentTime = normalizeTimeHHMM(validatedData.appointmentTime)

    // Not in the past, doctor not on leave, doctor's slot free, patient's slot
    // free — the same four rules update() and reschedule() apply (slotProblem).
    const problem = await slotProblem({
      organizationId,
      doctorId: validatedData.doctorId,
      patientId: validatedData.patientId,
      date: validatedData.appointmentDate,
      time: validatedData.appointmentTime,
    })
    if (problem) return res.status(problem.status).json(problem.body)

    // Pin to midnight of the hospital's day. `appointmentDate` is the DAY; the
    // time of day lives in `appointmentTime`. The browser sends a full instant
    // (the form defaults to `new Date()` and posts .toISOString()), so storing
    // it raw put the booking's own creation moment in the date — 2026-07-17
    // T11:40:15.915Z rather than midnight. That silently disabled the
    // double-booking guard: the unique index is on (organizationId, doctorId,
    // appointmentDate, appointmentTime), so a date unique to the millisecond
    // can never collide, and one doctor ended up with 13 bookings in the same
    // 10:00 slot. Normalising here is what gives that index something to catch.
    const apptDate = startOfDay(validatedData.appointmentDate)
    let consultationFee = null
    let appliedSlabInfo = null

    // Fee is always derived from the doctor's slabs (shared with the preview endpoint) —
    // createAppointmentSchema doesn't accept a client-supplied consultationFee.
    if (validatedData.doctorId) {
      const result = await computeConsultationFee({
        organizationId,
        doctorId: validatedData.doctorId,
        patientId: validatedData.patientId,
        date: apptDate,
      })
      if (result.doctorMissing) {
        return res.status(404).json(DOCTOR_GONE)
      }
      consultationFee = result.fee
      appliedSlabInfo =
        result.reason === 'slab'
          ? { type: 'slab', slabId: result.slab.id, fromDays: result.slab.fromDays, toDays: result.slab.toDays }
          : result.reason === 'reset'
            ? { type: '30day_reset' }
            : result.reason === 'default'
              ? { type: 'default' }
              : { type: 'new_patient' }
    }

    // patientId is required, but nothing verified it pointed at a real patient in
    // THIS org: a bogus id sailed through to the create below and surfaced as a
    // raw Prisma foreign-key error (P2003) → HTTP 500. Validate it up front, the
    // same way doctorId (via computeConsultationFee) and departmentId are, so a
    // bad reference returns a clean 404 instead. Mirrors the department check.
    const patient = await db.patient.findFirst({
      where: { id: validatedData.patientId, organizationId },
      select: { id: true },
    })
    if (!patient) {
      return res.status(404).json(refusal(
        'Patient not found',
        "This patient's record could not be found. Please search for the patient again.",
        'PATIENT_NOT_FOUND',
      ))
    }

    // departmentId is optional, but if supplied it must be a real department in
    // THIS org — otherwise any string (even a patient id) was stored as-is.
    // Mirrors roomController.createRoom's department check.
    if (validatedData.departmentId) {
      const dept = await db.department.findFirst({
        where: { id: validatedData.departmentId, organizationId },
        select: { id: true },
      })
      if (!dept) {
        return res.status(400).json(refusal(
          'Department not found',
          'This department no longer exists. Please choose another department.',
        ))
      }
    }

    // Create appointment, invoice, AND commission in transaction. The
    // findFirst check above is only a fast, friendly pre-check — it runs
    // outside any transaction/lock, so two requests within the same ~100ms
    // window can both pass it and both reach this create. The real guard is
    // the partial unique index on (organizationId, doctorId, appointmentDate,
    // appointmentTime) (migration 20260716100500_appointment_slot_unique) —
    // the loser's create throws P2002, caught below and translated to the
    // same SLOT_TAKEN response the pre-check gives the common case.
    let appointment, draftInvoiceNumber, commission
    try {
      ({ appointment, draftInvoiceNumber, commission } = await db.$transaction(async (tx) => {
      // Single source of truth for the fee. The receipt/appointment-card prints
      // `appointment.consultationFee`, while the invoice line charges this same
      // effective amount. Previously the appointment stored the raw `consultationFee`
      // (null when no doctor/slab applied) but the invoice fell back to the billing
      // service price or ₹500 — so the card showed no fee (or blank) while the
      // patient was actually billed the fallback. Deriving both from ONE value here
      // keeps the printed fee and the charged fee in agreement. A genuine free
      // follow-up is fee 0 (not null), so it still prints ₹0 and bills ₹0.
      const opdService = await tx.billingService.findFirst({
        where: { organizationId, isActive: true, serviceCategory: 'consultation' },
        orderBy: { createdAt: 'asc' },
      })
      const effectiveFee = consultationFee ?? opdService?.unitPrice ?? 500

      const appointment = await tx.appointment.create({
        data: {
          organizationId,
          patientId: validatedData.patientId,
          doctorId: validatedData.doctorId,
          appointmentDate: apptDate,
          appointmentTime: validatedData.appointmentTime,
          appointmentType: validatedData.appointmentType,
          priority: validatedData.priority || 'normal',
          notes: validatedData.notes,
          departmentId: validatedData.departmentId,
          consultationFee: effectiveFee,
          status: 'scheduled',
          reminderSent: false,
        },
        include: {
          patient: { select: { ...PATIENT_NAME_SELECT, phonePrimary: true } },
          doctor: { select: { id: true, fullName: true } },
        },
      })

      // Put the patient in the queue NOW, in the same transaction.
      //
      // The queue is derived from appointments, but it was derived LAZILY — by
      // syncAppointmentsToQueue, which runs when the Queue page is fetched and,
      // for the display board, at most once a minute. So a patient booked at
      // 15:50 did not exist in the queue at 15:50: the Queue screen only showed
      // them on the next refetch, and the wall board up to 60s later. Reception
      // had to refresh to see someone they had just booked.
      //
      // Writing the row here makes the queue correct the instant the
      // appointment exists, so a poll of either screen sees it immediately and
      // nothing has to wait for a sync pass.
      //
      // The sync is NOT redundant now — it stays as the self-heal for rows
      // created before this existed, for imported/seeded appointments, and for
      // slot or room changes. It upserts, so it simply finds this row already
      // present and leaves it alone.
      await upsertQueueForAppointment(tx, { organizationId, appointment })

      // Create draft invoice. unitPrice IS the appointment's stored consultationFee
      // (effectiveFee above) — same value, so the printed card and the invoice can
      // never disagree.
      const aptType = validatedData.appointmentType || 'OPD'
      const unitPrice = effectiveFee
      const description = consultationLineDescription(aptType, appointment.doctor?.fullName, opdService?.serviceName)
      // Same atomic per-org/FY series the billing counter draws from, so an
      // appointment invoice and a counter invoice share one numbering scheme and
      // cannot collide on the @unique column when created in the same millisecond.
      const invoiceNumber = await nextSeriesNumber(tx, organizationId, 'INV', 'INV', invoiceProbe(tx, organizationId))

      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          patientId: validatedData.patientId,
          appointmentId: appointment.id, // proper FK link, not just a notes string
          invoiceNumber,
          items: JSON.stringify([{
            type: 'consultation',
            description,
            quantity: 1,
            unitPrice,
            discount: 0,
            tax: 0,
            total: unitPrice,
          }]),
          subtotal: unitPrice,
          discountAmount: 0,
          discountPercentage: 0,
          taxAmount: 0,
          totalAmount: unitPrice,
          balanceDue: unitPrice,
          status: 'draft',
          paymentStatus: 'unpaid',
          notes: `Auto-voucher | Appointment: ${appointment.id} | Type: ${aptType}`,
        },
      })

      // Auto-create commission if doctor has commission config
      let commission = null
      if (validatedData.doctorId) {
        const commissionConfig = await tx.doctorCommissionConfig.findUnique({
          where: { doctorId: validatedData.doctorId },
        })

        if (commissionConfig && commissionConfig.isActive) {
          // A percentage doctor earns a share of what was actually charged, so a
          // free follow-up (unitPrice 0) correctly earns nothing. A fixed
          // per-consultation doctor is paid for SEEING the patient, so they earn
          // their flat amount even on a free follow-up. Guarding on the computed
          // amount (not on unitPrice) gives both: fixed pays out at ₹0 fee,
          // percentage stays zero. The old `unitPrice > 0` guard silently
          // withheld the fixed doctor's fee on every free follow-up.
          const commissionAmount = commissionFor(unitPrice, commissionConfig)

          if (commissionAmount > 0) {
          commission = await tx.doctorCommission.create({
            data: {
              organizationId,
              doctorId: validatedData.doctorId,
              invoiceId: invoice.id,
              invoiceAmount: unitPrice,
              commissionRate: commissionConfig.commissionRate,
              commissionType: commissionConfig.commissionType,
              commissionAmount,
              status: 'pending',
            },
          })
          }
        }
      }

      return { appointment, draftInvoiceNumber: invoice.invoiceNumber, commission }
      }))
    } catch (err) {
      // Two bookings for the same slot in the same instant: the loser hits the
      // partial unique index. Answer it the way the pre-check would have.
      if (isSlotConflict(err)) {
        return res.status(409).json(await slotTakenBody({
          organizationId,
          doctorId: validatedData.doctorId,
          date: validatedData.appointmentDate,
          time: validatedData.appointmentTime,
        }))
      }
      throw err
    }

    const messageLines = [
      `Appointment scheduled`,
      consultationFee === 0 ? ` — Free follow-up (no charge)` : '',
      draftInvoiceNumber ? ` — Draft invoice ${draftInvoiceNumber} created` : '',
      commission ? ` — Commission ₹${commission.commissionAmount.toFixed(2)} auto-generated` : '',
    ].filter(Boolean).join('')

    res.status(201).json({
      success: true,
      data: { ...appointment, draftInvoiceNumber, appliedSlabInfo, commission },
      message: messageLines,
    })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params
    const body = req.validatedBody

    // Ensure the appointment belongs to this org before mutating it.
    // A doctor may only mutate their own appointments (matches getOne scoping).
    const scopeWhere = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) scopeWhere.doctorId = myDoctorId
    const existing = await db.appointment.findFirst({
      where: scopeWhere,
      select: {
        id: true, status: true, doctorId: true, patientId: true, priority: true,
        appointmentDate: true, appointmentTime: true, appointmentType: true, consultationFee: true,
      },
    })
    if (!existing) {
      return res.status(404).json(APPOINTMENT_GONE)
    }

    // Enforce the status state-machine: reject illegal jumps (e.g. a cancelled
    // or completed appointment being moved to any other status) with a clean 400
    // instead of silently corrupting the record and its linked money.
    if (body.status !== undefined) {
      if (statusTransitionError(existing.status, body.status)) {
        return res.status(400).json(statusChangeRefusal(existing.status, body.status))
      }
    }

    // Whitelist: only these fields can be changed — sensitive fields like
    // organizationId, patientId, invoiceId are never touched.
    const updates = {}
    // Same day-pinning as create() — an edit must not reintroduce a
    // time-of-day into the date and slip back past the slot unique index.
    if (body.appointmentDate    !== undefined) updates.appointmentDate    = startOfDay(body.appointmentDate)
    if (body.appointmentTime    !== undefined) updates.appointmentTime    = normalizeTimeHHMM(body.appointmentTime)
    if (body.appointmentType    !== undefined) updates.appointmentType    = body.appointmentType
    if (body.doctorId           !== undefined) updates.doctorId           = body.doctorId
    if (body.chiefComplaint     !== undefined) updates.chiefComplaint     = body.chiefComplaint
    if (body.notes              !== undefined) updates.notes              = body.notes
    if (body.cancellationReason !== undefined) updates.cancellationReason = body.cancellationReason
    // consultationFee is deliberately NOT settable via PATCH: it is derived from
    // the doctor's slabs at create() and is what the linked Invoice + Doctor
    // Commission were built from. Changing it here alone put the appointment,
    // its invoice and its commission in a three-way disagreement. (The field is
    // also stripped from updateAppointmentSchema, so it never reaches here.)
    if (body.reminderSent       !== undefined) updates.reminderSent       = body.reminderSent

    // Status change → auto-set the matching timestamp
    if (body.status !== undefined) {
      updates.status = body.status
      if      (body.status === 'checked_in')  updates.checkedInAt  = new Date()
      else if (body.status === 'in_progress') updates.startedAt    = new Date()
      else if (body.status === 'completed')   updates.completedAt  = new Date()
      else if (body.status === 'cancelled')   updates.cancelledAt  = new Date()
      else if (body.status === 'no_show')     updates.cancelledAt  = new Date()
    }

    if (body.reminderSent === true) updates.reminderSentAt = new Date()

    // ── Moving the visit: same four rules as booking it ──────────────────────
    // An edit that changes the slot or the doctor is a booking decision, so it
    // passes exactly what create() passes. Without this a PATCH could put the
    // visit in the past, on a doctor's leave day, or on top of another patient;
    // only the doctor's own slot was caught, by the database, as the unreadable
    // "A record with this value already exists".
    //
    // Only a REAL move is re-checked, not the mere presence of the field: the
    // edit dialog posts the whole appointment back, date and time included, so
    // treating "was sent" as "was moved" would refuse every edit to a past
    // visit — a receptionist could not add a note to yesterday's appointment.
    const nextDoctorId = updates.doctorId ?? existing.doctorId
    const nextDate     = updates.appointmentDate ?? existing.appointmentDate
    const nextTime     = updates.appointmentTime ?? existing.appointmentTime
    const asYmd = (d) => ymdInZone(new Date(d))
    const movingSlot = asYmd(nextDate) !== asYmd(existing.appointmentDate)
      || nextTime !== existing.appointmentTime
      || nextDoctorId !== existing.doctorId
    // A visit that is finished or voided is history — its timestamps may be
    // corrected, but it is not re-booked (and re-checking those rules against a
    // past date would refuse the correction).
    const live = !['completed', 'cancelled', 'no_show', 'rescheduled'].includes(existing.status)

    if (movingSlot && live) {
      // The new doctor must be one of THIS hospital's doctors: doctorId comes
      // straight from the body, and nothing checked it.
      if (body.doctorId !== undefined && body.doctorId !== existing.doctorId) {
        const doctor = await db.user.findFirst({
          where: { id: body.doctorId, organizationId, role: 'doctor' },
          select: { id: true },
        })
        if (!doctor) return res.status(404).json(DOCTOR_GONE)
      }
      const problem = await slotProblem({
        organizationId,
        doctorId: nextDoctorId,
        patientId: existing.patientId,
        date: nextDate,
        time: nextTime,
        excludeAppointmentId: id,
      })
      if (problem) return res.status(problem.status).json(problem.body)
    }

    // ── Changing WHO is seen, or WHAT the visit is: the money must follow ────
    // create() derives the fee from the doctor's slabs and builds the draft
    // invoice and the doctor's commission from it. Changing the doctor or the
    // visit type afterwards used to leave all three behind: the appointment
    // said Dr B while the invoice line still read "OPD Consultation — Dr A",
    // was charged at Dr A's rate, and Dr A kept the commission for a patient
    // they never saw.
    //
    // The rule: while the invoice is still an untouched draft, the invoice line
    // and the commission are rebuilt to match the edit, in the same transaction
    // as the edit itself. Once anyone has issued or taken money on that
    // invoice, the visit is refused a doctor/type change — cancel and rebook,
    // so the payment and the refund stay visible.
    //
    // The PRICE follows the doctor only. Fees are per doctor (their rate and
    // this patient's history with them), so a new doctor is re-priced exactly
    // as booking with them would be. A visit-type change does not move the
    // price — computeConsultationFee never looked at the type — so correcting
    // "new patient" to "follow-up" relabels the line and leaves the amount the
    // patient was quoted alone.
    const changingDoctor = body.doctorId !== undefined && body.doctorId !== existing.doctorId
    const changingType = body.appointmentType !== undefined && body.appointmentType !== existing.appointmentType
    const repriceNeeded = (changingDoctor || changingType) && live
    let repricedFee = null
    if (repriceNeeded) {
      const touched = await db.invoice.findFirst({
        where: {
          organizationId,
          appointmentId: id,
          NOT: { status: 'draft', paymentStatus: 'unpaid' },
        },
        select: { id: true, invoiceNumber: true },
      })
      if (touched) {
        return res.status(409).json(refusal(
          'Invoice already generated',
          `Invoice ${touched.invoiceNumber} has already been issued for this visit, so the ${changingDoctor ? 'doctor' : 'visit type'} can't be changed. Cancel this appointment and book a new one instead.`,
          'APPOINTMENT_BILLED',
        ))
      }
      if (changingDoctor && nextDoctorId) {
        const fee = await computeConsultationFee({
          organizationId,
          doctorId: nextDoctorId,
          patientId: existing.patientId,
          date: startOfDay(nextDate),
          excludeAppointmentId: id, // the appointment must not price against itself
        })
        if (fee.doctorMissing) return res.status(404).json(DOCTOR_GONE)
        repricedFee = fee.fee
      }
    }

    // Checking in an appointment also creates (or reuses) its linked queue
    // entry, atomically with the status update — this is what actually
    // connects the Appointment and Queue modules (QueueManagement.appointmentId,
    // added alongside this change). Before this, check-in only stamped
    // `checkedInAt` on the appointment and never touched the queue at all.
    const appointment = await db.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id },
        data: repricedFee === null ? updates : { ...updates, consultationFee: repricedFee },
        include: {
          patient: {
            select: { ...PATIENT_NAME_SELECT, phonePrimary: true, gender: true, dateOfBirth: true },
          },
          doctor: {
            select: { id: true, fullName: true, specialization: true },
          },
        },
      })

      if (body.status === 'checked_in') {
        // requireRoom: a queue row with no room shows on NO board and the
        // patient waits unseen, so the check-in is refused instead (thrown
        // inside the tx, so the status change rolls back with it; turned into a
        // clean 400 in the catch below).
        await upsertQueueForAppointment(tx, { organizationId, appointment: updated, requireRoom: true })
      }

      // The doctor or the visit type changed, so the money it generated is
      // rebuilt to match: the invoice line names the doctor and the visit, its
      // amount is the appointment's (re-derived) fee, and the commission goes
      // to whoever is now seeing the patient, at THEIR rate. Only untouched
      // drafts reach here — anything billed was refused above.
      if (repriceNeeded) {
        const drafts = await tx.invoice.findMany({
          where: { organizationId, appointmentId: id, status: 'draft', paymentStatus: 'unpaid' },
          select: { id: true },
        })
        const fee = updated.consultationFee ?? 0
        for (const draft of drafts) {
          await tx.invoice.update({
            where: { id: draft.id },
            data: {
              items: JSON.stringify([{
                type: 'consultation',
                description: consultationLineDescription(updated.appointmentType, updated.doctor?.fullName),
                quantity: 1,
                unitPrice: fee,
                discount: 0,
                tax: 0,
                total: fee,
              }]),
              subtotal: fee,
              totalAmount: fee,
              balanceDue: fee,
              notes: `Auto-voucher | Appointment: ${id} | Type: ${updated.appointmentType || 'OPD'}`,
            },
          })
        }
        const invoiceIds = drafts.map((d) => d.id)
        if (invoiceIds.length) {
          // The old doctor's pending commission is withdrawn, not edited: it was
          // for a consultation they are no longer giving.
          await tx.doctorCommission.deleteMany({ where: { invoiceId: { in: invoiceIds }, status: 'pending' } })
          if (updated.doctorId) {
            const config = await tx.doctorCommissionConfig.findUnique({ where: { doctorId: updated.doctorId } })
            if (config?.isActive) {
              // Same rule as create(), and as IPD and the Commissions tab — it
              // lives in lib/money.js so a payout cannot differ by where it was
              // worked out, and it is rounded to paisa.
              const commissionAmount = commissionFor(fee, config)
              if (commissionAmount > 0) {
                await tx.doctorCommission.create({
                  data: {
                    organizationId,
                    doctorId: updated.doctorId,
                    invoiceId: invoiceIds[0],
                    invoiceAmount: fee,
                    commissionRate: config.commissionRate,
                    commissionType: config.commissionType,
                    commissionAmount,
                    status: 'pending',
                  },
                })
              }
            }
          }
        }
      }

      // Cancelling or no-showing an appointment must also drop the patient OUT of
      // the queue. Check-in creates a 'waiting' QueueManagement row; without this
      // the row stayed 'waiting' after a cancel, so the patient the receptionist
      // just cancelled was still called by staff and still shown on the public
      // display board. updateMany (not update) so it is a harmless no-op when the
      // appointment was never checked in and has no queue row.
      if (body.status === 'cancelled' || body.status === 'no_show') {
        await tx.queueManagement.updateMany({
          where: { appointmentId: id, status: { notIn: ['completed', 'cancelled', 'no_show'] } },
          data: { status: body.status },
        })
      }

      // Cancelling the appointment must VOID the money it generated, so reports
      // don't keep showing phantom "pending" revenue and a commission for a visit
      // that never happened. create() links a draft auto-voucher invoice via the
      // real FK Invoice.appointmentId, and the doctor commission via
      // DoctorCommission.invoiceId → that invoice. We void (mark cancelled), never
      // hard-delete, so the audit trail survives. Only UNTOUCHED invoices (still
      // draft + unpaid) are voided — a real invoice someone has since sent or
      // taken payment on is left exactly as-is (a refund is a separate decision).
      // Likewise only PENDING commissions are voided; an approved/paid one is a
      // settled obligation and is not silently reversed here.
      if (body.status === 'cancelled') {
        const draftInvoices = await tx.invoice.findMany({
          where: { organizationId, appointmentId: id, status: 'draft', paymentStatus: 'unpaid' },
          select: { id: true },
        })
        if (draftInvoices.length) {
          const invoiceIds = draftInvoices.map((inv) => inv.id)
          await tx.invoice.updateMany({
            where: { id: { in: invoiceIds }, organizationId },
            data: {
              status: 'cancelled',
              paymentStatus: 'cancelled',
              cancelledAt: new Date(),
              cancellationReason: body.cancellationReason || 'Appointment cancelled',
            },
          })
          await tx.doctorCommission.updateMany({
            where: { invoiceId: { in: invoiceIds }, status: 'pending' },
            data: { status: 'cancelled' },
          })
        }
      }

      return updated
    }).catch(async (err) => {
      // Someone took the slot between the check above and this write. Same
      // answer as booking gives, instead of the database's "a record already
      // exists" — and it needs the doctor and the day, which live here.
      if (isSlotConflict(err)) {
        throw Object.assign(new Error('slot taken'), {
          code: 'SLOT_TAKEN',
          body: await slotTakenBody({ organizationId, doctorId: nextDoctorId, date: nextDate, time: nextTime }),
        })
      }
      throw err
    })

    res.json({ success: true, data: appointment })
  } catch (err) {
    // Check-in was refused because the doctor has no room to seat the patient in
    // (see the NO_ROOM guard above). Surface it as a clean, actionable 400.
    if (err.code === 'NO_ROOM') {
      return res.status(400).json(refusal('Room not assigned', err.message, 'NO_ROOM'))
    }
    if (err.code === 'SLOT_TAKEN' && err.body) {
      return res.status(409).json(err.body)
    }
    next(err)
  }
}

// Reschedule = create the new appointment AND mark the old one rescheduled,
// atomically, with the two rows linked via rescheduledFromId/rescheduledToId.
// (Previously the frontend did this as two separate calls with no transaction.)
export async function reschedule(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params
    const { appointmentDate } = req.body
    // This route has no `validate()` middleware, so validate req.body here — it
    // is how unpadded times like "9:00" and impossible ones like "25:00" got in,
    // which then sort wrong on the board.
    const appointmentTime = normalizeTimeHHMM(req.body.appointmentTime)

    if (!appointmentDate || !appointmentTime) {
      return res.status(400).json(refusal('Choose a date and time', 'Please choose both a new date and a new time.'))
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(appointmentTime)) {
      return res.status(400).json(refusal('Invalid time', 'Please choose a valid time from the list.'))
    }
    if (Number.isNaN(new Date(appointmentDate).getTime())) {
      return res.status(400).json(refusal('Invalid date', 'Please choose a valid date.'))
    }

    const scopeWhere = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) scopeWhere.doctorId = myDoctorId
    const original = await db.appointment.findFirst({ where: scopeWhere })
    if (!original) {
      return res.status(404).json(APPOINTMENT_GONE)
    }

    // R5 — a finished or voided visit is not a thing you move. Only a live
    // upcoming appointment can be rescheduled; a cancelled/no-show/completed/
    // already-rescheduled one must not spawn a fresh live appointment.
    if (['cancelled', 'no_show', 'completed', 'rescheduled'].includes(original.status)) {
      return res.status(400).json(refusal(
        "Can't reschedule",
        `This appointment is already ${statusWords(original.status)}, so it can't be rescheduled. Please book a new appointment instead.`,
      ))
    }

    // R6 — the new slot passes the same four rules as a fresh booking: not in
    // the past (the DATE *and* the TIME — comparing days alone let a 14:00
    // reschedule land on 10:00 this morning), the doctor is not on leave that
    // day, the doctor's slot is free, and the patient is not already with
    // another doctor at that moment. Only the doctor's own slot was guarded
    // before, and only by the database's unique index.
    const problem = await slotProblem({
      organizationId,
      doctorId: original.doctorId,
      patientId: original.patientId,
      date: appointmentDate,
      time: appointmentTime,
      excludeAppointmentId: original.id, // the row being moved does not block itself
    })
    if (problem) return res.status(problem.status).json(problem.body)

    let created
    try {
      created = await db.$transaction(async (tx) => {
      // The old row is stood down FIRST. The slot's unique index counts every
      // status except cancelled/no_show/rescheduled, so while the original was
      // still 'scheduled' it held its own slot against its replacement: moving
      // an appointment to the same time (a correction that changes nothing, or
      // a same-slot move after an edit) was refused as "that doctor already has
      // an appointment at that time" — their own.
      await tx.appointment.update({
        where: { id: original.id, organizationId },
        data: { status: 'rescheduled' },
      })

      const newAppointment = await tx.appointment.create({
        data: {
          organizationId,
          patientId: original.patientId,
          doctorId: original.doctorId,
          appointmentDate: startOfDay(appointmentDate), // day only — see create()
          appointmentTime,
          appointmentType: original.appointmentType || 'new_patient',
          departmentId: original.departmentId,
          priority: original.priority,
          consultationFee: original.consultationFee,
          chiefComplaint: original.chiefComplaint,
          notes: original.notes,
          status: 'scheduled',
          rescheduledFromId: original.id,
        },
        include: {
          patient: { select: { ...PATIENT_NAME_SELECT, phonePrimary: true } },
          doctor: { select: { id: true, fullName: true } },
        },
      })
      await tx.appointment.update({
        where: { id: original.id, organizationId },
        data: { rescheduledToId: newAppointment.id },
      })

      // The moved visit joins the queue at its new slot, exactly as a freshly
      // booked one does. Without this the new appointment had no queue row at
      // all until someone happened to open the Queue page (the sync backfills
      // it), so the patient reception had just moved was missing from the board.
      await upsertQueueForAppointment(tx, { organizationId, appointment: newAppointment })

      // R1 — the old appointment is now 'rescheduled', so it must not keep the
      // patient in the queue. If they were checked in, close that queue row;
      // otherwise the patient stayed 'waiting' on the OLD slot's board and, on
      // checking into the new slot, showed up twice. updateMany = no-op when
      // there's no queue row.
      await tx.queueManagement.updateMany({
        where: { appointmentId: original.id, status: { notIn: ['completed', 'cancelled', 'no_show'] } },
        data: { status: 'rescheduled' },
      })

      // R2 — carry the draft invoice to the NEW appointment so the visit the
      // patient actually attends is the one that's billed. create() attaches a
      // draft invoice to every appointment; without this the invoice stayed on
      // the superseded 'rescheduled' row and the real visit looked unbilled.
      // Only an untouched draft is moved — a real invoice someone has since
      // acted on is left exactly where it is.
      await tx.invoice.updateMany({
        where: { appointmentId: original.id, status: 'draft', paymentStatus: 'unpaid' },
        data: { appointmentId: newAppointment.id },
      })

      return newAppointment
    })
    } catch (err) {
      // R4 — a reschedule onto a slot the doctor already has hits the partial
      // unique index and throws P2002. Translate it to the same clean SLOT_TAKEN
      // the create() path returns, instead of leaking a raw Prisma error.
      if (isSlotConflict(err)) {
        return res.status(409).json(await slotTakenBody({
          organizationId,
          doctorId: original.doctorId,
          date: appointmentDate,
          time: appointmentTime,
        }))
      }
      throw err
    }

    res.status(201).json({ success: true, data: created, message: 'Appointment rescheduled' })
  } catch (err) {
    next(err)
  }
}

// Update many appointments' status in ONE request (was N separate PATCH calls
// from the browser). Uses updateMany so it's a single DB statement.
export async function bulkUpdateStatus(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { ids, status } = req.validatedBody

    const data = { status }
    if (status === 'checked_in') data.checkedInAt = new Date()
    else if (status === 'in_progress') data.startedAt = new Date()
    else if (status === 'completed') data.completedAt = new Date()
    else if (status === 'cancelled' || status === 'no_show') data.cancelledAt = new Date()

    const where = { id: { in: ids }, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    // Enforce the SAME state-machine as the single update. Without this, bulk was
    // a back door to move a cancelled/completed appointment anywhere. Fetch the
    // in-scope rows' current statuses and reject the whole batch if ANY transition
    // is illegal, so a bulk action is all-or-nothing rather than partially applied.
    const targets = await db.appointment.findMany({ where, select: { id: true, status: true } })
    const offenders = targets.filter((a) => statusTransitionError(a.status, status))
    if (offenders.length) {
      // Name the states that are in the way ("2 are already completed, 1 is
      // cancelled"), so the receptionist knows which rows to untick.
      const byStatus = offenders.reduce((m, a) => m.set(a.status, (m.get(a.status) || 0) + 1), new Map())
      const which = [...byStatus].map(([s, n]) => `${n} ${n === 1 ? 'is' : 'are'} already ${statusWords(s)}`).join(', ')
      return res.status(400).json({
        ...refusal(
          'Nothing was updated',
          `${offenders.length} of the selected appointments can't be changed to ${statusWords(status)} (${which}). Untick ${offenders.length === 1 ? 'it' : 'them'} and try again.`,
          'INVALID_STATUS_TRANSITION',
        ),
        offenders: offenders.map((a) => ({ id: a.id, from: a.status })),
      })
    }

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.appointment.updateMany({ where, data })

      // Checking in here does what checking in one appointment does: each
      // patient joins the queue, in the room their doctor is sitting in. Before
      // this, bulk only stamped `checkedInAt`, so a receptionist selecting ten
      // arrivals and pressing Check in put NONE of them on the board — while
      // doing them one at a time worked. requireRoom keeps the two answers the
      // same too: the whole batch is refused (the transaction rolls back) if a
      // doctor has no room, rather than seating that patient nowhere.
      if (status === 'checked_in') {
        const rows = await tx.appointment.findMany({
          where: { id: { in: targets.map((t) => t.id) } },
          select: { id: true, patientId: true, doctorId: true, appointmentDate: true, appointmentTime: true, priority: true },
        })
        for (const appointment of rows) {
          await upsertQueueForAppointment(tx, { organizationId, appointment, requireRoom: true })
        }
      }

      // Mirror the single-cancel money void (see update()): a bulk cancel must
      // also void the linked draft invoices + pending commissions and drop the
      // patients from the queue, or bulk becomes a way to leak phantom money and
      // leave cancelled patients on the board.
      if (status === 'cancelled' || status === 'no_show') {
        await tx.queueManagement.updateMany({
          where: { appointmentId: { in: ids }, status: { notIn: ['completed', 'cancelled', 'no_show'] } },
          data: { status },
        })
      }
      if (status === 'cancelled') {
        const draftInvoices = await tx.invoice.findMany({
          where: { organizationId, appointmentId: { in: ids }, status: 'draft', paymentStatus: 'unpaid' },
          select: { id: true },
        })
        if (draftInvoices.length) {
          const invoiceIds = draftInvoices.map((inv) => inv.id)
          await tx.invoice.updateMany({
            where: { id: { in: invoiceIds }, organizationId },
            data: { status: 'cancelled', paymentStatus: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Appointment cancelled' },
          })
          await tx.doctorCommission.updateMany({
            where: { invoiceId: { in: invoiceIds }, status: 'pending' },
            data: { status: 'cancelled' },
          })
        }
      }

      return updated
    })
    res.json({ success: true, count: result.count })
  } catch (err) {
    // Same answer as a single check-in when a doctor has no room to seat the
    // patient in — and it says plainly that the batch wrote nothing.
    if (err.code === 'NO_ROOM') {
      return res.status(400).json(refusal(
        'No patients checked in',
        `${err.message} None of the selected patients were checked in.`,
        'NO_ROOM',
      ))
    }
    next(err)
  }
}

export async function remove(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params

    // Scope the delete to this org (and to the doctor's own, if a doctor) —
    // deleteMany lets us filter on non-unique fields.
    const deleteWhere = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) deleteWhere.doctorId = myDoctorId

    const count = await db.$transaction(async (tx) => {
      const appointment = await tx.appointment.findFirst({ where: deleteWhere, select: { id: true } })
      if (!appointment) return 0

      // create() links its auto-voucher invoice to the appointment with a real
      // FK (Invoice.appointmentId) — match on that. The old note-text match is
      // kept as a fallback for vouchers written before the column existed,
      // whose only link is the appointment id inside `notes`. Either way only
      // an untouched invoice (draft + unpaid) is removed, so one a staff member
      // has since acted on is never silently deleted.
      const draftInvoice = await tx.invoice.findFirst({
        where: {
          organizationId,
          status: 'draft',
          paymentStatus: 'unpaid',
          OR: [
            { appointmentId: appointment.id },
            { notes: { contains: appointment.id } },
          ],
        },
        select: { id: true },
      })
      if (draftInvoice) {
        await tx.doctorCommission.deleteMany({ where: { invoiceId: draftInvoice.id } })
        await tx.invoice.delete({ where: { id: draftInvoice.id } })
      }

      const { count } = await tx.appointment.deleteMany({ where: deleteWhere })
      return count
    })

    if (count === 0) {
      return res.status(404).json(APPOINTMENT_GONE)
    }

    res.json({ success: true, message: 'Appointment deleted' })
  } catch (err) {
    next(err)
  }
}
