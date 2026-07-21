import { db } from '../config/db.js'
import { patientFullName, PATIENT_NAME_SELECT } from '../lib/patientName.js'
import { optionalMobileSchema, normalizeIndianMobile } from '../lib/phone.js'
import { dayRange } from '../lib/dates.js'
import { getOrgId } from "../lib/reqContext.js";
import { z } from 'zod'

// Doctors only see their own patients — those they have an appointment or consultation
// with. Returns a Prisma `where` fragment for the doctor, or null for every other role.
//
// Data scoping is INDEPENDENT of AUTH_ENFORCED (the login flag): a logged-in doctor is
// always scoped to their own patients, even in demo mode. See utils/scope.js.
function doctorPatientFilter(req) {
  if (req.user?.role !== 'doctor') return null
  const doctorId = req.user.userId
  return {
    OR: [
      { appointments:  { some: { doctorId } } },
      { consultations: { some: { doctorId } } },
    ],
  }
}

// True when this doctor is linked to the given patient. Used to gate single-patient reads.
async function doctorOwnsPatient(doctorId, patientId) {
  const match = await db.patient.findFirst({
    where: {
      id: patientId,
      OR: [
        { appointments:  { some: { doctorId } } },
        { consultations: { some: { doctorId } } },
      ],
    },
    select: { id: true },
  })
  return Boolean(match)
}

// A UHID is a plain 10-digit number. Nothing else: no prefix, no date, no
// dashes — one format the front desk can read out over a phone and a patient
// can copy off a card.
//
// The old generator was `UHID` + today's date + 4 random digits, which was
// neither 10 digits nor reliably unique: 10,000 random values collide constantly
// once a day carries hundreds of registrations (the same birthday-paradox bug
// that `utils/queueNumber.js` was already rewritten to fix). It also left the
// database carrying four different shapes at once — MRN-26-1049513,
// MRN100469, UHID202607178657 and DEMOFLOW-UHID202607177658.
//
// Numbers come from the same atomic BillCounter the invoice numbers use, so two
// simultaneous registrations can never be handed the same one. Starting the
// series at 1,000,000,000 keeps every UHID exactly 10 digits (and leaves room
// for ~9 billion patients before it would grow an eleventh).
const UHID_BASE = 1_000_000_000

async function generateUHID(tx, organizationId) {
  const counter = await tx.billCounter.upsert({
    where: { organizationId_series_year: { organizationId, series: 'UHID', year: 'P' } },
    create: { organizationId, series: 'UHID', year: 'P', value: 1 },
    update: { value: { increment: 1 } },
  })
  return String(UHID_BASE + counter.value)
}

const patientSchema = z.object({
  firstName: z.string().min(2),
  middleName: z.string().optional(),
  lastName: z.string().min(2),
  dateOfBirth: z.string(),
  gender: z.enum(['male', 'female', 'other']),
  // Normalised + validated on the way in — see lib/phone.js. Previously
  // `z.string()`, which accepted anything and let country codes ("919876543210")
  // and junk ("788775657656") become permanent rows.
  phonePrimary: optionalMobileSchema(z, 'Primary phone'),
  phoneSecondary: optionalMobileSchema(z, 'Secondary phone'),
  email: z.string().email().optional().or(z.literal('')),
  // Address. These are listed here because zod strips anything it does not name:
  // dropping them from this object (commit b055d1f) silently deleted the address
  // in transit — the form collected it, the table had columns for it, the API
  // answered 201, and the row was written without it. No error, nobody told.
  houseNumber: z.string().optional(),
  street: z.string().optional(),
  locality: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits').optional().or(z.literal('')),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: optionalMobileSchema(z, 'Emergency contact phone'),
  emergencyContactRelationship: z.string().optional(),
  bloodGroup: z.string().optional(),
  allergies: z.array(z.string()).optional(),
  chronicConditions: z.array(z.string()).optional(),
  currentMedications: z.array(z.string()).optional(),
  hasInsurance: z.boolean().default(false),
  insuranceProvider: z.string().optional(),
  insuranceId: z.string().optional(),
  insuranceExpiryDate: z.string().optional(),
  maritalStatus: z.string().optional(),
  referredBy: z.string().optional(),
  mlcNumber: z.string().optional(),
  occupation: z.string().optional(),
  isVip: z.boolean().default(false),
  notes: z.string().optional(),
})

