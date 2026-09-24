import client from '@/api/client'

/**
 * What a percentage box may hold while somebody is typing in it.
 *
 * `min`/`max` on an <input type="number"> are only enforced by a form's own
 * validation, and these boxes sit outside any <form> — so a typed 500 went
 * straight into a bill as 500% GST. Empty stays empty (the box must be
 * clearable), anything unreadable is 0, and the rest is held between 0 and 100.
 * The server refuses out-of-range percentages too; this just stops the screen
 * from showing a total nobody will honour.
 */
export function percentBox(raw) {
  if (raw === '') return ''
  const n = parseFloat(raw)
  if (Number.isNaN(n)) return 0
  return Math.min(100, Math.max(0, n))
}

// ── Shared billing helpers (Lab / Radiology / OPD / Procedure / …) ────────────
// One place for the "create an invoice for this order + record what was paid" and
// "find that order's invoice + its payment ledger" flows, so every module bills
// and prints identically. No module re-implements this — DRY + scalable: a new
// module just calls these two functions.

// Create an invoice for a module's order, then (if money was collected at booking)
// record it as a Payment on that invoice. Returns { invoice, payment } — or null
// when there's nothing to bill. Non-throwing on the payment step is the caller's
// choice; this throws only if the invoice POST itself rejects.
//   items = [{ serviceName, quantity, unitPrice, tax, total }]
export async function createInvoiceWithPayment({ patientId, items, notes, amountPaid = 0, paymentMethod = 'cash' }) {
  if (!patientId || !Array.isArray(items) || items.length === 0) return null
  const invRes = await client.post('/billing', { resource: 'invoice', patientId, items, notes })
  if (!invRes?.success) return null
  const invoice = invRes.data
  let payment = null
  const amt = Number(amountPaid) || 0
  if (invoice?.id && amt > 0) {
    const payRes = await client.post('/billing', {
      resource: 'payment',
      invoiceId: invoice.id,
      patientId,
      amount: amt,
      paymentMethod: paymentMethod || 'cash',
    })
    if (payRes?.success) payment = payRes.data
  }
  return { invoice, payment }
}

// Find the invoice auto-created for an order (tagged with the order number in its
// notes) and return its payment ledger — each row stamped with the invoice number
// for the receipt's Payment table. Always resolves (never throws); missing data
// comes back as empty so callers can print the receipt regardless.
// The link runs one of two ways:
//   - order booked in Lab/Radiology → its invoice's notes carry the ORDER number;
//   - invoice raised in Billing → the order was made FROM it (order number
//     "LAB-<invoice number>", notes "Auto-raised from billing invoice …"), and
//     that invoice's notes do not mention the order at all.
// Only the first was searched, so a Billing-raised order never found its invoice
// and the lab receipt re-priced everything on its own — the #10 mismatch.
// `invoiceNumber` (optional) covers the second; existing callers are unchanged.
export async function fetchOrderInvoicePayments({ patientId, orderNumber, invoiceNumber }) {
  const empty = { invoice: null, payments: [], amountPaid: undefined, discountAmount: undefined }
  if (!patientId || (!orderNumber && !invoiceNumber)) return empty
  try {
    const res = await client.get('/billing', { params: { resource: 'invoices', patientId, limit: 100 } })
    if (!res?.success) return empty
    const invoice = (res.data || []).find((i) =>
      (invoiceNumber && i.invoiceNumber === invoiceNumber) ||
      (orderNumber && String(i.notes || '').includes(orderNumber)))
    if (!invoice) return empty
    return {
      invoice,
      payments: (invoice.payments || []).map((p) => ({ ...p, invoiceNumber: invoice.invoiceNumber })),
      amountPaid: Number(invoice.amountPaid || 0),
      discountAmount: Number(invoice.discountAmount || 0),
    }
  } catch {
    return empty
  }
}
