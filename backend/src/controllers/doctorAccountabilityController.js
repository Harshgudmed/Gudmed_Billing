import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { scopedDoctorId } from '../utils/scope.js'

export async function handleGet(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource, doctorId, status, period } = req.query

    // A logged-in doctor only ever sees their own accountability data.
    const myDoctorId = scopedDoctorId(req)

    // Parse and validate pagination parameters
    let limit = parseInt(req.query.limit) || 10
    let offset = parseInt(req.query.offset) || 0
    limit = Math.max(1, Math.min(limit, 1000))
    offset = Math.max(0, offset)

    if (resource === 'doctors') {
      const doctors = await db.user.findMany({
        where: { organizationId: ORG_ID, role: 'doctor', isActive: true, ...(myDoctorId ? { id: myDoctorId } : {}) },
        include: {
          department: { select: { id: true, name: true } },
          commissionConfig: true,
        },
        orderBy: { fullName: 'asc' },
      })
      return res.json({ success: true, data: doctors })
    }

    if (resource === 'commissions') {
      const where = {}
      if (doctorId) where.doctorId = doctorId
      if (status) where.status = status
      if (period) where.period = period
      // Force a doctor's own id regardless of any doctorId query param.
      if (myDoctorId) where.doctorId = myDoctorId

      const [commissions, total] = await Promise.all([
        db.doctorCommission.findMany({
          where,
          include: {
            doctor: { select: { id: true, fullName: true } },
            settledBy: { select: { id: true, fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        db.doctorCommission.count({ where }),
      ])

      const hasMore = (offset + limit) < total
      const page = Math.floor(offset / limit) + 1
      const totalPages = Math.ceil(total / limit)

      return res.json({
        success: true,
        data: commissions,
        meta: { total, limit, offset, page, totalPages, hasMore }
      })
    }

    if (resource === 'stats') {
      const doctors = await db.user.findMany({
        where: { organizationId: ORG_ID, role: 'doctor', ...(myDoctorId ? { id: myDoctorId } : {}) }, // a doctor sees only their own stats
        include: {
          commissionConfig: true,
          commissions: true,
        },
      })
      const stats = doctors.map(d => {
        const commissions = d.commissions || []
        const pending = commissions.filter(c => c.status === 'pending')
        const settled = commissions.filter(c => c.status === 'settled')
        return {
          doctorId: d.id,
          doctorName: d.fullName,
          commissionRate: d.commissionConfig?.commissionRate || 0,
          commissionType: d.commissionConfig?.commissionType || 'percentage',
          isActive: d.commissionConfig?.isActive || false,
          totalCommissions: commissions.length,
          pendingCount: pending.length,
          settledCount: settled.length,
          pendingAmount: pending.reduce((s, c) => s + (c.commissionAmount || 0), 0),
          settledAmount: settled.reduce((s, c) => s + (c.commissionAmount || 0), 0),
          totalInvoiceAmount: commissions.reduce((s, c) => s + (c.invoiceAmount || 0), 0),
        }
      })
      return res.json({ success: true, data: stats })
    }

    if (resource === 'timetable') {
      const targetDoctorId = myDoctorId || doctorId
      if (!targetDoctorId) {
        return res.status(400).json({ success: false, error: 'Doctor ID is required' })
      }
      const doctor = await db.user.findUnique({
        where: { id: targetDoctorId, organizationId: ORG_ID },
        select: { id: true, fullName: true, preferences: true }
      })
      if (!doctor) {
        return res.status(404).json({ success: false, error: 'Doctor not found' })
      }
      let prefs = {}
      try {
        if (doctor.preferences) prefs = JSON.parse(doctor.preferences)
      } catch (e) {}
      
      const timetable = prefs.timetable || {
        weeklySlots: {
          Monday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Tuesday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Wednesday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Thursday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Friday: { active: true, shifts: [{ start: '09:00', end: '17:00' }] },
          Saturday: { active: false, shifts: [] },
          Sunday: { active: false, shifts: [] }
        },
        exceptions: [],
        slotDuration: 15,
        maxPatientsPerDay: 30
      }
      return res.json({ success: true, data: { doctorId: doctor.id, fullName: doctor.fullName, timetable } })
    }

    res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (err) {
    next(err)
  }
}

export async function handlePost(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource } = req.query

    if (resource === 'config') {
      const { doctorId, commissionType, commissionRate, isActive, notes, consultationFee, followUpDays } = req.body

      // Persist the doctor's appointment fee + free follow-up window on the user record
      const userData = {}
      if (consultationFee !== undefined) {
        userData.consultationFee = consultationFee === '' || consultationFee === null ? null : parseFloat(consultationFee)
      }
      if (followUpDays !== undefined) {
        userData.followUpDays = followUpDays === '' || followUpDays === null ? null : parseInt(followUpDays)
      }
      if (Object.keys(userData).length) {
        // Scope to this org — only update a doctor that belongs to the caller's org
        await db.user.updateMany({ where: { id: doctorId, organizationId: ORG_ID }, data: userData })
      }

      const existing = await db.doctorCommissionConfig.findUnique({ where: { doctorId } })
      let config
      if (existing) {
        config = await db.doctorCommissionConfig.update({
          where: { doctorId },
          data: { commissionType, commissionRate: parseFloat(commissionRate) || 0, isActive, notes: notes || null },
        })
      } else {
        config = await db.doctorCommissionConfig.create({
          data: { organizationId: ORG_ID, doctorId, commissionType, commissionRate: parseFloat(commissionRate) || 0, isActive, notes: notes || null },
        })
      }
      return res.json({ success: true, data: config })
    }

    if (resource === 'commission') {
      const { doctorId, invoiceId, invoiceAmount, commissionRate, commissionType, commissionAmount } = req.body
      const commission = await db.doctorCommission.create({
        data: {
          organizationId: ORG_ID,
          doctorId,
          invoiceId: invoiceId || null,
          invoiceAmount: parseFloat(invoiceAmount) || 0,
          commissionRate: parseFloat(commissionRate) || 0,
          commissionType,
          commissionAmount: parseFloat(commissionAmount) || 0,
          status: 'pending',
        },
        include: {
          doctor: { select: { id: true, fullName: true } },
        },
      })
      return res.json({ success: true, data: commission })
    }


    if (resource === 'timetable') {
      const { doctorId, timetable } = req.body
      const targetDoctorId = doctorId
      if (!targetDoctorId) {
        return res.status(400).json({ success: false, error: 'Doctor ID is required' })
      }
      const doctor = await db.user.findUnique({
        where: { id: targetDoctorId, organizationId: ORG_ID }
      })
      if (!doctor) {
        return res.status(404).json({ success: false, error: 'Doctor not found' })
      }
      let prefs = {}
      try {
        if (doctor.preferences) prefs = JSON.parse(doctor.preferences)
      } catch (e) {}
      
      prefs.timetable = timetable
      
      const updated = await db.user.update({
        where: { id: targetDoctorId },
        data: { preferences: JSON.stringify(prefs) },
        select: { id: true, fullName: true, preferences: true }
      })
      return res.json({ success: true, message: 'Timetable updated successfully', data: updated })
    }

    res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (err) {
    next(err)
  }
}

export async function handlePatch(req, res, next) {
  try {
    const { resource } = req.query

    if (resource === 'settle') {
      const { commissionIds, settlementNote, settlementRef } = req.body
      await db.doctorCommission.updateMany({
        where: { id: { in: commissionIds }, status: 'pending' },
        data: {
          status: 'settled',
          settledAt: new Date(),
          settlementNote: settlementNote || null,
          settlementRef: settlementRef || null,
        },
      })
      return res.json({ success: true, message: `${commissionIds.length} commission(s) settled successfully` })
    }

    res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (err) {
    next(err)
  }
}

export async function handleDelete(req, res, next) {
  try {
    const { resource, id } = req.query
    if (resource === 'commission') {
      await db.doctorCommission.delete({ where: { id } })
      return res.json({ success: true })
    }
    res.status(400).json({ success: false, error: 'Unknown resource' })
  } catch (err) {
    next(err)
  }
}
