// Returns to the vendor: what can go back, its money, where the debit note
// goes, and what is billable once goods went back. Pure functions, no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  returnableOnLine, batchInOrderUnit, checkReturnLine, priceReturnLine, returnTotals, sumBy,
  settlementFor, stillToPay, debitNoteAfter, returnedAfter, RETURN_REASONS,
} from '../purchaseReturns.js'
import { billableOf, unbilledReturnedOf } from '../vendorBills.js'
import { lineAmounts } from '../purchaseOrders.js'

// gloves: 10 BOX ordered at ₹500 less 10%, GST 5%; 1 BOX = 100 PCS
const gloves = (over = {}) => ({ id: 'ol1', itemName: 'Gloves', unitCode: 'BOX', unitFactor: 100, quantity: 10, receivedQty: 10, billedQty: 0, returnedQty: 0, rate: 500, discountPct: 10, gstRate: 5, ...over })
const chair = (over = {}) => ({ id: 'ol2', itemName: 'Chair', unitCode: 'PCS', unitFactor: 1, quantity: 4, receivedQty: 4, billedQty: 0, returnedQty: 0, rate: 3000, discountPct: 0, gstRate: 18, ...over })

test('the reasons a return may give', () => {
  assert.deepEqual(RETURN_REASONS, ['damaged', 'wrong_item', 'expired', 'near_expiry', 'quality', 'other'])
})

test('returnable on a line: received less returned less waiting, never below 0', () => {
  assert.equal(returnableOnLine(gloves()), 10)
  assert.equal(returnableOnLine(gloves({ returnedQty: 3 })), 7)
  assert.equal(returnableOnLine(gloves({ returnedQty: 3 }), 2), 5)
  assert.equal(returnableOnLine(gloves({ returnedQty: 10 }), 1), 0)
  assert.equal(returnableOnLine(gloves({ receivedQty: 0.3, returnedQty: 0.1 + 0.2 })), 0)
  assert.equal(returnableOnLine(null), 0)
})

test('a batch in the order unit: whole units give only whole ones', () => {
  assert.equal(batchInOrderUnit(250, 100, true), 2)
  assert.equal(batchInOrderUnit(250, 100, false), 2.5)
  assert.equal(batchInOrderUnit(300, 100, true), 3)
  // 2.9999999 boxes from float noise is 3, not 2
  assert.equal(batchInOrderUnit(299.99999999, 100, true), 3)
  assert.equal(batchInOrderUnit(-5, 1), 0)
  assert.equal(batchInOrderUnit(7, 0), 7)
})

test('a return line: quantity, whole units, the order line, then the shelf', () => {
  const base = { itemName: 'Gloves', unitCode: 'BOX', batchNumber: 'GL-1', unitFactor: 100, wholeOnly: true, onShelf: 4, onLine: 6 }
  assert.deepEqual(checkReturnLine({ ...base, quantity: 3 }), { stockQty: 300 })
  assert.match(checkReturnLine({ ...base, quantity: 0 }).error, /enter how much/)
  assert.match(checkReturnLine({ ...base, quantity: -1 }).error, /enter how much/)
  assert.match(checkReturnLine({ ...base, quantity: 1.5 }).error, /whole BOX/)
  assert.match(checkReturnLine({ ...base, quantity: 7 }).error, /only 6 BOX received on this order can still go back/)
  assert.match(checkReturnLine({ ...base, quantity: 5 }).error, /batch GL-1: only 4 BOX is on the shelf/)
  assert.match(checkReturnLine({ ...base, quantity: 1, onShelf: 0 }).error, /nothing of it is left on the shelf/)
  assert.match(checkReturnLine({ ...base, quantity: 1, onLine: 0 }).error, /already gone back/)
  assert.match(checkReturnLine({ ...base, batchNumber: null, quantity: 5 }).error, /this batch/)
  // fractions are fine where the unit takes them
  assert.deepEqual(checkReturnLine({ ...base, wholeOnly: false, unitFactor: 1, quantity: 1.5 }), { stockQty: 1.5 })
})

test('a returned line is priced as the order priced it', () => {
  const p = priceReturnLine(gloves(), 2, 'intra')
  assert.deepEqual(p, { rate: 450, gstRate: 5, taxable: 900, gstAmount: 45, lineTotal: 945 })
  // returning everything is the order line's own amount to the paisa
  const all = priceReturnLine(gloves(), 10, 'intra')
  assert.deepEqual({ taxable: all.taxable, gstAmount: all.gstAmount, lineTotal: all.lineTotal }, lineAmounts({ quantity: 10, rate: 500, discountPct: 10, gstRate: 5 }, 'intra'))
  // a vendor without GST registration charged none, so none comes back
  assert.deepEqual(priceReturnLine(chair(), 1, 'none'), { rate: 3000, gstRate: 0, taxable: 3000, gstAmount: 0, lineTotal: 3000 })
  // ₹333.33 less 10% keeps paisa arithmetic, not ₹299.997
  assert.equal(priceReturnLine({ rate: 333.33, discountPct: 10, gstRate: 18 }, 3).taxable, 899.99)
})

test('return totals add the lines', () => {
  const lines = [priceReturnLine(gloves(), 2), priceReturnLine(chair(), 1)]
  assert.deepEqual(returnTotals(lines), { subtotal: 3900, gstAmount: 585, total: 4485 })
  assert.deepEqual(returnTotals([]), { subtotal: 0, gstAmount: 0, total: 0 })
})

