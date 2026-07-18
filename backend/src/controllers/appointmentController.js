import { db } from '../config/db.js'
import { Prisma } from '@prisma/client'
import { getOrgId } from "../lib/reqContext.js";
import { drName } from "../lib/drName.js";
import { nextSeriesNumber, invoiceProbe } from "../lib/counters.js";
import { startOfDay, endOfDay, todayIST } from '../utils/dates.js'
import { normalizeTimeHHMM } from '../lib/dates.js'
import { scopedDoctorId } from '../utils/scope.js'
import { computeConsultationFee } from '../services/appointmentFees.js'
import { nextQueueNumber } from '../utils/queueNumber.js'
import { deriveRoomAndVisitType } from '../lib/queueDerivation.js'

export async function getAll(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { date, dateFrom, dateTo, status, doctorId, patientId, department, search } = req.query
    const limit = Math.min(Number(req.query.limit) || 50, 1000) // hard cap, NaN-safe
    const offset = Math.max(Number(req.query.offset) || 0, 0)   // NaN/negative → 0

    const where = { organizationId }

    if (date) {
      // Match any appointment that falls on the requested calendar day
      where.appointmentDate = { gte: startOfDay(date), lte: endOfDay(date) }
    } else if (dateFrom && dateTo) {
      // Calendar/week views fetch a bounded date range instead of everything
      where.appointmentDate = { gte: startOfDay(dateFrom), lte: endOfDay(dateTo) }
    }
    if (status) where.status = status
    if (doctorId) where.doctorId = doctorId
    if (patientId) where.patientId = patientId

    // Filter by the appointment's doctor's department name
    if (department && department !== 'all') {
      where.doctor = { is: { department: { is: { name: department } } } }
    }

    // Free-text search across patient, doctor and chief complaint
    if (search) {
      const q = search.trim()
      where.OR = [
        { patient: { is: { firstName: { contains: q, mode: 'insensitive' } } } },
        { patient: { is: { lastName:  { contains: q, mode: 'insensitive' } } } },
        { patient: { is: { mrn:       { contains: q, mode: 'insensitive' } } } },
        { doctor:  { is: { fullName:  { contains: q, mode: 'insensitive' } } } },
        { chiefComplaint: { contains: q, mode: 'insensitive' } },
      ]
    }

    // A doctor only sees their own appointments (overrides any doctorId query param).
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    const [appointments, total] = await Promise.all([
      db.appointment.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
        include: {
          patient: {
            select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true, gender: true, dateOfBirth: true },
          },
          doctor: {
            select: { id: true, fullName: true, specialization: true },
          },
        },
      }),
      db.appointment.count({ where }),
    ])

    res.json({ 
      success: true, 
      data: appointments,
      meta: { total, limit, offset, hasMore: offset + limit < total }
    })
  } catch (err) {
    next(err)
  }
}

// Calendar cells only need counts, not full appointment rows. The DB groups the
// rows first, then we merge by yyyy-MM-dd for a compact month/week response.
export async function getCalendarCounts(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { dateFrom, dateTo } = req.query

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ success: false, error: 'dateFrom and dateTo are required' })
    }

    const from = startOfDay(dateFrom)
    const to = endOfDay(dateTo)
    const myDoctorId = scopedDoctorId(req)
    const doctorFilter = myDoctorId
      ? Prisma.sql`AND "doctorId" = ${myDoctorId}`
      : Prisma.empty

    const grouped = await db.$queryRaw`
      SELECT
        to_char(date_trunc('day', "appointmentDate"), 'YYYY-MM-DD') AS "date",
        "status",
        COUNT(*)::int AS "count"
      FROM "Appointment"
      WHERE "organizationId" = ${organizationId}
        AND "appointmentDate" >= ${from}
        AND "appointmentDate" <= ${to}
        ${doctorFilter}
      GROUP BY date_trunc('day', "appointmentDate"), "status"
      ORDER BY date_trunc('day', "appointmentDate") ASC
    `

    const byDay = new Map()
    for (const row of grouped) {
      const { date, status } = row
      const count = Number(row.count || 0)
      const summary = byDay.get(date) || { date, total: 0, byStatus: {} }
      summary.total += count
      summary.byStatus[status] = (summary.byStatus[status] || 0) + count
      byDay.set(date, summary)
    }

    res.json({ success: true, data: [...byDay.values()] })
  } catch (err) {
    next(err)
  }
}

