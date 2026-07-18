import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { z } from 'zod'
import { nextQueueNumber } from '../utils/queueNumber.js'
import { getPagination, paginationMeta } from '../lib/pagination.js'
import { priorityRank } from '../lib/queuePriority.js'
import { dayRange } from '../lib/dates.js'
import { syncAppointmentsToQueue } from '../lib/queueSync.js'
import { isOwned } from '../lib/tenant.js'

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
  roomId: z.string().optional(),
  visitType: z.enum(['new', 'follow_up']).default('new'),
  // Only meaningful for a 'follow_up' entry in a shared (multiple-doctor)
  // room — see lib/activeDoctor.js. Ignored otherwise.
  followUpDoctorId: z.string().optional(),
})

// PATCH /:id — whitelist only. organizationId/patientId/queueNumber are never
// client-writable (mass-assignment protection — matches the pattern used in
// appointmentController.js).
const queueUpdateSchema = z.object({
  status: z.enum(['waiting', 'called', 'in_progress', 'completed', 'cancelled', 'no_show']).optional(),
  priority: z.string().optional(),
  assignedToId: z.string().optional(),
  assignedRoom: z.string().optional(),
  roomId: z.string().optional(),
  visitType: z.enum(['new', 'follow_up']).optional(),
  followUpDoctorId: z.string().nullable().optional(),
  estimatedWaitMinutes: z.number().optional(),
  displayMessage: z.string().optional(),
})

