import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";

const patientSelect = { id: true, firstName: true, middleName: true, lastName: true, mrn: true, phonePrimary: true }

async function nextCaseNumber(orgId) {
  const count = await db.dayCareCase.count({ where: { organizationId: orgId } })
  return `DC${String(count + 1).padStart(4, '0')}`
}

export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { search, status, startDate, endDate } = req.query
    const where = { organizationId: ORG_ID }
    if (status && status !== 'all') where.status = status
    if (startDate || endDate) {
      where.admissionDate = {}
      if (startDate) where.admissionDate.gte = new Date(`${startDate}T00:00:00`)
      if (endDate) where.admissionDate.lte = new Date(`${endDate}T23:59:59.999`)
    } else if (req.query.today === 'true') {
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end = new Date(); end.setHours(23, 59, 59, 999)
      where.admissionDate = { gte: start, lte: end }
    }
    if (search) {
      where.OR = [
        { caseNumber: { contains: search, mode: 'insensitive' } },
        { procedure: { contains: search, mode: 'insensitive' } },
        { doctorName: { contains: search, mode: 'insensitive' } },
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { mrn: { contains: search, mode: 'insensitive' } } },
      ]
    }
    const cases = await db.dayCareCase.findMany({
      where,
      include: {
        patient: { select: patientSelect },
        doctor: { select: { id: true, fullName: true } },
      },
      orderBy: { admissionDate: 'desc' },
    })
    res.json({ success: true, data: cases })
  } catch (err) {
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const {
      patientId, doctorId, procedure, admissionDate, dischargeTime,
      fee, paymentStatus, amountPaid, status, notes,
    } = req.body

    if (!patientId) return res.status(400).json({ success: false, error: 'patientId is required' })
    const patient = await db.patient.findFirst({ where: { id: patientId, organizationId: ORG_ID }, select: { id: true } })
    if (!patient) return res.status(400).json({ success: false, error: 'Patient not found in this organization' })

    // Snapshot the doctor name; only link the FK if the user exists in this org.
    let safeDoctorId = null
    let doctorName = req.body.doctorName || null
    if (doctorId) {
      const doc = await db.user.findFirst({ where: { id: doctorId, organizationId: ORG_ID }, select: { id: true, fullName: true } })
      if (doc) { safeDoctorId = doc.id; doctorName = doc.fullName }
    }

    const caseNumber = await nextCaseNumber(ORG_ID)
    const dayCase = await db.dayCareCase.create({
      data: {
        organizationId: ORG_ID,
        caseNumber,
        patientId,
        doctorId: safeDoctorId,
        doctorName,
        procedure: procedure || null,
        admissionDate: admissionDate ? new Date(admissionDate) : new Date(),
        dischargeTime: dischargeTime || null,
        fee: fee != null && fee !== '' ? Number(fee) : 0,
        paymentStatus: paymentStatus || 'pending',
        amountPaid: amountPaid != null && amountPaid !== '' ? Number(amountPaid) : 0,
        status: status || 'admitted',
        notes: notes || null,
        createdById: req.user?.userId || null,
      },
      include: {
        patient: { select: patientSelect },
        doctor: { select: { id: true, fullName: true } },
      },
    })
    res.json({ success: true, data: dayCase })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.body
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })

    // Tenant guard: only touch a case that belongs to this org (no cross-tenant write).
    const owned = await db.dayCareCase.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!owned) return res.status(404).json({ success: false, error: 'Day-care case not found' })

    const data = {}
    const allowed = ['procedure', 'dischargeTime', 'paymentStatus', 'status', 'notes']
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k] || null
    if (req.body.fee !== undefined) data.fee = req.body.fee === '' || req.body.fee == null ? 0 : Number(req.body.fee)
    if (req.body.amountPaid !== undefined) data.amountPaid = req.body.amountPaid === '' || req.body.amountPaid == null ? 0 : Number(req.body.amountPaid)
    if (req.body.admissionDate !== undefined) data.admissionDate = new Date(req.body.admissionDate)
    if (req.body.doctorId !== undefined) {
      let safeDoctorId = null, doctorName = null
      if (req.body.doctorId) {
        const doc = await db.user.findFirst({ where: { id: req.body.doctorId, organizationId: ORG_ID }, select: { id: true, fullName: true } })
        if (doc) { safeDoctorId = doc.id; doctorName = doc.fullName }
      }
      data.doctorId = safeDoctorId
      data.doctorName = doctorName
    }

    const dayCase = await db.dayCareCase.update({
      where: { id },
      data,
      include: {
        patient: { select: patientSelect },
        doctor: { select: { id: true, fullName: true } },
      },
    })
    res.json({ success: true, data: dayCase })
  } catch (err) {
    next(err)
  }
}

export async function remove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.query
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })
    const { count } = await db.dayCareCase.deleteMany({ where: { id, organizationId: ORG_ID } })
    if (count === 0) return res.status(404).json({ success: false, error: 'Day-care case not found' })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}
