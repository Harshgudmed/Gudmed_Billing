// Vendor bills: the invoice-number key, the 3-way match per line and per bill,
// the totals with TDS, the payment terms and due date, and what submitting
// does. Pure functions, so no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  invoiceKey, netRateOf, billableOf, lineProblem, matchLine, matchBill, billTotals,
  paymentTermsFor, dueDateFor, submitOutcome, AUTO_DECIDER, MSME_MAX_DAYS,
} from '../vendorBills.js'
import { lineAmounts } from '../purchaseOrders.js'

const gloves = (over = {}) => ({ id: 'ol1', itemName: 'Gloves', unitCode: 'BOX', quantity: 20, receivedQty: 10, billedQty: 0, rate: 500, discountPct: 10, gstRate: 5, ...over })
const chair = (over = {}) => ({ id: 'ol2', itemName: 'Chair', unitCode: 'PCS', quantity: 4, receivedQty: 4, billedQty: 0, rate: 3000, discountPct: 0, gstRate: 18, ...over })

test('the invoice key ignores case, spaces and punctuation', () => {
  assert.equal(invoiceKey('inv/24-25/001'), 'INV2425001')
  assert.equal(invoiceKey('INV 24 25 001'), 'INV2425001')
  assert.equal(invoiceKey(' Inv.2425.001 '), 'INV2425001')
  assert.equal(invoiceKey('---'), '')
  assert.equal(invoiceKey(null), '')
  assert.equal(invoiceKey(12345), '12345')
})

test('net rate is the rate after discount; billable is received less billed', () => {
  assert.equal(netRateOf({ rate: 500, discountPct: 10 }), 450)
  assert.equal(netRateOf({ rate: 3000 }), 3000)
  assert.equal(netRateOf({}), 0)
  assert.equal(billableOf(gloves()), 10)
  assert.equal(billableOf(gloves({ billedQty: 4 })), 6)
  // billed more than received (Finance approved an over-bill): nothing left, never negative
  assert.equal(billableOf(gloves({ billedQty: 12 })), 0)
  // three-decimal quantities leave no dust
  assert.equal(billableOf({ receivedQty: 0.3, billedQty: 0.1 + 0.2 }), 0)
  assert.equal(billableOf(null), 0)
})

test('a line that cannot be stored: no quantity, or half of a whole unit', () => {
  assert.match(lineProblem(gloves(), { quantity: 0 }), /enter the quantity/)
  assert.match(lineProblem(gloves(), { quantity: 2.5 }, { wholeOnly: true }), /whole BOX/)
  assert.equal(lineProblem(gloves(), { quantity: 2.5 }), null)
  assert.equal(lineProblem(gloves(), { quantity: 3 }, { wholeOnly: true }), null)
})

test('a line that agrees with the order and the goods matches', () => {
  const m = matchLine(gloves(), { quantity: 10, rate: 500, discountPct: 10, gstRate: 5 })
  assert.deepEqual(m, { orderRate: 450, billableQty: 10, qtyOk: true, rateOk: true, problem: null })
  // the same net rate reached another way (no discount, lower rate) is the same price
  assert.equal(matchLine(gloves(), { quantity: 5, rate: 450, discountPct: 0, gstRate: 5 }).rateOk, true)
  // within a paisa
  assert.equal(matchLine(chair({ rate: 333.33, discountPct: 10 }), { quantity: 1, rate: 300, discountPct: 0, gstRate: 18 }).rateOk, true)
  assert.equal(matchLine(chair(), { quantity: 1, rate: 3000.01, gstRate: 18 }).rateOk, true)
  assert.equal(matchLine(chair(), { quantity: 1, rate: 3000.02, gstRate: 18 }).rateOk, false)
})

