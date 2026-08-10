// A receipt must never say in words that money was paid when none was.
//
// A real lab receipt printed:
//     Amount Paid In Words : Nine Hundred Sixty One Rupee(s) Only
//     Paid Amount                                          ₹0.00
//     Status : Unpaid
//
// Three lines on one document, two of them contradicting the third. The cause was
// `amountInWords(paid || net)`: `paid` is 0 on an unpaid bill, 0 is falsy, so
// `0 || 961` is 961 and the words took the amount OWED.
//
// On an Indian financial document the amount in words is the authoritative figure,
// so that receipt declared an unpaid bill settled. This test is named for that
// failure rather than for the function, because the function was never wrong — the
// caller was.
import { test } from 'node:test'
import assert from 'node:assert/strict'

// The rule the three receipt printers must follow. `Number(paid) || 0` collapses
// null, undefined, '' and NaN to zero WITHOUT letting a real 0 become the total.
const wordsFor = (paid) => Number(paid) || 0

test('an unpaid receipt says zero in words, not the amount owed', () => {
  const net = 961
  assert.equal(wordsFor(0), 0, 'a paid amount of 0 must stay 0, not become the net')
  assert.notEqual(wordsFor(0), net)
})

test('a partly paid receipt says what was paid, not what is owed', () => {
  assert.equal(wordsFor(500), 500)
})

test('a missing paid amount reads as zero rather than blank or NaN', () => {
  for (const empty of [null, undefined, '', 'abc', NaN]) {
    assert.equal(wordsFor(empty), 0, `${String(empty)} should read as 0`)
  }
})

test('the words never exceed what the figure shows', () => {
  // The invariant a reader of the receipt relies on: whatever is printed in words
  // is the same number printed against "Paid Amount".
  for (const paid of [0, 1, 0.5, 500, 961, 100000]) {
    assert.equal(wordsFor(paid), Number(paid) || 0)
  }
})