test('sumBy adds quantities per key without float dust', () => {
  const m = sumBy([{ k: 'a', quantity: 0.1 }, { k: 'a', quantity: 0.2 }, { k: 'b', quantity: 1 }], (r) => r.k)
  assert.equal(m.get('a'), 0.3)
  assert.equal(m.get('b'), 1)
})

test('billable once goods went back: a return before billing is no longer billable; one on a bill does not count twice', () => {
  assert.equal(billableOf(gloves({ returnedQty: 2 })), 8)
  assert.equal(billableOf(gloves({ billedQty: 6, returnedQty: 3 })), 1)
  // 6 billed, then 3 of the billed goods returned against that bill: 4 still unbilled
  assert.equal(billableOf(gloves({ billedQty: 6, returnedQty: 3, returnedOnBillsQty: 3 })), 4)
  // later 2 more arrive: they are billable
  assert.equal(billableOf(gloves({ receivedQty: 12, billedQty: 10, returnedQty: 3, returnedOnBillsQty: 3 })), 2)
  // never below 0, and never a negative "unbilled return"
  assert.equal(billableOf(gloves({ billedQty: 10, returnedQty: 2 })), 0)
  assert.equal(unbilledReturnedOf(gloves({ returnedQty: 1, returnedOnBillsQty: 3 })), 0)
  // the old rule still holds with no returns at all
  assert.equal(billableOf(gloves({ billedQty: 4 })), 6)
})

test('settlement: nothing billed → the order line stops being billable for it', () => {
  const orderLines = new Map([['ol1', gloves({ billedQty: 6 })]])
  assert.deepEqual(settlementFor({ lines: [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 4 }], orderLines, bills: [] }), { billId: null })
})

test('settlement: billed goods go on the newest passed bill that holds them all', () => {
  const orderLines = new Map([['ol1', gloves({ billedQty: 10 })], ['ol2', chair({ billedQty: 4 })]])
  const bills = [
    { id: 'b2', number: 'BILL-2', status: 'approved', lines: [{ orderLineId: 'ol1', quantity: 4 }], returned: new Map() },
    { id: 'b1', number: 'BILL-1', status: 'paid', lines: [{ orderLineId: 'ol1', quantity: 6 }, { orderLineId: 'ol2', quantity: 4 }], returned: new Map() },
  ]
  // gloves 3: BILL-2 holds 4 → the newer one
  assert.deepEqual(settlementFor({ lines: [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 3 }], orderLines, bills }), { billId: 'b2', number: 'BILL-2' })
  // gloves 5: only BILL-1 holds that many
  assert.deepEqual(settlementFor({ lines: [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 5 }], orderLines, bills }), { billId: 'b1', number: 'BILL-1' })
  // gloves + chair: only BILL-1 has both
  assert.equal(settlementFor({ lines: [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 1 }, { orderLineId: 'ol2', itemName: 'Chair', quantity: 1 }], orderLines, bills }).billId, 'b1')
  // what earlier returns took against a bill is not on it any more
  bills[1].returned = new Map([['ol1', 2]])
  assert.match(settlementFor({ lines: [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 5 }], orderLines, bills }).error, /more than one vendor bill/)
})

test('settlement: a bill on hold, a mix of billed and unbilled, a draft that claims nothing', () => {
  const orderLines = new Map([['ol1', gloves({ billedQty: 10 })], ['ol2', chair()]])
  const onHold = [{ id: 'b3', number: 'BILL-3', status: 'on_hold', lines: [{ orderLineId: 'ol1', quantity: 10 }], returned: new Map() }]
  assert.match(settlementFor({ lines: [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 2 }], orderLines, bills: onHold }).error, /BILL-3, which is on hold/)
  const mix = settlementFor({ lines: [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 2 }, { orderLineId: 'ol2', itemName: 'Chair', quantity: 1 }], orderLines, bills: onHold })
  assert.match(mix.error, /Chair is not billed yet but the rest is — send them back on two returns/)
  // a rejected bill holds nothing
  const rejected = [{ id: 'b4', number: 'BILL-4', status: 'rejected', lines: [{ orderLineId: 'ol1', quantity: 10 }], returned: new Map() }]
  assert.match(settlementFor({ lines: [{ orderLineId: 'ol1', itemName: 'Gloves', quantity: 2 }], orderLines, bills: rejected }).error, /more than one vendor bill/)
})

test('still to pay, and the vendor owing once a debit note passes what was unpaid', () => {
  assert.equal(stillToPay({ payable: 1000, debitNoteTotal: 300, amountPaid: 500 }), 200)
  assert.equal(stillToPay({ payable: 1000, debitNoteTotal: 300, amountPaid: 1000 }), -300)
  assert.equal(stillToPay({ payable: 1000 }), 1000)
  assert.equal(stillToPay(null), 0)
})

test('debit-note and returned counts move both ways and never below 0', () => {
  assert.equal(debitNoteAfter(0, 945, 1), 945)
  assert.equal(debitNoteAfter(945, 945, -1), 0)
  assert.equal(debitNoteAfter(100, 945, -1), null)
  assert.equal(debitNoteAfter(0.1 + 0.2, 0.3, -1), 0)
  assert.equal(returnedAfter(0, 2, 1), 2)
  assert.equal(returnedAfter(2, 2, -1), 0)
  assert.equal(returnedAfter(1, 2, -1), null)
  assert.equal(returnedAfter(0.3, 0.1 + 0.2, -1), 0)
})
