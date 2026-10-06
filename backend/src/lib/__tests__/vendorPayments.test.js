// Vendor payments: who records and approves in each payment mode, what is
// still due on a bill, the ageing buckets, and the MSME 45-day flag. Pure
// functions, so no database. (The payables query works the same figures out
// in SQL; scratchpad/payments/api.mjs compares the two on real bills.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  paymentRules, stillDue, payableNow, addDays, daysBetween, dueDayOf, bucketOf, msmeStatus, ageOf,
  BUCKET_KEYS, PAY_MODES, REFERENCE_NAME, MSME_MAX_DAYS, MSME_WARN_DAYS,
} from '../vendorPayments.js'

test('finance mode (the default): Finance or an administrator records, posted at once', () => {
  for (const mode of ['finance', undefined, 'nonsense']) {
    const r = paymentRules(mode)
    assert.equal(r.status, 'posted')
    assert.ok(r.recorders.includes('finance_controller') && r.recorders.includes('admin') && r.recorders.includes('super_admin'))
    assert.ok(!r.recorders.includes('purchase_officer') && !r.recorders.includes('store_keeper'))
  }
})

test('officer_finance mode: the purchase officer records, it waits; Finance decides', () => {
  const r = paymentRules('officer_finance')
  assert.equal(r.status, 'pending_approval')
  assert.deepEqual([...r.recorders].sort(), ['admin', 'purchase_officer', 'super_admin'])
  assert.deepEqual([...r.deciders].sort(), ['admin', 'finance_controller', 'super_admin'])
})

test('admin mode: only an administrator records and decides', () => {
  const r = paymentRules('admin')
  assert.equal(r.status, 'posted')
  assert.deepEqual([...r.recorders].sort(), ['admin', 'super_admin'])
  assert.deepEqual([...r.deciders].sort(), ['admin', 'super_admin'])
})

test('the store keeper never records or decides, in any mode', () => {
  for (const mode of ['finance', 'officer_finance', 'admin']) {
    const r = paymentRules(mode)
    assert.ok(!r.recorders.includes('store_keeper') && !r.deciders.includes('store_keeper'))
  }
})

test('still due = payable − debit notes − posted payments, to the paisa, never below 0', () => {
  assert.equal(stillDue({ payable: 1000, debitNoteTotal: 0, amountPaid: 0 }), 1000)
  assert.equal(stillDue({ payable: 2000, debitNoteTotal: 200, amountPaid: 1500 }), 300)
  assert.equal(stillDue({ payable: 333.33, debitNoteTotal: 0, amountPaid: 100.1 }), 233.23)
  // floating-point dust: 0.1 + 0.2 paid on 0.3
  assert.equal(stillDue({ payable: 0.3, amountPaid: 0.1 + 0.2 }), 0)
  assert.equal(stillDue({ payable: 1000, debitNoteTotal: 600, amountPaid: 500 }), 0) // a debit note after a payment: nothing due, not −100
  assert.equal(stillDue({}), 0)
  assert.equal(stillDue({ payable: '1000', debitNoteTotal: null, amountPaid: undefined }), 1000)
})

test('a pending payment holds its amount: what a new payment may be', () => {
  const bill = { payable: 2000, debitNoteTotal: 0, amountPaid: 0 }
  assert.equal(payableNow(bill), 2000)
  assert.equal(payableNow(bill, 1500), 500)
  assert.equal(payableNow(bill, 2000), 0)
  assert.equal(payableNow({ payable: 2000, debitNoteTotal: 200, amountPaid: 1500 }, 500), 0) // pending is over what is due
})

test('calendar arithmetic: across month ends, leap days and the year', () => {
  assert.equal(addDays('2026-01-31', 30), '2026-03-02')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-12-15', 45), '2027-01-29')
  assert.equal(addDays('2026-10-04', -10), '2026-09-24')
  assert.equal(daysBetween('2026-09-24', '2026-10-04'), 10)
  assert.equal(daysBetween('2026-10-04', '2026-09-24'), -10)
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30) // no DST in India, and none in UTC arithmetic either
})

