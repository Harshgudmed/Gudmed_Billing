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
import { invoiceLedger, recalcInvoice } from './invoiceLedger.js'
import { round2 } from './money.js'

/** Invoice lines the biller tagged as coming from a given module. */
const linesFrom = (items, sourceType) =>
  items.filter((i) => i.sourceType === sourceType && i.sourceId)

/** Marks a prescription as raised by billing, and names the invoice that did it.
 *  Same shape as the `[HCC:150]` tag this repo already parses out of notes — the
 *  alternative was a migration to add an invoiceId column for a link that only
 *  two functions ever follow. */
export const invoiceTag = (invoiceNumber) => `[INV:${invoiceNumber}]`
export const invoiceOfPrescription = (notes) => (String(notes || '').match(/\[INV:([^\]]+)\]/) || [])[1] || null

// How the Lab and Radiology screens name the order on the bill they raise
// (src/lib/billing.js createInvoiceWithPayment notes).
const ORDER_NOTE = { lab: 'Lab Order', radiology: 'Radiology Order' }

// Day-care cases and ambulance trips are billed from their own screens the same
// way, but their bill is found by its idempotency key "DAYCARE:<case number>" /
// "AMBULANCE:<trip number>" rather than by its notes: the key is exact, indexed
// and unique per hospital (so the bill cannot be raised twice), and Billing
// rewriting a bill's notes — a due-date extension does — cannot cut the link.
// The notes still name the case, for people reading the bill.
const BILL_KEY = { daycare: 'DAYCARE', ambulance: 'AMBULANCE' }
const RECORD_NOUN = { daycare: 'case', ambulance: 'trip' }
export const moduleBillKey = (kind, number) => `${BILL_KEY[kind]}:${number}`

const LIVE_BILL_SELECT = { id: true, invoiceNumber: true, totalAmount: true, amountPaid: true, balanceDue: true, paymentStatus: true, status: true }

/**
 * The live bill an order was charged on, whichever way it was raised:
 *  - by Billing: the order is named after the bill (LAB-<invoice>,
 *    RAD-<invoice>-<n>) — `fromBilling` true; that bill may hold other lines;
 *  - by the Lab/Radiology screen: the bill's notes end with the order number —
 *    a bill of that order alone;
 *  - by the Day Care / Ambulance screen: the bill's key names the case or trip.
 * A refund revises a bill into -R1, -R2…; the live (unarchived) one is returned.
 */
export async function invoiceOfOrder(tx, organizationId, kind, orderNumber) {
  if (!orderNumber) return null
  const named = kind === 'lab' ? orderNumber.match(/^LAB-(.+)$/) : kind === 'radiology' ? orderNumber.match(/^RAD-(.+)-\d+$/) : null
  let base = named?.[1] || null
  if (!base) {
    const tagged = await tx.invoice.findFirst({
      where: BILL_KEY[kind]
        ? { organizationId, idempotencyKey: moduleBillKey(kind, orderNumber) }
        : { organizationId, notes: { endsWith: `${ORDER_NOTE[kind]} ${orderNumber}` } },
      select: { invoiceNumber: true },
    })
    base = tagged?.invoiceNumber?.replace(/-R\d+$/, '') || null
  }
  if (!base) return null
  const live = await tx.invoice.findFirst({
    where: { organizationId, isArchived: false, OR: [{ invoiceNumber: base }, { invoiceNumber: { startsWith: `${base}-R` } }] },
    orderBy: { createdAt: 'desc' },
    select: LIVE_BILL_SELECT,
  })
  return live && { ...live, fromBilling: !!named }
}

/**
 * The live bills of many day-care cases / ambulance trips at once, for a list:
 * Map(case or trip number → bill). Two queries, not one per row — the second
 * only when a refund has revised some of them.
 */
export async function billsOfRecords(tx, organizationId, kind, numbers) {
  const bills = new Map()
  if (!numbers.length) return bills
  const bases = await tx.invoice.findMany({
    where: { organizationId, idempotencyKey: { in: numbers.map((n) => moduleBillKey(kind, n)) } },
    select: { ...LIVE_BILL_SELECT, idempotencyKey: true, isArchived: true },
  })
  const numberOf = (key) => key.slice(BILL_KEY[kind].length + 1)
  const revised = bases.filter((b) => b.isArchived)
  const revisions = revised.length
    ? await tx.invoice.findMany({
      where: { organizationId, isArchived: false, OR: revised.map((b) => ({ invoiceNumber: { startsWith: `${b.invoiceNumber}-R` } })) },
      orderBy: { createdAt: 'asc' }, // the newest revision is set last and wins
      select: LIVE_BILL_SELECT,
    })
    : []
  for (const { idempotencyKey, isArchived, ...bill } of bases) {
    if (!isArchived) bills.set(numberOf(idempotencyKey), bill)
  }
  for (const b of revised) {
    for (const r of revisions) if (r.invoiceNumber.startsWith(`${b.invoiceNumber}-R`)) bills.set(numberOf(b.idempotencyKey), r)
  }
  return bills
}

// The bill's payment status in the words the Day Care screen has always used.
const RECORD_PAYMENT_STATUS = { unpaid: 'pending', partially_paid: 'partial', paid: 'paid', refunded: 'refunded', cancelled: 'cancelled' }

/**
 * A case / trip as its screen shows it: its money is read off its bill (the
 * payments on the invoice are the one ledger — Billing and this screen show
 * the same figures). A record from before the sync has no bill; it keeps the
 * figures it was saved with, and what it recorded as paid is shown as
 * `paidOutsideBilling` — history, not rewritten into a bill.
 */
