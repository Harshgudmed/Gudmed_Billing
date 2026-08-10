// Regression tests for isOwned() — the tenant-ownership guard in src/lib/tenant.js.
//
// Handlers that update or delete "by id" used to trust the id straight off the URL.
// Anyone holding (or guessing) a cuid from a different hospital could therefore
// mutate or delete that hospital's row: the classic cross-tenant IDOR. isOwned()
// is the single check every such handler now calls first, so it has to be right
// for ANY model it is handed, and it has to fail CLOSED on junk input.
//
// Real-database integration test, same disposable-org pattern as
// concurrency.test.js — the guard is a query, so only a real query proves it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import { isOwned } from '../tenant.js'

let ourOrg, otherOrg, ourPatient, theirPatient, ourUser, theirUser, deletedPatientId

before(async () => {
  const stamp = Date.now()
  ourOrg = await db.organization.create({ data: { name: 'Test Org — tenant.test.js (ours)', slug: `test-tenant-ours-${stamp}` } })
  otherOrg = await db.organization.create({ data: { name: 'Test Org — tenant.test.js (theirs)', slug: `test-tenant-theirs-${stamp}` } })

  const patient = (organizationId, tag) => db.patient.create({
    data: {
      organizationId,
      mrn: `TESTMRN-TENANT-${tag}-${stamp}`,
      firstName: 'Tenant',
      lastName: `Patient ${tag}`,
      gender: 'other',
      dateOfBirth: new Date('1990-01-01'),
    },
  })
  ourPatient = await patient(ourOrg.id, 'OURS')
  theirPatient = await patient(otherOrg.id, 'THEIRS')

  ourUser = await db.user.create({ data: { organizationId: ourOrg.id, email: `tenant.ours.${stamp}@test.local`, fullName: 'Tenant Test Ours', role: 'doctor' } })
  theirUser = await db.user.create({ data: { organizationId: otherOrg.id, email: `tenant.theirs.${stamp}@test.local`, fullName: 'Tenant Test Theirs', role: 'doctor' } })

  // A row that existed and is now gone — what a stale browser tab still links to.
  const doomed = await patient(ourOrg.id, 'DELETED')
  deletedPatientId = doomed.id
  await db.patient.delete({ where: { id: doomed.id } })
})

after(async () => {
  const orgIds = [ourOrg?.id, otherOrg?.id].filter(Boolean)
  await db.patient.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.user.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.billCounter.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
  await db.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {})
})

test('a hospital may act on its own record', async () => {
  assert.equal(await isOwned('patient', ourPatient.id, ourOrg.id), true)
})

test('a REAL patient id belonging to another hospital is refused — the cross-tenant IDOR this guard exists to stop', async () => {
  // The id is genuine and the row is right there in the table; the only thing
  // wrong is the tenant. Before this check, `update({ where: { id } })` would
  // have happily rewritten another hospital's patient.
  assert.equal(await isOwned('patient', theirPatient.id, ourOrg.id), false)
  // ...and symmetrically, so nobody can argue it only guards one direction.
  assert.equal(await isOwned('patient', ourPatient.id, otherOrg.id), false)
})

test('an id that no longer exists is refused, not treated as owned', async () => {
  // A stale tab firing DELETE twice must get "Not found", never a second
  // destructive write path.
  assert.equal(await isOwned('patient', deletedPatientId, ourOrg.id), false)
  assert.equal(await isOwned('patient', 'clzzzzzzzzzzzzzzzzzzzzzzz', ourOrg.id), false)
})

test('a missing id is refused instead of matching whatever row happens to be first', async () => {
  // Without the short-circuit, Prisma drops `id: undefined` from the WHERE and
  // findFirst returns an ARBITRARY row of that org — so a request with no id
  // would be reported as owned and the handler would mutate a random patient.
  for (const badId of [undefined, null, '', 0, false, NaN]) {
    assert.equal(await isOwned('patient', badId, ourOrg.id), false, `id ${String(badId)} was accepted`)
  }
})

test('a missing organizationId is refused instead of matching the row in ANY tenant', async () => {
  // An unauthenticated / mis-wired request (no req.organizationId) must not turn
  // the guard into a global "does this id exist anywhere?" lookup.
  for (const badOrg of [undefined, null, '', 0, false]) {
    assert.equal(await isOwned('patient', ourPatient.id, badOrg), false, `organizationId ${String(badOrg)} was accepted`)
    assert.equal(await isOwned('patient', theirPatient.id, badOrg), false, `organizationId ${String(badOrg)} was accepted`)
  }
})

test('the same guard works on a second model — it is called generically with a model name, not just for patients', async () => {
  // Callers pass strings like 'ambulanceTrip', 'user', 'patient'. If it only
  // happened to work for patient, every other call site would be unguarded.
  assert.equal(await isOwned('user', ourUser.id, ourOrg.id), true)
  assert.equal(await isOwned('user', theirUser.id, ourOrg.id), false)
  assert.equal(await isOwned('user', deletedPatientId, ourOrg.id), false)

  // A patient id must not be accepted as a user id (or vice versa): the model
  // argument has to actually select the table being written to.
  assert.equal(await isOwned('user', ourPatient.id, ourOrg.id), false)
  assert.equal(await isOwned('patient', ourUser.id, ourOrg.id), false)
})
