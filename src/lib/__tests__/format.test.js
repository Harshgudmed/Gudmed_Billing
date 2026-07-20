import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTime12h, formatDateTime } from '../format.js'

test('afternoon times convert to PM', () => {
  assert.equal(formatTime12h('13:45'), '1:45 PM')
  assert.equal(formatTime12h('23:59'), '11:59 PM')
})

test('morning times convert to AM', () => {
  assert.equal(formatTime12h('09:00'), '9:00 AM')
  assert.equal(formatTime12h('05:30'), '5:30 AM')
})

test('the two midnight/noon boundaries are not "0:00"', () => {
  assert.equal(formatTime12h('00:30'), '12:30 AM')
  assert.equal(formatTime12h('00:00'), '12:00 AM')
  assert.equal(formatTime12h('12:00'), '12:00 PM') // noon is PM, not AM
  assert.equal(formatTime12h('12:30'), '12:30 PM')
})

test('an unpadded time (legacy rows store "9:00") still converts', () => {
  assert.equal(formatTime12h('9:00'), '9:00 AM')
})

test('minutes stay zero-padded', () => {
  assert.equal(formatTime12h('14:05'), '2:05 PM')
})

test('unparseable input is returned untouched, never "NaN:NaN"', () => {
  assert.equal(formatTime12h(''), '')
  assert.equal(formatTime12h(null), '')
  assert.equal(formatTime12h(undefined), '')
  assert.equal(formatTime12h('not-a-time'), 'not-a-time')
})

test('double-formatting is a no-op, so an accidental re-format cannot corrupt a time', () => {
  // "1:45 PM".split(':')[1] is "45 PM" -> NaN -> the input is returned as-is.
  // This makes the helper safe to apply twice, but the value is still
  // DISPLAY-only: never store it or sort on it (sorting relies on 24h).
  assert.equal(formatTime12h(formatTime12h('13:45')), '1:45 PM')
})

// ---------- formatDateTime ----------

test('a raw API timestamp becomes a readable date and time', () => {
  // The exact value that leaked onto a receipt row.
  const out = formatDateTime('2026-07-20T06:50:01.555Z')
  assert.match(out, /20 Jul 2026/)
  assert.match(out, /\d{1,2}:\d{2}\s?(am|pm|AM|PM)/)
  assert.ok(!out.includes('T'), 'must not still look like an ISO string')
  assert.ok(!out.includes('Z'), 'must not still carry the UTC marker')
})

test('withTime:false gives a plain calendar date', () => {
  const out = formatDateTime('2026-07-20T06:50:01.555Z', { withTime: false })
  assert.match(out, /20 Jul 2026/)
  assert.ok(!/\d{1,2}:\d{2}/.test(out), 'should carry no clock time')
})

test('missing or unparseable timestamps render blank, never "Invalid Date"', () => {
  assert.equal(formatDateTime(null), '')
  assert.equal(formatDateTime(undefined), '')
  assert.equal(formatDateTime(''), '')
  assert.equal(formatDateTime('not-a-date'), '')
})

test('accepts a Date object as well as a string', () => {
  assert.match(formatDateTime(new Date('2026-07-20T06:50:01.555Z')), /20 Jul 2026/)
})