// Today's appointment counts by status, computed by the DB (groupBy) instead of
// shipping every row to the browser to count.
export async function getStats(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const day = req.query.date || todayIST()
    const where = { organizationId, appointmentDate: { gte: startOfDay(day), lte: endOfDay(day) } }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    const grouped = await db.appointment.groupBy({ by: ['status'], where, _count: true })
    const by = Object.fromEntries(grouped.map((g) => [g.status, g._count]))
    res.json({
      success: true,
      data: {
        total: grouped.reduce((sum, g) => sum + g._count, 0),
        scheduled: by.scheduled || 0,
        confirmed: by.confirmed || 0,
        checkedIn: by.checked_in || 0,
        inProgress: by.in_progress || 0,
        completed: by.completed || 0,
        cancelled: by.cancelled || 0,
        noShows: by.no_show || 0,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getOne(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params

    // Scope single-appointment reads to the doctor's own (others → 404 below).
    const where = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    const appointment = await db.appointment.findFirst({
      where,
      include: {
        patient: true,
        doctor: { select: { id: true, fullName: true, specialization: true } },
        consultations: true,
      },
    })

    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' })
    }

    res.json({ success: true, data: appointment })
  } catch (err) {
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const validatedData = req.validatedBody
    // Pad once, here: the slot-clash lookup below and the row we store must agree,
    // and the stored value is string-sorted (see normalizeTimeHHMM).
    validatedData.appointmentTime = normalizeTimeHHMM(validatedData.appointmentTime)

    // Pin to midnight of the hospital's day. `appointmentDate` is the DAY; the
    // time of day lives in `appointmentTime`. The browser sends a full instant
    // (the form defaults to `new Date()` and posts .toISOString()), so storing
    // it raw put the booking's own creation moment in the date — 2026-07-17
    // T11:40:15.915Z rather than midnight. That silently disabled the
    // double-booking guard: the unique index is on (organizationId, doctorId,
    // appointmentDate, appointmentTime), so a date unique to the millisecond
    // can never collide, and one doctor ended up with 13 bookings in the same
    // 10:00 slot. Normalising here is what gives that index something to catch.
    const apptDate = startOfDay(validatedData.appointmentDate)
    let consultationFee = null
    let appliedSlabInfo = null

    // Fee is always derived from the doctor's slabs (shared with the preview endpoint) —
    // createAppointmentSchema doesn't accept a client-supplied consultationFee.
    if (validatedData.doctorId) {
      const result = await computeConsultationFee({
        organizationId,
        doctorId: validatedData.doctorId,
        patientId: validatedData.patientId,
        date: apptDate,
      })
      if (result.doctorMissing) {
        return res.status(404).json({ success: false, error: 'Doctor not found' })
      }
      consultationFee = result.fee
      appliedSlabInfo =
        result.reason === 'slab'
          ? { type: 'slab', slabId: result.slab.id, fromDays: result.slab.fromDays, toDays: result.slab.toDays }
          : result.reason === 'reset'
            ? { type: '30day_reset' }
            : result.reason === 'default'
              ? { type: 'default' }
              : { type: 'new_patient' }
    }

    // Prevent double-booking: no two live appointments for the SAME doctor at the
    // same date + time slot. Cancelled appointments free the slot again.
    //
    // Matched across the whole calendar DAY rather than on `apptDate` exactly:
    // every appointment written before the normalisation above carries a
    // creation-instant date, so an equality test would miss all of them and
    // happily double-book on top of existing rows. `rescheduled` is excluded to
    // match the partial index's own WHERE clause — a superseded row must not
    // keep holding the slot it was moved out of.
    const slotClash = await db.appointment.findFirst({
      where: {
        organizationId,
        doctorId: validatedData.doctorId,
        appointmentDate: { gte: startOfDay(apptDate), lte: endOfDay(apptDate) },
        appointmentTime: validatedData.appointmentTime,
        status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
      },
      select: { id: true },
    })
    if (slotClash) {
      return res.status(409).json({
        success: false,
        code: 'SLOT_TAKEN',
        error: `That doctor already has an appointment at ${validatedData.appointmentTime} on this date. Pick another slot.`,
      })
    }

    // Create appointment, invoice, AND commission in transaction. The
    // findFirst check above is only a fast, friendly pre-check — it runs
    // outside any transaction/lock, so two requests within the same ~100ms
    // window can both pass it and both reach this create. The real guard is
    // the partial unique index on (organizationId, doctorId, appointmentDate,
    // appointmentTime) (migration 20260716100500_appointment_slot_unique) —
    // the loser's create throws P2002, caught below and translated to the
    // same SLOT_TAKEN response the pre-check gives the common case.
    let appointment, draftInvoiceNumber, commission
    try {
      ({ appointment, draftInvoiceNumber, commission } = await db.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          organizationId,
          patientId: validatedData.patientId,
          doctorId: validatedData.doctorId,
          appointmentDate: apptDate,
          appointmentTime: validatedData.appointmentTime,
          appointmentType: validatedData.appointmentType,
          priority: validatedData.priority || 'normal',
          notes: validatedData.notes,
          departmentId: validatedData.departmentId,
          consultationFee,
          status: 'scheduled',
          reminderSent: false,
        },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true } },
          doctor: { select: { id: true, fullName: true } },
        },
      })

      // Create draft invoice
      const aptType = validatedData.appointmentType || 'OPD'
      const opdService = await tx.billingService.findFirst({
        where: { organizationId, isActive: true, serviceCategory: 'consultation' },
        orderBy: { createdAt: 'asc' },
      })
      const unitPrice = consultationFee ?? opdService?.unitPrice ?? 500
      // The line must say WHAT was billed, so reception/patient/audit can tell an
      // OPD visit from a follow-up on the receipt itself. Naming the service
      // alone ("OPD Consultation") made every appointment type — including
      // follow-ups and emergencies — print the same line.
      const VISIT_LABEL = {
        follow_up: 'Follow-up Consultation',
        new_patient: 'OPD Consultation (New Patient)',
        emergency: 'Emergency Consultation',
      }
      const visitLabel = VISIT_LABEL[aptType] || opdService?.serviceName || `${aptType} Consultation`
      const description = appointment.doctor?.fullName
        ? `${visitLabel} — ${drName(appointment.doctor.fullName)}`
        : visitLabel
      // Same atomic per-org/FY series the billing counter draws from, so an
      // appointment invoice and a counter invoice share one numbering scheme and
      // cannot collide on the @unique column when created in the same millisecond.
      const invoiceNumber = await nextSeriesNumber(tx, organizationId, 'INV', 'INV', invoiceProbe(tx, organizationId))

      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          patientId: validatedData.patientId,
          appointmentId: appointment.id, // proper FK link, not just a notes string
          invoiceNumber,
          items: JSON.stringify([{
            type: 'consultation',
            description,
            quantity: 1,
            unitPrice,
            discount: 0,
            tax: 0,
            total: unitPrice,
          }]),
          subtotal: unitPrice,
          discountAmount: 0,
          discountPercentage: 0,
          taxAmount: 0,
          totalAmount: unitPrice,
          balanceDue: unitPrice,
          status: 'draft',
          paymentStatus: 'unpaid',
          notes: `Auto-voucher | Appointment: ${appointment.id} | Type: ${aptType}`,
        },
      })

      // Auto-create commission if doctor has commission config
      let commission = null
      if (validatedData.doctorId) {
        const commissionConfig = await tx.doctorCommissionConfig.findUnique({
          where: { doctorId: validatedData.doctorId },
        })

        if (commissionConfig && commissionConfig.isActive) {
          // A percentage doctor earns a share of what was actually charged, so a
          // free follow-up (unitPrice 0) correctly earns nothing. A fixed
          // per-consultation doctor is paid for SEEING the patient, so they earn
          // their flat amount even on a free follow-up. Guarding on the computed
          // amount (not on unitPrice) gives both: fixed pays out at ₹0 fee,
          // percentage stays zero. The old `unitPrice > 0` guard silently
          // withheld the fixed doctor's fee on every free follow-up.
          const commissionAmount = commissionConfig.commissionType === 'percentage'
            ? (unitPrice * commissionConfig.commissionRate) / 100
            : commissionConfig.commissionRate

          if (commissionAmount > 0) {
          commission = await tx.doctorCommission.create({
            data: {
              organizationId,
              doctorId: validatedData.doctorId,
              invoiceId: invoice.id,
              invoiceAmount: unitPrice,
              commissionRate: commissionConfig.commissionRate,
              commissionType: commissionConfig.commissionType,
              commissionAmount,
              status: 'pending',
            },
          })
          }
        }
      }

      return { appointment, draftInvoiceNumber: invoice.invoiceNumber, commission }
      }))
    } catch (err) {
      // P2002's `target` is the constraint NAME on some Prisma versions and the
      // list of FIELD names on others — this Postgres client reports the fields
      // ("organizationId,doctorId,appointmentDate,appointmentTime"), so matching
      // only the index name never hit, and a taken slot would surface as a 500
      // instead of SLOT_TAKEN. It went unnoticed because the index itself could
      // never fire until appointmentDate stopped carrying a time-of-day (see
      // create()'s startOfDay call). `appointmentTime` is unique to this index —
      // it is the only unique constraint on Appointment that mentions it.
      const target = String(err.meta?.target || '')
      if (err.code === 'P2002'
        && (target.includes('Appointment_doctor_active_slot_key') || target.includes('appointmentTime'))) {
        return res.status(409).json({
          success: false,
          code: 'SLOT_TAKEN',
          error: `That doctor already has an appointment at ${validatedData.appointmentTime} on this date. Pick another slot.`,
        })
      }
      throw err
    }

    const messageLines = [
      `Appointment scheduled`,
      consultationFee === 0 ? ` — Free follow-up (no charge)` : '',
      draftInvoiceNumber ? ` — Draft invoice ${draftInvoiceNumber} created` : '',
      commission ? ` — Commission ₹${commission.commissionAmount.toFixed(2)} auto-generated` : '',
    ].filter(Boolean).join('')

    res.status(201).json({
      success: true,
      data: { ...appointment, draftInvoiceNumber, appliedSlabInfo, commission },
      message: messageLines,
    })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params
    const body = req.validatedBody

    // Ensure the appointment belongs to this org before mutating it.
    // A doctor may only mutate their own appointments (matches getOne scoping).
    const scopeWhere = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) scopeWhere.doctorId = myDoctorId
    const existing = await db.appointment.findFirst({ where: scopeWhere, select: { id: true } })
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Appointment not found' })
    }

    // Whitelist: only these fields can be changed — sensitive fields like
    // organizationId, patientId, invoiceId are never touched.
    const updates = {}
    // Same day-pinning as create() — an edit must not reintroduce a
    // time-of-day into the date and slip back past the slot unique index.
    if (body.appointmentDate    !== undefined) updates.appointmentDate    = startOfDay(body.appointmentDate)
    if (body.appointmentTime    !== undefined) updates.appointmentTime    = normalizeTimeHHMM(body.appointmentTime)
    if (body.appointmentType    !== undefined) updates.appointmentType    = body.appointmentType
    if (body.doctorId           !== undefined) updates.doctorId           = body.doctorId
    if (body.chiefComplaint     !== undefined) updates.chiefComplaint     = body.chiefComplaint
    if (body.notes              !== undefined) updates.notes              = body.notes
    if (body.cancellationReason !== undefined) updates.cancellationReason = body.cancellationReason
    if (body.consultationFee    !== undefined) updates.consultationFee    = body.consultationFee
    if (body.reminderSent       !== undefined) updates.reminderSent       = body.reminderSent

    // Status change → auto-set the matching timestamp
    if (body.status !== undefined) {
      updates.status = body.status
      if      (body.status === 'checked_in')  updates.checkedInAt  = new Date()
      else if (body.status === 'in_progress') updates.startedAt    = new Date()
      else if (body.status === 'completed')   updates.completedAt  = new Date()
      else if (body.status === 'cancelled')   updates.cancelledAt  = new Date()
      else if (body.status === 'no_show')     updates.cancelledAt  = new Date()
    }

    if (body.reminderSent === true) updates.reminderSentAt = new Date()

    // Checking in an appointment also creates (or reuses) its linked queue
    // entry, atomically with the status update — this is what actually
    // connects the Appointment and Queue modules (QueueManagement.appointmentId,
    // added alongside this change). Before this, check-in only stamped
    // `checkedInAt` on the appointment and never touched the queue at all.
    const appointment = await db.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id },
        data: updates,
        include: {
          patient: {
            select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true, gender: true, dateOfBirth: true },
          },
          doctor: {
            select: { id: true, fullName: true, specialization: true },
          },
        },
      })

      if (body.status === 'checked_in') {
        // Room + new-vs-follow-up are derived from the doctor/patient, not
        // asked at check-in — see lib/queueDerivation.js.
        const { roomId, visitType } = await deriveRoomAndVisitType({
          doctorId: updated.doctorId,
          patientId: updated.patientId,
          // The room comes from the shift covering THIS appointment's slot, so
          // the slot has to come along — see lib/queueDerivation.js.
          appointmentDate: updated.appointmentDate,
          appointmentTime: updated.appointmentTime,
        })
        await tx.queueManagement.upsert({
          where: { appointmentId: id },
          create: {
            organizationId,
            patientId: updated.patientId,
            appointmentId: id,
            serviceArea: 'opd',
            assignedToId: updated.doctorId,
            roomId,
            visitType,
            status: 'waiting',
            queueNumber: await nextQueueNumber(tx, organizationId, 'opd'),
          },
          update: {}, // already queued (e.g. re-check-in after an edit) — leave as-is
        })
      }

      // Cancelling or no-showing an appointment must also drop the patient OUT of
      // the queue. Check-in creates a 'waiting' QueueManagement row; without this
      // the row stayed 'waiting' after a cancel, so the patient the receptionist
      // just cancelled was still called by staff and still shown on the public
      // display board. updateMany (not update) so it is a harmless no-op when the
      // appointment was never checked in and has no queue row.
      if (body.status === 'cancelled' || body.status === 'no_show') {
        await tx.queueManagement.updateMany({
          where: { appointmentId: id, status: { notIn: ['completed', 'cancelled', 'no_show'] } },
          data: { status: body.status },
        })
      }

      return updated
    })

    res.json({ success: true, data: appointment })
  } catch (err) {
    next(err)
  }
}