test('billing more than was received and not yet billed is a quantity mismatch, in words', () => {
  const m = matchLine(gloves(), { quantity: 12, rate: 500, discountPct: 10, gstRate: 5 })
  assert.equal(m.qtyOk, false)
  assert.equal(m.rateOk, true)
  assert.equal(m.problem, 'Gloves: 12 BOX billed, only 10 received and not billed')
  // what another bill already claimed is not billable again
  assert.match(matchLine(gloves({ billedQty: 10 }), { quantity: 1, rate: 500, discountPct: 10, gstRate: 5 }).problem, /1 BOX billed, none received and not yet billed/)
  // exactly what is billable is fine, with float dust
  assert.equal(matchLine(gloves({ receivedQty: 0.3, billedQty: 0.1 }), { quantity: 0.2, rate: 500, discountPct: 10, gstRate: 5 }).qtyOk, true)
})

test('a different rate or GST is a price mismatch, in words', () => {
  const m = matchLine(chair(), { quantity: 4, rate: 3100, discountPct: 0, gstRate: 18 })
  assert.equal(m.rateOk, false)
  assert.equal(m.qtyOk, true)
  assert.equal(m.orderRate, 3000)
  assert.equal(m.problem, 'Chair: rate ₹3,100 vs ordered ₹3,000')
  // a discount anywhere → the words say the rate after discount
  assert.equal(matchLine(gloves(), { quantity: 1, rate: 500, discountPct: 5, gstRate: 5 }).problem, 'Gloves: rate after discount ₹475 vs ordered ₹450')
  // paisa shown when there are paisa
  assert.match(matchLine(chair(), { quantity: 1, rate: 3000.5, gstRate: 18 }).problem, /₹3,000\.50 vs ordered ₹3,000$/)
  const gst = matchLine(chair(), { quantity: 4, rate: 3000, gstRate: 12 })
  assert.equal(gst.rateOk, false)
  assert.equal(gst.problem, 'Chair: GST 12% vs ordered 18%')
  // everything wrong at once, in one line
  assert.equal(matchLine(chair(), { quantity: 5, rate: 3100, gstRate: 28 }).problem, 'Chair: 5 PCS billed, only 4 received and not billed, rate ₹3,100 vs ordered ₹3,000, GST 28% vs ordered 18%')
})

test('a bill matches when every line and the printed total agree', () => {
  const order = [gloves(), chair()]
  const lines = [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 10, rate: 500, discountPct: 10, gstRate: 5 }, { orderLineId: 'ol2', itemName: 'Chair', quantity: 4, rate: 3000, discountPct: 0, gstRate: 18 }]
  const total = 4500 * 1.05 + 12000 * 1.18 // 18885
  const ok = matchBill(order, lines, { total, invoiceTotal: 18885.4 })
  assert.equal(ok.matched, true)
  assert.equal(ok.mismatch, null)
  assert.deepEqual(ok.lines.map((l) => [l.qtyOk, l.rateOk, l.billableQty, l.orderRate]), [[true, true, 10, 450], [true, true, 4, 3000]])
  // no printed total typed: not checked
  assert.equal(matchBill(order, lines, { total }).matched, true)
})

test('a bill with differences lists every one, the invoice total last', () => {
  const order = [gloves(), chair()]
  const lines = [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 12, rate: 500, discountPct: 10, gstRate: 5 }, { orderLineId: 'ol2', itemName: 'Chair', quantity: 4, rate: 3100, discountPct: 0, gstRate: 18 }]
  const r = matchBill(order, lines, { total: 20311.2, invoiceTotal: 20500 })
  assert.equal(r.matched, false)
  assert.equal(r.mismatch, 'Gloves: 12 BOX billed, only 10 received and not billed; Chair: rate ₹3,100 vs ordered ₹3,000; Invoice total ₹20,500 vs ₹20,311.20 from the lines')
  assert.deepEqual(r.lines.map((l) => [l.qtyOk, l.rateOk]), [[false, true], [true, false]])
})

test('the printed total may differ by a rupee (rounding off), not more', () => {
  const order = [chair()]
  const lines = [{ orderLineId: 'ol2', itemName: 'Chair', quantity: 1, rate: 3000, gstRate: 18 }]
  assert.equal(matchBill(order, lines, { total: 3540, invoiceTotal: 3541 }).matched, true)
  assert.equal(matchBill(order, lines, { total: 3540, invoiceTotal: 3539 }).matched, true)
  assert.equal(matchBill(order, lines, { total: 3540, invoiceTotal: 3541.01 }).matched, false)
  assert.equal(matchBill(order, lines, { total: 3540, invoiceTotal: 0 }).matched, false)
})