// Whitelist of fields a client may change via update. System/identity fields
// (organizationId, mrn, isActive, id, timestamps) are NEVER here, so a
// request body can't overwrite them (mass-assignment protection).
const PATIENT_EDITABLE_FIELDS = [
  'firstName', 'middleName', 'lastName', 'dateOfBirth', 'gender',
  'phonePrimary', 'phoneSecondary', 'email',
  'houseNumber', 'street', 'locality', 'city', 'district', 'state', 'pincode',
  'emergencyContactName',
  'emergencyContactPhone', 'emergencyContactRelationship', 'bloodGroup',
  'allergies', 'chronicConditions', 'currentMedications', 'hasInsurance',
  'insuranceProvider', 'insuranceId', 'insuranceExpiryDate', 'maritalStatus',
  'referredBy', 'mlcNumber', 'occupation', 'isVip', 'notes',
]

export async function getAll(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const search = req.query.search || ''
    // Default to active only so soft-deleted (deactivated) patients drop out of
    // the main list. Pass ?status=inactive or ?status=all to see deactivated ones.
    const status = req.query.status || 'active'
    const limit = Math.min(Number(req.query.limit) || 50, 1000) // NaN-safe + hard cap
    const offset = Math.max(Number(req.query.offset) || 0, 0)   // NaN/negative → 0

    const where = { organizationId }
    if (status === 'active') where.isActive = true
    else if (status === 'inactive') where.isActive = false

    // Registration-date range filter (Today / This Week / This Month / custom).
    const { startDate, endDate } = req.query
    // Day boundaries in the hospital's timezone (see lib/dates.js) — the old parse
    // used the SERVER's timezone, so prod (UTC) and dev (IST) disagreed by 5h30m.
    if (startDate || endDate) {
      where.createdAt = dayRange(startDate, endDate)
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { mrn: { contains: search, mode: 'insensitive' } },
        { phonePrimary: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Doctors are limited to their own patients. Combine with any search filter via AND
    // so we don't clobber the search OR above.
    const docFilter = doctorPatientFilter(req)
    if (docFilter) {
      where.AND = [...(where.AND || []), docFilter]
    }

    const [patients, total] = await Promise.all([
      db.patient.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              labOrders: { where: { results: { some: {} } } },
              radiologyOrders: { where: { report: { isNot: null } } },
              admissions: { where: { status: 'admitted' } },
              patientDocuments: true,
            },
          },
        },
      }),
      db.patient.count({ where }),
    ])

    const data = patients.map((p) => {
      const { _count, ...patientData } = p;
      return {
        ...patientData,
        labReportCount: _count?.labOrders || 0,
        radiologyReportCount: _count?.radiologyOrders || 0,
        admittedCount: _count?.admissions || 0,
        documentCount: _count?.patientDocuments || 0,
      }
    })

    res.json({ success: true, data, meta: { total, limit, offset, hasMore: offset + limit < total } })
  } catch (err) {
    next(err)
  }
}

export async function getOne(req, res, next) {
  try {
    const organizationId = getOrgId(req)

    const patient = await db.patient.findFirst({ where: { id: req.params.id, organizationId } })
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }

    // A doctor may only view their own patients — treat others as not found so we
    // don't reveal that the record exists.
    if (doctorPatientFilter(req) && !(await doctorOwnsPatient(req.user.userId, patient.id))) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }

    res.json({ success: true, data: patient })
  } catch (err) {
    next(err)
  }
}

