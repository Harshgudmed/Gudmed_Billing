import { db } from '../config/db.js'
import { dayRange, todayRange } from '../lib/dates.js'
import { getOrgId, safeMoney } from "../lib/reqContext.js";
import { isOwned } from "../lib/tenant.js";

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
    // Hospital-timezone day boundaries (see lib/dates.js) — the server's own
    // timezone must not decide where a day starts.
    if (startDate || endDate) {
      where.admissionDate = dayRange(startDate, endDate)
    } else if (req.query.today === 'true') {
      where.admissionDate = todayRange()
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

    // Reject negative / NaN money before it poisons stored totals.
    const feeVal = safeMoney(fee)
    const paidVal = safeMoney(amountPaid)
    if (feeVal === null || paidVal === null) return res.status(400).json({ success: false, error: 'fee and amountPaid must be non-negative numbers' })

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
        fee: feeVal,
        paymentStatus: paymentStatus || 'pending',
        amountPaid: paidVal,
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
    if (!(await isOwned('dayCareCase', id, ORG_ID))) return res.status(404).json({ success: false, error: 'Day-care case not found' })

    const data = {}
    const allowed = ['procedure', 'dischargeTime', 'paymentStatus', 'status', 'notes']
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k] || null
    if (req.body.fee !== undefined) {
      const v = safeMoney(req.body.fee)
      if (v === null) return res.status(400).json({ success: false, error: 'fee must be a non-negative number' })
      data.fee = v
    }
    if (req.body.amountPaid !== undefined) {
      const v = safeMoney(req.body.amountPaid)
      if (v === null) return res.status(400).json({ success: false, error: 'amountPaid must be a non-negative number' })
      data.amountPaid = v
    }
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