// Reschedule = create the new appointment AND mark the old one rescheduled,
// atomically, with the two rows linked via rescheduledFromId/rescheduledToId.
// (Previously the frontend did this as two separate calls with no transaction.)
export async function reschedule(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params
    const { appointmentDate } = req.body
    // This route has no `validate()` middleware, so validate req.body here — it
    // is how unpadded times like "9:00" and impossible ones like "25:00" got in,
    // which then sort wrong on the board.
    const appointmentTime = normalizeTimeHHMM(req.body.appointmentTime)

    if (!appointmentDate || !appointmentTime) {
      return res.status(400).json({ success: false, error: 'appointmentDate and appointmentTime are required' })
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(appointmentTime)) {
      return res.status(400).json({ success: false, error: 'Time must be HH:mm between 00:00 and 23:59' })
    }
    if (Number.isNaN(new Date(appointmentDate).getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid appointmentDate' })
    }

    const scopeWhere = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) scopeWhere.doctorId = myDoctorId
    const original = await db.appointment.findFirst({ where: scopeWhere })
    if (!original) {
      return res.status(404).json({ success: false, error: 'Appointment not found' })
    }

    // R5 — a finished or voided visit is not a thing you move. Only a live
    // upcoming appointment can be rescheduled; a cancelled/no-show/completed/
    // already-rescheduled one must not spawn a fresh live appointment.
    if (['cancelled', 'no_show', 'completed', 'rescheduled'].includes(original.status)) {
      return res.status(400).json({ success: false, error: `A ${original.status} appointment cannot be rescheduled` })
    }

    // R6 — you cannot reschedule into the past. Compare on the hospital DAY so a
    // same-day reschedule is still allowed.
    if (startOfDay(appointmentDate) < startOfDay(new Date())) {
      return res.status(400).json({ success: false, error: 'Cannot reschedule to a date in the past' })
    }

    let created
    try {
      created = await db.$transaction(async (tx) => {
      const newAppointment = await tx.appointment.create({
        data: {
          organizationId,
          patientId: original.patientId,
          doctorId: original.doctorId,
          appointmentDate: startOfDay(appointmentDate), // day only — see create()
          appointmentTime,
          appointmentType: original.appointmentType || 'new_patient',
          departmentId: original.departmentId,
          priority: original.priority,
          consultationFee: original.consultationFee,
          chiefComplaint: original.chiefComplaint,
          notes: original.notes,
          status: 'scheduled',
          rescheduledFromId: original.id,
        },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true } },
          doctor: { select: { id: true, fullName: true } },
        },
      })
      await tx.appointment.update({
        where: { id: original.id },
        data: { status: 'rescheduled', rescheduledToId: newAppointment.id },
      })

      // R1 — the old appointment is now 'rescheduled', so it must not keep the
      // patient in the queue. If they were checked in, close that queue row;
      // otherwise the patient stayed 'waiting' on the OLD slot's board and, on
      // checking into the new slot, showed up twice. updateMany = no-op when
      // there's no queue row.
      await tx.queueManagement.updateMany({
        where: { appointmentId: original.id, status: { notIn: ['completed', 'cancelled', 'no_show'] } },
        data: { status: 'rescheduled' },
      })

      // R2 — carry the draft invoice to the NEW appointment so the visit the
      // patient actually attends is the one that's billed. create() attaches a
      // draft invoice to every appointment; without this the invoice stayed on
      // the superseded 'rescheduled' row and the real visit looked unbilled.
      // Only an untouched draft is moved — a real invoice someone has since
      // acted on is left exactly where it is.
      await tx.invoice.updateMany({
        where: { appointmentId: original.id, status: 'draft', paymentStatus: 'unpaid' },
        data: { appointmentId: newAppointment.id },
      })

      return newAppointment
    })
    } catch (err) {
      // R4 — a reschedule onto a slot the doctor already has hits the partial
      // unique index and throws P2002. Translate it to the same clean SLOT_TAKEN
      // the create() path returns, instead of leaking a raw Prisma error.
      const target = String(err.meta?.target || '')
      if (err.code === 'P2002'
        && (target.includes('Appointment_doctor_active_slot_key') || target.includes('appointmentTime'))) {
        return res.status(409).json({
          success: false,
          code: 'SLOT_TAKEN',
          error: `That doctor already has an appointment at ${appointmentTime} on this date. Pick another slot.`,
        })
      }
      throw err
    }

    res.status(201).json({ success: true, data: created, message: 'Appointment rescheduled' })
  } catch (err) {
    next(err)
  }
}

