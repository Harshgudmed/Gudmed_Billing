import { db } from '../config/db.js'
import { getDepartments, getUsers } from './settingsController.js'
import { handleGet as doctorAccountabilityGet } from './doctorAccountabilityController.js'
import { create as createPatient, getAll as searchPatients } from './patientController.js'
import { create as createAppointment, checkSlot } from './appointmentController.js'
import { createAppointmentSchema } from '../validations/appointment.validation.js'
import { formatTime12h, formatDayMonth } from '../lib/dates.js'

// The patient's own phone booking an appointment from the hospital's QR code.
//
// ONE set of rules for everyone. A patient who books at the counter and one who
// books on their phone must be registered and booked by exactly the same code —
// the same duplicate-patient guard, UHID counter, past-date check, slot check,
// double-booking check, leave check, fee, queue entry, draft invoice and doctor
// commission. So nothing here re-implements any of that. Every handler below is
// the existing, logged-in handler, called unchanged; this file only answers the
// one question a public request cannot answer for itself: WHICH hospital.
//
// The hospital comes from the QR link (/self-register?org=<id>), is checked to
// exist, and is set exactly where a login would have set it (req.organizationId).
// Nothing from a session is present, so the handlers run with no user — the same
// as an admin/reception call with no doctor scoping — and each request is
// narrowed to the one read it needs (see `only`).

/** The hospital named in the URL, or a 404. */
async function hospitalFrom(req, res) {
  const org = await db.organization.findUnique({
    where: { id: String(req.params.orgId || '') },
    select: { id: true, isActive: true },
  })
  if (!org || org.isActive === false) {
    res.status(404).json({ success: false, error: 'Hospital not found' })
    return null
  }
  return org
}

/**
 * The same request object, acting for this hospital, with no session and with
 * only the query this public endpoint allows — so a caller cannot widen a read
 * (e.g. ask the user list for admins, or the accountability API for commissions).
 */
function only(req, org, query) {
  req.organizationId = org.id
  req.user = undefined
  // Express 4 keeps req.query as a plain property, so it can be replaced.
  req.query = query
  return req
}

/**
 * Runs an existing Express handler and hands back what it answered, instead of
 * letting it write to the real response — so two handlers can run in sequence
 * (register, then book). A thrown error still goes to the app's error handler.
 */
function capture(handler, reqLike) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(body) { resolve({ status: this.statusCode, body }); return this },
    }
    Promise.resolve(handler(reqLike, res, (err) => (err ? reject(err) : resolve({ status: 500, body: null })))).catch(reject)
  })
}

// ── Reads the booking form needs ────────────────────────────────────────────

/** GET /api/public/org/:orgId/departments */
export async function publicDepartments(req, res, next) {
  try {
    const org = await hospitalFrom(req, res)
    if (!org) return
    return getDepartments(only(req, org, {}), res, next)
  } catch (err) { next(err) }
}

/** GET /api/public/org/:orgId/doctors — the lean doctor list reception books from. */
export async function publicDoctors(req, res, next) {
  try {
    const org = await hospitalFrom(req, res)
    if (!org) return
    return getUsers(only(req, org, { role: 'doctor', lean: '1' }), res, next)
  } catch (err) { next(err) }
}

/** GET /api/public/org/:orgId/doctor-timetable?doctorId= — the slots the date picker offers. */
export async function publicDoctorTimetable(req, res, next) {
  try {
    const org = await hospitalFrom(req, res)
    if (!org) return
    const doctorId = String(req.query.doctorId || '')
    return doctorAccountabilityGet(only(req, org, { resource: 'timetable', doctorId }), res, next)
  } catch (err) { next(err) }
}

/**
 * GET /api/public/org/:orgId/check-slot?doctorId&date&time — whether the time a
 * patient just picked is still bookable, so the page can say why in red under
 * the Time field before they press Book. The counter's own check, narrowed to
 * doctor + date + time: no patient id and no appointment id are passed on, so
 * the answer can only ever be about the doctor's diary ("Dr. Sharma is already
 * booked at 10:00 AM"), never about another patient.
 */
export async function publicCheckSlot(req, res, next) {
  try {
    const org = await hospitalFrom(req, res)
    if (!org) return
    const { doctorId = '', date = '', time = '' } = req.query
    return checkSlot(only(req, org, { doctorId: String(doctorId), date: String(date), time: String(time) }), res, next)
  } catch (err) { next(err) }
}

// ── An already-registered patient finding their record ──────────────────────

/** "Ramesh" → "R*****" — enough for a person to recognise their own name, not to read someone else's. */
const mask = (s) => (s ? String(s)[0] + '*'.repeat(Math.max(1, String(s).length - 1)) : '')

/** "1000000123" → "******0123" — enough to tell family members apart, not to copy. */
const maskUhid = (s) => (s ? '*'.repeat(Math.max(0, String(s).length - 4)) + String(s).slice(-4) : '')

/**
 * This hospital's active patients registered on exactly this 10-digit mobile.
 *
 * The search itself is the patients list's own (patientController.getAll →
 * patientSearchWhere). What this adds is what an anonymous page needs: the
 * counter's search matches any part of a name or number, so a page anyone can
 * open answers only a complete mobile number, exactly — never a name, never a
 * few digits.
 */
async function findRegistered(organizationId, mobile) {
  const m = String(mobile || '').trim()
  if (!/^[6-9]\d{9}$/.test(m)) return []
  const found = await capture(searchPatients, { organizationId, query: { search: m, limit: '20', status: 'active' } })
  const rows = found.status === 200 && Array.isArray(found.body?.data) ? found.body.data : []
  return rows.filter((p) => p.phonePrimary === m)
}

