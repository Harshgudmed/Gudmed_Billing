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
    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Organization context required' })
    }
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
    const organizationId = getOrgId(req)
    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Organization context required' })
    }
    const { id } = req.params
    const patient = await db.patient.findUnique({ where: { id } })
    if (!patient || patient.organizationId !== organizationId) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }

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
          department: { select: { id: true, name: true } },
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
    const [billingStats] = await Promise.all([
      db.invoice.aggregate({
        where: {
          patientId: id,
          status: { not: 'cancelled' },
          paymentStatus: { not: 'cancelled' },
        },
        _sum: { totalAmount: true, amountPaid: true, balanceDue: true },
        _count: { _all: true },
      }),
    ])

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

    const patientData = {
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

    const patient = await db.patient.create({
      data: patientData,
      include: {
        appointments: true
      }
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

    const patient = await db.patient.findUnique({ where: { id } })
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }

    // Enforce organization scope
    if (patient.organizationId !== organizationId) {
      return res.status(404).json({ success: false, error: 'Patient not found' })
    }

    // Doctors may only update their own patients
    const docFilter = doctorPatientFilter(req)
    if (docFilter && !(await doctorOwnsPatient(req.user.userId, id))) {
      return res.status(403).json({ success: false, error: 'Unauthorized' })
    }

    // CRM users may only update patients assigned to them
    const crmId = crmScopeId(req)
    if (crmId && patient.assignedCrmUserId !== req.user.userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' })
    }

    const updateData = { ...body }
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
