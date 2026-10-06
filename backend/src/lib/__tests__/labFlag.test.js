import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultFlag } from '../labFlag.js'

const hb = { referenceMin: 12, referenceMax: 16, criticalLow: 7, criticalHigh: 20 }

test('a value above the range is HIGH even when nothing was ticked', () => {
  assert.deepEqual(resultFlag('18.2', hb), { flag: 'H', isAbnormal: true, isCritical: false })
})

test('a value below the range is LOW, not the HIGH the screen used to send', () => {
  assert.deepEqual(resultFlag('10', hb, { isAbnormal: true }), { flag: 'L', isAbnormal: true, isCritical: false })
})

test('a value inside the range is normal; the range ends are normal', () => {
  assert.deepEqual(resultFlag('13.5', hb), { flag: 'N', isAbnormal: false, isCritical: false })
  assert.equal(resultFlag(12, hb).flag, 'N')
  assert.equal(resultFlag(16, hb).flag, 'N')
})

test('past a critical limit is critical, with its direction', () => {
  assert.deepEqual(resultFlag('6.5', hb), { flag: 'L', isAbnormal: true, isCritical: true })
  assert.deepEqual(resultFlag('21', hb), { flag: 'H', isAbnormal: true, isCritical: true })
})

test("the technician's tick is kept inside the range", () => {
  assert.deepEqual(resultFlag('13', hb, { isAbnormal: true }), { flag: 'A', isAbnormal: true, isCritical: false })
  assert.deepEqual(resultFlag('13', hb, { isCritical: true }), { flag: 'A', isAbnormal: true, isCritical: true })
})

test('a value the range cannot judge keeps the ticks', () => {
  assert.deepEqual(resultFlag('Positive', hb), { flag: 'N', isAbnormal: false, isCritical: false })
  assert.deepEqual(resultFlag('Positive', hb, { isAbnormal: true }), { flag: 'A', isAbnormal: true, isCritical: false })
  assert.equal(resultFlag('<0.1', hb).flag, 'N')
  assert.equal(resultFlag('', hb).flag, 'N')
})

test('a test with only one end of the range is judged on that end', () => {
  assert.equal(resultFlag('250', { referenceMax: 200 }).flag, 'H')
  assert.equal(resultFlag('5', { referenceMax: 200 }).flag, 'N')
  assert.equal(resultFlag('5', {}).flag, 'N')
})
