// TDS on vendor bills: the rate per section and PAN, the vendor's default, an
// override on the bill, and the amount in whole rupees. Pure functions, so no
// database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TDS_SECTIONS, TDS_SECTION_CODES, isTdsSection, tdsRateFor, tdsSectionsFor, tdsDefault, resolveTds, tdsAmountOf } from '../tds.js'

const COMPANY = 'AAKCM4821M' // 4th letter C
const PERSON = 'ABCPK1234L' // 4th letter P
const HUF = 'ABCHK1234L' // 4th letter H
const FIRM = 'AAPFU0939F' // 4th letter F

test('the five sections, labelled as the vendor form labels them', () => {
  assert.deepEqual(TDS_SECTION_CODES, ['194C', '194J', '194I', '194H', '194Q'])
  assert.equal(TDS_SECTIONS.find((s) => s.section === '194C').label, '194C — Contractor')
  assert.equal(TDS_SECTIONS.find((s) => s.section === '194Q').label, '194Q — Purchase of goods')
  assert.ok(isTdsSection('194J'))
  assert.ok(!isTdsSection('194A'))
  assert.ok(!isTdsSection(null))
})

test('194C: 1% for an individual or HUF, 2% for anyone else', () => {
  assert.equal(tdsRateFor('194C', PERSON), 1)
  assert.equal(tdsRateFor('194C', HUF), 1)
  assert.equal(tdsRateFor('194C', COMPANY), 2)
  assert.equal(tdsRateFor('194C', FIRM), 2)
  // typed in small letters with a space: still that PAN
  assert.equal(tdsRateFor('194C', ' abcpk1234l '), 1)
})

test('the other sections at their rates', () => {
  assert.equal(tdsRateFor('194J', COMPANY), 10)
  assert.equal(tdsRateFor('194I', PERSON), 10)
  assert.equal(tdsRateFor('194H', COMPANY), 2)
  assert.equal(tdsRateFor('194Q', COMPANY), 0.1)
})

test('no PAN (or one that is not a PAN): 20%, and 5% under 194Q', () => {
  for (const pan of [null, undefined, '', 'NOTAPAN', 'AAKCM4821']) {
    assert.equal(tdsRateFor('194C', pan), 20, String(pan))
    assert.equal(tdsRateFor('194J', pan), 20)
    assert.equal(tdsRateFor('194Q', pan), 5)
  }
})

test('no section, or an unknown one: no TDS', () => {
  assert.equal(tdsRateFor(null, COMPANY), 0)
  assert.equal(tdsRateFor('194Z', COMPANY), 0)
})

test('the section list carries this vendor\'s rates', () => {
  const person = tdsSectionsFor(PERSON)
  assert.equal(person.find((s) => s.section === '194C').rate, 1)
  assert.equal(person.find((s) => s.section === '194J').rate, 10)
  const noPan = tdsSectionsFor(null)
  assert.ok(noPan.every((s) => s.rate === (s.section === '194Q' ? 5 : 20)))
  // the shared list itself is not changed by asking
  assert.equal(TDS_SECTIONS.find((s) => s.section === '194C').rate, 2)
})

test('a bill starts from the vendor\'s default section, with a note saying why', () => {
  const company = tdsDefault({ defaultTdsSection: '194C', pan: COMPANY })
  assert.equal(company.section, '194C')
  assert.equal(company.rate, 2)
  assert.match(company.note, /194C — Contractor at 2%/)
  assert.match(company.note, /not an individual/)
  assert.match(tdsDefault({ defaultTdsSection: '194C', pan: PERSON }).note, /individual or HUF/)
  const noPan = tdsDefault({ defaultTdsSection: '194J', pan: null })
  assert.equal(noPan.rate, 20)
  assert.match(noPan.note, /no PAN.*206AA/)
  assert.deepEqual(tdsDefault({ defaultTdsSection: null, pan: COMPANY }), { section: null, rate: 0, note: 'No TDS section is set for this vendor' })
  assert.equal(tdsDefault().section, null)
})

test('the bill may override the section and the rate', () => {
  const vendor = { defaultTdsSection: '194C', pan: COMPANY }
  // nothing typed → the default
  assert.deepEqual(resolveTds({}, vendor), { tdsSection: '194C', tdsRate: 2 })
  // another section, no rate → that section's rate for this PAN
  assert.deepEqual(resolveTds({ section: '194J' }, vendor), { tdsSection: '194J', tdsRate: 10 })
  // a rate typed (a lower-deduction certificate) → that rate
  assert.deepEqual(resolveTds({ section: '194J', rate: 2 }, vendor), { tdsSection: '194J', tdsRate: 2 })
  assert.deepEqual(resolveTds({ rate: 0.5 }, vendor), { tdsSection: '194C', tdsRate: 0.5 })
  assert.deepEqual(resolveTds({ section: '194C', rate: 0 }, vendor), { tdsSection: '194C', tdsRate: 0 })
  // "No TDS" chosen: none, whatever rate came with it
  assert.deepEqual(resolveTds({ section: null }, vendor), { tdsSection: null, tdsRate: 0 })
  assert.deepEqual(resolveTds({ section: '', rate: 10 }, vendor), { tdsSection: null, tdsRate: 0 })
  // a vendor without a default and nothing chosen → none
  assert.deepEqual(resolveTds({}, { pan: COMPANY }), { tdsSection: null, tdsRate: 0 })
})

test('TDS is on the value before GST, in whole rupees', () => {
  assert.equal(tdsAmountOf(10000, 2), 200)
  assert.equal(tdsAmountOf(12345.67, 2), 247) // 246.91
  assert.equal(tdsAmountOf(1234.5, 1), 12) // 12.345
  assert.equal(tdsAmountOf(150, 1), 2) // 1.50 → up
  assert.equal(tdsAmountOf(49999, 0.1), 50) // 49.999
  assert.equal(tdsAmountOf(400, 0.1), 0) // 0.40
  assert.equal(tdsAmountOf(0, 10), 0)
  assert.equal(tdsAmountOf(5000, 0), 0)
  assert.equal(tdsAmountOf(null, 2), 0)
})
