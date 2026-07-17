import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { computeConsultationFee } from '../services/appointmentFees.js'

/**
 * Get all fee slabs for a doctor or organization
 * Query params: doctorId (optional), organizationId (required via req.organizationId)
 */
export async function getSlabs(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { doctorId } = req.query

    const where = { organizationId: ORG_ID }
    if (doctorId) where.doctorId = doctorId

    const slabs = await db.doctorFeeSlab.findMany({
      where,
      include: {
        doctor: { select: { id: true, fullName: true, specialization: true } },
      },
      orderBy: [{ doctorId: 'asc' }, { fromDays: 'asc' }],
    })

    res.json({ success: true, data: slabs })
  } catch (err) {
    next(err)
  }
}

/**
 * Create a new fee slab for a doctor
 * Body: { doctorId, fromDays, toDays, feeAmount, isActive, notes }
 */
export async function createSlab(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { doctorId, fromDays, toDays, feeAmount, isActive, notes } = req.body

    // Validate inputs
    if (!doctorId || fromDays === undefined || toDays === undefined || feeAmount === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields' })
    }

    // Money and day-counts can never be negative. Without this, feeAmount:-100
    // flowed end-to-end into a negative invoice + negative commission — every
    // follow-up turned into a credit note.
    if (Number(feeAmount) < 0) {
      return res.status(400).json({ success: false, error: 'feeAmount cannot be negative' })
    }
    if (Number(fromDays) < 0 || Number(toDays) < 0) {
      return res.status(400).json({ success: false, error: 'fromDays and toDays cannot be negative' })
    }

    if (fromDays >= toDays) {
      return res.status(400).json({ success: false, error: 'fromDays must be less than toDays' })
    }

    // Verify doctor belongs to this org
    const doctor = await db.user.findFirst({
      where: { id: doctorId, organizationId: ORG_ID, role: 'doctor' },
    })

    if (!doctor) {
      return res.status(404).json({ success: false, error: 'Doctor not found' })
    }

    // Check for overlapping slabs
    const overlap = await db.doctorFeeSlab.findFirst({
      where: {
        doctorId,
        organizationId: ORG_ID,
        OR: [
          { fromDays: { lt: toDays }, toDays: { gt: fromDays } },
        ],
      },
    })

    if (overlap) {
      return res.status(400).json({
        success: false,
        error: `Overlapping slab found: ${overlap.fromDays}-${overlap.toDays} days`,
      })
    }

    const slab = await db.doctorFeeSlab.create({
      data: {
        organizationId: ORG_ID,
        doctorId,
        fromDays: parseInt(fromDays),
        toDays: parseInt(toDays),
        feeAmount: parseFloat(feeAmount),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        notes: notes || null,
      },
      include: {
        doctor: { select: { id: true, fullName: true } },
      },
    })

    res.status(201).json({ success: true, data: slab, message: 'Fee slab created successfully' })
  } catch (err) {
    next(err)
  }
}

/**
 * Update an existing fee slab
 * Params: id
 * Body: { fromDays?, toDays?, feeAmount?, isActive?, notes? }
 */
export async function updateSlab(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params
    const { fromDays, toDays, feeAmount, isActive, notes } = req.body

    // Verify slab belongs to this org
    const existing = await db.doctorFeeSlab.findFirst({
      where: { id, organizationId: ORG_ID },
    })

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Fee slab not found' })
    }

    const newFromDays = fromDays !== undefined ? parseInt(fromDays) : existing.fromDays
    const newToDays = toDays !== undefined ? parseInt(toDays) : existing.toDays

    if (newFromDays >= newToDays) {
      return res.status(400).json({ success: false, error: 'fromDays must be less than toDays' })
    }

    // Check for overlapping slabs (excluding current slab)
    const overlap = await db.doctorFeeSlab.findFirst({
      where: {
        doctorId: existing.doctorId,
        organizationId: ORG_ID,
        id: { not: id },
        OR: [
          { fromDays: { lt: newToDays }, toDays: { gt: newFromDays } },
        ],
      },
    })

    if (overlap) {
      return res.status(400).json({
        success: false,
        error: `Overlapping slab found: ${overlap.fromDays}-${overlap.toDays} days`,
      })
    }

    const data = {}
    if (fromDays !== undefined) data.fromDays = newFromDays
    if (toDays !== undefined) data.toDays = newToDays
    if (feeAmount !== undefined) data.feeAmount = parseFloat(feeAmount)
    if (isActive !== undefined) data.isActive = Boolean(isActive)
    if (notes !== undefined) data.notes = notes || null

    const slab = await db.doctorFeeSlab.update({
      where: { id },
      data,
      include: {
        doctor: { select: { id: true, fullName: true } },
      },
    })

    res.json({ success: true, data: slab, message: 'Fee slab updated successfully' })
  } catch (err) {
    next(err)
  }
}

/**
 * Delete a fee slab
 * Params: id
 */
export async function deleteSlab(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.params

    // Verify slab belongs to this org
    const slab = await db.doctorFeeSlab.findFirst({
      where: { id, organizationId: ORG_ID },
    })

    if (!slab) {
      return res.status(404).json({ success: false, error: 'Fee slab not found' })
    }

    await db.doctorFeeSlab.delete({ where: { id } })

    res.json({ success: true, message: 'Fee slab deleted successfully' })
  } catch (err) {
    next(err)
  }
}

/**
 * Calculate applicable fee for a patient's next appointment with a doctor
 * Query params: doctorId, patientId
 * Returns: { fee, daysSinceLastVisit, appliedSlab }
 */
export async function calculateFee(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { doctorId, patientId, date } = req.query

    if (!doctorId || !patientId) {
      return res.status(400).json({ success: false, error: 'doctorId and patientId required' })
    }

    // Shared with the booking endpoint so the preview always matches the charge.
    const result = await computeConsultationFee({
      organizationId: ORG_ID,
      doctorId,
      patientId,
      date,
    })
    if (result.doctorMissing) {
      return res.status(404).json({ success: false, error: 'Doctor not found' })
    }

    // Map the canonical result to this endpoint's existing response shape.
    let appliedSlab
    if (result.reason === 'slab') {
      appliedSlab = {
        id: result.slab.id,
        fromDays: result.slab.fromDays,
        toDays: result.slab.toDays,
        feeAmount: result.slab.feeAmount,
      }
    } else if (result.reason === 'reset') {
      appliedSlab = { type: 'new_patient', reason: 'More than 30 days since last visit' }
    } else if (result.reason === 'default') {
      appliedSlab = { type: 'default', reason: 'No matching slab found' }
    } else {
      appliedSlab = { type: 'new_patient', reason: 'First appointment' }
    }

    res.json({
      success: true,
      data: {
        fee: result.fee,
        daysSinceLastVisit: result.daysSinceLastVisit,
        appliedSlab,
        isNewPatient: result.isNewPatient,
      },
    })
  } catch (err) {
    next(err)
  }
}
