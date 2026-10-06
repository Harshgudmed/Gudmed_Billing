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
// Opt-in (existing callers are unchanged without them):
//   type           — what kind of bill this is ('lab', 'radiology', 'daycare',
//                    'ambulance'), stamped on every line that has none, so
//                    Billing's Type column and filter can tell it from an OPD bill.
//   idempotencyKey — one bill per record: raising it again (a retry, a double
//                    click) returns the same bill, and the booking payment is
//                    keyed too, so it is not taken twice.
export async function createInvoiceWithPayment({ patientId, items, notes, amountPaid = 0, paymentMethod = 'cash', type, idempotencyKey }) {
  if (!patientId || !Array.isArray(items) || items.length === 0) return null
  const invRes = await client.post('/billing', {
    resource: 'invoice',
    patientId,
    items: type ? items.map((i) => ({ type, ...i })) : items,
    notes,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  })
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
      ...(idempotencyKey ? { idempotencyKey: `${idempotencyKey}:booking` } : {}),
    })
    if (payRes?.success) payment = payRes.data
  }
  return { invoice, payment }
}

// The bill a Day Care case or an ambulance trip raises from its own screen —
// one per record, found again by its key. Keep the key in step with
// moduleBillKey in backend/src/lib/invoiceFulfillment.js, which reads it back.
const RECORD_BILL = {
  daycare: { key: 'DAYCARE', label: 'Day Care', note: 'Day Care Case' },
  ambulance: { key: 'AMBULANCE', label: 'Ambulance', note: 'Ambulance Trip' },
}
export function raiseRecordBill(kind, { number, patientId, serviceName, charge, amountPaid, paymentMethod }) {
  const bill = RECORD_BILL[kind]
  return createInvoiceWithPayment({
    patientId,
    items: [{ serviceName, quantity: 1, unitPrice: Number(charge), tax: 0, total: Number(charge) }],
    notes: `[${bill.label}] ${bill.note} ${number}`,
    amountPaid,
    paymentMethod,
    type: kind,
    idempotencyKey: `${bill.key}:${number}`,
  })
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

// ── Who may do what in Billing ────────────────────────────────────────────────
// Mirrors backend/src/lib/billingAccess.js, which decides every write again:
// the counters raise bills and take money, the Finance Controller sets prices
// and releases refunds (and takes no money), an administrator does everything.
// These only choose which tabs and buttons a person is shown.
const BILLING_ADMINS = ['admin', 'super_admin']
const BILLING_ROLES = {
  raise: ['receptionist', 'billing', 'billing_clerk', 'pharmacist', 'lab_technician', 'radiology_technician'],
  adjust: ['receptionist', 'billing', 'billing_clerk'],
  approve: ['finance_controller'],
  catalog: ['finance_controller'],
  // The Billing screen's Insurance tab lists the claims; the front desk does not work them.
  insurance: ['billing', 'billing_clerk', 'finance_controller'],
}

/** What `role` may do in Billing. No role (login off, the demo) may do everything. */
export function billingAccess(role) {
  const can = (what) => !role || BILLING_ADMINS.includes(role) || BILLING_ROLES[what].includes(role)
  return { canRaise: can('raise'), canAdjust: can('adjust'), canApprove: can('approve'), canEditCatalog: can('catalog'), canSeeInsurance: can('insurance') }
}
