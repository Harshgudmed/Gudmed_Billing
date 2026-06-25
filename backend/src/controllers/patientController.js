import { db } from '../config/db.js'
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

// Patient CRM users see only patients assigned to them.
function crmScopeId(req) {
  if (req.user?.role !== 'patient_crm') return null
  return req.user.userId
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

function generateUHID() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `UHID${date}${random}`
}

const patientSchema = z.object({
  firstName: z.string().min(2),
  middleName: z.string().optional(),
  lastName: z.string().min(2),
  dateOfBirth: z.string(),
  gender: z.enum(['male', 'female', 'other']),
  phonePrimary: z.string().optional(),
  phoneSecondary: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  region: z.string().optional(),
  zone: z.string().optional(),
  woreda: z.string().optional(),
  kebele: z.string().optional(),
  houseNumber: z.string().optional(),
  postalCode: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
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

export async function getAll(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const search = req.query.search || ''
    // Default to active only so soft-deleted (deactivated) patients drop out of
    // the main list. Pass ?status=inactive or ?status=all to see deactivated ones.
    const status = req.query.status || 'active'
    const limit = parseInt(req.query.limit || '50')
    const offset = parseInt(req.query.offset || '0')

    const where = { organizationId }
    if (status === 'active') where.isActive = true
    else if (status === 'inactive') where.isActive = false

    // Registration-date range filter (Today / This Week / This Month / custom).
    const { startDate, endDate } = req.query
    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt.gte = new Date(`${startDate}T00:00:00`)
      if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59.999`)
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

    // Patient CRM users see only the patients assigned to them.
    const crmId = crmScopeId(req)
    if (crmId) where.assignedCrmUserId = crmId

    const [patients, total] = await Promise.all([
      db.patient.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: 'desc' } }),
      db.patient.count({ where }),
    ])

    // Flag which patients have a generated report (lab order with results,
    // radiology order with a report, or uploaded documents) so the list can show clickable icons.
    const ids = patients.map((p) => p.id)
    const [labGroups, radGroups, admGroups, docGroups] = ids.length
      ? await Promise.all([
          db.labOrder.groupBy({
            by: ['patientId'],
            where: { patientId: { in: ids }, results: { some: {} } },
            _count: { _all: true },
          }),
          db.radiologyOrder.groupBy({
            by: ['patientId'],
            where: { patientId: { in: ids }, report: { isNot: null } },
            _count: { _all: true },
          }),
          db.admission.groupBy({
            by: ['patientId'],
            where: { patientId: { in: ids }, status: 'admitted' },
            _count: { _all: true },
          }),
          db.patientDocument.groupBy({
            by: ['patientId'],
            where: { patientId: { in: ids } },
            _count: { _all: true },
          }),
        ])
      : [[], [], [], []]

    const labCount = Object.fromEntries(labGroups.map((g) => [g.patientId, g._count._all]))
    const radCount = Object.fromEntries(radGroups.map((g) => [g.patientId, g._count._all]))
    const admCount = Object.fromEntries(admGroups.map((g) => [g.patientId, g._count._all]))
    const docCount = Object.fromEntries(docGroups.map((g) => [g.patientId, g._count._all]))
    const data = patients.map((p) => ({
      ...p,
      labReportCount: labCount[p.id] || 0,
      radiologyReportCount: radCount[p.id] || 0,
      admittedCount: admCount[p.id] || 0,
      documentCount: docCount[p.id] || 0,
    }))

    res.json({ success: true, data, meta: { total, limit, offset, hasMore: offset + limit < total } })
  } catch (err) {
    next(err)
  }
}

export async function getOne(req, res, next) {
  try {
    const patient = await db.patient.findUnique({ where: { id: req.params.id } })
    if (!patient) return res.status(404).json({ success: false, error: 'Patient not found' })

    // A doctor may only view their own patients — treat others as not found so we
    // don't reveal that the record exists.
    if (doctorPatientFilter(req) && !(await doctorOwnsPatient(req.user.userId, patient.id))) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }
    // CRM users may only view patients assigned to them.
    if (crmScopeId(req) && patient.assignedCrmUserId !== req.user.userId) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }

    res.json({ success: true, data: patient })
  } catch (err) {
    next(err)
  }
}

export async function getRecords(req, res, next) {
  try {
    const { id } = req.params
    const patient = await db.patient.findUnique({ where: { id } })
    if (!patient) return res.status(404).json({ success: false, error: 'Patient not found' })

    if (doctorPatientFilter(req) && !(await doctorOwnsPatient(req.user.userId, id))) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }
    if (crmScopeId(req) && patient.assignedCrmUserId !== req.user.userId) {
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

    // Attach department names (Appointment stores departmentId but has no relation)
    const deptIds = [...new Set(appointments.map(a => a.departmentId).filter(Boolean))]
    if (deptIds.length) {
      const depts = await db.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })
      const deptMap = new Map(depts.map(d => [d.id, d]))
      appointments.forEach(a => { a.department = a.departmentId ? deptMap.get(a.departmentId) || null : null })
    }

    // Billing summary across all non-cancelled invoices
    const billable = invoices.filter(i => i.status !== 'cancelled' && i.paymentStatus !== 'cancelled')
    const totalBilled = billable.reduce((s, i) => s + (i.totalAmount || 0), 0)
    const totalPaid = billable.reduce((s, i) => s + (i.amountPaid || 0), 0)
    const balanceDue = billable.reduce((s, i) => s + (i.balanceDue != null ? i.balanceDue : (i.totalAmount || 0) - (i.amountPaid || 0)), 0)

    res.json({
      success: true,
      data: {
        labOrders, radiologyOrders, admissions, appointments, invoices, patientDocuments,
        billing: { totalBilled, totalPaid, balanceDue, invoiceCount: billable.length },
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

    const patient = await db.patient.create({
      data: {
        organizationId,
        mrn: generateUHID(),
        firstName: validatedData.firstName,
        middleName: validatedData.middleName,
        lastName: validatedData.lastName,
        dateOfBirth: new Date(validatedData.dateOfBirth),
        gender: validatedData.gender,
        phonePrimary: validatedData.phonePrimary,
        phoneSecondary: validatedData.phoneSecondary,
        email: validatedData.email || null,
        region: validatedData.region,
        zone: validatedData.zone,
        woreda: validatedData.woreda,
        kebele: validatedData.kebele,
        houseNumber: validatedData.houseNumber,
        postalCode: validatedData.postalCode,
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
      },
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
    const { id } = req.params
    const body = req.body

    const updateData = { ...body }
    if (updateData.dateOfBirth) updateData.dateOfBirth = new Date(updateData.dateOfBirth)
    if (updateData.insuranceExpiryDate) updateData.insuranceExpiryDate = new Date(updateData.insuranceExpiryDate)
    if (Array.isArray(updateData.allergies)) updateData.allergies = JSON.stringify(updateData.allergies)
    if (Array.isArray(updateData.chronicConditions)) updateData.chronicConditions = JSON.stringify(updateData.chronicConditions)
    if (Array.isArray(updateData.currentMedications)) updateData.currentMedications = JSON.stringify(updateData.currentMedications)

    const patient = await db.patient.update({ where: { id }, data: updateData })
    res.json({ success: true, data: patient })
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
