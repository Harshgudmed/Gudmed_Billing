import { db } from '../../config/db.js'
import { getOrgId } from "../../lib/reqContext.js";
import { createPrescriptionSchema, updatePrescriptionSchema } from '../validations/prescription.validation.js'
import { getPagination, paginationMeta, handleServiceError, makeError } from '../utils.js'
import { recordStockChange, consumeFromBatches, findShortages, insufficientStockError } from '../stockService.js'

const SORTABLE_FIELDS = ['prescriptionDate', 'status', 'createdAt']

const PATIENT_SELECT = { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true }
const DOCTOR_SELECT  = { id: true, fullName: true }

export async function list(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { status, patientId, doctorId, sortBy, sortOrder } = req.query
    const { page, limit, skip } = getPagination(req.query)

    const where = { organizationId: ORGANIZATION_ID }
    if (status) where.status = status
    if (patientId) where.patientId = patientId
    if (doctorId) where.doctorId = doctorId

    const orderBy = SORTABLE_FIELDS.includes(sortBy)
      ? { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' }
      : { createdAt: 'desc' }

    const [data, total] = await Promise.all([
      db.prescription.findMany({
        where,
        include: {
          patient: { select: PATIENT_SELECT },
          doctor: { select: DOCTOR_SELECT },
        },
        orderBy,
        skip,
        take: limit,
      }),
      db.prescription.count({ where }),
    ])

    res.json({ success: true, data, pagination: paginationMeta(page, limit, total) })
  } catch (err) {
    next(err)
  }
}

export async function getById(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const prescription = await db.prescription.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
      include: {
        patient: { select: PATIENT_SELECT },
        doctor: { select: DOCTOR_SELECT },
      },
    })
    if (!prescription) throw makeError('Prescription not found', 404, 'PRESCRIPTION_NOT_FOUND')
    res.json({ success: true, data: prescription })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = createPrescriptionSchema.parse(req.body)

    const data = await db.prescription.create({
      data: {
        organizationId: ORGANIZATION_ID,
        patientId: parsed.patientId,
        doctorId: parsed.doctorId,
        consultationId: parsed.consultationId ?? undefined,
        items: JSON.stringify(parsed.items),
        notes: parsed.notes ?? undefined,
        status: 'pending',
      },
    })

    res.status(201).json({ success: true, data, message: 'Prescription created successfully' })
  } catch (err) {
    next(err)
  }
}

// POST /pharmacy/prescriptions/:id/dispense
// Stock-aware dispensing: validates every item against available stock, then
// decrements drug stock + batches (FIFO) and writes a StockLedger row per item.
//   - Default: BLOCK with 422 INSUFFICIENT_STOCK if any item is short.
//   - body { allowPartial: true }: dispense what's available, mark partially_dispensed.
export async function dispense(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const allowPartial = req.body?.allowPartial === true
    const createdById = req.user?.userId ?? null

    const result = await db.$transaction(async (tx) => {
      const rx = await tx.prescription.findFirst({
        where: { id: req.params.id, organizationId: ORGANIZATION_ID },
      })
      if (!rx) throw makeError('Prescription not found', 404, 'PRESCRIPTION_NOT_FOUND')
      if (rx.status === 'fully_dispensed') {
        throw makeError('Prescription already fully dispensed', 409, 'ALREADY_DISPENSED')
      }

      let items = []
      try { items = JSON.parse(rx.items || '[]') } catch { items = [] }
      // Only items linked to a real drug affect stock; free-text lines are label-only.
      const stockItems = items.filter((i) => i.drugId && Number(i.quantity) > 0)

      const shortages = await findShortages(tx, { organizationId: ORGANIZATION_ID, items: stockItems })
      if (shortages.length && !allowPartial) {
        throw insufficientStockError(shortages)
      }

      // Re-read available quantities for partial clamping.
      const drugs = await tx.pharmacyDrug.findMany({
        where: { id: { in: stockItems.map((i) => i.drugId) }, organizationId: ORGANIZATION_ID },
        select: { id: true, quantityInStock: true },
      })
      const availById = new Map(drugs.map((d) => [d.id, d.quantityInStock]))

      let partial = false
      for (const it of stockItems) {
        const available = availById.get(it.drugId) ?? 0
        const qty = allowPartial ? Math.min(it.quantity, available) : it.quantity
        if (qty < it.quantity) partial = true
        if (qty <= 0) continue
        await consumeFromBatches(tx, { drugId: it.drugId, quantity: qty })
        await recordStockChange(tx, {
          organizationId: ORGANIZATION_ID,
          drugId: it.drugId,
          changeType: 'dispense',
          quantityDelta: -qty,
          reference: rx.id,
          note: `Dispensed from prescription ${rx.id}`,
          createdById,
        })
      }

      const status = partial ? 'partially_dispensed' : 'fully_dispensed'
      const updated = await tx.prescription.update({
        where: { id: rx.id },
        data: { status, dispensedById: createdById ?? undefined, dispensedAt: new Date() },
      })
      return { prescription: updated, status, shortages }
    })

    res.json({
      success: true,
      data: result.prescription,
      status: result.status,
      shortages: result.shortages,
      message: result.status === 'partially_dispensed' ? 'Partially dispensed (limited stock)' : 'Dispensed successfully',
    })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = updatePrescriptionSchema.parse(req.body)

    const existing = await db.prescription.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
    })
    if (!existing) throw makeError('Prescription not found', 404, 'PRESCRIPTION_NOT_FOUND')

    const updateData = { ...parsed }
    if (updateData.dispensedAt) updateData.dispensedAt = new Date(updateData.dispensedAt)
    if (updateData.items && Array.isArray(updateData.items)) {
      updateData.items = JSON.stringify(updateData.items)
    }

    const data = await db.prescription.update({ where: { id: req.params.id }, data: updateData })
    res.json({ success: true, data, message: 'Prescription updated successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}
