// Machine Integration management API — list/configure analyzers, watch the
// result queue, read logs, and manually reprocess stuck items. Follows the same
// resource-param + getOrgId conventions as laboratoryController.

import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'
import { processQueueItem, processPending } from '../integration/queueProcessor.js'
import { z } from 'zod'

const createSchema = z.object({
  machineName: z.string().min(1),
  machineType: z.enum(['lab_analyzer', 'radiology_equipment', 'vital_signs_monitor']).default('lab_analyzer'),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  department: z.string().optional(),
  connectionType: z.enum(['hl7', 'astm', 'rest_api', 'file_upload', 'serial']).default('hl7'),
  connectionDetails: z.string().optional(),  // JSON string e.g. {"port":6661}
  testMapping: z.string().optional(),        // JSON string {"718-7":"<labTestId>"}
  isActive: z.boolean().optional(),
})

export const getAll = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { resource } = req.query

    if (!resource || resource === 'integrations') {
      const data = await db.machineIntegration.findMany({
        where: { organizationId: ORGANIZATION_ID },
        orderBy: { createdAt: 'desc' },
      })
      return res.json({ success: true, data })
    }

    if (resource === 'queue') {
      const where = { organizationId: ORGANIZATION_ID }
      if (req.query.status) where.status = req.query.status
      const data = await db.machineResultsQueue.findMany({
        where,
        include: { machineIntegration: { select: { machineName: true } } },
        orderBy: { receivedAt: 'desc' },
        take: Math.min(parseInt(req.query.limit) || 50, 500),
      })
      return res.json({ success: true, data })
    }

    if (resource === 'logs') {
      const data = await db.integrationLog.findMany({
        where: { organizationId: ORGANIZATION_ID },
        orderBy: { logDate: 'desc' },
        take: Math.min(parseInt(req.query.limit) || 100, 1000),
      })
      return res.json({ success: true, data })
    }

    return res.status(400).json({ success: false, error: 'Invalid resource parameter' })
  } catch (err) {
    next(err)
  }
}

export const create = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validation error', details: parsed.error.issues })
    }
    const data = await db.machineIntegration.create({
      data: {
        ...parsed.data,
        connectionDetails: parsed.data.connectionDetails || '{}',
        testMapping: parsed.data.testMapping || '{}',
        organizationId: ORGANIZATION_ID,
      },
    })
    return res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const update = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { id, ...rest } = req.body
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })

    // Tenant guard: only update a row this org owns (prevents cross-tenant writes).
    const owned = await db.machineIntegration.findFirst({
      where: { id, organizationId: ORGANIZATION_ID },
      select: { id: true },
    })
    if (!owned) return res.status(404).json({ success: false, error: 'Not found' })

    // Mass-assignment protection: never let the body rewrite identity/tenant.
    delete rest.organizationId
    delete rest.id

    const data = await db.machineIntegration.update({ where: { id }, data: rest })
    return res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

/** Manually (re)process one queue item — used for "manual_review"/"failed" rows. */
export const reprocess = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { id } = req.body
    if (!id) return res.status(400).json({ success: false, error: 'queue item id is required' })

    // Tenant guard: only reprocess a queue item this org owns.
    const owned = await db.machineResultsQueue.findFirst({
      where: { id, organizationId: ORGANIZATION_ID },
      select: { id: true },
    })
    if (!owned) return res.status(404).json({ success: false, error: 'Not found' })

    const result = await processQueueItem(id)
    return res.json({ success: true, data: result })
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message })
  }
}

/** Drain all pending queue items for this org (manual trigger / cron). */
export const drain = async (req, res, next) => {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const results = await processPending(ORGANIZATION_ID)
    return res.json({ success: true, data: results })
  } catch (err) {
    next(err)
  }
}
