import { db } from '../config/db.js'
import { patientSearchWhere } from '../lib/patientSearch.js'
import { dayRange } from '../lib/dates.js'
import { getOrgId, safeMoney } from "../lib/reqContext.js";
import { isOwned } from "../lib/tenant.js";
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'

const patientSelect = { ...PATIENT_NAME_SELECT, mrn: true, phonePrimary: true }

// Generate the next per-org trip number (AM0001, AM0002, ...). The
// @@unique([organizationId, tripNumber]) constraint is the real safety net.
async function nextTripNumber(orgId) {
  const count = await db.ambulanceTrip.count({ where: { organizationId: orgId } })
  return `AM${String(count + 1).padStart(4, '0')}`
}

export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { search, status, type, startDate, endDate } = req.query
    const where = { organizationId: ORG_ID }
    if (status && status !== 'all') where.status = status
    if (type && type !== 'all') where.ambulanceType = type
    // Hospital-timezone day boundaries (see lib/dates.js).
    if (startDate || endDate) {
      where.tripDate = dayRange(startDate, endDate)
    }
    const searchWhere = patientSearchWhere(search, 'patient', (term) => [
      { tripNumber: { contains: term, mode: 'insensitive' } },
      { fromLocation: { contains: term, mode: 'insensitive' } },
      { toLocation: { contains: term, mode: 'insensitive' } },
      { driverName: { contains: term, mode: 'insensitive' } },
    ])
    if (searchWhere) Object.assign(where, searchWhere)
    const trips = await db.ambulanceTrip.findMany({
      where,
      include: { patient: { select: patientSelect } },
      orderBy: { tripDate: 'desc' },
    })
    res.json({ success: true, data: trips })
  } catch (err) {
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const {
      patientId, ambulanceType, fromLocation, toLocation, distanceKm, charge,
      status, tripDate, driverName, vehicleNumber, contactPhone, notes,
    } = req.body

    // Reject negative/non-numeric money before it's stored (mirror of update()).
    const safeDistanceKm = safeMoney(distanceKm, { fallback: null })
    if (safeDistanceKm === null && distanceKm !== '' && distanceKm != null) return res.status(400).json({ success: false, error: 'distanceKm must be a non-negative number' })
    const safeCharge = safeMoney(charge)
    if (safeCharge === null) return res.status(400).json({ success: false, error: 'charge must be a non-negative number' })

    // Only link a patient that actually belongs to this org (FK safety).
    let safePatientId = null
    if (patientId) {
      const p = await db.patient.findFirst({ where: { id: patientId, organizationId: ORG_ID }, select: { id: true } })
      safePatientId = p ? patientId : null
    }

    const tripNumber = await nextTripNumber(ORG_ID)
    const trip = await db.ambulanceTrip.create({
      data: {
        organizationId: ORG_ID,
        tripNumber,
        patientId: safePatientId,
        ambulanceType: ambulanceType || 'BLS',
        fromLocation: fromLocation || null,
        toLocation: toLocation || 'Hospital',
        distanceKm: safeDistanceKm,
        charge: safeCharge,
        status: status || 'completed',
        tripDate: tripDate ? new Date(tripDate) : new Date(),
        driverName: driverName || null,
        vehicleNumber: vehicleNumber || null,
        contactPhone: contactPhone || null,
        notes: notes || null,
        createdById: req.user?.userId || null,
      },
      include: { patient: { select: patientSelect } },
    })
    res.json({ success: true, data: trip })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.body
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })

    // Tenant guard: only touch a trip that belongs to this org (no cross-tenant write).
    if (!(await isOwned('ambulanceTrip', id, ORG_ID))) return res.status(404).json({ success: false, error: 'Ambulance trip not found' })

    const data = {}
    const allowed = ['ambulanceType', 'fromLocation', 'toLocation', 'status', 'driverName', 'vehicleNumber', 'contactPhone', 'notes']
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k] || null
    if (req.body.distanceKm !== undefined) {
      const v = safeMoney(req.body.distanceKm, { fallback: null })
      if (v === null && req.body.distanceKm !== '' && req.body.distanceKm != null) return res.status(400).json({ success: false, error: 'distanceKm must be a non-negative number' })
      data.distanceKm = v
    }
    if (req.body.charge !== undefined) {
      const v = safeMoney(req.body.charge)
      if (v === null) return res.status(400).json({ success: false, error: 'charge must be a non-negative number' })
      data.charge = v
    }
    if (req.body.tripDate !== undefined) data.tripDate = new Date(req.body.tripDate)
    if (req.body.patientId !== undefined) {
      let safePatientId = null
      if (req.body.patientId) {
        const p = await db.patient.findFirst({ where: { id: req.body.patientId, organizationId: ORG_ID }, select: { id: true } })
        safePatientId = p ? req.body.patientId : null
      }
      data.patientId = safePatientId
    }

    const trip = await db.ambulanceTrip.update({
      where: { id },
      data,
      include: { patient: { select: patientSelect } },
    })
    res.json({ success: true, data: trip })
  } catch (err) {
    next(err)
  }
}

export async function remove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.query
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })
    // Tenant-scoped delete: deleteMany with the org filter only removes OUR row.
    const { count } = await db.ambulanceTrip.deleteMany({ where: { id, organizationId: ORG_ID } })
    if (count === 0) return res.status(404).json({ success: false, error: 'Ambulance trip not found' })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}
