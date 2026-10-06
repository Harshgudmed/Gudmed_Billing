// Purchase-order arithmetic and the GST type a vendor charges. Pure functions,
// so no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gstTypeFor, lineAmounts, orderTotals } from '../purchaseOrders.js'
import { stateCodeByName } from '../gst.js'

test('GST type follows the vendor: none unregistered, CGST+SGST same state, IGST across', () => {
  assert.equal(gstTypeFor({ gstNumber: null, stateCode: '06' }, '06'), 'none')
  assert.equal(gstTypeFor({ gstNumber: '06AAKCS4821M1Z0', stateCode: '06' }, '06'), 'intra')
  assert.equal(gstTypeFor({ gstNumber: '29AAECT8834B1Z7', stateCode: '29' }, '06'), 'inter')
  // an unknown state on either side is taken as the same state
  assert.equal(gstTypeFor({ gstNumber: '06AAKCS4821M1Z0', stateCode: null }, '06'), 'intra')
  assert.equal(gstTypeFor({ gstNumber: '29AAECT8834B1Z7', stateCode: '29' }, null), 'intra')
})

test('a line: quantity × rate, less discount, plus GST; an unregistered vendor adds none', () => {
  assert.deepEqual(lineAmounts({ quantity: 10, rate: 310, gstRate: 5 }), { taxable: 3100, gstAmount: 155, lineTotal: 3255 })
  assert.deepEqual(lineAmounts({ quantity: 2, rate: 85000, discountPct: 10, gstRate: 5 }), { taxable: 153000, gstAmount: 7650, lineTotal: 160650 })
  assert.deepEqual(lineAmounts({ quantity: 10, rate: 310, gstRate: 5 }, 'none'), { taxable: 3100, gstAmount: 0, lineTotal: 3100 })
  // paisa, not floating-point dust
  assert.deepEqual(lineAmounts({ quantity: 3, rate: 33.33, gstRate: 18 }), { taxable: 99.99, gstAmount: 18, lineTotal: 117.99 })
})

test('order totals split CGST/SGST exactly, or all IGST, or none', () => {
  const lines = [lineAmounts({ quantity: 1, rate: 100.01, gstRate: 5 }), lineAmounts({ quantity: 1, rate: 50, gstRate: 18 })]
  const intra = orderTotals(lines, 'intra')
  assert.equal(intra.subtotal, 150.01)
  assert.equal(round(intra.cgst + intra.sgst), 14)           // 5.00 + 9.00
  assert.equal(intra.total, 164.01)
  assert.equal(intra.igst, 0)
  const odd = orderTotals([{ taxable: 10, gstAmount: 0.05 }], 'intra')
  assert.equal(round(odd.cgst + odd.sgst), 0.05)              // the odd paisa is not lost
  const inter = orderTotals(lines, 'inter')
  assert.equal(inter.igst, 14); assert.equal(inter.cgst, 0)
  const none = orderTotals([lineAmounts({ quantity: 1, rate: 100, gstRate: 18 }, 'none')], 'none')
  assert.deepEqual(none, { subtotal: 100, cgst: 0, sgst: 0, igst: 0, total: 100 })
})

test('the hospital state by name gives its GST code', () => {
  assert.equal(stateCodeByName('Haryana'), '06')
  assert.equal(stateCodeByName('  haryana '), '06')
  assert.equal(stateCodeByName('Jammu & Kashmir'), '01')
  assert.equal(stateCodeByName('Andhra Pradesh'), '37')
  assert.equal(stateCodeByName('Atlantis'), null)
  assert.equal(stateCodeByName(null), null)
})

const round = (n) => Math.round(n * 100) / 100
