// Regression test: no endpoint may ship a User row's credentials to the browser.
//
// THE BUG THIS PREVENTS
// /doctor-accountability?resource=doctors used `include:` instead of `select:`.
// `include` keeps every scalar column of User, so all 1,128 doctors arrived in
// the browser carrying `passwordHash` and `invitationToken`. Anyone who opened
// the screen and looked at the Network tab had them. An invitation token is not
// merely sensitive — it is @unique and redeems into an account, so a leaked live
// token is a direct takeover of that doctor's login.
//
// It was found while chasing a 3.2 MB screen, which is the point: a payload
// nobody sized is a payload nobody read. The size assertion below is deliberately
// loose (it exists to catch a re-introduced `include`, not to police kilobytes);
// the credential assertion is exact.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '..', '..', '..')
try {
  for (const line of fs.readFileSync(path.join(backendRoot, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* no .env — skips below */ }

const HAS_DB = !!process.env.DATABASE_URL
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const require = createRequire(path.join(backendRoot, 'package.json'))

// Anything here reaching a browser is an incident, not a performance problem.
const NEVER_SEND = ['passwordHash', 'invitationToken', 'resetToken', 'refreshToken']

let db, handleGet
before(async () => {
  if (!HAS_DB) return
  const { PrismaClient } = require('@prisma/client')
  db = new PrismaClient()
  handleGet = (await import('../../controllers/doctorAccountabilityController.js')).handleGet
})
after(async () => { if (db) await db.$disconnect() })

function get(query) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json: resolve }
    Promise.resolve(handleGet({ query, organizationId: ORG, user: null }, res, reject)).catch(reject)
  })
}

test('the doctor list never carries a password hash or an invitation token',
  { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  const { data: doctors } = await get({ resource: 'doctors' })
  assert.ok(doctors.length > 0, 'need at least one active doctor to test against')

  for (const field of NEVER_SEND) {
    const leaked = doctors.filter((d) => field in d)
    assert.equal(leaked.length, 0, `${field} present on ${leaked.length} doctor rows — this reaches the browser`)
  }

  // A re-introduced `include:` shows up as the column count jumping back to ~28.
  assert.ok(
    Object.keys(doctors[0]).length <= 10,
    `doctor row has ${Object.keys(doctors[0]).length} keys — an explicit select was probably replaced by include`,
  )
})

test('every field the accountability screen renders is still present',
  { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  // Trimming a payload is only safe if it still carries what the UI reads.
  // These are the exact fields DoctorAccountabilityModule.jsx touches on a doctor.
  const { data: doctors } = await get({ resource: 'doctors' })
  for (const field of ['id', 'fullName', 'specialization', 'isActive', 'consultationFee', 'commissionConfig', '_count']) {
    assert.ok(field in doctors[0], `the screen reads doctor.${field} and it is no longer sent`)
  }
})

test('the slab count sent with each doctor matches counting the slabs by hand',
  { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  // The screen used to download all 3,384 slab rows purely to tally them per
  // doctor. _count replaced that; if it ever counted a different set (a missing
  // org filter, the wrong relation) the badge would silently show other
  // hospitals' slabs.
  const { data: doctors } = await get({ resource: 'doctors' })
  const rows = await db.doctorFeeSlab.findMany({ where: { organizationId: ORG }, select: { doctorId: true } })

  const byHand = {}
  for (const row of rows) byHand[row.doctorId] = (byHand[row.doctorId] || 0) + 1

  for (const doctor of doctors) {
    assert.equal(doctor._count.feeSlabs, byHand[doctor.id] || 0, `slab count wrong for doctor ${doctor.id}`)
  }
})
