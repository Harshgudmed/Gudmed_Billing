import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roomFromTimetable, resolveRoom } from '../queueDerivation.js'

// 2026-07-17 is a Friday; 2026-07-16 a Thursday. Dates are given as the
// hospital-midnight instant that appointmentController now stores.
const FRIDAY = '2026-07-17T00:00:00+05:30'
const THURSDAY = '2026-07-16T00:00:00+05:30'
const ROOM_A = 'room-100'
const ROOM_B = 'room-101'
const LINK = 'oldest-link-room'

const tt = (weeklySlots) => ({ weeklySlots })
const day = (shifts, active = true) => ({ active, shifts })

// ---------- the bug this module exists for ----------

test('a doctor working two rooms gets the room for THAT DAY, not their oldest link', () => {
  // Exactly the shape that stranded Atul's patients: Thursday in room A,
  // Friday in room B, oldest DoctorRoomAssignment link pointing at room A.
  const timetable = tt({
    Thursday: day([{ start: '09:00', end: '17:00', roomId: ROOM_A }]),
    Friday: day([{ start: '05:00', end: '23:00', roomId: ROOM_B }]),
  })
  assert.equal(resolveRoom(timetable, ROOM_A, FRIDAY, '05:30'), ROOM_B)
  assert.equal(resolveRoom(timetable, ROOM_A, THURSDAY, '09:30'), ROOM_A)
})

test('a switched-off day does not seat the doctor in its leftover shift', () => {
  // `active: false` keeps its shifts so re-enabling the day restores them.
  const timetable = tt({
    Thursday: day([{ start: '09:00', end: '17:00', roomId: ROOM_A }], false),
    Friday: day([{ start: '05:00', end: '23:00', roomId: ROOM_B }]),
  })
  assert.equal(roomFromTimetable(timetable, THURSDAY, '09:30'), null)
})

test('a day object with no `active` key at all still counts as working', () => {
  const timetable = tt({ Friday: { shifts: [{ start: '09:00', end: '17:00', roomId: ROOM_B }] } })
  assert.equal(roomFromTimetable(timetable, FRIDAY, '10:00'), ROOM_B)
})

// ---------- shift boundaries ----------

test('start is inclusive, end is exclusive', () => {
  const timetable = tt({ Friday: day([{ start: '09:00', end: '17:00', roomId: ROOM_B }]) })
  assert.equal(roomFromTimetable(timetable, FRIDAY, '09:00'), ROOM_B)
  // 17:00 is outside the shift, but it is still the only room they sit in that
  // day — nearest-shift, not nothing.
  assert.equal(roomFromTimetable(timetable, FRIDAY, '17:00'), ROOM_B)
})

test('two rooms in ONE day: each booking lands in the shift covering it', () => {
  const timetable = tt({
    Friday: day([
      { start: '09:00', end: '12:00', roomId: ROOM_A },
      { start: '14:00', end: '18:00', roomId: ROOM_B },
    ]),
  })
  assert.equal(roomFromTimetable(timetable, FRIDAY, '10:00'), ROOM_A)
  assert.equal(roomFromTimetable(timetable, FRIDAY, '15:00'), ROOM_B)
})

test('booked outside every shift → the nearest shift that day, not the stale link', () => {
  const timetable = tt({
    Friday: day([
      { start: '09:00', end: '12:00', roomId: ROOM_A },
      { start: '14:00', end: '18:00', roomId: ROOM_B },
    ]),
  })
  assert.equal(resolveRoom(timetable, LINK, FRIDAY, '13:30'), ROOM_B) // 13:30 is closer to 14:00
  assert.equal(resolveRoom(timetable, LINK, FRIDAY, '08:00'), ROOM_A)
})

// ---------- leave ----------

test('a doctor on leave that date resolves to no room from the timetable', () => {
  const timetable = {
    weeklySlots: { Friday: day([{ start: '09:00', end: '17:00', roomId: ROOM_B }]) },
    exceptions: [{ date: '2026-07-17', reason: 'leave' }],
  }
  assert.equal(roomFromTimetable(timetable, FRIDAY, '10:00'), null)
})

// ---------- fallback ----------

test('no timetable at all → the oldest room link, as before', () => {
  assert.equal(resolveRoom(null, LINK, FRIDAY, '10:00'), LINK)
})

test('shifts that carry no roomId → the link, not a room the doctor is not in', () => {
  const timetable = tt({ Friday: day([{ start: '09:00', end: '17:00' }]) })
  assert.equal(resolveRoom(timetable, LINK, FRIDAY, '10:00'), LINK)
})

test('nothing to go on at all → null, never a crash', () => {
  assert.equal(resolveRoom(null, null, FRIDAY, '10:00'), null)
  assert.equal(roomFromTimetable(tt({}), FRIDAY, '10:00'), null)
})

test('an unparseable or missing appointment time falls back instead of guessing', () => {
  const timetable = tt({ Friday: day([{ start: '09:00', end: '17:00', roomId: ROOM_B }]) })
  assert.equal(resolveRoom(timetable, LINK, FRIDAY, ''), LINK)
  assert.equal(resolveRoom(timetable, LINK, FRIDAY, undefined), LINK)
})

test('an invalid appointment date falls back instead of throwing', () => {
  const timetable = tt({ Friday: day([{ start: '09:00', end: '17:00', roomId: ROOM_B }]) })
  assert.equal(resolveRoom(timetable, LINK, 'not-a-date', '10:00'), LINK)
})

// ---------- timezone ----------

test('the weekday is the HOSPITAL\'s, not the server\'s', () => {
  // 2026-07-17T19:00Z is still Friday in UTC but already Saturday 00:30 IST.
  const timetable = tt({
    Friday: day([{ start: '09:00', end: '23:59', roomId: ROOM_A }]),
    Saturday: day([{ start: '00:00', end: '06:00', roomId: ROOM_B }]),
  })
  assert.equal(roomFromTimetable(timetable, '2026-07-17T19:00:00Z', '00:30'), ROOM_B)
})