test('a bill line whose order line has gone does not match', () => {
  const r = matchBill([], [{ orderLineId: 'gone', itemName: 'Mask', quantity: 1, rate: 1 }], { total: 1 })
  assert.equal(r.matched, false)
  assert.match(r.mismatch, /Mask: no longer on the order/)
})

test('bill totals: GST as on the order, TDS on the value before GST, payable after TDS', () => {
  const lines = [lineAmounts({ quantity: 10, rate: 500, discountPct: 10, gstRate: 5 }), lineAmounts({ quantity: 4, rate: 3000, gstRate: 18 })]
  const t = billTotals(lines, 'intra', 2)
  assert.equal(t.subtotal, 16500)
  assert.equal(t.cgst + t.sgst, 2385)
  assert.equal(t.total, 18885)
  assert.equal(t.tdsAmount, 330)
  assert.equal(t.payable, 18555)
  const inter = billTotals(lines, 'inter', 0)
  assert.equal(inter.igst, 2385)
  assert.equal(inter.tdsAmount, 0)
  assert.equal(inter.payable, 18885)
  // an unregistered vendor: no GST at all
  const none = billTotals([lineAmounts({ quantity: 2, rate: 1000, gstRate: 18 }, 'none')], 'none', 1)
  assert.deepEqual(none, { subtotal: 2000, cgst: 0, sgst: 0, igst: 0, total: 2000, tdsAmount: 20, payable: 1980 })
})

test('payment terms: the order\'s, else the vendor\'s, else 30; an MSME at most 45', () => {
  assert.deepEqual(paymentTermsFor({ orderTerms: 60, vendorTerms: 15 }), { days: 60, capped: false })
  assert.deepEqual(paymentTermsFor({ orderTerms: null, vendorTerms: 15 }), { days: 15, capped: false })
  assert.deepEqual(paymentTermsFor({}), { days: 30, capped: false })
  // 0 days is "pay on the invoice date", not "not set"
  assert.deepEqual(paymentTermsFor({ orderTerms: 0, vendorTerms: 45 }), { days: 0, capped: false })
  assert.deepEqual(paymentTermsFor({ orderTerms: 90, msme: true }), { days: MSME_MAX_DAYS, capped: true })
  assert.deepEqual(paymentTermsFor({ vendorTerms: 30, msme: true }), { days: 30, capped: false })
})

test('the due date is the invoice date plus the days', () => {
  assert.equal(dueDateFor(new Date('2026-10-01'), 30).toISOString().slice(0, 10), '2026-10-31')
  assert.equal(dueDateFor('2026-09-15', 45).toISOString().slice(0, 10), '2026-10-30')
  assert.equal(dueDateFor('2026-10-01', 0).toISOString().slice(0, 10), '2026-10-01')
  // across a year end
  assert.equal(dueDateFor('2026-12-20', 30).toISOString().slice(0, 10), '2027-01-19')
})

test('submitting: approved by the match itself, or on hold with the differences', () => {
  const now = new Date('2026-10-02T10:00:00Z')
  const yes = submitOutcome({ matched: true, mismatch: null }, now)
  assert.equal(yes.status, 'approved')
  assert.equal(yes.matched, true)
  assert.equal(yes.decidedByName, AUTO_DECIDER)
  assert.equal(yes.decidedAt, now)
  assert.equal(yes.submittedAt, now)
  assert.equal(yes.decisionRemark, null)
  const no = submitOutcome({ matched: false, mismatch: 'Chair: rate ₹3,100 vs ordered ₹3,000' }, now)
  assert.equal(no.status, 'on_hold')
  assert.equal(no.matched, false)
  assert.equal(no.mismatch, 'Chair: rate ₹3,100 vs ordered ₹3,000')
  assert.equal(no.decidedAt, null)
  assert.equal(no.decidedByName, null)
})
