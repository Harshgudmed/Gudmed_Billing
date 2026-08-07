// The server's own answer to "what does this item cost?".
//
// WHY THIS EXISTS
// billingController accepted `unitPrice` from the request body and only
// recomputed `total = quantity x unitPrice` from it. The multiplication was
// server-side, but the price it multiplied was whatever the client sent — so a
// 5,000 test could be billed at 1 by editing one number in the request, and the
// resulting invoice looked completely ordinary: right patient, right test name,
// right arithmetic. Nothing downstream could tell it apart from a real bill.
//
// Every id on a billed line is hostile until proven otherwise (CLAUDE.md #4),
// and so is every price attached to it.
//
// THIS IS NOT A NEW PRICING ENGINE. inpatient/tariffService.js already resolves
// prices for IPD through the ChargeMaster + TariffPlan tables, and
// inpatient/orderBillingService.js already reads these same four catalogues.
// This file is the small, admission-free part of that logic — the plain
// "what does the catalogue say" lookup — so OPD can use it too. IPD can be
// pointed at this in a later change; today it is left alone.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not invent a price. 569 lab tests and 1,673 radiology exams currently
// have no price in the catalogue at all, and those lines bill at 0 — exactly
// what happens today, because the billing screen has no price input at all
// (BillingModule's updateItemAmt is defined and never called; the cart shows the
// amount as static text and only quantity is editable). The figure the client
// sends for a catalogue line was itself read from this same catalogue moments
// earlier — `amt: Number(t.price || 0)` — so for an unpriced test it is already
// 0. There is no human-entered price to preserve, which is why a line carrying
// a sourceId ignores the request's price completely rather than falling back to
// it: the fallback would protect nothing and trust everything.
//
// Those lines are marked `priceSource: 'unpriced'` on the stored invoice, so
// "which bills went out at zero?" is answerable from the invoice JSON alone.
//
// A line with NO sourceId (a consultation, a dressing, "Home Collection
// Charges" — the categories with no catalogue behind them) still takes its
// price from the request, because nothing else knows it. That is unchanged.

import { round2 } from './money.js'

// The catalogues a billed line can point at. `sourceType` is set by the biller's
// UI (see invoiceItemSchema) for the three clinical modules; a line carrying only
// `serviceId` is a BillingService (consultation, procedure, accommodation).
const CATALOG = {
  lab: {
    model: 'labTest',
    select: { price: true },
    priceOf: (row) => row.price,
    label: 'lab test',
  },
  radiology: {
    model: 'radiologyExam',
    select: { price: true },
    priceOf: (row) => row.price,
    label: 'radiology exam',
  },
  pharmacy: {
    model: 'pharmacyDrug',
    // Falls back to the printed MRP: a drug with no selling price set is still
    // sellable at its MRP, and billing it at 0 would give the medicine away.
    select: { sellingPrice: true, mrp: true },
    priceOf: (row) => row.sellingPrice ?? row.mrp,
    label: 'drug',
  },
  service: {
    model: 'billingService',
    select: { unitPrice: true },
    priceOf: (row) => row.unitPrice,
    label: 'service',
  },
}

/**
 * The catalogue price of one item, or null when the catalogue has none.
 *
 * `organizationId` is in the where, not just the id: an id from another
 * hospital must read as "not found" rather than returning that hospital's price.
 *
 * Returns { price, exists }:
 *   price  — a usable price (> 0), else null
 *   exists — whether a row was found at all. A missing row is NOT the same as a
 *            row with no price: the first is a bad id, the second is a gap in
 *            the catalogue, and the callers treat them differently.
 */
export async function catalogPrice(tx, { organizationId, sourceType, sourceId }) {
  const catalog = CATALOG[sourceType]
  if (!catalog || !sourceId) return { price: null, exists: null, label: null }

  const row = await tx[catalog.model].findFirst({
    where: { id: sourceId, organizationId },
    select: catalog.select,
  })
  if (!row) return { price: null, exists: false, label: catalog.label }

  const value = catalog.priceOf(row)
  const usable = typeof value === 'number' && value > 0
  return { price: usable ? round2(value) : null, exists: true, label: catalog.label }
}

/**
 * Reprice a whole invoice's lines from the catalogue.
 *
 * MUST be called with the `tx` that writes the invoice, so the price stored is
 * the price that was in the catalogue at the moment the invoice was committed.
 *
 * Throws 404 for a clinical line whose sourceId does not belong to this org —
 * matching what fulfillRadiologyItems already does further down the same
 * transaction, and stopping a cross-tenant id from reaching the FK.
 */
export async function priceInvoiceItems(tx, { organizationId, items }) {
  const priced = []

  for (const item of items) {
    // A clinical line carries sourceType + sourceId. A BillingService line
    // carries only serviceId, and is looked up as 'service'.
    const sourceType = item.sourceType || (item.serviceId ? 'service' : null)
    const sourceId = item.sourceId || item.serviceId || null

    const { price, exists, label } = await catalogPrice(tx, { organizationId, sourceType, sourceId })

    // A clinical sourceId that resolves to nothing is either stale or another
    // hospital's. `serviceId` is exempt: it is not proven to always be a
    // BillingService id, and rejecting it would break billing for lines that
    // work today.
    if (exists === false && item.sourceType) {
      const err = new Error(`This ${label} is not in your catalogue: ${item.serviceName}`)
      err.status = 404
      throw err
    }

    const quantity = Number(item.quantity) || 0
    // A line that names a catalogue row is priced ONLY by that catalogue — never
    // by the request, not even when the catalogue has no price. The biller has no
    // way to type one, so a price arriving on such a line has no legitimate
    // source it could have come from other than this same table.
    // A line with no sourceId has no catalogue to consult, so it keeps its price.
    const unitPrice = sourceId ? (price ?? 0) : round2(item.unitPrice)
    const total = round2(quantity * unitPrice)

    const line = { ...item, unitPrice, total }

    // Tax rides on the line as an amount, not a rate, so it cannot be recomputed
    // in general. Where the biller sent the rate too (pharmacy does), recompute
    // it — otherwise overriding the price would leave GST calculated on the old
    // one. Lines without a rate keep the tax they arrived with.
    if (price !== null && typeof item.gstRate === 'number' && item.gstRate > 0) {
      line.tax = round2((total * item.gstRate) / 100)
    }

    // Marks a catalogue line the catalogue could not price, so "which bills went
    // out at zero?" is answerable from the invoice JSON alone.
    if (price === null && sourceId) line.priceSource = 'unpriced'

    priced.push(line)
  }

  return priced
}