/**
 * GET /api/public/org/:orgId/patients?search=<10-digit mobile>
 * For PatientLookup on the QR page: everyone registered on that mobile (a
 * family often shares one), with names and UHIDs masked. No address, email,
 * date of birth or history.
 */
export async function publicFindPatient(req, res, next) {
  try {
    const org = await hospitalFrom(req, res)
    if (!org) return
    const rows = await findRegistered(org.id, req.query.search)
    return res.json({
      success: true,
      data: rows.map((p) => ({
        id: p.id,
        mrn: maskUhid(p.mrn),
        firstName: mask(p.firstName),
        middleName: '',
        lastName: mask(p.lastName),
        gender: p.gender,
        // Only the number the caller typed, echoed back so the booking can
        // name it again.
        phonePrimary: p.phonePrimary,
      })),
    })
  } catch (err) { next(err) }
}

// ── Register + book ─────────────────────────────────────────────────────────

// How far ahead a phone may book. Reception can book any future date; an
// anonymous public form holding slots months out is how a calendar gets filled
// with people who never come.
const MAX_DAYS_AHEAD = 30

/**
 * POST /api/public/org/:orgId/book
 * Body: { patient: {…registration fields…}, appointment: { doctorId, departmentId?,
 *         appointmentDate, appointmentTime, appointmentType?, priority?, notes? } }
 *
 * Exactly what reception's form does, in the same order: create the patient,
 * then book the appointment for them.
 */
export async function publicRegisterAndBook(req, res, next) {
  try {
    const org = await hospitalFrom(req, res)
    if (!org) return
    const { patient = {}, appointment = {} } = req.body || {}

    const day = new Date(appointment.appointmentDate)
    const latest = new Date(Date.now() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000)
    if (!Number.isNaN(day.getTime()) && day > latest) {
      return res.status(400).json({ success: false, error: `Online booking is open for the next ${MAX_DAYS_AHEAD} days. Please choose an earlier date.` })
    }

    let patientRow
    let alreadyRegistered = false

    // Already registered (chosen on the page from the people on a mobile number):
    // the choice is checked again HERE — the patient must be one of those
    // registered on that mobile, never just any id the browser sends.
    const { existing } = req.body || {}
    if (existing) {
      const match = (await findRegistered(org.id, existing.mobile)).find((p) => p.id === existing.patientId)
      if (!match) {
        return res.status(404).json({ success: false, error: 'No record matches this mobile number. Please register as a new patient.' })
      }
      patientRow = match
      alreadyRegistered = true
    }

    // 1. Register — the same handler reception's form calls. `appointment` is
    //    dropped from the patient body: that nested shortcut books without any of
    //    the booking rules, which is exactly what this endpoint must not allow.
    const { appointment: _nested, ...patientBody } = patient
    const registered = patientRow ? null : await capture(createPatient, { organizationId: org.id, body: patientBody })

    if (patientRow) {
      // found above
    } else if (registered.status === 201) {
      patientRow = registered.body.data
    } else if (registered.status === 409 && registered.body?.code === 'PATIENT_EXISTS') {
      // Same phone + same date of birth is, by the guard's own definition, this
      // person. At the counter reception reuses that record; a patient on their
      // phone cannot be asked to choose, so they are booked on it — never given
      // a second UHID.
      patientRow = registered.body.data
      alreadyRegistered = true
    } else {
      return res.status(registered.status).json(registered.body)
    }

    // 2. Book — the same schema and handler the counter's booking goes through.
    const parsed = createAppointmentSchema.safeParse({
      ...appointment,
      patientId: patientRow.id,
      notes: ['Self-booked via QR', appointment.notes].filter(Boolean).join(' — '),
    })
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: parsed.error.issues,
        patient: { id: patientRow.id, mrn: patientRow.mrn },
      })
    }
    const booked = await capture(createAppointment, { organizationId: org.id, validatedBody: parsed.data, body: parsed.data })

    if (booked.status !== 201) {
      // The counter's refusal for a patient who is already booked at that time
      // names them and their other doctor ("Rahul Verma already has an
      // appointment with Dr. Mehta …") — right for reception, wrong for an
      // anonymous phone: anyone holding a mobile number would learn the full
      // name (which this page otherwise masks) and who they are seeing. The
      // patient is told only what they need: they are already booked then.
      const body = booked.body?.code === 'PATIENT_DOUBLE_BOOKED'
        ? {
          ...booked.body,
          error: `You already have an appointment at ${formatTime12h(parsed.data.appointmentTime) || parsed.data.appointmentTime} on ${formatDayMonth(parsed.data.appointmentDate)}. Please choose another time.`,
        }
        : booked.body
      // The patient exists either way (as at the counter, where a failed booking
      // no longer undoes the registration). Say so, so the page can tell them.
      return res.status(booked.status).json({ ...body, patient: { id: patientRow.id, mrn: patientRow.mrn } })
    }

    // Only what the patient's appointment card shows. The counter's response also
    // carries the doctor's commission, the draft invoice number and the fee slab
    // applied — hospital internals that must not reach an anonymous phone.
    const a = booked.body.data
    return res.status(201).json({
      success: true,
      data: {
        patient: { id: patientRow.id, mrn: patientRow.mrn, firstName: patientRow.firstName, lastName: patientRow.lastName },
        appointment: {
          id: a.id,
          appointmentDate: a.appointmentDate,
          appointmentTime: a.appointmentTime,
          appointmentType: a.appointmentType,
          status: a.status,
          consultationFee: a.consultationFee,
          patient: a.patient
            ? { firstName: a.patient.firstName, middleName: a.patient.middleName, lastName: a.patient.lastName, mrn: a.patient.mrn }
            : null,
          doctor: a.doctor ? { fullName: a.doctor.fullName } : null,
        },
        alreadyRegistered,
      },
    })
  } catch (err) { next(err) }
}
