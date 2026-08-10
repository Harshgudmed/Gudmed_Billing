// Every printed document must state the hospital the same way.
//
// It did not. There were five headers in printBilling.js and they disagreed about
// where the details come from:
//
//   invoice + receipt      clinic.address / clinic.phone / clinic.email
//   lab + radiology        clinic.address || orgInfo.address, then orgInfo.*
//   pharmacy              orgInfo.address, orgInfo.phone || clinic.phone
//
// `clinic` is a per-machine override kept in localStorage. On a front-desk machine
// whose saved profile has no email, the invoice printed no email at all while the
// lab receipt printed it correctly — the same hospital, two documents, two
// identities. The invoice also printed the raw address string, which wraps
// mid-sentence, instead of the one clean line the other three built.
//
// Named for that failure. The rule is: localStorage overrides, the organisation
// record fills in, and nothing silently disappears because one source is empty.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Loaded from source rather than imported: printBilling.js pulls in browser-only
// modules (sonner, window), and the header builder is pure.
const SRC = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../../../src/components/billing/utils/printBilling.js'),
  'utf8',
)
const hospitalHeaderLines = eval(
  '(' + SRC.match(/export function hospitalHeaderLines[\s\S]*?\n}/)[0].replace('export function', 'function') + ')',
)

const ORG = {
  name: 'GudMed Super Speciality Hospital',
  address: 'MM Towers, Sector 18, Gurugram, Haryana 122015',
  city: 'Gurugram',
  region: 'Haryana',
  phone: '+91-9999196828',
  email: 'cs@gudmed.in',
}
const get = (lines, key) => lines.find(([k]) => k === key)?.[1]

test('the email still prints when the machine has no saved clinic profile', () => {
  // The exact case from the reported invoice: clinic empty, so the header that
  // read only clinic.email printed nothing at all.
  const lines = hospitalHeaderLines(ORG, {})
  assert.equal(get(lines, 'Email'), 'cs@gudmed.in')
  assert.equal(get(lines, 'Phone'), '+91-9999196828')
  assert.ok(get(lines, 'Address').includes('MM Towers'))
})

test('a clinic profile overrides the organisation record, field by field', () => {
  const lines = hospitalHeaderLines(ORG, { address: 'Branch Road, Delhi', phone: '011-4000' })
  assert.equal(get(lines, 'Address'), 'Branch Road, Delhi')
  assert.equal(get(lines, 'Phone'), '011-4000')
  // Not overridden, so it must still come through rather than vanish.
  assert.equal(get(lines, 'Email'), 'cs@gudmed.in')
})

test('the city and state are not appended twice', () => {
  // The address field usually already ends with them; appending again produced
  // "…Gurugram, Haryana, Gurugram, Haryana" on the printed page.
  const addr = hospitalHeaderLines(ORG, {})[0][1]
  assert.equal(addr.match(/Gurugram/g).length, 1)
  assert.equal(addr.match(/Haryana/g).length, 1)
})

test('the city and state ARE appended when the ORGANISATION address omits them', () => {
  const lines = hospitalHeaderLines({ ...ORG, address: 'MM Towers, Sector 18' }, {})
  assert.equal(get(lines, 'Address'), 'MM Towers, Sector 18, Gurugram, Haryana')
})

test("a branch address typed by the front desk is not given head office's city", () => {
  // The first version appended orgInfo.city/region to a clinic override too, so a
  // Delhi branch printed "Branch Road, Delhi, Gurugram, Haryana".
  const lines = hospitalHeaderLines(ORG, { address: 'Branch Road, Delhi' })
  assert.equal(get(lines, 'Address'), 'Branch Road, Delhi')
})

test('a blank line is dropped rather than printed as an empty row', () => {
  const lines = hospitalHeaderLines({ name: 'X', address: 'Somewhere' }, {})
  assert.equal(lines.length, 1, 'only Address has a value')
  assert.equal(lines[0][0], 'Address')
})