// GET /api/triage  (reads queue data)
export async function getQueue(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { serviceArea, status, search, startDate, endDate, roomId } = req.query
    const { page, limit, skip } = getPagination(req.query)

    // The queue is derived from appointments — a patient with an appointment today
    // is in the queue, with no check-in step (client's rule). Do this before the
    // read so the list is never a day behind. Idempotent: a no-op once synced.
    if (startDate || endDate) {
      await syncAppointmentsToQueue(ORG_ID, startDate, endDate)
    }

    // Everything except the status filter. The per-status tile counts are built
    // from this so that clicking one tile (which sets `status`) narrows the
    // table WITHOUT collapsing the other tiles to zero — the counts stay a
    // stable breakdown of the current date/search scope.
    const baseWhere = { organizationId: ORG_ID }
    if (serviceArea && serviceArea !== 'all') baseWhere.serviceArea = serviceArea
    if (roomId) baseWhere.roomId = roomId
    // Day boundaries in the HOSPITAL's timezone, not the server's — a dev laptop
    // runs in IST and Render runs in UTC, so the old parse shifted "today" by 5h30m
    // and hid patients from the production queue.
    if (startDate || endDate) {
      baseWhere.joinedQueueAt = dayRange(startDate, endDate)
    }
    if (search) {
      baseWhere.OR = [
        { queueNumber: { contains: search, mode: 'insensitive' } },
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { mrn: { contains: search, mode: 'insensitive' } } },
      ]
    }

    // The listed page (and its total) additionally honour the status filter.
    const where = (status && status !== 'all')
      ? { ...baseWhere, status }
      : baseWhere

    // priorityRank first (urgent group on top), then joinedQueueAt — which is
    // stamped to "now" on a priority change, so a newly-urgent patient lands at
    // the BOTTOM of the urgent group (the client's rule). createdAt is the final
    // tiebreak so two rows with an identical joinedQueueAt (bulk check-in, or the
    // same instant) always sort the same way — without it Postgres returned tied
    // rows in an unstable physical order and the board reshuffled on every poll.
    const orderBy = [{ priorityRank: 'desc' }, { joinedQueueAt: 'asc' }, { createdAt: 'asc' }]

    // Counts span the whole filtered set, not just this page — otherwise the
    // header tiles would only ever count the rows currently on screen.
    // `summary` is the shape useServerPagination already exposes to callers.
    const [queue, total, byStatus] = await Promise.all([
      db.queueManagement.findMany({
        where,
        take: limit,
        skip,
        orderBy,
        include: {
          patient: {
            select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true, gender: true, dateOfBirth: true },
          },
        },
      }),
      db.queueManagement.count({ where }),
      db.queueManagement.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } }),
    ])

    const now = new Date()
    const TERMINAL = ['completed', 'cancelled', 'no_show']
    const queueWithWaitTime = queue.map(item => {
      // Wait time = time spent waiting to be seen, so it must STOP counting once
      // the patient leaves the waiting state — otherwise a patient seen days ago
      // shows an ever-growing wait of hundreds of hours. Freeze at the first
      // "attended" moment; fall back to updatedAt for a terminal row that was
      // never called, and only keep ticking against `now` while still waiting.
      const attendedAt = item.serviceStartedAt || item.calledAt || item.serviceCompletedAt
      const endRef = attendedAt ? new Date(attendedAt)
        : TERMINAL.includes(item.status) ? new Date(item.updatedAt)
        : now
      const waitTime = item.joinedQueueAt
        ? Math.max(0, Math.floor((endRef.getTime() - new Date(item.joinedQueueAt).getTime()) / 60000))
        : 0
      return { ...item, waitTime }
    })

    res.json({
      success: true,
      data: queueWithWaitTime,
      pagination: paginationMeta(page, limit, total),
      summary: Object.fromEntries(byStatus.map(r => [r.status, r._count._all])),
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
    if (validatedData.roomId && !(await isOwned('room', validatedData.roomId, ORG_ID))) {
      return res.status(400).json({ success: false, error: 'Room not found' })
    }
    const patientInclude = { patient: { select: { id: true, mrn: true, firstName: true, lastName: true } } }

    // Derive the numeric sort key from the priority string up front so both the
    // upsert and the plain create store it (the queue is ordered on this).
    const createData = {
      organizationId: ORG_ID,
      ...validatedData,
      priorityRank: priorityRank(validatedData.priority),
      queueNumber: await nextQueueNumber(db, ORG_ID, validatedData.serviceArea),
      status: 'waiting',
    }

    // appointmentId is @unique on QueueManagement — upsert instead of create
    // so re-submitting for the same appointment (e.g. a double-click, or the
    // appointment was already checked in via appointmentController.update())
    // returns the existing entry instead of a 500 unique-constraint error.
    const queueItem = validatedData.appointmentId
      ? await db.queueManagement.upsert({
          where: { appointmentId: validatedData.appointmentId },
          create: createData,
          update: {},
          include: patientInclude,
        })
      : await db.queueManagement.create({
          data: createData,
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
      select: { id: true, priorityRank: true },
    })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Queue item not found' })
    }

    // Whitelist + auto-set the matching timestamp on a status change — the old
    // code passed `req.body` straight to Prisma with no validation at all.
    const validatedData = queueUpdateSchema.parse(req.body)
    if (validatedData.roomId && !(await isOwned('room', validatedData.roomId, ORG_ID))) {
      return res.status(400).json({ success: false, error: 'Room not found' })
    }
    if (validatedData.followUpDoctorId && !(await isOwned('user', validatedData.followUpDoctorId, ORG_ID))) {
      return res.status(400).json({ success: false, error: 'Doctor not found' })
    }
    const data = { ...validatedData }
    if (validatedData.status === 'called') data.calledAt = new Date()
    else if (validatedData.status === 'in_progress') data.serviceStartedAt = new Date()
    else if (validatedData.status === 'completed') data.serviceCompletedAt = new Date()
    
    // Keep the numeric sort key in step with the priority string so a priority
    // change actually reorders the queue on the next read.
    if (validatedData.priority !== undefined) {
      const newRank = priorityRank(validatedData.priority)
      // Reset joinedQueueAt to current time when priority is changed (up or down)
      // so they go to the bottom of their new priority group.
      if (existing.priorityRank !== undefined && newRank !== existing.priorityRank) {
        data.joinedQueueAt = new Date()
      }
      data.priorityRank = newRank
    }

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

// POST /api/queue/:id/prescription-uploaded — the display board's actual
// "you are next" trigger (see Smart Waiting Time in the client requirements):
// stamped by the GudMed/Scribble prescription-upload webhook once it exists,
// and by a manual "Prescription Ready" staff button in the meantime — both
// call this same function so the display board never has to know which one
// fired it.
export async function markPrescriptionUploaded(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params
    const existing = await db.queueManagement.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Queue item not found' })

    const item = await db.queueManagement.update({
      where: { id },
      data: { prescriptionUploadedAt: new Date() },
    })
    res.json({ success: true, data: item })
  } catch (err) {
    next(err)
  }
}

// DELETE /api/queue/:id/prescription-uploaded — undo a misclick, or reset
// when a different patient is called into the room before the marked one.
export async function clearPrescriptionUploaded(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params
    const existing = await db.queueManagement.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Queue item not found' })

    const item = await db.queueManagement.update({
      where: { id },
      data: { prescriptionUploadedAt: null },
    })
    res.json({ success: true, data: item })
  } catch (err) {
    next(err)
  }
}
