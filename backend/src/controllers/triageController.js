import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { z } from 'zod'
import { generateQueueNumber } from '../utils/queueNumber.js'

const queueSchema = z.object({
  patientId: z.string(),
  // Set when reception/staff add a walk-in to the queue on behalf of an
  // existing appointment (rather than a pure walk-in) — links the two
  // features via QueueManagement.appointmentId.
  appointmentId: z.string().optional(),
  serviceArea: z.string(),
  serviceType: z.string().optional(),
  priority: z.string().default('normal'),
  assignedToId: z.string().optional(),
  assignedRoom: z.string().optional(),
})

// PATCH /:id — whitelist only. organizationId/patientId/queueNumber are never
// client-writable (mass-assignment protection — matches the pattern used in
// appointmentController.js).
const queueUpdateSchema = z.object({
  status: z.enum(['waiting', 'called', 'in_service', 'completed', 'cancelled', 'no_show']).optional(),
  priority: z.string().optional(),
  assignedToId: z.string().optional(),
  assignedRoom: z.string().optional(),
  estimatedWaitMinutes: z.number().optional(),
  displayMessage: z.string().optional(),
})

// GET /api/triage  (reads queue data)
export async function getQueue(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { serviceArea, status } = req.query
    const limit = parseInt(req.query.limit || '10')
    const offset = parseInt(req.query.offset || '0')
    const where = { organizationId: ORG_ID }
    if (serviceArea) where.serviceArea = serviceArea
    if (status) where.status = status

    const orderBy = [{ priority: 'desc' }, { joinedQueueAt: 'asc' }]

    const [queue, total] = await Promise.all([
      db.queueManagement.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy,
        include: {
          patient: {
            select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true, gender: true, dateOfBirth: true },
          },
        },
      }),
      db.queueManagement.count({ where }),
    ])

    const now = new Date()
    const queueWithWaitTime = queue.map(item => ({
      ...item,
      waitTime: item.joinedQueueAt
        ? Math.floor((now.getTime() - new Date(item.joinedQueueAt).getTime()) / 60000)
        : 0,
    }))

    res.json({
      success: true,
      data: queueWithWaitTime,
      meta: { total, limit, offset, hasMore: offset + limit < total },
    })
  } catch (err) {
    next(err)
  }
}

// POST /api/triage  (adds patient to queue)
export async function addToQueue(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const validatedData = queueSchema.parse(req.body)
    const patientInclude = { patient: { select: { id: true, mrn: true, firstName: true, lastName: true } } }

    // appointmentId is @unique on QueueManagement — upsert instead of create
    // so re-submitting for the same appointment (e.g. a double-click, or the
    // appointment was already checked in via appointmentController.update())
    // returns the existing entry instead of a 500 unique-constraint error.
    const queueItem = validatedData.appointmentId
      ? await db.queueManagement.upsert({
          where: { appointmentId: validatedData.appointmentId },
          create: {
            organizationId: ORG_ID,
            ...validatedData,
            queueNumber: generateQueueNumber(validatedData.serviceArea),
            status: 'waiting',
          },
          update: {},
          include: patientInclude,
        })
      : await db.queueManagement.create({
          data: {
            organizationId: ORG_ID,
            ...validatedData,
            queueNumber: generateQueueNumber(validatedData.serviceArea),
            status: 'waiting',
          },
          include: patientInclude,
        })

    res.status(201).json({ success: true, data: queueItem, message: 'Added to queue' })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/triage/:id  (update queue item status)
export async function updateQueue(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params

    // Verify the queue item belongs to this org before mutating it — the old
    // code updated by id alone with no ownership check (cross-tenant IDOR:
    // any authenticated caller could modify any other org's queue item).
    const existing = await db.queueManagement.findFirst({
      where: { id, organizationId: ORG_ID },
      select: { id: true },
    })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Queue item not found' })
    }

    // Whitelist + auto-set the matching timestamp on a status change — the old
    // code passed `req.body` straight to Prisma with no validation at all.
    const validatedData = queueUpdateSchema.parse(req.body)
    const data = { ...validatedData }
    if (validatedData.status === 'called') data.calledAt = new Date()
    else if (validatedData.status === 'in_service') data.serviceStartedAt = new Date()
    else if (validatedData.status === 'completed') data.serviceCompletedAt = new Date()

    const item = await db.queueManagement.update({
      where: { id },
      data,
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
      },
    })
    res.json({ success: true, data: item })
  } catch (err) {
    next(err)
  }
}
