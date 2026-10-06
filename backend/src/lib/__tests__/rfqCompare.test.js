// Comparing RFQ quotes: landed cost per unit, the lowest per line, vendor
// totals for the lines each can supply, and who is cheaper for the same lines.
// Pure functions, so no database.
//
// Run: node --test src/lib/__tests__/rfqCompare.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { landedUnitCost, isQuotable, compareQuotes, cheaperThan } from '../rfqCompare.js'
import { lineAmounts, orderTotals } from '../purchaseOrders.js'

test('landed cost per unit: rate less discount plus GST; an unregistered vendor charges no GST', () => {
  assert.equal(landedUnitCost({ rate: 100, discountPct: 10, gstRate: 5 }), 94.5)
  assert.equal(landedUnitCost({ rate: 100, discountPct: 10, gstRate: 5 }, 'inter'), 94.5)
  assert.equal(landedUnitCost({ rate: 100, discountPct: 10, gstRate: 18 }, 'none'), 90)
  assert.equal(landedUnitCost({ rate: 33.33, gstRate: 18 }), 39.33) // paisa, not float dust
  assert.equal(landedUnitCost({ rate: 0, gstRate: 18 }), 0)
})

test('a quote counts only when available and priced', () => {
  assert.equal(isQuotable({ rate: 10, available: true }), true)
  assert.equal(isQuotable({ rate: 10, available: false }), false)
  assert.equal(isQuotable({ rate: 0, available: true }), false)
  assert.equal(isQuotable(null), false)
})

// Two lines: 10 boxes of gloves, 4 chairs. Three vendors.
const lines = [{ id: 'gl', quantity: 10 }, { id: 'ch', quantity: 4 }]
const vendors = [
  { id: 'A', status: 'quoted', gstType: 'intra' },
  { id: 'B', status: 'quoted', gstType: 'inter' },
  { id: 'C', status: 'quoted', gstType: 'none' }, // not GST-registered
  { id: 'D', status: 'declined', gstType: 'intra' },
  { id: 'E', status: 'invited', gstType: 'intra' },
]
const quotes = [
  { vendorId: 'A', lineId: 'gl', rate: 200, discountPct: 0, gstRate: 5, available: true },  // 210 landed
  { vendorId: 'A', lineId: 'ch', rate: 3000, discountPct: 5, gstRate: 18, available: true }, // 3363 landed
  { vendorId: 'B', lineId: 'gl', rate: 190, discountPct: 0, gstRate: 5, available: true },  // 199.50 — lowest gloves
  { vendorId: 'B', lineId: 'ch', rate: 3100, discountPct: 0, gstRate: 18, available: true }, // 3658
  { vendorId: 'C', lineId: 'gl', rate: 205, discountPct: 0, gstRate: 5, available: true },  // 205 (no GST)
  { vendorId: 'C', lineId: 'ch', rate: 0, available: false },                                // cannot supply
  { vendorId: 'D', lineId: 'gl', rate: 1, gstRate: 0, available: true },                     // declined: ignored
]

test('per line: landed cost for each vendor that can supply it, the lowest marked', () => {
  const c = compareQuotes({ lines, vendors, quotes })
  assert.deepEqual(c.lines.gl.landed, { A: 210, B: 199.5, C: 205 })
  assert.equal(c.lines.gl.lowest, 199.5)
  assert.deepEqual(c.lines.gl.lowestVendorIds, ['B'])
  assert.deepEqual(c.lines.ch.landed, { A: 3363, B: 3658 })
  assert.deepEqual(c.lines.ch.lowestVendorIds, ['A'])
  assert.equal(c.vendors.D, undefined, 'a declined vendor takes no part')
  assert.equal(c.vendors.E, undefined, 'a vendor who has not answered takes no part')
})

test('vendor totals are the purchase order the award would make, for the lines it can supply', () => {
  const c = compareQuotes({ lines, vendors, quotes })
  const a = orderTotals([lineAmounts({ quantity: 10, rate: 200, gstRate: 5 }), lineAmounts({ quantity: 4, rate: 3000, discountPct: 5, gstRate: 18 })], 'intra')
  assert.equal(c.vendors.A.total, a.total) // 2100 + 13452 = 15552
  assert.equal(c.vendors.A.total, 15552)
  assert.equal(c.vendors.A.cgst + c.vendors.A.sgst, 2152) // 100 + 2052
  assert.equal(c.vendors.B.total, 1995 + 14632)
  assert.equal(c.vendors.B.igst, 95 + 2232)
  assert.deepEqual(c.vendors.C.lineIds, ['gl'], 'C can supply the gloves only')
  assert.equal(c.vendors.C.total, 2050)
  assert.equal(c.vendors.C.complete, false)
  assert.equal(c.vendors.A.complete, true)
  assert.equal(c.cheapestCompleteVendorId, 'A', 'A is cheapest of those who can supply everything')
})

test('who is cheaper for the same lines', () => {
  const c = compareQuotes({ lines, vendors, quotes })
  assert.deepEqual(cheaperThan(c, vendors, 'A'), [], 'A is cheapest for both lines')
  const forB = cheaperThan(c, vendors, 'B')
  assert.deepEqual(forB.map((x) => x.vendorId), ['A'])
  assert.equal(forB[0].saving, 16627 - 15552)
  // C quoted gloves only: A (2100) and B (1995) both quote gloves; B is cheaper than C's 2050.
  const forC = cheaperThan(c, vendors, 'C')
  assert.deepEqual(forC.map((x) => x.vendorId), ['B'])
  assert.equal(forC[0].total, 1995)
  assert.deepEqual(cheaperThan(c, vendors, 'D'), [], 'a vendor with no quote has nothing to compare')
})

test('ties: equal landed cost marks both; equal totals need no reason', () => {
  const tieQuotes = [
    { vendorId: 'A', lineId: 'gl', rate: 100, gstRate: 5, available: true },
    { vendorId: 'B', lineId: 'gl', rate: 100, gstRate: 5, available: true },
  ]
  const c = compareQuotes({ lines: [{ id: 'gl', quantity: 3 }], vendors: vendors.slice(0, 2), quotes: tieQuotes })
  assert.deepEqual(c.lines.gl.lowestVendorIds.sort(), ['A', 'B'])
  assert.deepEqual(cheaperThan(c, vendors.slice(0, 2), 'B'), [])
})

test('nobody quoted: no lowest, no cheapest', () => {
  const c = compareQuotes({ lines, vendors: [{ id: 'A', status: 'invited', gstType: 'intra' }], quotes: [] })
  assert.equal(c.lines.gl.lowest, null)
  assert.equal(c.cheapestCompleteVendorId, null)
})
