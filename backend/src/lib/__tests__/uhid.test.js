// Regression tests for generateUHID() — the patient MRN minter, moved out of
// patientController into src/lib/counters.js so every registration path shares it.
//
// The bug this file guards: pre-triage used to mint its own MRN as
// `UHID${Date.now().toString().slice(-8)}`. The last 8 digits of the epoch
// millisecond clock wrap every ~27.8 hours, so a screening converted today could
// be handed the exact number a screening got yesterday — and Patient.mrn is
// @unique, so the conversion just exploded (or, worse, the front desk ended up
// with two people sharing one hospital number). It also produced a different
// shape ("UHID12345678") from the 10-digit number printed on cards.
//
// That uniqueness is now scoped PER HOSPITAL (@@unique([organizationId, mrn])),
// because generateUHID counts per org: it used to be global, which meant the
// SECOND hospital to register anyone was handed org #1's "1000000001" and could
// not create a single patient. The last test in this file guards that.
//
// Real-database integration test, same disposable-org pattern as
// concurrency.test.js — the whole point is that Postgres itself serialises the
// counter, so mocks would prove nothing.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { generateUHID } from '../counters.js'

let orgA, orgB
const createdPatientIds = []

before(async () => {
  const stamp = Date.now()
  orgA = await db.organization.create({ data: { name: 'Test Org A — uhid.test.js', slug: `test-uhid-a-${stamp}` } })
  orgB = await db.organization.create({ data: { name: 'Test Org B — uhid.test.js', slug: `test-uhid-b-${stamp}` } })
})

after(async () => {
  // Delete children before the orgs, and never leave a counter row behind: a
  // stray BillCounter would keep handing out numbers for a hospital that no
  // longer exists. Wrapped so a failed assertion still cleans up.
  const orgIds = [orgA?.id, orgB?.id].filter(Boolean)
  if (createdPatientIds.length) await db.patient.deleteMany({ where: { id: { in: createdPatientIds } } }).catch(() => {})
  await db.billCounter.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.patient.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {})
})

test('every UHID is exactly 10 digits, so a hospital number never prints short or with a "UHID" prefix', async () => {
  // Pre-triage's old scheme produced "UHID12345678" — 12 characters, letters
  // included — which broke card printing and any search that assumed a number.
  for (let i = 0; i < 5; i++) {
    const uhid = await db.$transaction((tx) => generateUHID(tx, orgA.id))
    assert.match(uhid, /^\d{10}$/, `got ${uhid}`)
  }
})

test('consecutive registrations strictly increase — a number is never reissued or handed out backwards', async () => {
  const issued = []
  for (let i = 0; i < 6; i++) issued.push(Number(await db.$transaction((tx) => generateUHID(tx, orgA.id))))

  for (let i = 1; i < issued.length; i++) {
    assert.ok(issued[i] > issued[i - 1], `UHID went backwards: ${issued[i - 1]} then ${issued[i]}`)
  }
  assert.equal(new Set(issued).size, issued.length, 'the same UHID was issued twice')
})

test('front-desk registration and a pre-triage conversion draw from ONE counter row, so the two paths cannot mint the same MRN', async () => {
  // This is the actual fix: both callers now go through generateUHID, which
  // upserts the single BillCounter row keyed (org, series:'UHID', year:'P').
  const before = await db.billCounter.findUnique({
    where: { organizationId_series_year: { organizationId: orgA.id, series: 'UHID', year: 'P' } },
  })

  const fromRegistration = await db.$transaction((tx) => generateUHID(tx, orgA.id))
  const fromPreTriage = await db.$transaction((tx) => generateUHID(tx, orgA.id))

  assert.notEqual(fromRegistration, fromPreTriage)
  assert.equal(Number(fromPreTriage) - Number(fromRegistration), 1, 'the two paths must consume consecutive numbers from the same sequence')

  const after = await db.billCounter.findUnique({
    where: { organizationId_series_year: { organizationId: orgA.id, series: 'UHID', year: 'P' } },
  })
  assert.equal(after.value - before.value, 2, 'both paths must advance the SAME counter row')
  assert.equal(Number(fromPreTriage) - after.value, 1_000_000_000, 'the UHID must be the counter offset by the 10-digit base')

  // Exactly one UHID counter exists, and its year key is the constant 'P' — not a
  // financial year. If it were per-FY the sequence would restart every April and
  // reissue last year's numbers on a globally @unique column.
  const counters = await db.billCounter.findMany({ where: { organizationId: orgA.id, series: 'UHID' } })
  assert.equal(counters.length, 1)
  assert.equal(counters[0].year, 'P')
})

test('two people registering at the same instant in separate transactions never receive the same UHID', async () => {
  const [a, b] = await Promise.all([
    db.$transaction((tx) => generateUHID(tx, orgA.id)),
    db.$transaction((tx) => generateUHID(tx, orgA.id)),
  ])
  assert.notEqual(a, b)
})

