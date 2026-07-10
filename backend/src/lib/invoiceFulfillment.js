// Turns billed invoice lines into the real clinical/inventory work they imply.
//
// WHY THIS FILE EXISTS: the Billing module can bill a medicine, a lab test or a
// radiology exam. Billing alone used to write nothing but an Invoice row — so a
// drug sold at the billing counter never left pharmacy stock (the same box could
// be sold twice), and a billed lab test never reached the lab (no order, so no
// report was ever produced).
//
// Every function here MUST run inside the caller's `db.$transaction` (they take
// `tx`), so the invoice and the stock/order writes commit or roll back together.
// All lookups are scoped by `organizationId` — a hospital can only ever consume
// its OWN stock and raise orders against its OWN tests/exams.

import { recordStockChange, consumeFromBatches, findShortages, insufficientStockError } from '../pharmacy/stockService.js'
import { resolveRequestedById } from './requestedBy.js'

/** Invoice lines the biller tagged as coming from a given module. */
const linesFrom = (items, sourceType) =>
  items.filter((i) => i.sourceType === sourceType && i.sourceId)

/**
 * Sell the billed medicines: check stock, draw down batches FIFO, write the
 * stock ledger, and record a PharmacySale so the sale shows in pharmacy reports.
 * Throws 422 INSUFFICIENT_STOCK (before any write) if any line is short.
 */
export async function fulfillPharmacyItems(tx, { organizationId, items, invoice, patientId, actorId }) {
  const lines = linesFrom(items, 'pharmacy')
  if (!lines.length) return null

  const stockItems = lines.map((i) => ({ drugId: i.sourceId, quantity: i.quantity, drugName: i.serviceName }))

  // Check every line BEFORE consuming any, so a short line can't leave earlier
  // lines already decremented (the transaction would roll back, but failing fast
  // gives the biller the full shortage list in one go).
  const shortages = await findShortages(tx, { organizationId, items: stockItems })
  if (shortages.length) throw insufficientStockError(shortages)

  const soldItems = []
  for (const line of lines) {
    const { consumed } = await consumeFromBatches(tx, { drugId: line.sourceId, quantity: line.quantity })
    soldItems.push({
      drugId: line.sourceId,
      drugName: line.serviceName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: line.total,
      gstRate: line.gstRate || 0,
      batchNumber: consumed.map((c) => c.batchNumber).join('/') || '',
      expiryDate: consumed[0]?.expiryDate || null,
    })
  }

  const subtotal = soldItems.reduce((sum, i) => sum + i.total, 0)
  const sale = await tx.pharmacySale.create({
    data: {
      organizationId,
      patientId: patientId || null,
      servedById: actorId || null,
      saleType: 'prescription',
      items: JSON.stringify(soldItems),
      subtotal,
      discountAmount: 0,
      totalAmount: subtotal,
      // The Invoice — not this sale — owns the money. Marking the sale unpaid here
      // would double-count revenue in pharmacy reports, so it mirrors the invoice.
      paymentStatus: invoice.paymentStatus === 'paid' ? 'paid' : 'pending',
      paymentMethod: 'billing_counter',
      amountPaid: 0,
      receiptNumber: invoice.invoiceNumber,
    },
  })

  for (const item of soldItems) {
    await recordStockChange(tx, {
      organizationId,
      drugId: item.drugId,
      changeType: 'sale',
      quantityDelta: -item.quantity,
      reference: sale.id,
      note: `Billing invoice ${invoice.invoiceNumber}`,
      createdById: actorId || null,
    })
  }

  return sale
}

/**
 * Raise ONE lab order covering every billed lab test, so the lab sees the work.
 */
export async function fulfillLabItems(tx, { organizationId, items, invoice, patientId, actorId }) {
  const lines = linesFrom(items, 'lab')
  if (!lines.length) return null

  const requestedById = await resolveRequestedById(tx, organizationId, actorId)
  const tests = lines.map((line) => ({
    testId: line.sourceId,
    testName: line.serviceName,
    urgency: 'routine',
    status: 'pending',
  }))

  return tx.labOrder.create({
    data: {
      organizationId,
      orderNumber: `LAB-${invoice.invoiceNumber}`,
      patientId,
      requestedById,
      tests: JSON.stringify(tests),
      priority: 'routine',
      status: 'pending',
      notes: `Auto-raised from billing invoice ${invoice.invoiceNumber}`,
    },
  })
}

/**
 * Raise one radiology order per billed exam (the model holds a single examId).
 * A quantity of 2 on one line still means one exam ordered — quantity is a
 * billing concept; the radiology worklist wants one order per exam to report on.
 */
export async function fulfillRadiologyItems(tx, { organizationId, items, invoice, patientId, actorId }) {
  const lines = linesFrom(items, 'radiology')
  if (!lines.length) return []

  const requestedById = await resolveRequestedById(tx, organizationId, actorId)

  const orders = []
  for (const [i, line] of lines.entries()) {
    // Guard the examId FK: a stale/foreign id would otherwise throw a raw P2003.
    const exam = await tx.radiologyExam.findFirst({
      where: { id: line.sourceId, organizationId },
      select: { id: true },
    })
    if (!exam) {
      throw Object.assign(new Error(`Radiology exam not found: ${line.serviceName}`), { status: 404 })
    }
    orders.push(
      await tx.radiologyOrder.create({
        data: {
          organizationId,
          orderNumber: `RAD-${invoice.invoiceNumber}-${i + 1}`,
          patientId,
          examId: line.sourceId,
          requestedById,
          urgency: 'routine',
          status: 'pending',
          notes: `Auto-raised from billing invoice ${invoice.invoiceNumber}`,
        },
      }),
    )
  }
  return orders
}

/** Run all three fulfilments for one invoice. */
export async function fulfillInvoiceItems(tx, ctx) {
  const sale = await fulfillPharmacyItems(tx, ctx)
  const labOrder = await fulfillLabItems(tx, ctx)
  const radiologyOrders = await fulfillRadiologyItems(tx, ctx)
  return { sale, labOrder, radiologyOrders }
}
