import { db } from '../config/db.js'
import { getOrgId, safeMoney } from "../lib/reqContext.js";

const patientSelect = { id: true, firstName: true, middleName: true, lastName: true, mrn: true, phonePrimary: true }

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
    if (startDate || endDate) {
      where.tripDate = {}
      if (startDate) where.tripDate.gte = new Date(`${startDate}T00:00:00`)
      if (endDate) where.tripDate.lte = new Date(`${endDate}T23:59:59.999`)
    }
    if (search) {
      where.OR = [
        { tripNumber: { contains: search, mode: 'insensitive' } },
        { fromLocation: { contains: search, mode: 'insensitive' } },
        { toLocation: { contains: search, mode: 'insensitive' } },
        { driverName: { contains: search, mode: 'insensitive' } },
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { mrn: { contains: search, mode: 'insensitive' } } },
      ]
    }
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
        distanceKm: distanceKm != null && distanceKm !== '' ? Number(distanceKm) : null,
        charge: charge != null && charge !== '' ? Number(charge) : 0,
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
    const owned = await db.ambulanceTrip.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!owned) return res.status(404).json({ success: false, error: 'Ambulance trip not found' })

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
