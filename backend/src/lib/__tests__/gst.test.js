// GSTIN / PAN / IFSC checks. Pure functions, so no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGstin, gstinCheckChar, isValidPan, isValidIfsc, cleanId } from '../gst.js'

// GSTN's own published sample GSTIN.
const SAMPLE = '27AAPFU0939F1ZV'

test('the published sample GSTIN is valid and yields its state and PAN', () => {
  const r = parseGstin(SAMPLE)
  assert.equal(r.ok, true)
  assert.equal(r.stateCode, '27')
  assert.equal(r.stateName, 'Maharashtra')
  assert.equal(r.pan, 'AAPFU0939F')
})

test('lower case and spaces are cleaned, not rejected', () => {
  assert.equal(parseGstin(' 27aapfu0939f1zv ').ok, true)
  assert.equal(cleanId(' ab cd '), 'ABCD')
})

test('one mistyped digit is caught by the check character', () => {
  const typo = '27AAPFU0938F1ZV' // 9 → 8
  const r = parseGstin(typo)
  assert.equal(r.ok, false)
  assert.match(r.error, /typing mistake/)
})

test('a well-formed GSTIN with an unknown state code is refused', () => {
  const first14 = '99AAPFU0939F1Z'
  const r = parseGstin(first14 + gstinCheckChar(first14))
  assert.equal(r.ok, false)
  assert.match(r.error, /not a GST state code/)
})

test('wrong length or shape is refused with an example', () => {
  for (const bad of ['', '27AAPFU0939F1Z', '27AAPFU0939F1ZVX', 'AAAAAAAAAAAAAAA', '27AAPFU0939F1YV']) {
    const r = parseGstin(bad)
    assert.equal(r.ok, false, bad)
    assert.match(r.error, /15 characters/)
  }
})

test('the check character is computed for every valid position', () => {
  // Changing any one of the first 14 characters must change the check character.
  const base = SAMPLE.slice(0, 14)
  for (let i = 0; i < 14; i++) {
    const swapped = base.slice(0, i) + (base[i] === '1' ? '2' : '1') + base.slice(i + 1)
    assert.notEqual(gstinCheckChar(swapped), SAMPLE[14], `position ${i}`)
  }
})

test('PAN and IFSC shapes', () => {
  assert.equal(isValidPan('AAPFU0939F'), true)
  assert.equal(isValidPan('aapfu0939f'), true)
  assert.equal(isValidPan('AAPF0939F'), false)
  assert.equal(isValidIfsc('SBIN0001234'), true)
  assert.equal(isValidIfsc('sbin0001234'), true)
  assert.equal(isValidIfsc('SBIN1001234'), false, '5th character must be 0')
  assert.equal(isValidIfsc('SBI0001234'), false)
})
