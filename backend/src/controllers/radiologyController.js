import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { z } from 'zod'
import { PATIENT_SNAPSHOT_SELECT } from '../utils/patientSnapshot.js'

// ── Zod Schemas ────────────────────────────────────────────────────────────────

const examSchema = z.object({
  examName: z.string().min(1),
  examCategory: z.string().min(1),
  examCode: z.string().optional(),
  modality: z.string().optional(),
  bodyPart: z.string().optional(),
  description: z.string().optional(),
  preparationInstructions: z.string().optional(),
  estimatedDuration: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
  contrastRequired: z.boolean().optional(),
})

const orderSchema = z.object({
  patientId: z.string().min(1),
  examId: z.string().min(1),
  consultationId: z.string().optional(),
  clinicalIndication: z.string().optional(),
  provisionalDiagnosis: z.string().optional(),
  relevantHistory: z.string().optional(),
  urgency: z.string().optional(),
  scheduledDate: z.string().optional(),
  notes: z.string().optional(),
})

const reportSchema = z.object({
  orderId: z.string().min(1),
  technique: z.string().optional(),
  findings: z.string().optional(),
  impression: z.string().optional(),
  recommendations: z.string().optional(),
  hasCriticalFindings: z.boolean().optional(),
  criticalFindings: z.string().optional(),
  criticalNotifiedTo: z.string().optional(),
  comparedWithPrevious: z.boolean().optional(),
  comparisonNotes: z.string().optional(),
  dicomStudyUid: z.string().optional(),
  templateUsed: z.string().optional(),
  images: z.any().optional(),
  reportedById: z.string().optional(),
  verifiedById: z.string().optional(),
  verifiedAt: z.string().datetime().optional(),
})

const orderUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  urgency: z.string().optional(),
  clinicalIndication: z.string().optional(),
  provisionalDiagnosis: z.string().optional(),
  relevantHistory: z.string().optional(),
  notes: z.string().optional(),
  scheduledDate: z.string().optional(),
  cancellationReason: z.string().optional(),
}).passthrough()

const reportUpdateSchema = z.object({
  id: z.string().min(1),
  technique: z.string().optional(),
  findings: z.string().optional(),
  impression: z.string().optional(),
  recommendations: z.string().optional(),
  hasCriticalFindings: z.boolean().optional(),
  criticalFindings: z.string().optional(),
  criticalNotifiedTo: z.string().optional(),
  comparedWithPrevious: z.boolean().optional(),
  comparisonNotes: z.string().optional(),
  status: z.string().optional(),
  verifiedById: z.string().optional(),
  verifiedAt: z.string().datetime().optional(),
}).passthrough()

const examUpdateSchema = z.object({
  id: z.string().min(1),
  examName: z.string().optional(),
  examCategory: z.string().optional(),
  examCode: z.string().optional(),
  modality: z.string().optional(),
  bodyPart: z.string().optional(),
  description: z.string().optional(),
  preparationInstructions: z.string().optional(),
  estimatedDuration: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
  contrastRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).passthrough()

// ── Helpers ────────────────────────────────────────────────────────────────────

// Shared patient snapshot fields — single source of truth (see utils/patientSnapshot).
const patientSelect = PATIENT_SNAPSHOT_SELECT

function todayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { gte: start, lte: end }
}

// ── GET /api/radiology ─────────────────────────────────────────────────────────

