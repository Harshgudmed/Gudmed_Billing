import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { listResponse } from "../lib/pagination.js";

function generateScreeningNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `SCR${date}${random}`
}

// GET /api/pre-triage
export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { status = 'all', search = '', startDate = '', endDate = '' } = req.query

    // baseWhere = everything EXCEPT the status filter, so the summary counts show
    // the full status distribution no matter which status tab is active.
    const baseWhere = { organizationId: ORG_ID }
    if (search) {
      baseWhere.OR = [
        { screeningNumber: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { patient: { mrn: { contains: search, mode: 'insensitive' } } },
      ]
    }
    if (startDate || endDate) {
      baseWhere.createdAt = {}
      if (startDate) baseWhere.createdAt.gte = new Date(startDate)
      if (endDate) { const e = new Date(endDate); e.setHours(23, 59, 59, 999); baseWhere.createdAt.lte = e }
    }

    const where = { ...baseWhere }
    if (status !== 'all') where.status = status

    const include = {
      screenedBy: { select: { fullName: true } },
      patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
    }
    // Stat cards count across baseWhere (all statuses) so the tabs stay accurate.
    const body = await listResponse(db.preTriage, {
      where, include, orderBy: { screenedAt: 'desc' }, req,
      summary: async () => {
        const [total, pending, routed, registered] = await Promise.all([
          db.preTriage.count({ where: baseWhere }),
          db.preTriage.count({ where: { ...baseWhere, status: 'screening' } }),
          db.preTriage.count({ where: { ...baseWhere, status: 'routed' } }),
          db.preTriage.count({ where: { ...baseWhere, status: 'registered_as_patient' } }),
        ])
        return { total, pending, routed, registered }
      },
    })
    res.json(body)
  } catch (err) {
    next(err)
  }
}

// GET /api/pre-triage/:id
export async function getOne(req, res, next) {
  try {
    const screening = await db.preTriage.findUnique({
      where: { id: req.params.id },
      include: { screenedBy: { select: { fullName: true } } },
    })
    if (!screening) return res.status(404).json({ success: false, error: 'Screening not found' })
    res.json({ success: true, data: screening })
  } catch (err) {
    next(err)
  }
}

// POST /api/pre-triage
export async function create(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const validatedData = req.validatedBody
    let data = { ...validatedData }

    if (validatedData.patientId) {
      const patient = await db.patient.findUnique({ where: { id: validatedData.patientId } })
      if (!patient) {
        return res.status(404).json({ success: false, error: 'Patient not found' })
      }
      const age = patient.dateOfBirth
        ? Math.floor((Date.now() - new Date(patient.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null
      data = {
        ...data,
        firstName: patient.firstName,
        lastName: patient.lastName,
        age: age ?? data.age,
        gender: patient.gender || data.gender,
        phone: patient.phonePrimary || data.phone,
      }
    }

    const screening = await db.preTriage.create({
      data: {
        organizationId: ORG_ID,
        screeningNumber: generateScreeningNumber(),
        ...data,
        status: 'screening',
      },
    })

    res.status(201).json({ success: true, data: screening })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/pre-triage/:id
const PROTECTED_FIELDS = new Set(['id', 'organizationId', 'screeningNumber', 'screenedAt', 'screenedById'])

export async function update(req, res, next) {
  try {
    // Strip protected fields and convert empty strings to null (avoids FK violations)
    const data = Object.fromEntries(
      Object.entries(req.body)
        .filter(([k]) => !PROTECTED_FIELDS.has(k))
        .map(([k, v]) => [k, v === '' ? null : v])
    )

    const screening = await db.preTriage.update({
      where: { id: req.params.id },
      data,
    })
    res.json({ success: true, data: screening })
  } catch (err) {
    next(err)
  }
}

// POST /api/pre-triage/:id/convert  — convert screening to registered patient
export async function convertToPatient(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const screening = await db.preTriage.findUnique({ where: { id: req.params.id } })
    if (!screening) return res.status(404).json({ success: false, error: 'Screening not found' })

    const mrn = `UHID${Date.now().toString().slice(-8)}`

    // Use a Prisma transaction to guarantee both database operations succeed or fail together
    const patient = await db.$transaction(async (tx) => {
      const newPatient = await tx.patient.create({
        data: {
          organizationId: ORG_ID,
          mrn,
          firstName: screening.firstName || 'Unknown',
          lastName: screening.lastName || 'Patient',
          dateOfBirth: new Date(),
          gender: screening.gender || 'unknown',
          phonePrimary: screening.phone,
        },
      })

      await tx.preTriage.update({
        where: { id: req.params.id },
        data: { status: 'registered_as_patient', patientId: newPatient.id },
      })

      return newPatient
    })

    res.status(201).json({ success: true, data: patient })
  } catch (err) {
    next(err)
  }
}
