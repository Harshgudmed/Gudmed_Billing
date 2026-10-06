// GST on an invoice line with a rate (pharmacy): charged on the line's price
// less its share of the bill's discount, to the paisa — the same rule the New
// Invoice screen uses (BillingModule cartLines), so the total it shows is the
// total stored. Pure: a fake transaction holding one drug.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceInvoiceItems } from '../catalogPrice.js'

const tx = { pharmacyDrug: { findFirst: async () => ({ sellingPrice: 12.5, mrp: 15 }) } }
const drug = (quantity) => ({ serviceName: 'Paracetamol 500', quantity, unitPrice: 12.5, total: 12.5 * quantity, tax: 0, gstRate: 12, sourceType: 'pharmacy', sourceId: 'd1' })
const consult = { serviceName: 'Consultation', quantity: 1, unitPrice: 300, total: 300, tax: 54 }

test('no discount: GST on the line price, to the paisa', async () => {
  const [line] = await priceInvoiceItems(tx, { organizationId: 'o', items: [drug(2)] })
  assert.equal(line.total, 25)
  assert.equal(line.tax, 3)
})

test('a discount lowers the GST: it is charged on what the patient pays', async () => {
  // ₹25 of tablets, ₹1 discount → GST 12% of ₹24 = ₹2.88 (it was ₹3.00, on the price before discount)
  const [line] = await priceInvoiceItems(tx, { organizationId: 'o', items: [drug(2)], discountAmount: 1 })
  assert.equal(line.tax, 2.88)
})

test('the discount is shared across lines by value', async () => {
  // ₹325 bill, ₹32.50 discount: the tablets carry 25/325 of it = ₹2.50 → GST 12% of ₹22.50 = ₹2.70
  const [tabs, c] = await priceInvoiceItems(tx, { organizationId: 'o', items: [drug(2), consult], discountAmount: 32.5 })
  assert.equal(tabs.tax, 2.7)
  // a line without a rate keeps the tax it was sent with
  assert.equal(c.tax, 54)
})
