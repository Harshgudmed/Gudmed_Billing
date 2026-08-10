// PROOF: the patient address the form collects is silently discarded.
//
//   node e2e/proof-address-dropped.js
//
// Registers a patient through the real API with every address field filled,
// then reads the row straight out of Postgres and compares. Self-cleaning.
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backend = path.join(__dirname, '..', 'backend')
const require = createRequire(path.join(backend, 'package.json'))
const { PrismaClient } = require('@prisma/client')

for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const API = process.env.E2E_API || 'http://localhost:5000/api'
const db = new PrismaClient()

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@gudmed.in', password: 'Gudmed@123' }),
})
const cookie = login.headers.get('set-cookie')?.split(';')[0]

// Exactly what the Register Patient form holds in state (PatientsModule.jsx:94)
// plus the rest of the address columns that exist on the Patient model.
const sent = {
  firstName: 'AddressProof',
  lastName: 'Tester',
  dateOfBirth: '1990-05-15',
  gender: 'male',
  phonePrimary: '+919812345678',

  // ── the address ──────────────────────────────────────────────
  region: 'Delhi',                       // the form's "State / Region" box
  zone: 'South Delhi',
  woreda: 'Hauz Khas',
  kebele: 'Block C',
  houseNumber: 'B-42',
  postalCode: '110016',
  addressDescription: 'B-42, Block C, Hauz Khas, South Delhi, Delhi 110016',
}

console.log('\n═══ PROOF: does the patient address survive registration? ═══\n')
console.log('SENT to POST /api/patients:')
for (const k of ['region', 'zone', 'woreda', 'kebele', 'houseNumber', 'postalCode', 'addressDescription']) {
  console.log(`   ${k.padEnd(20)} "${sent[k]}"`)
}

const t0 = Date.now()
const res = await fetch(`${API}/patients`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(sent),
})
const ms = Date.now() - t0
const body = await res.json().catch(() => null)

console.log(`\nRESPONSE: ${res.status} in ${ms}ms`)
console.log(`   success: ${body?.success}   mrn: ${body?.data?.mrn}`)
console.log(`   (no error, no warning — the clerk sees "Patient registered")`)

const id = body?.data?.id
if (!id) { console.log('\n   registration failed; cannot continue\n'); await db.$disconnect(); process.exit(2) }

const row = await db.patient.findUnique({
  where: { id },
  select: {
    mrn: true, firstName: true, phonePrimary: true,
    region: true, zone: true, woreda: true, kebele: true,
    houseNumber: true, postalCode: true, addressDescription: true,
  },
})

console.log('\nWHAT IS ACTUALLY IN THE DATABASE:')
console.log(`   ${'firstName'.padEnd(20)} ${JSON.stringify(row.firstName)}      <- stored`)
console.log(`   ${'phonePrimary'.padEnd(20)} ${JSON.stringify(row.phonePrimary)}   <- stored`)
let lost = 0
for (const k of ['region', 'zone', 'woreda', 'kebele', 'houseNumber', 'postalCode', 'addressDescription']) {
  const gone = row[k] === null || row[k] === undefined
  if (gone) lost++
  console.log(`   ${k.padEnd(20)} ${JSON.stringify(row[k])}${gone ? '        <- SENT, BUT GONE' : ''}`)
}

// The API's own read-back — what the profile screen renders from.
const get = await fetch(`${API}/patients/${id}`, { headers: { ...(cookie ? { cookie } : {}) } })
const gotBack = (await get.json().catch(() => null))?.data
console.log(`\nWHAT GET /api/patients/${row.mrn} RETURNS:`)
console.log(`   region: ${JSON.stringify(gotBack?.region)}   <- PatientProfile.jsx:307 renders this as "Region"`)

console.log('\n' + '─'.repeat(62))
if (lost > 0) {
  console.log(`CONFIRMED: ${lost} of 7 address fields were sent and are NOT stored.`)
  console.log('')
  console.log('WHY — it is not a format problem, it is a missing field list:')
  console.log('  1. The form has an address box, labelled "State / Region"')
  console.log('     (src/components/patients/components/PatientForm.jsx:75-77)')
  console.log('  2. The form state carries region/zone/woreda/kebele')
  console.log('     (src/components/patients/PatientsModule.jsx:94)')
  console.log('  3. The Patient TABLE HAS ALL SEVEN COLUMNS — they are real and writable')
  console.log('     (backend/prisma/schema.prisma, Patient model)')
  console.log('  4. But patientSchema (backend/src/controllers/patientController.js:43-69)')
  console.log('     lists 26 fields and NOT ONE of them is an address field.')
  console.log('     zod.object() STRIPS unknown keys by default — silently, no error.')
  console.log('  5. PATIENT_EDITABLE_FIELDS (same file, L74-81) omits them too,')
  console.log('     so editing a patient cannot save an address either.')
  console.log('')
  console.log('  => The address is deleted in transit, between a form that collects it')
  console.log('     and a table that has room for it. The API returns 201. Nobody is told.')
} else {
  console.log('Address survived — the finding does not reproduce.')
}
console.log('')

await db.patient.delete({ where: { id } }).catch(() => {})
console.log('(test patient removed)\n')
await db.$disconnect()
process.exit(lost > 0 ? 1 : 0)