export const getAll = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource, status, urgency, examCategory, orderId, search } = req.query

    // Pagination. NOTE: a second `Math.min(limit, 1000)` used to sit below this and
    // silently overrode the 2000 cap, so `?limit=2000` returned only 1000 rows and
    // the rest of the catalogue was unreachable (1927 exams → 927 invisible).
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 2000)
    const offset = Math.max(0, parseInt(req.query.offset) || 0)

    if (resource === 'exams') {
      const where = {
        organizationId: ORGANIZATION_ID,
        isActive: true,
        ...(examCategory ? { examCategory } : {}),
      }
      // Server-side search, so a picker never has to download the whole catalogue.
      if (search) {
        where.OR = [
          { examName: { contains: search, mode: 'insensitive' } },
          { examCode: { contains: search, mode: 'insensitive' } },
          { modality: { contains: search, mode: 'insensitive' } },
          { bodyPart: { contains: search, mode: 'insensitive' } },
        ]
      }
      const [data, total] = await Promise.all([
        db.radiologyExam.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: [{ examCategory: 'asc' }, { examName: 'asc' }],
        }),
        db.radiologyExam.count({ where }),
      ])

      const hasMore = (offset + limit) < total
      const page = Math.floor(offset / limit) + 1
      const totalPages = Math.ceil(total / limit)

      return res.json({
        success: true,
        data,
        meta: {
          total,
          limit,
          offset,
          page,
          totalPages,
          hasMore
        },
      })
    }

    if (resource === 'orders') {
      const where = {
        organizationId: ORGANIZATION_ID,
        ...(status ? { status } : {}),
        ...(urgency ? { urgency } : {}),
      }
      const [data, total] = await Promise.all([
        db.radiologyOrder.findMany({
          where,
          take: limit,
          skip: offset,
          include: {
            patient: { select: patientSelect },
            exam: true,
            report: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        db.radiologyOrder.count({ where }),
      ])

      const hasMore = (offset + limit) < total
      const page = Math.floor(offset / limit) + 1
      const totalPages = Math.ceil(total / limit)

      return res.json({
        success: true,
        data,
        meta: { total, limit, offset, page, totalPages, hasMore },
      })
    }

    if (resource === 'reports') {
      const where = {
        ...(orderId ? { orderId } : {}),
      }
      const [data, total] = await Promise.all([
        db.radiologyReport.findMany({
          where,
          take: limit,
          skip: offset,
          include: {
            order: {
              include: {
                patient: { select: patientSelect },
                exam: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        db.radiologyReport.count({ where }),
      ])

      const hasMore = (offset + limit) < total
      const page = Math.floor(offset / limit) + 1
      const totalPages = Math.ceil(total / limit)

      return res.json({
        success: true,
        data,
        meta: { total, limit, offset, page, totalPages, hasMore },
      })
    }

    if (resource === 'stats') {
      const today = todayRange()
      const [pending, inProgress, completedToday, criticalFindings, totalExams] =
        await Promise.all([
          db.radiologyOrder.count({ where: { organizationId: ORGANIZATION_ID, status: 'pending' } }),
          db.radiologyOrder.count({ where: { organizationId: ORGANIZATION_ID, status: 'in_progress' } }),
          db.radiologyOrder.count({ where: { organizationId: ORGANIZATION_ID, status: 'completed', orderDate: today } }),
          db.radiologyReport.count({
            where: { order: { organizationId: ORGANIZATION_ID }, hasCriticalFindings: true, verifiedAt: null },
          }),
          db.radiologyExam.count({ where: { organizationId: ORGANIZATION_ID, isActive: true } }),
        ])
      return res.json({ success: true, data: { pending, inProgress, completedToday, criticalFindings, totalExams } })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource. Use: exams, orders, reports, stats' })
  } catch (err) {
    next(err)
  }
}

// ── POST /api/radiology ────────────────────────────────────────────────────────

export const create = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource } = req.body

    if (resource === 'exam') {
      const parsed = examSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }
      const {
        examName, examCategory, examCode, modality, bodyPart,
        description, preparationInstructions, estimatedDuration, price, contrastRequired,
      } = parsed.data

      const data = await db.radiologyExam.create({
        data: {
          organizationId: ORGANIZATION_ID,
          isActive: true,
          examName,
          examCategory,
          ...(examCode !== undefined ? { examCode } : {}),
          ...(modality !== undefined ? { modality } : {}),
          ...(bodyPart !== undefined ? { bodyPart } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(preparationInstructions !== undefined ? { preparationInstructions } : {}),
          ...(estimatedDuration !== undefined ? { estimatedDuration } : {}),
          ...(price !== undefined ? { price } : {}),
          ...(contrastRequired !== undefined ? { contrastRequired } : {}),
        },
      })
      return res.json({ success: true, data })
    }

    if (resource === 'order') {
      const parsed = orderSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }
      const {
        patientId, examId, consultationId,
        clinicalIndication, provisionalDiagnosis, relevantHistory,
        urgency, scheduledDate, notes,
      } = parsed.data

      const orderNumber = `RAD${Date.now()}`

      const data = await db.radiologyOrder.create({
        data: {
          organizationId: ORGANIZATION_ID,
          orderNumber,
          patientId,
          examId,
          requestedById: 'user-admin',
          status: 'pending',
          ...(consultationId !== undefined ? { consultationId } : {}),
          ...(clinicalIndication !== undefined ? { clinicalIndication } : {}),
          ...(provisionalDiagnosis !== undefined ? { provisionalDiagnosis } : {}),
          ...(relevantHistory !== undefined ? { relevantHistory } : {}),
          ...(urgency !== undefined ? { urgency } : {}),
          ...(scheduledDate !== undefined ? { scheduledDate: new Date(scheduledDate) } : {}),
          ...(notes !== undefined ? { notes } : {}),
        },
        include: {
          patient: { select: patientSelect },
          exam: true,
        },
      })
      return res.json({ success: true, data })
    }

    if (resource === 'report') {
      const parsed = reportSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }
      const {
        orderId, technique, findings, impression, recommendations,
        hasCriticalFindings, criticalFindings, criticalNotifiedTo,
        comparedWithPrevious, comparisonNotes,
        dicomStudyUid, templateUsed, images,
        reportedById, verifiedById, verifiedAt,
      } = parsed.data

      const data = await db.radiologyReport.create({
        data: {
          organizationId: getOrgId(req),
          orderId,
          status: 'draft',
          ...(technique !== undefined ? { technique } : {}),
          ...(findings !== undefined ? { findings } : {}),
          ...(impression !== undefined ? { impression } : {}),
          ...(recommendations !== undefined ? { recommendations } : {}),
          ...(hasCriticalFindings !== undefined ? { hasCriticalFindings } : {}),
          ...(criticalFindings !== undefined ? { criticalFindings } : {}),
          ...(criticalNotifiedTo !== undefined ? { criticalNotifiedTo } : {}),
          ...(comparedWithPrevious !== undefined ? { comparedWithPrevious } : {}),
          ...(comparisonNotes !== undefined ? { comparisonNotes } : {}),
          ...(dicomStudyUid !== undefined ? { dicomStudyUid } : {}),
          ...(templateUsed !== undefined ? { templateUsed } : {}),
          ...(images !== undefined ? { images } : {}),
          ...(reportedById !== undefined ? { reportedById } : {}),
          ...(verifiedById !== undefined ? { verifiedById } : {}),
          ...(verifiedAt !== undefined ? { verifiedAt: new Date(verifiedAt) } : {}),
        },
      })

      await db.radiologyOrder.update({
        where: { id: orderId },
        data: { status: 'reported' },
      })

      return res.json({ success: true, data })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource. Use: exam, order, report' })
  } catch (err) {
    next(err)
  }
}

// ── PATCH /api/radiology ───────────────────────────────────────────────────────

export const update = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource } = req.body

    if (resource === 'order') {
      const parsed = orderUpdateSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }
      const { id, resource: _r, ...fields } = parsed.data

      if (fields.scheduledDate) fields.scheduledDate = new Date(fields.scheduledDate)

      // Tenant guard: only touch an order that belongs to this org.
      const owned = await db.radiologyOrder.findFirst({ where: { id, organizationId: ORGANIZATION_ID }, select: { id: true } })
      if (!owned) return res.status(404).json({ success: false, error: 'Radiology order not found' })

      const data = await db.radiologyOrder.update({
        where: { id },
        data: fields,
        include: {
          patient: { select: patientSelect },
          exam: true,
          report: true,
        },
      })
      return res.json({ success: true, data })
    }

    if (resource === 'report') {
      const parsed = reportUpdateSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }
      const { id, resource: _r, ...fields } = parsed.data

      if (fields.verifiedAt) fields.verifiedAt = new Date(fields.verifiedAt)

      // Tenant guard via the parent order's org (RadiologyReport.organizationId is
      // nullable). Blocks cross-tenant tampering with radiology report content.
      const owned = await db.radiologyReport.findFirst({
        where: { id, order: { organizationId: ORGANIZATION_ID } },
        select: { id: true },
      })
      if (!owned) return res.status(404).json({ success: false, error: 'Radiology report not found' })

      const data = await db.radiologyReport.update({
        where: { id },
        data: fields,
      })
      return res.json({ success: true, data })
    }

    if (resource === 'exam') {
      const parsed = examUpdateSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }
      const { id, resource: _r, ...fields } = parsed.data

      // Tenant guard: only touch an exam catalog entry that belongs to this org.
      const owned = await db.radiologyExam.findFirst({ where: { id, organizationId: ORGANIZATION_ID }, select: { id: true } })
      if (!owned) return res.status(404).json({ success: false, error: 'Radiology exam not found' })

      const data = await db.radiologyExam.update({
        where: { id },
        data: fields,
      })
      return res.json({ success: true, data })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource. Use: order, report, exam' })
  } catch (err) {
    next(err)
  }
}
