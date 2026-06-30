import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { z } from 'zod'

function generateQueueNumber(serviceArea) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  const prefix = serviceArea.substring(0, 3).toUpperCase()
  return `${prefix}${date}${random}`
}

const queueSchema = z.object({
  patientId: z.string(),
  serviceArea: z.string(),
  serviceType: z.string().optional(),
  priority: z.string().default('normal'),
  assignedToId: z.string().optional(),
  assignedRoom: z.string().optional(),
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

    const queueItem = await db.queueManagement.create({
      data: {
        organizationId: ORG_ID,
        ...validatedData,
        queueNumber: generateQueueNumber(validatedData.serviceArea),
        status: 'waiting',
      },
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
      },
    })

    res.status(201).json({ success: true, data: queueItem, message: 'Added to queue' })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/triage/:id  (update queue item status)
export async function updateQueue(req, res, next) {
  try {
    const item = await db.queueManagement.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
      },
    })
    res.json({ success: true, data: item })
  } catch (err) {
    next(err)
  }
}
