import { db } from '../../config/db.js'
import { getOrgId, safeMoney } from "../../lib/reqContext.js";
import { dayRange } from '../../lib/dates.js'
import { createSaleSchema } from '../validations/sale.validation.js'
import { getPagination, paginationMeta, handleServiceError, makeError } from '../utils.js'
import { recordStockChange, consumeFromBatches } from '../stockService.js'
import { getPatientSnapshot } from '../../utils/patientSnapshot.js'
import { nextSeriesNumber } from '../../lib/counters.js'
import { PATIENT_NAME_SELECT } from '../../lib/patientName.js'

const SORTABLE_FIELDS = ['saleDate', 'totalAmount', 'paymentStatus', 'createdAt']

export async function list(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { startDate, endDate, patientId, paymentStatus, sortBy, sortOrder } = req.query
    const { page, limit, skip } = getPagination(req.query)

    const where = { organizationId: ORGANIZATION_ID }
    if (patientId) where.patientId = patientId
    if (paymentStatus) where.paymentStatus = paymentStatus
    // Whole calendar days in the HOSPITAL's timezone (see lib/dates.js) — the old
    // parse used the server's, so prod (UTC) and dev (IST) disagreed by 5h30m.
    if (startDate || endDate) {
      where.createdAt = dayRange(startDate, endDate)
    }

    const orderBy = SORTABLE_FIELDS.includes(sortBy)
      ? { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' }
      : { createdAt: 'desc' }

    const [data, total, sumAgg] = await Promise.all([
      db.pharmacySale.findMany({
        where,
        include: {
          patient: { select: { ...PATIENT_NAME_SELECT, } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      db.pharmacySale.count({ where }),
      // Sum across the WHOLE filtered set (not just this page) so the UI can show
      // the period's true revenue even though it only loads one page of rows.
      db.pharmacySale.aggregate({ where, _sum: { totalAmount: true } }),
    ])

    res.json({
      success: true,
      data,
      pagination: paginationMeta(page, limit, total),
      summary: { totalAmount: sumAgg._sum.totalAmount ?? 0, totalCount: total },
    })
  } catch (err) {
    next(err)
  }
}

export async function getById(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const sale = await db.pharmacySale.findFirst({
      where: { id: req.params.id, organizationId: ORGANIZATION_ID },
      include: {
        patient: { select: { ...PATIENT_NAME_SELECT, } },
      },
    })
    if (!sale) throw makeError('Sale not found', 404, 'SALE_NOT_FOUND')
    res.json({ success: true, data: sale })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const parsed = createSaleSchema.parse(req.body)

    const data = await db.$transaction(async (tx) => {
      // Validate stock for every item before any write
      const drugsById = new Map()
      for (const item of parsed.items) {
        const drug = await tx.pharmacyDrug.findFirst({
          where: { id: item.drugId, organizationId: ORGANIZATION_ID },
          select: { id: true, drugName: true, quantityInStock: true, gstRate: true },
        })
        if (!drug) {
          throw makeError(`Drug not found: ${item.drugId}`, 404, 'DRUG_NOT_FOUND')
        }
        if (drug.quantityInStock < item.quantity) {
          throw makeError(
            `Insufficient stock for "${drug.drugName}": requested ${item.quantity}, available ${drug.quantityInStock}`,
            422,
            'INSUFFICIENT_STOCK',
            { drugName: drug.drugName, requested: item.quantity, available: drug.quantityInStock }
          )
        }
        drugsById.set(item.drugId, drug)
      }

      // MONEY SAFETY: compute the totals and validate the discount BEFORE any
      // stock mutation, so a bad discount can never decrement inventory or store
      // a negative total. Reject a discount that is negative, non-numeric, or
      // greater than the subtotal (which would drive totalAmount below 0).
      const subtotal = parsed.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      const discountAmount = safeMoney(parsed.discountAmount)
      if (discountAmount === null) {
        throw makeError('Discount amount must be a non-negative number', 400, 'INVALID_DISCOUNT')
      }
      if (discountAmount > subtotal) {
        throw makeError(
          `Discount (${discountAmount}) cannot exceed subtotal (${subtotal})`,
          400,
          'DISCOUNT_EXCEEDS_SUBTOTAL',
          { subtotal, discountAmount }
        )
      }
      const totalAmount = subtotal - discountAmount

      // Decrement stock for each item — batches FIFO + ledger row (single source of
      // truth) — BEFORE building the stored item list, so we can snapshot which
      // batch/expiry each line actually drew from onto the receipt (a GST invoice
      // must show the batch/expiry that was true at sale time, not looked up later).
      const enrichedItems = []
      for (const item of parsed.items) {
        const drug = drugsById.get(item.drugId)
        const { consumed } = await consumeFromBatches(tx, { drugId: item.drugId, quantity: item.quantity })
        enrichedItems.push({
          ...item,
          gstRate: drug.gstRate || 0,
          batchNumber: consumed.map((c) => c.batchNumber).join('/') || '',
          expiryDate: consumed[0]?.expiryDate || null,
        })
      }

      // Build the multi-payment ledger. Each split gets its own receipt number +
      // timestamp so the printed Payment table (SN/Receipt/Date/Amount/Paymode)
      // has real per-row data. Stored as JSON on the sale (see schema `payments`).
      // A single-method sale still records ONE payment row so every receipt shows
      // a consistent Payment log (same as Lab/Radiology/Billing).
      // Same 'OPD_RCP' series every other receipt path draws from (billing,
      // paymentController, prescription dispense) — one continuous sequence
      // across every money-collection point, matching a single physical receipt
      // book. Date.now()+Math.random() (the old code) can mint the same string
      // twice for two sales in the same millisecond, and receiptNumber is
      // @@unique — a live collision is a hard 500 in front of a pharmacist.
      const receiptNumber = await nextSeriesNumber(tx, ORGANIZATION_ID, 'OPD_RCP', 'RCP')
      const splitInput = Array.isArray(parsed.payments) && parsed.payments.length
        ? parsed.payments
        : [{ amount: totalAmount, paymentMethod: parsed.paymentMethod || 'cash' }]
      const paymentSplits = splitInput.map((p, i) => ({
        receiptNumber: `${receiptNumber}-${i + 1}`,
        paymentDate: new Date().toISOString(),
        amount: p.amount,
        paymentMethod: p.paymentMethod,
        reference: p.reference || null,
      }))
      const amountPaidTotal = paymentSplits.reduce((s, p) => s + Number(p.amount || 0), 0)

      // Capture patient details for the receipt via the SHARED snapshot helper —
      // the single source of truth for patient info across every module. Only link
      // to a REAL patient row (getPatientSnapshot returns null for a free-typed ID
      // that isn't a real patient), otherwise the patientId foreign key would blow
      // up the sale. Values typed in the sale dialog (parsed.phone / parsed.uhid)
      // always take priority so walk-in / OTC sales still show what was entered.
      const snapshot = await getPatientSnapshot(tx, parsed.patientId, ORGANIZATION_ID)
      const linkedPatientId = snapshot?.patientId ?? null
      // A typed identifier that isn't a real patient row is still worth showing as
      // the UHID on the receipt (e.g. an external MRN the operator typed).
      const typedIdAsUhid = (parsed.patientId && !linkedPatientId) ? parsed.patientId : null

      const sale = await tx.pharmacySale.create({
        data: {
          organizationId: ORGANIZATION_ID,
          patientId: linkedPatientId,
          prescriptionId: parsed.prescriptionId ?? null,
          customerName: parsed.customerName || null,
          items: JSON.stringify(enrichedItems),
          subtotal,
          discountAmount,
          totalAmount,
          paymentMethod: paymentSplits.length ? paymentSplits.map((p) => p.paymentMethod).join(' + ') : (parsed.paymentMethod ?? 'cash'),
          paymentStatus: amountPaidTotal >= totalAmount - 0.005 ? 'paid' : (amountPaidTotal > 0 ? 'partially_paid' : 'unpaid'),
          amountPaid: amountPaidTotal,
          receiptNumber,
          payments: paymentSplits.length ? JSON.stringify(paymentSplits) : null,
          // Patient info snapshot for receipt — typed values win, patient row fills gaps
          phone: parsed.phone || snapshot?.phone || null,
          mrn: snapshot?.mrn ?? null,
          uhid: parsed.uhid || typedIdAsUhid || snapshot?.uhid || null,
          referenceDoctor: parsed.referenceDoctor || null,
        },
      })

      for (const item of parsed.items) {
        await recordStockChange(tx, {
          organizationId: ORGANIZATION_ID,
          drugId: item.drugId,
          changeType: 'sale',
          quantityDelta: -item.quantity,
          reference: sale.id,
          note: `Sale ${sale.receiptNumber}`,
          createdById: req.user?.userId ?? null,
        })
      }

      // Mark linked prescription as fully dispensed. Org-scoped via updateMany:
      // update-by-bare-id let one hospital flip ANOTHER hospital's prescription
      // to dispensed, so their pharmacy would refuse to dispense it. updateMany
      // simply matches nothing when the id belongs to another tenant.
      if (parsed.prescriptionId) {
        await tx.prescription.updateMany({
          where: { id: parsed.prescriptionId, organizationId: ORGANIZATION_ID },
          data: { status: 'fully_dispensed' },
        })
      }

      return sale
    })

    res.status(201).json({ success: true, data, message: 'Sale created successfully' })
  } catch (err) {
    if (handleServiceError(res, err)) return
    next(err)
  }
}

/**
 * POST /pharmacy/sales/:id/cancel  — void a sale and put the medicine back.
 *
 * Cancelling only the row would leave the stock decremented for ever: the same
 * box could never be sold again and the shelf would stop matching the ledger.
 * The reversal mirrors reverseInvoiceFulfillment in billingController — positive
 * deltas THROUGH recordStockChange, never a bare increment, or every later
 * balanceAfter in StockLedger is wrong and the count can never be audited back
 * to a document.
 *
 * Batch quantities are deliberately not restored: one line can be drawn FIFO
 * across several batches and batch tracking is best-effort (stockService.js);
 * quantityInStock stays the authority for selling.
 *
 * Money is NOT settled here. A sale raised from the billing counter is owned by
 * its Invoice — the refund belongs to that document, through the endpoint that
 * knows this hospital's refund mode.
 */
export async function cancel(req, res, next) {
  try {
    const ORGANIZATION_ID = getOrgId(req)
    const { reason } = req.body || {}
    if (!reason || !String(reason).trim()) {
      throw makeError('A cancellation reason is required', 400, 'REASON_REQUIRED')
    }

    const data = await db.$transaction(async (tx) => {
      const sale = await tx.pharmacySale.findFirst({
        where: { id: req.params.id, organizationId: ORGANIZATION_ID },
        select: { id: true, items: true, paymentStatus: true, receiptNumber: true },
      })
      if (!sale) throw makeError('Sale not found', 404, 'SALE_NOT_FOUND')
      // Guarded, not assumed: cancelling twice would return the stock twice and
      // leave the shelf claiming medicine that was never returned.
      if (sale.paymentStatus === 'cancelled') {
        throw makeError('This sale is already cancelled', 409, 'ALREADY_CANCELLED')
      }

      let items = []
      try { items = JSON.parse(sale.items || '[]') } catch { items = [] }

      const returned = []
      for (const item of items) {
        const quantity = Number(item.quantity) || 0
        if (!item.drugId || quantity <= 0) continue
        await recordStockChange(tx, {
          organizationId: ORGANIZATION_ID,
          drugId: item.drugId,
          changeType: 'return',
          quantityDelta: quantity,
          reference: sale.id,
          note: `Cancelled pharmacy sale ${sale.receiptNumber}: ${String(reason).trim()}`,
          createdById: req.user?.id || null,
        })
        returned.push({ drugId: item.drugId, quantity })
      }

      // Voided, never deleted: the row is the record of what was dispensed and
      // later reversed, and the ledger rows point at its id.
      //
      // The reason is written onto the StockLedger rows above, not onto the sale —
      // PharmacySale has no free-text column, and adding one is a migration this
      // change does not need. The ledger is the better home anyway: it is the row
      // an auditor reads when asking why the shelf count moved.
      const updated = await tx.pharmacySale.update({
        where: { id: sale.id },
        data: { paymentStatus: 'cancelled' },
      })

      return { sale: updated, stockReturned: returned }
    })

    res.json({ success: true, data })
  } catch (err) {
    handleServiceError(err, res, next)
  }
}
