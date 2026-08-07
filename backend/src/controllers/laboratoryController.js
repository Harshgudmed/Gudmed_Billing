import { db } from '../config/db.js'
import { getOrgId, getActor, safeMoney } from "../lib/reqContext.js";
import { isOwned } from '../lib/tenant.js'
import { patientSearchWhere } from '../lib/patientSearch.js'
import { nextSeriesNumber } from "../lib/counters.js";
import { resolveRequestedById } from '../lib/requestedBy.js'
import { todayRange } from '../lib/dates.js'
import { listResponse } from '../lib/pagination.js'
import { z } from 'zod'
import { PATIENT_SNAPSHOT_SELECT } from '../utils/patientSnapshot.js'

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
  referenceMin: z.number().optional(),
  referenceMax: z.number().optional(),
  criticalLow: z.number().optional(),
  criticalHigh: z.number().optional(),
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

      const body = await listResponse(db.labTest, {
        where,
        orderBy: [{ testCategory: 'asc' }, { testName: 'asc' }],
        req,
        fullListTake: 2000,
      })
      return res.json(body)
    }

    if (resource === 'orders') {
      const where = { organizationId: ORGANIZATION_ID }
      // `status` accepts one value or a comma-separated list. The lab screens ask
      // for GROUPS of statuses ("open" = pending + sample_collected + in_progress);
      // with single-value matching only, they had to pull the whole table and
      // split it in the browser, which silently dropped rows past the cap.
      if (status) {
        const wanted = String(status).split(',').map((s) => s.trim()).filter(Boolean)
        if (wanted.length > 1) where.status = { in: wanted }
        else if (wanted.length === 1) where.status = wanted[0]
      }
      if (priority) where.priority = priority
      const searchWhere = patientSearchWhere(search, 'patient', (term) => [
        { orderNumber: { contains: term, mode: 'insensitive' } },
      ])
      if (searchWhere) Object.assign(where, searchWhere)
      const body = await listResponse(db.labOrder, {
        where,
        include: { patient: { select: PATIENT_SNAPSHOT_SELECT }, results: { include: { test: true } } },
        orderBy: { createdAt: 'desc' },
        req,
        fullListTake: 2000,
      })
      return res.json(body)
    }

    if (resource === 'results') {
      const where = { organizationId: ORGANIZATION_ID }
      if (orderId) where.orderId = orderId
      const body = await listResponse(db.labResult, {
        where,
        include: {
          test: true,
          order: { include: { patient: { select: PATIENT_SNAPSHOT_SELECT } } },
        },
        orderBy: { createdAt: 'desc' },
        req,
        fullListTake: 2000,
      })
      return res.json(body)
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
          // Scoped through the parent order: LabResult.organizationId is nullable,
          // so the org filter has to come from the LabOrder it belongs to. Without
          // it this tile counted EVERY hospital's unverified criticals — one
          // tenant's alarm number driven by another tenant's patients.
          db.labResult.count({
            where: { isCritical: true, verifiedAt: null, order: { organizationId: ORGANIZATION_ID } },
          }),
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

      // Reject a negative/non-numeric price before it flows into billing.
      if (parsed.data.price !== undefined && safeMoney(parsed.data.price) === null) {
        return res.status(400).json({ success: false, error: 'price must be a non-negative number' })
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

      const actorId = getActor(req).id
      // The order number is drawn from the atomic per-org counter inside the same
      // transaction as the insert, so two orders raised in the same millisecond
      // cannot collide on the @unique orderNumber (which `LAB${Date.now()}` did).
      // patientId is caller-supplied: without this an order (and the patient
      // demographics echoed back in the response) could be attached to another
      // hospital's patient. Shared isOwned tenant guard.
      if (!(await isOwned('patient', patientId, ORGANIZATION_ID))) {
        return res.status(404).json({ success: false, error: 'Patient not found' })
      }

      const data = await db.$transaction(async (tx) => {
        const orderNumber = await nextSeriesNumber(tx, ORGANIZATION_ID, 'LAB_ORDER', 'LAB')
        const requestedById = await resolveRequestedById(tx, ORGANIZATION_ID, actorId)

        return tx.labOrder.create({
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

      // Tenant guard: only attach a result to an order/test that belong to this
      // org, otherwise a caller could bind a result onto another org's records.
      const ownedOrder = await db.labOrder.findFirst({
        where: { id: orderId, organizationId: getOrgId(req) },
        select: { id: true },
      })
      if (!ownedOrder) return res.status(404).json({ success: false, error: 'Lab order not found' })

      const ownedTest = await db.labTest.findFirst({
        where: { id: testId, organizationId: getOrgId(req) },
        select: { id: true },
      })
      if (!ownedTest) return res.status(404).json({ success: false, error: 'Lab test not found' })

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

      // Strip identity/tenant fields so a passthrough body can't relocate this
      // order to another org or corrupt its identity via the `...updates` spread.
      delete updates.organizationId
      delete updates.id
      delete updates.patientId
      delete updates.orderNumber
      delete updates.requestedById
      // The accession number labels the physical tube, so it is minted HERE and
      // never accepted from the client. The UI used to build it as
      // `ACC-${Math.floor(Math.random() * 10000)}` — 10,000 possible values
      // against a @@unique column, which by the birthday bound is more likely
      // than not to repeat within ~118 samples and then 500s in front of a
      // technician holding the tube. Worse, it called that twice per collection,
      // once for this request and once for the on-screen copy, so the number
      // printed on the tube was never the number stored against the order.
      delete updates.accessionNumber

      // Tenant guard: only touch an order that belongs to this org.
      const owned = await db.labOrder.findFirst({ where: { id, organizationId: ORGANIZATION_ID }, select: { id: true } })
      if (!owned) return res.status(404).json({ success: false, error: 'Lab order not found' })

      const data = await db.$transaction(async (tx) => {
        // First collection only. Re-collecting, or any later status change, must
        // not renumber a tube that is already on a rack in the lab.
        if (updates.status === 'sample_collected') {
          const accessionNumber = await nextSeriesNumber(tx, ORGANIZATION_ID, 'LAB_ACCESSION', 'ACC')
          // Compare-and-set: only claim the number if the order still has none.
          // A double-clicked Collect button would otherwise relabel the tube with
          // a second number after the first one was already written and printed.
          // A losing click leaves a gap in the series, which is harmless.
          await tx.labOrder.updateMany({
            where: { id, organizationId: ORGANIZATION_ID, accessionNumber: null },
            data: { accessionNumber },
          })
        }
        return tx.labOrder.update({ where: { id }, data: { ...updates } })
      })
      return res.json({ success: true, data })
    }

    if (resource === 'result') {
      const parsed = updateResultSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
      }

      const { id, resource: _r, ...updates } = parsed.data

      // Strip identity/tenant fields so a passthrough body can't reattach this
      // result to another org's order or corrupt its identity via `...updates`.
      delete updates.organizationId
      delete updates.id
      delete updates.orderId

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

      // Strip identity/tenant fields so a passthrough body can't relocate this
      // test catalog entry to another org via the `...updates` spread.
      delete updates.organizationId
      delete updates.id

      // Reject a negative/non-numeric price on update too (passthrough schema
      // doesn't type-check it), so it can't slip back in via edit.
      if (updates.price !== undefined && safeMoney(updates.price) === null) {
        return res.status(400).json({ success: false, error: 'price must be a non-negative number' })
      }

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