// Update many appointments' status in ONE request (was N separate PATCH calls
// from the browser). Uses updateMany so it's a single DB statement.
export async function bulkUpdateStatus(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { ids, status } = req.validatedBody

    const data = { status }
    if (status === 'checked_in') data.checkedInAt = new Date()
    else if (status === 'in_progress') data.startedAt = new Date()
    else if (status === 'completed') data.completedAt = new Date()
    else if (status === 'cancelled' || status === 'no_show') data.cancelledAt = new Date()

    const where = { id: { in: ids }, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) where.doctorId = myDoctorId

    const result = await db.appointment.updateMany({ where, data })
    res.json({ success: true, count: result.count })
  } catch (err) {
    next(err)
  }
}

export async function remove(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { id } = req.params

    // Scope the delete to this org (and to the doctor's own, if a doctor) —
    // deleteMany lets us filter on non-unique fields.
    const deleteWhere = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) deleteWhere.doctorId = myDoctorId

    const count = await db.$transaction(async (tx) => {
      const appointment = await tx.appointment.findFirst({ where: deleteWhere, select: { id: true } })
      if (!appointment) return 0

      // create() links its auto-voucher invoice to the appointment only via a
      // text note (Invoice has no appointmentId FK) — clean it up here too, but
      // only while it's still untouched (draft + unpaid), so a real invoice a
      // staff member has since acted on is never silently deleted.
      const draftInvoice = await tx.invoice.findFirst({
        where: {
          organizationId,
          status: 'draft',
          paymentStatus: 'unpaid',
          notes: { contains: appointment.id },
        },
        select: { id: true },
      })
      if (draftInvoice) {
        await tx.doctorCommission.deleteMany({ where: { invoiceId: draftInvoice.id } })
        await tx.invoice.delete({ where: { id: draftInvoice.id } })
      }

      const { count } = await tx.appointment.deleteMany({ where: deleteWhere })
      return count
    })

    if (count === 0) {
      return res.status(404).json({ success: false, error: 'Appointment not found' })
    }

    res.json({ success: true, message: 'Appointment deleted' })
  } catch (err) {
    next(err)
  }
}
