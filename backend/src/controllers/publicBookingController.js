import { db } from '../config/db.js'
import { getDepartments, getUsers } from './settingsController.js'
import { handleGet as doctorAccountabilityGet } from './doctorAccountabilityController.js'
import { create as createPatient } from './patientController.js'
import { create as createAppointment } from './appointmentController.js'
import { createAppointmentSchema } from '../validations/appointment.validation.js'

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

    // 1. Register — the same handler reception's form calls. `appointment` is
    //    dropped from the patient body: that nested shortcut books without any of
    //    the booking rules, which is exactly what this endpoint must not allow.
    const { appointment: _nested, ...patientBody } = patient
    const registered = await capture(createPatient, { organizationId: org.id, body: patientBody })

    let patientRow
    let alreadyRegistered = false
    if (registered.status === 201) {
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
      // The patient exists either way (as at the counter, where a failed booking
      // no longer undoes the registration). Say so, so the page can tell them.
      return res.status(booked.status).json({ ...booked.body, patient: { id: patientRow.id, mrn: patientRow.mrn } })
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