export function withBill(record, bill) {
  if (!bill) return { ...record, bill: null, paidOutsideBilling: round2(Number(record.amountPaid) || 0) }
  const paymentStatus = bill.status === 'cancelled' ? 'cancelled' : (RECORD_PAYMENT_STATUS[bill.paymentStatus] || bill.paymentStatus)
  return { ...record, bill, paymentStatus, paidOutsideBilling: 0 }
}

/** A refusal from the checks below, as an error the API answers with 409. */
export const refusalError = (refusal) => Object.assign(new Error(refusal.error), { status: 409, title: refusal.title })

/**
 * A day-care fee / ambulance charge changed on its own screen: its bill follows,
 * while nothing has been paid on it. Once money was taken the change is refused
 * — the bill then changes in Billing (refund, or an added charge), where the
 * money trail is kept. A charge of 0 cancels the unpaid bill: there is nothing
 * left to pay for. Runs in the caller's transaction, with the case's own update.
 * Returns { refusal } or {}.
 */
export async function changeRecordCharge(tx, { organizationId, kind, number, charge }) {
  const bill = await invoiceOfOrder(tx, organizationId, kind, number)
  if (!bill || bill.status === 'cancelled') return {}
  // Payments on this bill wait until this change is written, so the check
  // below cannot be overtaken by money arriving in the same instant.
  await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${bill.id} FOR UPDATE`
  const { paid } = await invoiceLedger(tx, bill.id)
  if (paid > 0.005) {
    return { refusal: { title: 'Paid', error: `₹${paid} is already paid on this ${RECORD_NOUN[kind]}'s bill ${bill.invoiceNumber}, so its charge can no longer be changed here. Change it in Billing (a refund, or an added charge).` } }
  }
  if (charge <= 0) {
    await tx.invoice.update({
      where: { id: bill.id },
      data: { status: 'cancelled', paymentStatus: 'cancelled', cancelledAt: new Date(), cancellationReason: `The ${RECORD_NOUN[kind]}'s charge was set to 0` },
    })
    return {}
  }
  const invoice = await tx.invoice.findUnique({ where: { id: bill.id }, select: { items: true, discountAmount: true } })
  let items = []
  try { items = JSON.parse(invoice.items || '[]') } catch { items = [] }
  // The first line is the case's own; lines Billing added later stay as they are.
  items[0] = { ...items[0], quantity: 1, unitPrice: round2(charge), total: round2(charge) }
  const subtotal = round2(items.reduce((s, i) => s + (i.total || 0), 0))
  const taxAmount = round2(items.reduce((s, i) => s + (i.tax || 0), 0))
  const discountAmount = Math.min(invoice.discountAmount || 0, subtotal + taxAmount)
  await tx.invoice.update({
    where: { id: bill.id },
    data: { items: JSON.stringify(items), subtotal, taxAmount, discountAmount, totalAmount: round2(subtotal - discountAmount + taxAmount) },
  })
  await recalcInvoice(tx, bill.id)
  return {}
}

/**
 * Billing cancelled a bill (or cancelled it with a refund): a day-care case or
 * ambulance trip it was raised for is called off too — only while nothing has
 * been done yet ('admitted' / 'scheduled'), the rule lab and radiology orders
 * follow. A case already in procedure, or a trip already made, is real work
 * and stays for a person to decide on. `baseInvoiceNumber` is the bill's first
 * number (revisions do not carry the key). Returns the ids called off.
 */
export async function callOffBilledRecord(tx, { organizationId, baseInvoiceNumber }) {
  const base = await tx.invoice.findFirst({
    where: { organizationId, invoiceNumber: baseInvoiceNumber },
    select: { idempotencyKey: true },
  })
  const [, prefix, number] = String(base?.idempotencyKey || '').match(/^(DAYCARE|AMBULANCE):(.+)$/) || []
  if (!prefix) return { dayCareCaseIds: [], ambulanceTripIds: [] }
  const [model, field, openStatus] = prefix === 'DAYCARE' ? ['dayCareCase', 'caseNumber', 'admitted'] : ['ambulanceTrip', 'tripNumber', 'scheduled']
  const open = await tx[model].findMany({ where: { organizationId, [field]: number, status: openStatus }, select: { id: true } })
  if (open.length) {
    await tx[model].updateMany({ where: { id: { in: open.map((r) => r.id) }, status: openStatus }, data: { status: 'cancelled' } })
  }
  const ids = open.map((r) => r.id)
  return prefix === 'DAYCARE' ? { dayCareCaseIds: ids, ambulanceTripIds: [] } : { dayCareCaseIds: [], ambulanceTripIds: ids }
}

/**
 * The rule both order screens apply before cancelling an order, and what to
 * do with its bill. Money taken → refused: Billing's "Cancel & refund" gives
 * it back. A bill raised at Billing → refused too (it may hold other lines).
 * The screen's own unpaid bill → `cancelBill`, cancelled with the order;
 * cancelling the order alone left a bill the patient was still asked to pay.
 */
export async function orderCancelCheck(tx, organizationId, kind, orderNumber) {
  const bill = await invoiceOfOrder(tx, organizationId, kind, orderNumber)
  if (!bill || bill.status === 'cancelled') return {}
  if (bill.amountPaid > 0.005) {
    return { refusal: { title: 'Paid', error: `This ${RECORD_NOUN[kind] || 'order'} is paid on ${bill.invoiceNumber}. Cancel it in Billing with "Cancel & refund" so the patient gets the money back.` } }
  }
  if (bill.fromBilling) {
    return { refusal: { title: 'Billed at Billing', error: `This order was raised on ${bill.invoiceNumber} at Billing. Cancel it there.` } }
  }
  return { cancelBill: bill }
}

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