test('a burst of simultaneous registrations produces no duplicates and no lost increments', async () => {
  const before = await db.billCounter.findUnique({
    where: { organizationId_series_year: { organizationId: orgA.id, series: 'UHID', year: 'P' } },
  })

  const results = await Promise.all(
    Array.from({ length: 20 }, () => db.$transaction((tx) => generateUHID(tx, orgA.id))),
  )

  assert.equal(new Set(results).size, results.length, 'two concurrent registrations got the same hospital number')

  const after = await db.billCounter.findUnique({
    where: { organizationId_series_year: { organizationId: orgA.id, series: 'UHID', year: 'P' } },
  })
  assert.equal(after.value - before.value, 20, 'an increment was lost — a number would be reused later')
})

test('the numbers issued are actually storable as Patient.mrn, which is unique within a hospital', async () => {
  // The end state the whole counter exists for: 5 registrations in a row, all
  // written to the unique mrn column without a P2002.
  for (let i = 0; i < 5; i++) {
    const mrn = await db.$transaction(async (tx) => {
      const uhid = await generateUHID(tx, orgA.id)
      const p = await tx.patient.create({
        data: {
          organizationId: orgA.id,
          mrn: uhid,
          firstName: 'UHID',
          lastName: `Patient ${i}`,
          gender: 'other',
          dateOfBirth: new Date('1990-01-01'),
        },
      })
      createdPatientIds.push(p.id)
      return p.mrn
    })
    assert.match(mrn, /^\d{10}$/)
  }
  const stored = await db.patient.findMany({ where: { id: { in: createdPatientIds } }, select: { mrn: true } })
  assert.equal(new Set(stored.map((p) => p.mrn)).size, stored.length)
})

test('a second hospital gets its own sequence — its first patient is not pushed to number 30 by another hospital\'s traffic', async () => {
  const b1 = await db.$transaction((tx) => generateUHID(tx, orgB.id))
  const b2 = await db.$transaction((tx) => generateUHID(tx, orgB.id))

  assert.equal(b1, String(1_000_000_000 + 1), 'a brand-new org must start at the base + 1')
  assert.equal(Number(b2) - Number(b1), 1)

  // Org A has issued many by now; drawing for B must not have disturbed it, and
  // A's next number must still follow A's own sequence.
  const counterA = await db.billCounter.findUnique({
    where: { organizationId_series_year: { organizationId: orgA.id, series: 'UHID', year: 'P' } },
  })
  const nextA = await db.$transaction((tx) => generateUHID(tx, orgA.id))
  assert.equal(Number(nextA), 1_000_000_000 + counterA.value + 1, 'org B\'s registrations leaked into org A\'s sequence')
})

test('two hospitals can each hold the SAME UHID — a second hospital is not blocked from registering its first patient', async () => {
  // The production blocker this whole migration exists for. generateUHID counts
  // PER ORG, so every hospital's first patient is handed "1000000001" — but
  // Patient.mrn carried a GLOBAL @unique, so whichever hospital committed second
  // died with P2002 and could not register a single person. Neither caller
  // (patientController.create, preTriage convertToPatient) retries, so the front
  // desk just saw a 500. Fixed by @@unique([organizationId, mrn]).
  //
  // Both writes must actually hit the table: asserting only on the counter (as
  // the test above does) would still pass with the global index in place.
  const sharedUhid = await db.$transaction((tx) => generateUHID(tx, orgB.id))

  for (const organizationId of [orgA.id, orgB.id]) {
    const p = await db.patient.create({
      data: {
        organizationId,
        mrn: sharedUhid,
        firstName: 'Shared',
        lastName: 'Uhid',
        gender: 'other',
        dateOfBirth: new Date('1990-01-01'),
      },
    })
    createdPatientIds.push(p.id)
  }

  const both = await db.patient.findMany({
    where: { mrn: sharedUhid, organizationId: { in: [orgA.id, orgB.id] } },
    select: { organizationId: true },
  })
  assert.equal(both.length, 2, 'both hospitals must be able to hold the same hospital number')
  assert.equal(new Set(both.map((p) => p.organizationId)).size, 2, 'the two rows must belong to different hospitals')

  // Scoped, not abandoned: reusing a UHID INSIDE one hospital must still be
  // refused, or one person's history silently splits across two records.
  await assert.rejects(
    () =>
      db.patient.create({
        data: {
          organizationId: orgA.id,
          mrn: sharedUhid,
          firstName: 'Duplicate',
          lastName: 'Uhid',
          gender: 'other',
          dateOfBirth: new Date('1990-01-01'),
        },
      }),
    (err) => err.code === 'P2002',
    'the same UHID was accepted twice within one hospital',
  )
})
