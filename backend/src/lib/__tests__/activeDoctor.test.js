import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveActiveDoctor, assertValidShift, assertNoSelfOverlap, otherConcurrentDoctors } from '../activeDoctor.js'

const MON = 1 // JS Date#getDay(): 0=Sun..6=Sat
const ROOM = 'room-204'
const OTHER_ROOM = 'room-999'

function timetable(shiftsByDay) {
  const weeklySlots = {}
  for (const [day, shifts] of Object.entries(shiftsByDay)) {
    weeklySlots[day] = { active: true, shifts }
  }
  return { weeklySlots }
}

// ---------- no doctors / unassigned ----------

test('no candidate doctors at all → unassigned, not onBreak', () => {
  const r = resolveActiveDoctor(ROOM, [], { now: { hhmm: '10:00', dayOfWeek: MON } })
  assert.equal(r.unassigned, true)
  assert.equal(r.onBreak, false)
  assert.equal(r.doctorId, null)
})

test('doctor exists but their timetable has no shifts for THIS room at all → onBreak, never crashes', () => {
  const doctors = [{
    doctorId: 'd1', doctorName: 'Dr. Lonely',
    timetable: timetable({ Monday: [{ start: '09:00', end: '13:00', roomId: OTHER_ROOM }] }),
  }]
  const r = resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '10:00', dayOfWeek: MON } })
  assert.equal(r.onBreak, true)
  assert.equal(r.unassigned, false)
})

test('doctor with a null/missing timetable (never set one) → onBreak, never crashes', () => {
  const doctors = [{ doctorId: 'd1', doctorName: 'Dr. NoTimetable', timetable: null }]
  const r = resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '10:00', dayOfWeek: MON } })
  assert.equal(r.onBreak, true)
})

// ---------- single doctor, single shift ----------

test('one doctor, one shift, current time inside it → that doctor is active', () => {
  const doctors = [{
    doctorId: 'd1', doctorName: 'Dr. Patel',
    timetable: timetable({ Monday: [{ start: '09:00', end: '17:00', roomId: ROOM }] }),
  }]
  const r = resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '12:00', dayOfWeek: MON } })
  assert.equal(r.doctorId, 'd1')
  assert.equal(r.unassigned, false)
  assert.equal(r.onBreak, false)
})

test('start time is INCLUSIVE', () => {
  const doctors = [{ doctorId: 'd1', doctorName: 'Dr. Patel', timetable: timetable({ Monday: [{ start: '09:00', end: '17:00', roomId: ROOM }] }) }]
  assert.equal(resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '09:00', dayOfWeek: MON } }).doctorId, 'd1')
})

test('end time is EXCLUSIVE — the handoff instant is no longer this doctor\'s', () => {
  const doctors = [{ doctorId: 'd1', doctorName: 'Dr. Patel', timetable: timetable({ Monday: [{ start: '09:00', end: '17:00', roomId: ROOM }] }) }]
  const r = resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '17:00', dayOfWeek: MON } })
  assert.notEqual(r.doctorId, 'd1')
  assert.equal(r.onBreak, true)
})

test('wrong day of week (shift exists but not today) → onBreak', () => {
  const doctors = [{ doctorId: 'd1', doctorName: 'Dr. Patel', timetable: timetable({ Monday: [{ start: '09:00', end: '17:00', roomId: ROOM }] }) }]
  const r = resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '12:00', dayOfWeek: 2 /* Tuesday */ } })
  assert.equal(r.onBreak, true)
})

test('unpadded "9:0"-style stored time still matches (normalizeTimeHHMM reused)', () => {
  const doctors = [{ doctorId: 'd1', doctorName: 'Dr. X', timetable: timetable({ Monday: [{ start: '9:0', end: '13:0', roomId: ROOM }] }) }]
  const r = resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '09:30', dayOfWeek: MON } })
  assert.equal(r.doctorId, 'd1')
})

// ---------- shared room: two doctors, different shifts pointing at the SAME room ----------

const sharedDoctors = [
  { doctorId: 'patel', doctorName: 'Dr. Suresh Patel', timetable: timetable({ Monday: [{ start: '09:00', end: '13:00', roomId: ROOM }] }) },
  { doctorId: 'verma', doctorName: 'Dr. Rahul Verma', timetable: timetable({ Monday: [{ start: '14:00', end: '18:00', roomId: ROOM }] }) },
]

test('shared room: resolves to whichever doctor\'s shift contains "now"', () => {
  assert.equal(resolveActiveDoctor(ROOM, sharedDoctors, { now: { hhmm: '10:30', dayOfWeek: MON } }).doctorId, 'patel')
  assert.equal(resolveActiveDoctor(ROOM, sharedDoctors, { now: { hhmm: '15:00', dayOfWeek: MON } }).doctorId, 'verma')
})

test('shared room: gap between shifts → onBreak, not silently assigned to either doctor', () => {
  const r = resolveActiveDoctor(ROOM, sharedDoctors, { now: { hhmm: '13:30', dayOfWeek: MON } }) // 1-2pm lunch gap
  assert.equal(r.onBreak, true)
})

