import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupWaitingByDoctor, bookedDoctorId } from '../queueGrouping.js'

const DHRUV = 'doc-dhruv'
const ATUL = 'doc-atul'
const DEEPIKA = 'doc-deepika'
const ELSEWHERE = 'doc-elsewhere'

// All three sit in this room today; dhruv happens to be the active one.
const hasShiftToday = (id) => [DHRUV, ATUL, DEEPIKA].includes(id)

const entry = (name, { assignedToId = null, followUpDoctorId = null } = {}) => ({ name, assignedToId, followUpDoctorId })

// ---------- the regression this module exists for ----------

test('REGRESSION: a `new` patient booked with a doctor is listed under THAT doctor, not the active one', () => {
  // Every `new` appointment has followUpDoctorId = null. Grouping on
  // followUpDoctorId alone sent all three patients to whoever won activeDoctor —
  // i.e. the board handed Dr atul's patient to Dr dhruv.
  const groups = groupWaitingByDoctor([
    entry('Harsh', { assignedToId: DHRUV }),
    entry('Rohit', { assignedToId: ATUL }),
    entry('Anjali', { assignedToId: DEEPIKA }),
  ], { activeDoctorId: DHRUV, hasShiftToday })

  assert.deepEqual(groups.get(DHRUV).map((e) => e.name), ['Harsh'])
  assert.deepEqual(groups.get(ATUL).map((e) => e.name), ['Rohit'], 'Rohit booked with atul must NOT be under dhruv')
  assert.deepEqual(groups.get(DEEPIKA).map((e) => e.name), ['Anjali'])
})

// ---------- bookedDoctorId precedence ----------

test('followUpDoctorId wins over assignedToId', () => {
  assert.equal(bookedDoctorId({ followUpDoctorId: ATUL, assignedToId: DHRUV }), ATUL)
})

test('falls back to assignedToId when there is no follow-up target', () => {
  assert.equal(bookedDoctorId({ followUpDoctorId: null, assignedToId: DHRUV }), DHRUV)
})

test('a true walk-in (neither set) has no booked doctor', () => {
  assert.equal(bookedDoctorId({ followUpDoctorId: null, assignedToId: null }), null)
})

// ---------- walk-ins ----------

test('a true walk-in queues for whoever is active', () => {
  const groups = groupWaitingByDoctor([entry('Walkin')], { activeDoctorId: DHRUV, hasShiftToday })
  assert.deepEqual(groups.get(DHRUV).map((e) => e.name), ['Walkin'])
})

test('a walk-in with no active doctor lands in "unassigned", not lost', () => {
  const groups = groupWaitingByDoctor([entry('Walkin')], { activeDoctorId: null, hasShiftToday: () => false })
  assert.deepEqual(groups.get('unassigned').map((e) => e.name), ['Walkin'])
})

// ---------- the "booked with the 2pm doctor, arrived at 9am" case ----------

test('a patient booked with a doctor whose shift is LATER today keeps their own group', () => {
  const groups = groupWaitingByDoctor([entry('EarlyBird', { assignedToId: ATUL })], { activeDoctorId: DHRUV, hasShiftToday })
  assert.deepEqual(groups.get(ATUL).map((e) => e.name), ['EarlyBird'])
  assert.deepEqual(groups.get(DHRUV), [], 'active doctor still gets an (empty) group')
})

// ---------- doctor not here today ----------

test('a patient whose doctor is NOT in this room today folds into the active doctor', () => {
  // Their doctor isn't coming — whoever is active will see them. Must NOT
  // create a phantom group labelled with that doctor's shift on another weekday.
  const groups = groupWaitingByDoctor([entry('Orphan', { assignedToId: ELSEWHERE })], { activeDoctorId: DHRUV, hasShiftToday })
  assert.deepEqual(groups.get(DHRUV).map((e) => e.name), ['Orphan'])
  assert.equal(groups.has(ELSEWHERE), false, 'no phantom group for a doctor who is not here today')
})

test('follow-up to a doctor not here today also folds into the active doctor', () => {
  const groups = groupWaitingByDoctor([entry('OldPatient', { followUpDoctorId: ELSEWHERE })], { activeDoctorId: DHRUV, hasShiftToday })
  assert.deepEqual(groups.get(DHRUV).map((e) => e.name), ['OldPatient'])
  assert.equal(groups.has(ELSEWHERE), false)
})

// ---------- empty-room state ----------

test('the active doctor always gets a group even with zero patients', () => {
  const groups = groupWaitingByDoctor([], { activeDoctorId: DHRUV, hasShiftToday })
  assert.deepEqual(groups.get(DHRUV), [], 'so an idle room renders "no one waiting", not a blank list')
})

test('no active doctor and no patients -> no groups at all', () => {
  const groups = groupWaitingByDoctor([], { activeDoctorId: null, hasShiftToday: () => false })
  assert.equal(groups.size, 0)
})

// ---------- ordering preserved ----------

test('patient order within a group is preserved (caller already sorted by priority/time)', () => {
  const groups = groupWaitingByDoctor([
    entry('First', { assignedToId: ATUL }),
    entry('Second', { assignedToId: ATUL }),
    entry('Third', { assignedToId: ATUL }),
  ], { activeDoctorId: DHRUV, hasShiftToday })
  assert.deepEqual(groups.get(ATUL).map((e) => e.name), ['First', 'Second', 'Third'])
})
