import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOru, interpretAbnormalFlag, parseReferenceRange } from '../hl7Parser.js'
import { mapResultsToRows } from '../queueProcessor.js'

const ORU = [
  'MSH|^~\\&|COBAS|LAB|HMS|HOSP|20260630120000||ORU^R01|MSG00001|P|2.3.1',
  'PID|1||MRN12345^^^HOSP^MR||DOE^JOHN||19800101|M',
  'OBR|1|ORD789|ACC456|CBC^Complete Blood Count^L|||20260630113000',
  'OBX|1|NM|718-7^Hemoglobin^LN||9.2|g/dL|13.0-17.0|L|||F',
  'OBX|2|NM|789-8^RBC^LN||3.1|10*6/uL|4.5-5.9|LL|||F',
  'OBX|3|NM|6690-2^WBC^LN||7.5|10*3/uL|4.0-11.0|N|||F',
].join('\r')

test('parseOru extracts patient, order ids and results', () => {
  const p = parseOru(ORU)
  assert.equal(p.messageType, 'ORU')
  assert.equal(p.patientIdentifier, 'MRN12345')
  assert.equal(p.patientName, 'JOHN DOE')
  assert.equal(p.placerOrderNumber, 'ORD789') // OBR-2 → orderNumber
  assert.equal(p.fillerOrderNumber, 'ACC456')  // OBR-3 → accessionNumber
  assert.equal(p.results.length, 3)
})

test('abnormal/critical flags interpreted correctly', () => {
  const p = parseOru(ORU)
  const hgb = p.results.find((r) => r.code === '718-7')
  assert.equal(hgb.value, '9.2')
  assert.equal(hgb.unit, 'g/dL')
  assert.equal(hgb.isAbnormal, true)
  assert.equal(hgb.isCritical, false) // 'L' = abnormal only

  const rbc = p.results.find((r) => r.code === '789-8')
  assert.equal(rbc.isCritical, true)  // 'LL' = critical
  assert.equal(rbc.isAbnormal, true)

  const wbc = p.results.find((r) => r.code === '6690-2')
  assert.equal(wbc.isAbnormal, false) // 'N' = normal
})

test('reference ranges parsed into min/max', () => {
  const p = parseOru(ORU)
  const hgb = p.results.find((r) => r.code === '718-7')
  assert.equal(hgb.referenceRange.min, 13.0)
  assert.equal(hgb.referenceRange.max, 17.0)
  assert.equal(hgb.referenceRange.text, '13.0-17.0')
})

test('parseReferenceRange handles non-range forms', () => {
  assert.deepEqual(parseReferenceRange('<200'), { min: null, max: null, text: '<200' })
  assert.deepEqual(parseReferenceRange('Negative'), { min: null, max: null, text: 'Negative' })
  assert.deepEqual(parseReferenceRange(''), { min: null, max: null, text: null })
})

test('interpretAbnormalFlag matrix', () => {
  assert.deepEqual(interpretAbnormalFlag('H'), { isAbnormal: true, isCritical: false, flag: 'H' })
  assert.deepEqual(interpretAbnormalFlag('HH'), { isAbnormal: true, isCritical: true, flag: 'HH' })
  assert.deepEqual(interpretAbnormalFlag('N'), { isAbnormal: false, isCritical: false, flag: null })
  assert.deepEqual(interpretAbnormalFlag(''), { isAbnormal: false, isCritical: false, flag: null })
})

test('mapResultsToRows maps known codes and reports unmapped', () => {
  const p = parseOru(ORU)
  const mapping = { '718-7': 'test-hgb', '789-8': 'test-rbc' } // WBC intentionally unmapped
  const { rows, unmapped } = mapResultsToRows(p, mapping, {
    organizationId: 'org-demo',
    orderId: 'order-1',
    instrument: 'Cobas',
  })
  assert.equal(rows.length, 2)
  assert.deepEqual(unmapped, ['6690-2'])
  const hgbRow = rows.find((r) => r.testId === 'test-hgb')
  assert.equal(hgbRow.resultValue, '9.2')
  assert.equal(hgbRow.isAbnormal, true)
  assert.equal(hgbRow.referenceRangeMin, 13.0)
  assert.equal(hgbRow.instrumentUsed, 'Cobas')
  assert.equal(hgbRow.enteredById, null)
})

test('CRLF and LF line endings both parse', () => {
  assert.equal(parseOru(ORU.replace(/\r/g, '\r\n')).results.length, 3)
  assert.equal(parseOru(ORU.replace(/\r/g, '\n')).results.length, 3)
})
