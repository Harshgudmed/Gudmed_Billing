import { db } from '../config/db.js'
import { nextSeriesNumber } from '../lib/counters.js'
import { patientSearchWhere } from '../lib/patientSearch.js'
import { dayRange } from '../lib/dates.js'
import { getOrgId, safeMoney } from "../lib/reqContext.js";
import { PATIENT_NAME_SELECT } from '../lib/patientName.js'
import { billsOfRecords, invoiceOfOrder, orderCancelCheck, changeRecordCharge, withBill, refusalError } from '../lib/invoiceFulfillment.js'

const patientSelect = { ...PATIENT_NAME_SELECT, mrn: true, phonePrimary: true }

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
    // Each trip's money is read off its bill (lib/invoiceFulfillment.js).
    const bills = await billsOfRecords(db, ORG_ID, 'ambulance', trips.map((t) => t.tripNumber))
    res.json({ success: true, data: trips.map((t) => withBill(t, bills.get(t.tripNumber))) })
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

    const trip = await db.$transaction(async (tx) => {
      const tripNumber = await nextSeriesNumber(tx, ORG_ID, 'AMBULANCE_TRIP', 'AM')
      return tx.ambulanceTrip.create({
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
    })
    // The screen raises the trip's bill next (src/lib/billing.js createInvoiceWithPayment).
    res.json({ success: true, data: withBill(trip, null) })
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
    const existing = await db.ambulanceTrip.findFirst({ where: { id, organizationId: ORG_ID }, select: { tripNumber: true, charge: true, status: true, patientId: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Ambulance trip not found' })

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

    const cancelling = data.status === 'cancelled' && existing.status !== 'cancelled'
    const reopening = existing.status === 'cancelled' && data.status && data.status !== 'cancelled'
    const chargeChanged = data.charge !== undefined && data.charge !== Number(existing.charge)
    const patientChanged = data.patientId !== undefined && data.patientId !== existing.patientId
    const trip = await db.$transaction(async (tx) => {
      const bill = await invoiceOfOrder(tx, ORG_ID, 'ambulance', existing.tripNumber)
      // A bill belongs to one patient; it is not moved to another one here.
      if (patientChanged && bill && bill.status !== 'cancelled') {
        throw refusalError({ title: 'Billed', error: `This trip is billed on ${bill.invoiceNumber} to its patient, so the patient can no longer be changed. Cancel the trip (or its bill in Billing) and log a new one.` })
      }
      if (reopening && bill) {
        throw refusalError({ title: 'Cancelled', error: 'This trip was cancelled together with its bill. Log a new trip instead.' })
      }
      if (cancelling) {
        // The lab order's rule (lib/invoiceFulfillment.js orderCancelCheck).
        const check = await orderCancelCheck(tx, ORG_ID, 'ambulance', existing.tripNumber)
        if (check.refusal) throw refusalError(check.refusal)
        if (check.cancelBill) {
          await tx.invoice.updateMany({
            where: { id: check.cancelBill.id, organizationId: ORG_ID, amountPaid: { lte: 0 }, status: { not: 'cancelled' } },
            data: { status: 'cancelled', paymentStatus: 'cancelled', cancelledAt: new Date(), cancellationReason: `Ambulance trip ${existing.tripNumber} cancelled` },
          })
        }
      } else if (chargeChanged) {
        const change = await changeRecordCharge(tx, { organizationId: ORG_ID, kind: 'ambulance', number: existing.tripNumber, charge: data.charge })
        if (change.refusal) throw refusalError(change.refusal)
      }
      const updated = await tx.ambulanceTrip.update({
        where: { id },
        data,
        include: { patient: { select: patientSelect } },
      })
      return withBill(updated, await invoiceOfOrder(tx, ORG_ID, 'ambulance', existing.tripNumber))
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
    const existing = await db.ambulanceTrip.findFirst({ where: { id, organizationId: ORG_ID }, select: { tripNumber: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Ambulance trip not found' })
    // A billed trip is not deleted out from under its bill; it is cancelled instead.
    const bill = await invoiceOfOrder(db, ORG_ID, 'ambulance', existing.tripNumber)
    if (bill && bill.status !== 'cancelled') {
      return res.status(409).json({ success: false, error: `This trip is billed on ${bill.invoiceNumber}. Set it to Cancelled instead — an unpaid bill is cancelled with it; a paid one is cancelled in Billing with "Cancel & refund".` })
    }
    // Tenant-scoped delete: deleteMany with the org filter only removes OUR row.
    const { count } = await db.ambulanceTrip.deleteMany({ where: { id, organizationId: ORG_ID } })
    if (count === 0) return res.status(404).json({ success: false, error: 'Ambulance trip not found' })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}