test('the due day: the bill\'s own, else the vendor\'s terms from the bill date, else 30 days', () => {
  assert.equal(dueDayOf({ dueDay: '2026-11-03', invoiceDay: '2026-10-04', vendorTermsDays: 60 }), '2026-11-03')
  assert.equal(dueDayOf({ dueDay: null, invoiceDay: '2026-10-04', vendorTermsDays: 15 }), '2026-10-19')
  assert.equal(dueDayOf({ dueDay: null, invoiceDay: '2026-10-04', vendorTermsDays: 0 }), '2026-10-04') // cash on delivery
  assert.equal(dueDayOf({ dueDay: null, invoiceDay: '2026-10-04', vendorTermsDays: null }), '2026-11-03')
})

test('ageing buckets by days past due: due today is not overdue', () => {
  assert.deepEqual(BUCKET_KEYS, ['notDue', 'd1_30', 'd31_60', 'd61_90', 'd90plus'])
  const cases = [[-30, 'notDue'], [0, 'notDue'], [1, 'd1_30'], [30, 'd1_30'], [31, 'd31_60'], [60, 'd31_60'], [61, 'd61_90'], [90, 'd61_90'], [91, 'd90plus'], [4000, 'd90plus']]
  for (const [days, key] of cases) assert.equal(bucketOf(days), key, `${days} days`)
})

test('MSME: 45 days from the bill date; flagged within 7 days and once past', () => {
  assert.equal(MSME_MAX_DAYS, 45)
  assert.equal(MSME_WARN_DAYS, 7)
  const today = '2026-10-04'
  assert.deepEqual(msmeStatus({ msme: true, invoiceDay: '2026-08-25', today }), { msmeDeadline: '2026-10-09', msmeDaysLeft: 5, msmeFlag: 'near' })
  assert.equal(msmeStatus({ msme: true, invoiceDay: '2026-08-27', today }).msmeDaysLeft, 7)
  assert.equal(msmeStatus({ msme: true, invoiceDay: '2026-08-27', today }).msmeFlag, 'near') // exactly 7 left
  assert.equal(msmeStatus({ msme: true, invoiceDay: '2026-08-28', today }).msmeFlag, null) // 8 left
  assert.equal(msmeStatus({ msme: true, invoiceDay: '2026-08-20', today }).msmeFlag, 'near') // the last day itself
  assert.deepEqual(msmeStatus({ msme: true, invoiceDay: '2026-08-15', today }), { msmeDeadline: '2026-09-29', msmeDaysLeft: -5, msmeFlag: 'past' })
  assert.deepEqual(msmeStatus({ msme: false, invoiceDay: '2026-01-01', today }), { msmeDeadline: null, msmeDaysLeft: null, msmeFlag: null })
})

test('one bill aged: overdue days, bucket and the MSME flag together', () => {
  const today = '2026-10-04'
  assert.deepEqual(ageOf({ dueDay: '2026-09-24', invoiceDay: '2026-08-25', vendorTermsDays: 30, msme: false, today }),
    { dueDay: '2026-09-24', daysOverdue: 10, bucket: 'd1_30', msmeDeadline: null, msmeDaysLeft: null, msmeFlag: null })
  // An MSME vendor on 60-day terms: its bill is still "not due" by the agreed
  // terms, yet the law's 45 days are nearly up — the flag says so.
  const msme = ageOf({ dueDay: '2026-10-24', invoiceDay: '2026-08-25', vendorTermsDays: 60, msme: true, today })
  assert.equal(msme.bucket, 'notDue')
  assert.equal(msme.msmeFlag, 'near')
  assert.equal(ageOf({ dueDay: null, invoiceDay: '2026-05-27', vendorTermsDays: 30, msme: false, today }).bucket, 'd90plus') // 100 days overdue
})

test('every bank mode names its reference; cash needs none', () => {
  assert.deepEqual(PAY_MODES, ['neft', 'rtgs', 'imps', 'upi', 'cheque', 'dd', 'cash'])
  for (const m of PAY_MODES) assert.equal(!!REFERENCE_NAME[m], m !== 'cash', m)
})