test('shared room: before the first shift and after the last shift → onBreak', () => {
  assert.equal(resolveActiveDoctor(ROOM, sharedDoctors, { now: { hhmm: '07:00', dayOfWeek: MON } }).onBreak, true)
  assert.equal(resolveActiveDoctor(ROOM, sharedDoctors, { now: { hhmm: '19:00', dayOfWeek: MON } }).onBreak, true)
})

test('a doctor can have shifts in MULTIPLE different rooms — only the shift for THIS room counts', () => {
  const doctors = [{
    doctorId: 'd1', doctorName: 'Dr. Multi-Room',
    timetable: timetable({
      Monday: [
        { start: '09:00', end: '12:00', roomId: ROOM },
        { start: '14:00', end: '18:00', roomId: OTHER_ROOM },
      ],
    }),
  }]
  assert.equal(resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '10:00', dayOfWeek: MON } }).doctorId, 'd1')
  // 3pm: this doctor is in the OTHER room, so ROOM correctly shows nobody active
  assert.equal(resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '15:00', dayOfWeek: MON } }).onBreak, true)
})

test('overlapping shifts from two doctors\' independent timetables (a real data-entry conflict) resolve deterministically, not crash', () => {
  const doctors = [
    { doctorId: 'a', doctorName: 'Dr. A', timetable: timetable({ Monday: [{ start: '10:00', end: '14:00', roomId: ROOM }] }) },
    { doctorId: 'b', doctorName: 'Dr. B', timetable: timetable({ Monday: [{ start: '09:00', end: '12:00', roomId: ROOM }] }) },
  ]
  const r = resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '11:00', dayOfWeek: MON } })
  assert.equal(r.doctorId, 'b') // 09:00 start sorts before 10:00
})

// ---------- manual override (absent-doctor case) ----------

test('override wins over a matching shift', () => {
  const r = resolveActiveDoctor(ROOM, sharedDoctors, {
    now: { hhmm: '10:30', dayOfWeek: MON }, // would normally resolve to Dr. Patel
    override: { doctorId: 'covering-doc', doctorName: 'Dr. Covering' },
  })
  assert.equal(r.doctorId, 'covering-doc')
  assert.equal(r.manual, true)
})

test('override wins even during a gap (onBreak would otherwise apply)', () => {
  const r = resolveActiveDoctor(ROOM, sharedDoctors, {
    now: { hhmm: '13:30', dayOfWeek: MON },
    override: { doctorId: 'covering-doc', doctorName: 'Dr. Covering' },
  })
  assert.equal(r.doctorId, 'covering-doc')
  assert.equal(r.onBreak, false)
})

test('override wins even with zero candidate doctors (unassigned would otherwise apply)', () => {
  const r = resolveActiveDoctor(ROOM, [], { override: { doctorId: 'x', doctorName: 'Dr. X' } })
  assert.equal(r.doctorId, 'x')
  assert.equal(r.unassigned, false)
})

test('override doctor need not be one of the room\'s candidate doctors (a covering doctor from elsewhere)', () => {
  const r = resolveActiveDoctor(ROOM, sharedDoctors, {
    now: { hhmm: '10:30', dayOfWeek: MON },
    override: { doctorId: 'outside-doc', doctorName: 'Dr. Outsider' },
  })
  assert.equal(r.doctorId, 'outside-doc')
})

// ---------- write-time validation ----------

test('assertValidShift rejects start === end', () => {
  assert.throws(() => assertValidShift({ start: '09:00', end: '09:00' }))
})

test('assertValidShift rejects start after end (overnight not supported)', () => {
  assert.throws(() => assertValidShift({ start: '22:00', end: '06:00' }))
})

test('assertValidShift accepts a normal same-day shift', () => {
  assert.doesNotThrow(() => assertValidShift({ start: '09:00', end: '13:00' }))
})

// Regression: NaN comparisons (>=, <, ==) are ALWAYS false in JS, so a naive
// `toMinutes(start) >= toMinutes(end)` check silently PASSED empty/malformed
// times instead of rejecting them — found live via an adversarial API test
// (empty-string shift times were accepted with HTTP 200 before this fix).
test('assertValidShift rejects empty-string times (regression: NaN >= NaN is false, not true)', () => {
  assert.throws(() => assertValidShift({ start: '', end: '' }), /Invalid shift time/)
})

test('assertValidShift rejects garbage/non-time strings', () => {
  assert.throws(() => assertValidShift({ start: 'not-a-time', end: '13:00' }), /Invalid shift time/)
  assert.throws(() => assertValidShift({ start: '09:00', end: undefined }), /Invalid shift time/)
})

// Defense in depth: write-time validation should block this now, but if
// malformed data ever reaches read time anyway (pre-fix rows, a manual DB
// edit), resolution must fail safe — never match, never throw — not crash
// the display board for every OTHER room too.
test('resolveActiveDoctor never crashes on a malformed stored shift — fails safe (treated as no match)', () => {
  const doctors = [{
    doctorId: 'd1', doctorName: 'Dr. Bad Data',
    timetable: { weeklySlots: { Monday: { active: true, shifts: [{ start: '', end: '', roomId: ROOM }] } } },
  }]
  assert.doesNotThrow(() => resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '10:00', dayOfWeek: MON } }))
  assert.equal(resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '10:00', dayOfWeek: MON } }).onBreak, true)
})

