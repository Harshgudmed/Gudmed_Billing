import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { z } from 'zod'
import { nextQueueNumber } from '../utils/queueNumber.js'
import { getPagination, paginationMeta } from '../lib/pagination.js'
import { priorityRank } from '../lib/queuePriority.js'
import { dayRange, todayRange } from '../lib/dates.js'
import { syncAppointmentsToQueue } from '../lib/queueSync.js'
import { isOwned } from '../lib/tenant.js'
import { PATIENT_NAME_SELECT, patientFullName } from '../lib/patientName.js'

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

// How often the appointment→queue self-heal may actually run, per org+date
// range. Keyed by range as well as org because "today" and a historical range
// are different scans, and a user paging through last month must not starve
// today's heal (or vice versa).
const SYNC_EVERY_MS = 60_000
const lastSyncAt = new Map() // `${orgId}|${startDate}|${endDate}` -> epoch ms

async function syncIfDue(organizationId, startDate, endDate) {
  const key = `${organizationId}|${startDate || ''}|${endDate || ''}`
  const now = Date.now()
  if (now - (lastSyncAt.get(key) || 0) < SYNC_EVERY_MS) return
  // Stamped BEFORE awaiting, so concurrent requests in the same window (several
  // open queue tabs polling together) do not all start their own sync.
  lastSyncAt.set(key, now)
  await syncAppointmentsToQueue(organizationId, startDate, endDate)
}

// GET /api/triage  (reads queue data)
export async function getQueue(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { serviceArea, status, search, startDate, endDate, roomId } = req.query
    const { page, limit, skip } = getPagination(req.query)

    // The queue is derived from appointments — a patient with an appointment
    // today is in the queue, with no check-in step (client's rule).
    //
    // Booking now writes the queue row in the same transaction as the
    // appointment, so this sync is no longer what makes a new patient appear;
    // it is the self-heal for rows that predate that, for imported/seeded
    // appointments, and for slot or room changes.
    //
    // That matters because this screen now POLLS every 5s. The sync is not
    // cheap — it scans the day's appointments and took ~2.2s against this
    // dataset — so running it on every poll would put a permanent 2s query on
    // the pool for each open queue tab. Throttled per org+range, exactly like
    // the display board's healTodaysQueue().
    if (startDate || endDate) {
      await syncIfDue(ORG_ID, startDate, endDate)
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
            select: { ...PATIENT_NAME_SELECT, phonePrimary: true, gender: true, dateOfBirth: true },
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
    const patientInclude = { patient: { select: { ...PATIENT_NAME_SELECT, } } }

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
        patient: { select: { ...PATIENT_NAME_SELECT, } },
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
/**
 * POST /api/queue/call-next — the doctor's one button.
 *
 * A consultation ends and the next one begins as a single event: the doctor
 * finishes with whoever is in the room and waves the next person in. Doing that
 * previously meant two separate row actions on the reception screen (mark the
 * current patient completed, then mark the next one called), which is not
 * something a doctor can do from their desk mid-clinic — so in practice nobody
 * did, `in_progress` stayed empty, and the board could never say who was next.
 *
 * One transaction, so the room can never briefly show two patients in progress
 * or none at all:
 *   1. whoever is in_progress in this room  → completed
 *   2. the first waiting patient            → in_progress
 *
 * The patient after that then reads as "you are next" on the board with no
 * further action (see displayController) — which is the whole point: the
 * warning comes from the queue moving, not from someone remembering to send it.
 */
export async function callNextPatient(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { roomId, doctorId, queueEntryId } = req.body || {}
    if (!roomId && !doctorId && !queueEntryId) {
      return res.status(400).json({ success: false, error: 'roomId, doctorId or queueEntryId is required' })
    }
    if (roomId && !(await isOwned('room', roomId, ORG_ID))) {
      return res.status(404).json({ success: false, error: 'Room not found' })
    }

    // Calling a SPECIFIC patient in (reception picking someone out of order —
    // they stepped out, or an urgent case) still has to close whoever is
    // currently in the room, so it runs the same transaction with the target
    // pinned instead of taken from the head of the queue.
    let pinned = null
    if (queueEntryId) {
      pinned = await db.queueManagement.findFirst({
        where: { id: queueEntryId, organizationId: ORG_ID },
        select: { id: true, roomId: true, assignedToId: true },
      })
      if (!pinned) return res.status(404).json({ success: false, error: 'Queue item not found' })
    }

    // Scope to the room (a shared room's queue is the room's, not one doctor's)
    // and to TODAY, so an old unfinished row from a previous day can never be
    // picked up as "the next patient".
    const scope = { organizationId: ORG_ID, joinedQueueAt: todayRange() }
    // A pinned entry defines its own room, so the patient it replaces is the
    // one in THAT room — not whatever room the caller happened to name.
    if (pinned?.roomId) scope.roomId = pinned.roomId
    else if (roomId) scope.roomId = roomId
    if (!pinned && doctorId) scope.assignedToId = doctorId

    const result = await db.$transaction(async (tx) => {
      const current = await tx.queueManagement.findFirst({
        where: { ...scope, status: 'in_progress', id: { not: pinned?.id } },
        orderBy: { serviceStartedAt: 'asc' },
        select: { id: true },
      })
      if (current) {
        await tx.queueManagement.update({
          where: { id: current.id },
          data: { status: 'completed', serviceCompletedAt: new Date() },
        })
      }

      // Same ordering the board and the queue list use, so the person the
      // screen showed as next is the person who actually gets called.
      const upNext = pinned ?? await tx.queueManagement.findFirst({
        where: { ...scope, status: { in: ['waiting', 'called'] } },
        orderBy: [{ priorityRank: 'desc' }, { joinedQueueAt: 'asc' }],
        select: { id: true },
      })
      if (!upNext) return { completedId: current?.id ?? null, nowServing: null }

      const nowServing = await tx.queueManagement.update({
        where: { id: upNext.id },
        data: { status: 'in_progress', serviceStartedAt: new Date(), calledAt: new Date() },
        include: { patient: { select: PATIENT_NAME_SELECT } },
      })
      return { completedId: current?.id ?? null, nowServing }
    })

    res.json({
      success: true,
      data: result,
      message: result.nowServing
        ? `Now serving ${patientFullName(result.nowServing.patient)}`
        : 'Queue is empty — nobody left to call',
    })
  } catch (err) {
    next(err)
  }
}

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