export async function getRecords(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params
    const patient = await db.patient.findFirst({ where: { id, organizationId } })
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }

    if (doctorPatientFilter(req) && !(await doctorOwnsPatient(req.user.userId, id))) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }

    const [labOrders, radiologyOrders, admissions, appointments, invoices, patientDocuments] = await Promise.all([
      db.labOrder.findMany({
        where: { patientId: id },
        include: { results: { include: { test: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      db.radiologyOrder.findMany({
        where: { patientId: id },
        include: { exam: true, report: true },
        orderBy: { createdAt: 'desc' },
      }),
      db.admission.findMany({
        where: { patientId: id },
        include: { bed: { include: { ward: true } } },
        orderBy: { admissionDate: 'desc' },
      }),
      db.appointment.findMany({
        where: { patientId: id },
        include: {
          doctor: { select: { id: true, fullName: true, specialization: true } },
        },
        orderBy: { appointmentDate: 'desc' },
      }),
      db.invoice.findMany({
        where: { patientId: id },
        orderBy: { invoiceDate: 'desc' },
      }),
      db.patientDocument.findMany({
        where: { patientId: id },
        orderBy: { uploadedAt: 'desc' },
      }),
    ])

    // Billing summary using Database Aggregation
    const billingStats = await db.invoice.aggregate({
      where: {
        patientId: id,
        status: { not: 'cancelled' },
        paymentStatus: { not: 'cancelled' },
      },
      _sum: { totalAmount: true, amountPaid: true, balanceDue: true },
      _count: { _all: true },
    })

    const totalBilled = billingStats._sum.totalAmount || 0;
    const totalPaid = billingStats._sum.amountPaid || 0;
    const balanceDue = billingStats._sum.balanceDue != null 
      ? billingStats._sum.balanceDue 
      : (totalBilled - totalPaid);

    res.json({
      success: true,
      data: {
        labOrders, radiologyOrders, admissions, appointments, invoices, patientDocuments,
        billing: { totalBilled, totalPaid, balanceDue, invoiceCount: billingStats._count._all },
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const validatedData = patientSchema.parse(req.body)

    // A UHID identifies a PERSON, not a visit. Somebody coming back — a
    // follow-up, a new complaint, a relative booking for them — must keep the
    // number they were given the first time, or their history splits in two and
    // the "is this a follow-up?" fee logic stops recognising them.
    //
    // Nothing checked for this, so re-registering someone silently minted a
    // second UHID: "Ramesh Suresh Chandrakant", same phone and same date of
    // birth, ended up as two patients registered three hours apart.
    //
    // Same phone + same date of birth is the match: names are typed
    // inconsistently ("Ramesh" / "ramesh kumar"), but those two together are
    // deliberate data that a returning patient repeats.
    if (validatedData.phonePrimary && validatedData.dateOfBirth) {
      const existing = await db.patient.findFirst({
        where: {
          organizationId,
          phonePrimary: validatedData.phonePrimary,
          dateOfBirth: new Date(validatedData.dateOfBirth),
        },
        select: PATIENT_NAME_SELECT,
      })
      if (existing) {
        // 409, not a silent merge: reception must SEE that this person already
        // exists and decide, rather than have two records quietly become one.
        // The existing record is returned so the UI can offer "use this patient".
        return res.status(409).json({
          success: false,
          code: 'PATIENT_EXISTS',
          error: `${patientFullName(existing)} is already registered with UHID ${existing.mrn} (same phone and date of birth). Use the existing record instead of creating a new one.`,
          data: existing,
        })
      }
    }

    const patientData = {
      organizationId,
      firstName: validatedData.firstName,
      middleName: validatedData.middleName,
      lastName: validatedData.lastName,
      dateOfBirth: new Date(validatedData.dateOfBirth),
      gender: validatedData.gender,
      phonePrimary: validatedData.phonePrimary,
      phoneSecondary: validatedData.phoneSecondary,
      email: validatedData.email || null,
      houseNumber: validatedData.houseNumber,
      street: validatedData.street,
      locality: validatedData.locality,
      city: validatedData.city,
      district: validatedData.district,
      state: validatedData.state,
      pincode: validatedData.pincode || null,
      emergencyContactName: validatedData.emergencyContactName,
      emergencyContactPhone: validatedData.emergencyContactPhone,
      emergencyContactRelationship: validatedData.emergencyContactRelationship,
      bloodGroup: validatedData.bloodGroup,
      allergies: validatedData.allergies ? JSON.stringify(validatedData.allergies) : null,
      chronicConditions: validatedData.chronicConditions ? JSON.stringify(validatedData.chronicConditions) : null,
      currentMedications: validatedData.currentMedications ? JSON.stringify(validatedData.currentMedications) : null,
      hasInsurance: validatedData.hasInsurance,
      insuranceProvider: validatedData.insuranceProvider,
      insuranceId: validatedData.insuranceId,
      insuranceExpiryDate: validatedData.insuranceExpiryDate ? new Date(validatedData.insuranceExpiryDate) : null,
      maritalStatus: validatedData.maritalStatus,
      referredBy: validatedData.referredBy,
      mlcNumber: validatedData.mlcNumber,
      occupation: validatedData.occupation,
      isVip: validatedData.isVip,
      notes: validatedData.notes,
    };

    if (req.body.appointment && req.body.appointment.doctorId && req.body.appointment.appointmentDate) {
      const appt = req.body.appointment;
      patientData.appointments = {
        create: {
          organizationId,
          doctorId: appt.doctorId,
          departmentId: appt.departmentId || null,
          appointmentDate: new Date(appt.appointmentDate),
          appointmentTime: appt.appointmentTime || '09:00',
          appointmentType: appt.appointmentType || 'new_patient',
          priority: appt.priority || 'normal',
          notes: appt.notes || null,
        }
      };
    }

    // The UHID is drawn INSIDE the transaction that writes the patient, so a
    // number is never burned by a create that then fails, and two concurrent
    // registrations cannot receive the same one.
    const patient = await db.$transaction(async (tx) => {
      return tx.patient.create({
        data: { ...patientData, mrn: await generateUHID(tx, organizationId) },
        include: { appointments: true },
      })
    })

    await db.auditLog.create({
      data: {
        organizationId,
        action: 'create',
        entityType: 'patient',
        entityId: patient.id,
        description: `Patient ${patient.mrn} registered`,
      },
    }).catch(() => {})

    res.status(201).json({
      success: true,
      data: patient,
      message: `Patient registered successfully. UHID: ${patient.mrn}`,
    })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params
    const body = req.body

    const patient = await db.patient.findFirst({ where: { id, organizationId } })
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }

    // Doctors may only update their own patients
    const docFilter = doctorPatientFilter(req)
    if (docFilter && !(await doctorOwnsPatient(req.user.userId, id))) {
      return res.status(403).json({ success: false, error: 'Unauthorized' })
    }

    // Only copy whitelisted fields — ignore anything else the client sends.
    const updateData = {}
    for (const key of PATIENT_EDITABLE_FIELDS) {
      if (body[key] !== undefined) updateData[key] = body[key]
    }
    // Edits go through the same phone rules as registration. This route takes
    // req.body directly (no zod schema), so without this an edit was the open
    // back door: a number rejected at registration could still be pasted in
    // here and stored, country code and all.
    //
    // But a NEW rule must not make EXISTING rows uneditable. 511 patients were
    // saved with a bad phone before this validation existed, and 267 of those
    // cannot be repaired automatically (stripping "91" off 914291170526 leaves
    // 4291170526, which is not a mobile number at all — the digits themselves
    // are wrong). The edit form prefills every field from the stored record, so
    // rejecting an unchanged bad value would mean nobody could fix that
    // patient's ADDRESS either — the legacy phone would hold the whole record
    // hostage. So: reject only what this edit actually tries to CHANGE.
    for (const field of ['phonePrimary', 'phoneSecondary', 'emergencyContactPhone']) {
      if (updateData[field] === undefined) continue
      const raw = updateData[field]
      if (raw == null || String(raw).trim() === '') { updateData[field] = null; continue }

      const clean = normalizeIndianMobile(raw)
      if (clean) { updateData[field] = clean; continue }   // fixable → store it clean

      // Unrepairable. Untouched legacy value: leave it exactly as it was and let
      // the rest of the edit through. Genuinely new input: reject it.
      if (String(raw) === String(patient[field] ?? '')) {
        delete updateData[field]
        continue
      }
      return res.status(400).json({
        success: false,
        error: `${field} must be a 10-digit Indian mobile number (received "${raw}")`,
      })
    }

    if (updateData.dateOfBirth) updateData.dateOfBirth = new Date(updateData.dateOfBirth)
    if (updateData.insuranceExpiryDate) updateData.insuranceExpiryDate = new Date(updateData.insuranceExpiryDate)
    if (Array.isArray(updateData.allergies)) updateData.allergies = JSON.stringify(updateData.allergies)
    if (Array.isArray(updateData.chronicConditions)) updateData.chronicConditions = JSON.stringify(updateData.chronicConditions)
    if (Array.isArray(updateData.currentMedications)) updateData.currentMedications = JSON.stringify(updateData.currentMedications)

    const updatedPatient = await db.patient.update({ where: { id }, data: updateData })

    await db.auditLog.create({
      data: {
        organizationId,
        action: 'update',
        entityType: 'patient',
        entityId: patient.id,
        description: `Patient ${patient.mrn} updated`,
      },
    }).catch(() => {})

    res.json({ success: true, data: updatedPatient })
  } catch (err) {
    next(err)
  }
}

export async function remove(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params
    // SOFT DELETE: a patient's medical/legal record must never be erased
    // (record-retention; admissions/bills/results point to it). We mark the
    // patient inactive so they drop out of the active list but all history is
    // preserved. updateMany is org-scoped → also returns count for not-found.
    const result = await db.patient.updateMany({
      where: { id, organizationId },
      data: { isActive: false },
    })
    if (result.count === 0) {
      return res.status(404).json({ success: false, error: "Patient not found" })
    }
    res.json({ success: true, message: "Patient deactivated" })
  } catch (err) {
    next(err)
  }
}
