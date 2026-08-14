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

/** Marks a prescription as raised by billing, and names the invoice that did it.
 *  Same shape as the `[HCC:150]` tag this repo already parses out of notes — the
 *  alternative was a migration to add an invoiceId column for a link that only
 *  two functions ever follow. */
export const invoiceTag = (invoiceNumber) => `[INV:${invoiceNumber}]`
export const invoiceOfPrescription = (notes) => (String(notes || '').match(/\[INV:([^\]]+)\]/) || [])[1] || null

/**
 * Raise the prescription the billed medicines imply — do NOT take them off the
 * shelf yet.
 *
 * WHY NOT: the medicine leaves the shelf when the pharmacist hands it over, not
 * when the cashier takes the money. Deducting at billing time meant a patient who
 * paid and never collected had the stock counted as gone for ever, and a hospital
 * with a separate pharmacy window had no list of what was waiting to be handed
 * out — the sale existed, but nothing told the pharmacist it was theirs to do.
 *
 * So billing now raises a Prescription, which is exactly what the Pharmacy
 * module's Prescriptions tab already lists and its Dispense button already knows
 * how to fulfil. That path consumes the batches, writes the stock ledger and
 * records the PharmacySale — all of it already written, none of it duplicated
 * here.
 *
 * Stock is still CHECKED before the bill is raised. Billing a medicine the shelf
 * does not have is a promise the pharmacy cannot keep, and the patient finds out
 * at the window after paying.
 */
export async function fulfillPharmacyItems(tx, { organizationId, items, invoice, patientId, actorId }) {
  const lines = linesFrom(items, 'pharmacy')
  if (!lines.length) return null

  const stockItems = lines.map((i) => ({ drugId: i.sourceId, quantity: i.quantity, drugName: i.serviceName }))

  // Checked, not reserved. Two bills raised in the same second for the last box
  // will both pass — the shortage then surfaces at dispense, where the pharmacist
  // can see it and act, rather than one of them silently taking stock to -1.
  const shortages = await findShortages(tx, { organizationId, items: stockItems })
  if (shortages.length) throw insufficientStockError(shortages)

  const rxItems = lines.map((line) => ({
    drugId: line.sourceId,
    drugName: line.serviceName,
    quantity: line.quantity,
    // What was charged, so the dispense receipt shows the billed price rather
    // than today's catalogue price — the patient has already paid this.
    unitPrice: line.unitPrice,
    gstRate: line.gstRate || 0,
  }))

  return tx.prescription.create({
    data: {
      organizationId,
      patientId: patientId || null,
      prescriptionDate: new Date(),
      items: JSON.stringify(rxItems),
      status: 'pending',
      notes: `${invoiceTag(invoice.invoiceNumber)} Billed at the counter — collect from pharmacy`,
      createdById: actorId || null,
    },
  })
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
