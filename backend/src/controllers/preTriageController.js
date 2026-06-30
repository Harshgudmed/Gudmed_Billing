import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";

function generateScreeningNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `SCR${date}${random}`
}

// GET /api/pre-triage
export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { status = 'all' } = req.query
    const limit = parseInt(req.query.limit || '50')
    const offset = parseInt(req.query.offset || '0')

    const where = { organizationId: ORG_ID }
    if (status !== 'all') where.status = status

    const [screenings, total] = await Promise.all([
      db.preTriage.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { screenedAt: 'desc' },
        include: {
          screenedBy: { select: { fullName: true } },
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
        },
      }),
      db.preTriage.count({ where }),
    ])

    res.json({ 
      success: true, 
      data: screenings,
      meta: { total, limit, offset, hasMore: offset + limit < total }
    })
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