// ---------- assertNoSelfOverlap (one doctor can't be in two rooms at once) ----------

test('assertNoSelfOverlap allows non-overlapping shifts across different rooms on the same day', () => {
  assert.doesNotThrow(() => assertNoSelfOverlap([
    { start: '09:00', end: '11:00', roomId: ROOM },
    { start: '11:00', end: '13:00', roomId: OTHER_ROOM },
  ]))
})

test('assertNoSelfOverlap rejects overlapping shifts in DIFFERENT rooms (can\'t be in two places at once)', () => {
  assert.throws(() => assertNoSelfOverlap([
    { start: '09:00', end: '12:00', roomId: ROOM },
    { start: '11:00', end: '14:00', roomId: OTHER_ROOM },
  ]), /overlapping shift/)
})

test('assertNoSelfOverlap is order-independent (sorts internally before checking)', () => {
  assert.throws(() => assertNoSelfOverlap([
    { start: '11:00', end: '14:00', roomId: OTHER_ROOM },
    { start: '09:00', end: '12:00', roomId: ROOM },
  ]), /overlapping shift/)
})

test('assertNoSelfOverlap allows back-to-back shifts (one ends exactly when the other starts)', () => {
  assert.doesNotThrow(() => assertNoSelfOverlap([
    { start: '09:00', end: '11:00', roomId: ROOM },
    { start: '11:00', end: '13:00', roomId: OTHER_ROOM },
  ]))
})

// ---------- otherConcurrentDoctors (shared-room display board: don't claim
// two doctors are "sitting together" unless their shifts genuinely overlap) ----------

test('normal non-overlapping shared-room shifts → empty, even though multiple doctors are linked to the room', () => {
  const doctors = [
    { doctorId: 'd1', doctorName: 'Dr. Morning', timetable: timetable({ Monday: [{ start: '08:00', end: '11:00', roomId: ROOM }] }) },
    { doctorId: 'd2', doctorName: 'Dr. Midday', timetable: timetable({ Monday: [{ start: '11:00', end: '14:00', roomId: ROOM }] }) },
    { doctorId: 'd3', doctorName: 'Dr. Afternoon', timetable: timetable({ Monday: [{ start: '14:00', end: '17:00', roomId: ROOM }] }) },
  ]
  const active = resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '09:00', dayOfWeek: MON } })
  assert.equal(active.doctorId, 'd1')
  const others = otherConcurrentDoctors(ROOM, doctors, { activeDoctorId: active.doctorId, now: { hhmm: '09:00', dayOfWeek: MON } })
  assert.deepEqual(others, [], 'Dr. Midday and Dr. Afternoon are NOT here right now — their shifts are later')
})

test('a genuine overlap (data-entry conflict) surfaces the other doctor(s) actually concurrent right now', () => {
  const doctors = [
    { doctorId: 'd1', doctorName: 'Dr. Early', timetable: timetable({ Monday: [{ start: '08:00', end: '12:00', roomId: ROOM }] }) },
    { doctorId: 'd2', doctorName: 'Dr. Overlap', timetable: timetable({ Monday: [{ start: '09:00', end: '13:00', roomId: ROOM }] }) },
  ]
  const active = resolveActiveDoctor(ROOM, doctors, { now: { hhmm: '10:00', dayOfWeek: MON } })
  assert.equal(active.doctorId, 'd1', 'earliest-start wins the tie-break')
  const others = otherConcurrentDoctors(ROOM, doctors, { activeDoctorId: active.doctorId, now: { hhmm: '10:00', dayOfWeek: MON } })
  assert.deepEqual(others, [{ doctorId: 'd2', doctorName: 'Dr. Overlap' }])
})

test('an override room never reports concurrent doctors — a covering doctor is a single replacement, not a shift overlap', () => {
  const doctors = [
    { doctorId: 'd1', doctorName: 'Dr. Scheduled', timetable: timetable({ Monday: [{ start: '08:00', end: '17:00', roomId: ROOM }] }) },
    { doctorId: 'd2', doctorName: 'Dr. Also Scheduled', timetable: timetable({ Monday: [{ start: '08:00', end: '17:00', roomId: ROOM }] }) },
  ]
  const override = { doctorId: 'd3', doctorName: 'Dr. Covering' }
  const others = otherConcurrentDoctors(ROOM, doctors, { override, activeDoctorId: 'd3', now: { hhmm: '10:00', dayOfWeek: MON } })
  assert.deepEqual(others, [])
})

test('no doctors linked to the room → empty, not a crash', () => {
  assert.deepEqual(otherConcurrentDoctors(ROOM, [], { activeDoctorId: null, now: { hhmm: '10:00', dayOfWeek: MON } }), [])
})
