import { db } from '../config/db.js'
import { Prisma } from '@prisma/client'
import { getOrgId } from "../lib/reqContext.js";
import { startOfDay, endOfDay } from '../utils/dates.js'
import { scopedDoctorId } from '../utils/scope.js'
import { computeConsultationFee } from '../services/appointmentFees.js'

export async function getAll(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { date, dateFrom, dateTo, status, doctorId, patientId, department, search } = req.query
    const limit = Math.min(parseInt(req.query.limit || '50'), 1000) // hard cap
    const offset = parseInt(req.query.offset || '0')

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
    const day = req.query.date || new Date().toISOString()
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

    const apptDate = new Date(validatedData.appointmentDate)
    let consultationFee = null
    let appliedSlabInfo = null

    // If frontend sends consultationFee (from OPD service selection), use it directly
    if (validatedData.consultationFee !== null && validatedData.consultationFee !== undefined && validatedData.consultationFee !== '') {
      consultationFee = parseFloat(validatedData.consultationFee)
      appliedSlabInfo = { type: 'opd_service_selected' }
    } else if (validatedData.doctorId) {
      // Otherwise, derive the fee from the doctor's slabs (shared with the preview endpoint)
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

    // Create appointment, invoice, AND commission in transaction
    const { appointment, draftInvoiceNumber, commission } = await db.$transaction(async (tx) => {
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
      const description = opdService?.serviceName ?? `${aptType} Consultation`
      const invoiceNumber = `INV${Date.now()}`

      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          patientId: validatedData.patientId,
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

        if (commissionConfig && commissionConfig.isActive && unitPrice > 0) {
          const commissionAmount = commissionConfig.commissionType === 'percentage'
            ? (unitPrice * commissionConfig.commissionRate) / 100
            : commissionConfig.commissionRate

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

      return { appointment, draftInvoiceNumber: invoice.invoiceNumber, commission }
    })

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
    const body = req.body

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
    if (body.appointmentDate    !== undefined) updates.appointmentDate    = body.appointmentDate
    if (body.appointmentTime    !== undefined) updates.appointmentTime    = body.appointmentTime
    if (body.appointmentType    !== undefined) updates.appointmentType    = body.appointmentType
    if (body.doctorId           !== undefined) updates.doctorId           = body.doctorId
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

    const appointment = await db.appointment.update({
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
    const { appointmentDate, appointmentTime } = req.body

    if (!appointmentDate || !appointmentTime) {
      return res.status(400).json({ success: false, error: 'appointmentDate and appointmentTime are required' })
    }

    const scopeWhere = { id, organizationId }
    const myDoctorId = scopedDoctorId(req)
    if (myDoctorId) scopeWhere.doctorId = myDoctorId
    const original = await db.appointment.findFirst({ where: scopeWhere })
    if (!original) {
      return res.status(404).json({ success: false, error: 'Appointment not found' })
    }

    const created = await db.$transaction(async (tx) => {
      const newAppointment = await tx.appointment.create({
        data: {
          organizationId,
          patientId: original.patientId,
          doctorId: original.doctorId,
          appointmentDate: new Date(appointmentDate),
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
      return newAppointment
    })

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
    const { ids, status } = req.body
    if (!Array.isArray(ids) || ids.length === 0 || !status) {
      return res.status(400).json({ success: false, error: 'ids[] and status are required' })
    }

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
    const { count } = await db.appointment.deleteMany({ where: deleteWhere })
    if (count === 0) {
      return res.status(404).json({ success: false, error: 'Appointment not found' })
    }

    res.json({ success: true, message: 'Appointment deleted' })
  } catch (err) {
    next(err)
  }
}
