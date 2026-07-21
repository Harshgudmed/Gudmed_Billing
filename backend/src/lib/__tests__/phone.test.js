import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { normalizeIndianMobile, isValidIndianMobile, optionalMobileSchema } from '../phone.js'

// ---------- the real bad data found in the database ----------

test('a 91-prefixed number whose remainder is NOT a mobile stays unfixable', () => {
  // Real row: Harsh Mohan Bansal's stored "913029320008". Stripping 91 leaves
  // 3029320008, which starts with 3 — not a dialable Indian mobile. So this is
  // not a country-code mistake at all; the underlying number is wrong, and no
  // cleanup can invent the right one. It has to be re-entered by a human.
  assert.equal(normalizeIndianMobile('913029320008'), null)
})

test('91-prefixed 12-digit numbers become their real 10 digits', () => {
  assert.equal(normalizeIndianMobile('919876543210'), '9876543210')
  assert.equal(normalizeIndianMobile('+919876543210'), '9876543210')
  assert.equal(normalizeIndianMobile('0919876543210'), '9876543210')
})

test('junk that merely LOOKS long enough is rejected, not stored', () => {
  // 788775657656 is 12 digits but has no country code to strip — the old
  // `min(10)` check let it through.
  assert.equal(normalizeIndianMobile('788775657656'), null)
})

// ---------- formatting noise ----------

test('spaces, dashes and brackets are removed', () => {
  assert.equal(normalizeIndianMobile('+91 98765 43210'), '9876543210')
  assert.equal(normalizeIndianMobile('98765-43210'), '9876543210')
  assert.equal(normalizeIndianMobile('(+91) 9876543210'), '9876543210')
})

test('a single leading zero (STD habit) is dropped', () => {
  assert.equal(normalizeIndianMobile('09876543210'), '9876543210')
})

test('an already-clean number passes through unchanged', () => {
  assert.equal(normalizeIndianMobile('9876543210'), '9876543210')
})

// ---------- rejection ----------

test('too short, too long, or a landline-style prefix is rejected', () => {
  assert.equal(normalizeIndianMobile('12345'), null)
  assert.equal(normalizeIndianMobile('98765432101234'), null)
  assert.equal(normalizeIndianMobile('1234567890'), null) // must start 6-9
  assert.equal(normalizeIndianMobile('5876543210'), null)
})

test('empty and non-string input never throws', () => {
  assert.equal(normalizeIndianMobile(''), null)
  assert.equal(normalizeIndianMobile(null), null)
  assert.equal(normalizeIndianMobile(undefined), null)
  assert.equal(normalizeIndianMobile(9876543210), '9876543210')
})

test('isValidIndianMobile only accepts the already-clean form', () => {
  assert.equal(isValidIndianMobile('9876543210'), true)
  assert.equal(isValidIndianMobile('919876543210'), false) // fixable, but not clean
  assert.equal(isValidIndianMobile(''), false)
})

// ---------- the zod field ----------

test('the optional field accepts blank, cleans valid, and rejects bad', () => {
  const schema = z.object({ phonePrimary: optionalMobileSchema(z, 'Phone') })

  assert.equal(schema.parse({}).phonePrimary, null)
  assert.equal(schema.parse({ phonePrimary: '' }).phonePrimary, null)
  assert.equal(schema.parse({ phonePrimary: '  ' }).phonePrimary, null)
  assert.equal(schema.parse({ phonePrimary: '+91 98765 43210' }).phonePrimary, '9876543210')
  assert.equal(schema.parse({ phonePrimary: '919876543210' }).phonePrimary, '9876543210')

  // A wrong number must FAIL rather than land in the table as null — otherwise
  // a typo silently erases the patient's contact details.
  assert.throws(() => schema.parse({ phonePrimary: '12345' }), /10-digit/)
  assert.throws(() => schema.parse({ phonePrimary: '788775657656' }), /10-digit/)
})
