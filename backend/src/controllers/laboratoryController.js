import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { z } from 'zod'
import { PATIENT_SNAPSHOT_SELECT } from '../utils/patientSnapshot.js'

async function resolveRequestedById(organizationId) {
  const fromEnv = process.env.DEFAULT_REQUESTED_BY_ID
  if (fromEnv) {
    const user = await db.user.findUnique({ where: { id: fromEnv } })
    if (user) return fromEnv
  }
  const orgId = organizationId || process.env.ORGANIZATION_ID || 'org-demo'
  const admin = await db.user.findFirst({
    where: { organizationId: orgId, isActive: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) {
    throw Object.assign(
      new Error('No active user found to assign lab orders. Create a user in Settings or set DEFAULT_REQUESTED_BY_ID in .env'),
      { status: 400 }
    )
  }
  return admin.id
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const createTestSchema = z.object({
  testName: z.string().min(1),
  testCode: z.string().optional(),
  testCategory: z.string().optional(),
  testType: z.string().optional(),
  specimenType: z.string().optional(),
  specimenVolume: z.string().optional(),
  specimenContainer: z.string().optional(),
  unit: z.string().optional(),
  referenceRanges: z.string().optional(),
  price: z.number().optional(),
  turnaroundTime: z.number().int().optional(),
  department: z.string().optional(),
  preparationInstructions: z.string().optional(),
  clinicalSignificance: z.string().optional(),
})

const createOrderSchema = z.object({
  patientId: z.string().min(1),
  consultationId: z.string().optional(),
  tests: z.array(z.any()).min(1),
  clinicalIndication: z.string().optional(),
  provisionalDiagnosis: z.string().optional(),
  priority: z.string().optional(),
  notes: z.string().optional(),
})

const createResultSchema = z.object({
  orderId: z.string().min(1),
  testId: z.string().min(1),
  resultValue: z.string().optional(),
  resultUnit: z.string().optional(),
  isAbnormal: z.boolean().optional(),
  isCritical: z.boolean().optional(),
  flag: z.string().optional(),
  comment: z.string().optional(),
})

const updateOrderSchema = z.object({
  id: z.string().min(1),
}).passthrough()

const updateResultSchema = z.object({
  id: z.string().min(1),
}).passthrough()

const updateTestSchema = z.object({
  id: z.string().min(1),
}).passthrough()

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return { gte: start, lte: end }
}

// ── Controllers ────────────────────────────────────────────────────────────────

export const getAll = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource, testCategory, status, priority, orderId, search } = req.query

    // Pagination. NOTE: a second `Math.min(limit, 1000)` used to sit below this and
    // silently overrode the 2000 cap, so `?limit=2000` returned only 1000 rows and
    // the rest of the catalogue was unreachable (1607 tests → 607 invisible).
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 2000)
    const offset = Math.max(0, parseInt(req.query.offset) || 0)

    if (resource === 'tests') {
      const where = { organizationId: ORGANIZATION_ID, isActive: true }
      if (testCategory) where.testCategory = testCategory
      // Server-side search, so a picker never has to download the whole catalogue
      // (mirrors pharmacy/controllers/drug.controller.js).
      if (search) {
        where.OR = [
          { testName: { contains: search, mode: 'insensitive' } },
          { testCode: { contains: search, mode: 'insensitive' } },
          { testCategory: { contains: search, mode: 'insensitive' } },
        ]
      }

      const [data, total] = await Promise.all([
        db.labTest.findMany({
          where,
          orderBy: [{ testCategory: 'asc' }, { testName: 'asc' }],
          take: limit,
          skip: offset,
        }),
        db.labTest.count({ where }),
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
      const where = { organizationId: ORGANIZATION_ID }
      if (status) where.status = status
      if (priority) where.priority = priority

      const [data, total] = await Promise.all([
        db.labOrder.findMany({
          where,
          include: {
            patient: {
              select: PATIENT_SNAPSHOT_SELECT,
            },
            results: {
              include: { test: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        db.labOrder.count({ where }),
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

    if (resource === 'results') {
      const where = {}
      if (orderId) where.orderId = orderId

      const [data, total] = await Promise.all([
        db.labResult.findMany({
          where,
          include: {
            test: true,
            order: {
              include: {
                patient: {
                  select: PATIENT_SNAPSHOT_SELECT,
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        db.labResult.count({ where }),
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
      const baseWhere = { organizationId: ORGANIZATION_ID }

      const [pending, sampleCollected, inProgress, completedToday, criticalResults, totalTests] =
        await Promise.all([
          db.labOrder.count({ where: { ...baseWhere, status: 'pending' } }),
          db.labOrder.count({ where: { ...baseWhere, status: 'sample_collected' } }),
          db.labOrder.count({ where: { ...baseWhere, status: 'in_progress' } }),
          db.labOrder.count({
            where: { ...baseWhere, status: 'completed', resultsReportedAt: todayRange() },
          }),
          db.labResult.count({ where: { isCritical: true, verifiedAt: null } }),
          db.labTest.count({ where: { organizationId: ORGANIZATION_ID, isActive: true } }),
        ])

      return res.json({
        success: true,
        data: { pending, sampleCollected, inProgress, completedToday, criticalResults, totalTests },
      })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource parameter' })
  } catch (err) {
    next(err)
  }
}

export const create = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource } = req.body

    if (resource === 'test') {
      const parsed = createTestSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const data = await db.labTest.create({
        data: {
          ...parsed.data,
          organizationId: ORGANIZATION_ID,
          isActive: true,
        },
      })
      return res.json({ success: true, data })
    }

    if (resource === 'order') {
      const parsed = createOrderSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const { patientId, consultationId, tests, clinicalIndication, provisionalDiagnosis, priority, notes } =
        parsed.data

      const orderNumber = `LAB${Date.now()}`
      const requestedById = await resolveRequestedById(ORGANIZATION_ID)

      const data = await db.labOrder.create({
        data: {
          orderNumber,
          organizationId: ORGANIZATION_ID,
          patientId,
          consultationId: consultationId || null,
          requestedById,
          tests: JSON.stringify(tests),
          clinicalIndication,
          provisionalDiagnosis,
          priority,
          notes,
          status: 'pending',
        },
        // Return the patient too, so the freshly-created order shows the real
        // name in the UI immediately (not "Unknown" until the next refresh).
        include: {
          patient: {
            select: PATIENT_SNAPSHOT_SELECT,
          },
        },
      })
      return res.json({ success: true, data })
    }

    if (resource === 'result') {
      const parsed = createResultSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const { orderId, testId, resultValue, resultUnit, isAbnormal, isCritical, flag, comment } =
        parsed.data

      const data = await db.labResult.create({
        data: {
          organizationId: getOrgId(req),
          orderId,
          testId,
          resultValue,
          resultUnit,
          isAbnormal,
          isCritical,
          flag,
          comment,
        },
      })
      return res.json({ success: true, data })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource value' })
  } catch (err) {
    next(err)
  }
}

export const update = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource } = req.body

    if (resource === 'order') {
      const parsed = updateOrderSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const { id, resource: _r, ...updates } = parsed.data

      // Tenant guard: only touch an order that belongs to this org.
      const owned = await db.labOrder.findFirst({ where: { id, organizationId: ORGANIZATION_ID }, select: { id: true } })
      if (!owned) return res.status(404).json({ success: false, error: 'Lab order not found' })

      const data = await db.labOrder.update({
        where: { id },
        data: { ...updates },
      })
      return res.json({ success: true, data })
    }

    if (resource === 'result') {
      const parsed = updateResultSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const { id, resource: _r, ...updates } = parsed.data

      // Tenant guard via the parent order's org (LabResult.organizationId is nullable,
      // so verify ownership through the order it belongs to). Blocks cross-tenant
      // tampering with clinical result values.
      const owned = await db.labResult.findFirst({
        where: { id, order: { organizationId: ORGANIZATION_ID } },
        select: { id: true },
      })
      if (!owned) return res.status(404).json({ success: false, error: 'Lab result not found' })

      const data = await db.labResult.update({
        where: { id },
        data: { ...updates },
      })
      return res.json({ success: true, data })
    }

    if (resource === 'test') {
      const parsed = updateTestSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const { id, resource: _r, ...updates } = parsed.data

      // Tenant guard: only touch a test catalog entry that belongs to this org.
      const owned = await db.labTest.findFirst({ where: { id, organizationId: ORGANIZATION_ID }, select: { id: true } })
      if (!owned) return res.status(404).json({ success: false, error: 'Lab test not found' })

      const data = await db.labTest.update({
        where: { id },
        data: { ...updates },
      })
      return res.json({ success: true, data })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource value' })
  } catch (err) {
    next(err)
  }
}
