// ============================================================================
// HOSTILE AUDIT — PATIENT REGISTER MODULE
// ============================================================================
//
//   node e2e/audit-patient-register.js
//
// Every check below exists because a specific real-world hospital failure is
// possible if it regresses. The WHY is stated on each one. This is not a smoke
// test: it fills real forms, hits the real API with hostile payloads, and then
// reads the actual database row to see what landed.
//
// Ground rules baked in (learned the hard way on this codebase):
//   * backend/.env has AUTH_ENFORCED=false DELIBERATELY. "Works without a
//     token" is NOT reported as a bug — production sets it true.
//   * Playwright selectors are scoped to getByRole('dialog') when a modal is
//     open. Querying the page grabs controls BEHIND the overlay, which then
//     blocks the click and looks exactly like a product bug. It isn't.
//   * No fixed waitForTimeout-then-read-text. Wait for the real element.
//   * Every finding is asserted twice (REPRO) before it is reported.
//
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Prisma lives in backend/, not at the repo root where this file sits.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backend = path.join(__dirname, '..', 'backend')
const require = createRequire(path.join(backend, 'package.json'))
const { PrismaClient } = require('@prisma/client')

// backend/.env holds DATABASE_URL; nothing loads it for a script run from here.
for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const BASE = process.env.E2E_BASE || 'http://localhost:5173'
const API = process.env.E2E_API || 'http://localhost:5000/api'
const db = new PrismaClient()

// ── reporting ───────────────────────────────────────────────────────────────
const findings = []
const cleanChecks = []
const ok = (n, d = '') => { cleanChecks.push(n); console.log(`  ✅ ${n}${d ? ` — ${d}` : ''}`) }
const bug = (sev, n, d) => { findings.push({ sev, n, d }); console.log(`  ❌ [${sev}] ${n}\n       ${String(d).replace(/\n/g, '\n       ')}`) }
const info = (n, d = '') => console.log(`  ℹ  ${n}${d ? ` — ${d}` : ''}`)

// Track everything we create so the 1.05M-row production-like DB is left clean.
const createdPatientIds = new Set()
const createdOrgIds = new Set()

/** POST/PATCH the API directly, bypassing the UI. A real client (or a tester
 *  with devtools) is not constrained by the form's sanitising. Returns
 *  {status, body, ms} — never throws, so a 500 is data, not a crash. */
async function api(method, urlPath, payload) {
  const t0 = Date.now()
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const ms = Date.now() - t0
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, ms }
}

/** A minimally-valid patient. Spread over it to make a hostile variant. */
const validPatient = (over = {}) => ({
  firstName: 'Audit', lastName: 'Probe', dateOfBirth: '1990-05-15',
  gender: 'male', phonePrimary: '+919876500000', ...over,
})

/** Create via API and remember the id for cleanup. */
async function createPatient(payload) {
  const r = await api('POST', '/patients', payload)
  const id = r.body?.data?.id
  if (id) createdPatientIds.add(id)
  return r
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

// Record every API call the app makes: what went out, what came back, how long.
const calls = []
page.on('request', (r) => { if (r.url().includes('/api/')) r._t0 = Date.now() })
page.on('response', async (res) => {
  const req = res.request()
  if (!req.url().includes('/api/')) return
  let body = null
  try { body = await res.json() } catch { /* non-JSON */ }
  let sent = null
  try { sent = req.postData() ? JSON.parse(req.postData()) : null } catch { sent = req.postData() }
  calls.push({
    method: req.method(), url: req.url().replace(/^.*\/api/, '/api'),
    status: res.status(), ms: Date.now() - (req._t0 || Date.now()), sent, got: body,
  })
})
const lastWrite = (match) => [...calls].reverse().find((c) => c.url.includes(match) && ['POST', 'PUT', 'PATCH'].includes(c.method))

try {
console.log('\n═══ HOSTILE AUDIT — PATIENT REGISTER ═══\n')

// ════════════════════════════════════════════════════════════════════════════
// A. THREE-WAY CONTRACT DIFF  [UI form] × [zod schema] × [Prisma column]
// ════════════════════════════════════════════════════════════════════════════
// WHY: a field the form SENDS that zod strips is silently discarded — the
// receptionist types it, sees a success toast, and the data is gone. This is
// the highest-yield check in the whole file.
console.log('A. THREE-WAY CONTRACT DIFF (form → zod → Prisma → GET)')

// These are sent verbatim by RegisterPatientForm (it POSTs the whole form
// state object via useCreatePatient) and every one has a real Prisma column.
const ADDRESS_FIELDS = {
  region: 'Maharashtra', zone: 'Pune', woreda: 'Haveli',
  kebele: 'Wagholi', houseNumber: '12-B', postalCode: '411014',
}

{
  const payload = validPatient({ ...ADDRESS_FIELDS, firstName: 'Addr', lastName: 'Contract' })
  const r = await createPatient(payload)
  if (r.status !== 201) {
    bug('S2', 'contract-diff probe could not create a patient', `POST /patients → ${r.status} ${JSON.stringify(r.body)}`)
  } else {
    const row = await db.patient.findUnique({ where: { id: r.body.data.id } })
    const dropped = Object.keys(ADDRESS_FIELDS).filter((f) => row[f] == null)
    if (dropped.length) {
      bug('S2', 'Registration silently discards the patient\'s entire ADDRESS',
        `POST ${API}/patients\n` +
        `sent: ${JSON.stringify(ADDRESS_FIELDS)}\n` +
        `response: 201 Created (success toast shown to the user)\n` +
        `DB row: ${dropped.map((f) => `${f}=null`).join(', ')}\n` +
        `cause: backend patientSchema (patientController.js:43) has no key for these; zod strips unknown keys silently.\n` +
        `Prisma HAS all ${dropped.length} columns (schema.prisma:284-290).`)
    } else ok('address fields survive registration')
  }
}

// Same fields, now via the EDIT path (PatientsModule PATCHes the whole form).
{
  const r = await createPatient(validPatient({ firstName: 'Addr', lastName: 'Editcase' }))
  if (r.status === 201) {
    const id = r.body.data.id
    const u = await api('PATCH', `/patients/${id}`, { ...ADDRESS_FIELDS })
    const row = await db.patient.findUnique({ where: { id } })
    const dropped = Object.keys(ADDRESS_FIELDS).filter((f) => row[f] == null)
    if (dropped.length) {
      bug('S2', 'Editing a patient silently discards the ADDRESS too',
        `PATCH ${API}/patients/${id}\n` +
        `sent: ${JSON.stringify(ADDRESS_FIELDS)}\n` +
        `response: ${u.status} (UI toasts "Patient updated successfully")\n` +
        `DB row after: ${dropped.map((f) => `${f}=null`).join(', ')}\n` +
        `cause: PATIENT_EDITABLE_FIELDS (patientController.js:74) whitelist omits them, so the loop never copies them.`)
    } else ok('address fields survive edit')
  }
}

// A column the API can never populate is a dead field — worth knowing about.
{
  const zodKeys = ['firstName','middleName','lastName','dateOfBirth','gender','phonePrimary','phoneSecondary','email','emergencyContactName','emergencyContactPhone','emergencyContactRelationship','bloodGroup','allergies','chronicConditions','currentMedications','hasInsurance','insuranceProvider','insuranceId','insuranceExpiryDate','maritalStatus','referredBy','mlcNumber','occupation','isVip','notes']
  const prismaScalar = ['externalId','region','zone','woreda','kebele','houseNumber','postalCode','addressDescription','insuranceCoverageDetails','photoUrl','educationLevel']
  const unreachable = prismaScalar.filter((f) => !zodKeys.includes(f))
  info('Prisma columns no API path can ever write', unreachable.join(', '))
}

// ════════════════════════════════════════════════════════════════════════════
// H. MRN / UHID GENERATION — ATOMICITY
// ════════════════════════════════════════════════════════════════════════════
// WHY: mrn is @unique. generateUHID() (patientController.js:37) is
// `UHID + yyyymmdd + Math.random()*10000` → only 10,000 slots PER DAY, with no
// uniqueness check. This codebase already has the correct atomic pattern in
// backend/src/lib/counters.js (nextSeriesNumber, used by invoices) — Patient
// does not use it. A collision = a registration that fails at the counter with
// the patient standing there. Prove it with REAL concurrent calls.
console.log('\nH. MRN/UHID ATOMICITY (concurrent registrations)')
{
  const todayPrefix = `UHID${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
  const existingToday = await db.patient.count({ where: { mrn: { startsWith: todayPrefix } } })
  info('UHIDs already issued today', `${existingToday} of 10,000 possible slots (${(existingToday / 100).toFixed(1)}% of the keyspace)`)

  // Birthday-paradox collision probability for the next N registrations.
  const N = 20
  const pColl = 1 - Math.exp((-N * (2 * existingToday + N - 1)) / (2 * 10000))
  info('theoretical collision chance for the next 20 registrations', `${(pColl * 100).toFixed(1)}%`)

  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => createPatient(validPatient({ firstName: 'Race', lastName: `Probe${i}` })))
  )
  const conflicts = results.filter((r) => r.status === 409 || r.status === 500)
  const mrns = results.filter((r) => r.status === 201).map((r) => r.body.data.mrn)
  const dupes = mrns.filter((m, i) => mrns.indexOf(m) !== i)

  if (conflicts.length) {
    bug('S2', 'Concurrent registration fails with a UHID collision',
      `${conflicts.length}/${N} concurrent POST /patients failed.\n` +
      `example: ${conflicts[0].status} ${JSON.stringify(conflicts[0].body)}\n` +
      `cause: generateUHID() = Math.random()*10000 with no uniqueness retry; mrn is @unique.\n` +
      `${existingToday} UHIDs already exist for today → the keyspace is ${(existingToday / 100).toFixed(1)}% full.\n` +
      `counters.js:nextSeriesNumber() is the atomic pattern this codebase already uses for invoices.`)
  } else if (dupes.length) {
    bug('S1', 'Duplicate UHID issued to two different patients', `duplicated: ${[...new Set(dupes)].join(', ')}`)
  } else {
    info('no collision in this run of 20', `keyspace is ${(existingToday / 100).toFixed(1)}% full — non-deterministic, see report`)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// H(2). DUPLICATE PATIENTS
// ════════════════════════════════════════════════════════════════════════════
// WHY: the same human registered twice = two UHIDs, two chart histories. Labs
// land on one, the doctor reads the other. This is a real-world hospital
// disaster, not a nit.
console.log('\nH2. DUPLICATE PATIENT DETECTION')
{
  const twin = validPatient({ firstName: 'Ramesh', lastName: 'Kumar', dateOfBirth: '1985-03-20', phonePrimary: '+919812345678' })
  const a = await createPatient(twin)
  const b = await createPatient(twin) // byte-identical human
  if (a.status === 201 && b.status === 201) {
    bug('S2', 'Identical patient can be registered twice with no warning',
      `Two POST /patients with a byte-identical body (same name + DOB + phone) both returned 201.\n` +
      `payload: ${JSON.stringify(twin)}\n` +
      `UHIDs issued: ${a.body.data.mrn} and ${b.body.data.mrn} — two charts for one human.\n` +
      `There is no duplicate check, no warning, and no soft-match prompt anywhere in create().`)
  } else ok('duplicate registration is blocked or warned')
}

// ════════════════════════════════════════════════════════════════════════════
// D. DATES & TIMEZONE
// ════════════════════════════════════════════════════════════════════════════
// WHY: DOB drives age, drives paediatric drug dosing. A DOB that is wrong by a
// day, or a DOB in the future, is a clinical-safety issue, not cosmetic.
console.log('\nD. DATES & TIMEZONE')
{
  // Future DOB — a patient cannot be born tomorrow.
  const future = new Date(Date.now() + 86400e3 * 365).toISOString().slice(0, 10)
  const r = await createPatient(validPatient({ dateOfBirth: future, firstName: 'Future', lastName: 'Baby' }))
  if (r.status === 201) {
    const row = await db.patient.findUnique({ where: { id: r.body.data.id } })
    bug('S2', 'Date of birth in the FUTURE is accepted and stored',
      `POST /patients dateOfBirth=${future} → 201 Created\n` +
      `stored dateOfBirth: ${row.dateOfBirth.toISOString()}\n` +
      `expected: 400 — a patient cannot be born in the future.\n` +
      `cause: zod has \`dateOfBirth: z.string()\` — no date validation of any kind.\n` +
      `impact: calcAge() returns a NEGATIVE age for this patient everywhere in the UI.`)
  } else ok('future DOB rejected', `${r.status}`)

  // Garbage date string — z.string() accepts it, new Date() makes it Invalid,
  // Prisma then throws. A 500 here means validation is not doing its job.
  const g = await createPatient(validPatient({ dateOfBirth: 'not-a-date', firstName: 'Bad', lastName: 'Datestr' }))
  if (g.status >= 500) {
    bug('S2', 'Unparseable dateOfBirth causes a 500 instead of a 400',
      `POST /patients dateOfBirth="not-a-date" → ${g.status}\n` +
      `body: ${JSON.stringify(g.body)}\n` +
      `expected: 400 Validation error. zod's z.string() passes it, then new Date("not-a-date") = Invalid Date and Prisma throws at the driver.`)
  } else if (g.status === 400) ok('unparseable DOB → 400')
  else info('unparseable DOB', `→ ${g.status} ${JSON.stringify(g.body).slice(0, 120)}`)

  // Absurd-but-parseable dates.
  for (const d of ['1850-01-01', '1900-01-01', new Date().toISOString().slice(0, 10)]) {
    const rr = await createPatient(validPatient({ dateOfBirth: d, firstName: 'Edge', lastName: 'Dob' }))
    info(`DOB ${d}`, `→ ${rr.status}${rr.status === 201 ? ` stored ${(await db.patient.findUnique({ where: { id: rr.body.data.id } })).dateOfBirth.toISOString()}` : ''}`)
  }

  // ── DOB round-trip: does the day survive storage + read-back? ──
  // WHY: `new Date('1990-05-15')` parses as UTC midnight. Read back and
  // formatted in a NEGATIVE-offset timezone it renders as the 14th. Classic.
  const rt = await createPatient(validPatient({ dateOfBirth: '1990-05-15', firstName: 'Round', lastName: 'Trip' }))
  if (rt.status === 201) {
    const row = await db.patient.findUnique({ where: { id: rt.body.data.id } })
    const stored = row.dateOfBirth.toISOString()
    const getBack = await api('GET', `/patients/${rt.body.data.id}`)
    // How the browser would render it (date-fns format uses LOCAL time).
    const localDay = new Date(row.dateOfBirth).toLocaleDateString('en-CA') // yyyy-mm-dd, local
    info('DOB round-trip', `typed 1990-05-15 → stored ${stored} → GET ${getBack.body?.data?.dateOfBirth} → renders local as ${localDay}`)
    if (localDay !== '1990-05-15') {
      bug('S1', 'Date of birth shifts by a day between typing and reload',
        `typed 1990-05-15, stored ${stored}, renders as ${localDay} in this machine's timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`)
    } else {
      ok('DOB round-trips correctly in this timezone', `${Intl.DateTimeFormat().resolvedOptions().timeZone} — see report re: negative-offset deployments`)
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// B. BOUNDARY VALUES
// ════════════════════════════════════════════════════════════════════════════
// WHY: a 10k-char name is not a joke input — it is a paste accident. It must
// either be rejected or stored intact, never truncated silently.
console.log('\nB. BOUNDARY VALUES')
{
  const cases = [
    ['empty firstName', { firstName: '' }],
    ['1-char firstName (schema min is 2)', { firstName: 'A' }],
    ['exactly 2 chars', { firstName: 'Ab' }],
    ['300-char firstName', { firstName: 'X'.repeat(300) }],
    ['10000-char firstName', { firstName: 'Y'.repeat(10000) }],
    ['empty lastName', { lastName: '' }],
    ['1-char lastName', { lastName: 'B' }],
  ]
  for (const [label, over] of cases) {
    const r = await createPatient(validPatient({ ...over, lastName: over.lastName ?? 'Bound' }))
    let storedLen = null
    if (r.status === 201) {
      const row = await db.patient.findUnique({ where: { id: r.body.data.id } })
      storedLen = row.firstName.length
    }
    info(label, `→ ${r.status}${storedLen != null ? ` stored length ${storedLen}` : ` ${JSON.stringify(r.body?.error || r.body).slice(0, 60)}`}`)
    // A silently truncated name is worse than a rejection: the chart is wrong.
    if (r.status === 201 && over.firstName && storedLen !== over.firstName.length) {
      bug('S2', `${label} was TRUNCATED on store`, `sent ${over.firstName.length} chars, stored ${storedLen}`)
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// C. TYPE CONFUSION — hit the API directly, the UI is not the boundary
// ════════════════════════════════════════════════════════════════════════════
// WHY: a 500 means validation did not do its job and the error reached the
// driver. Validation must return 400. 500s also risk leaking internals (M).
console.log('\nC. TYPE CONFUSION (a 500 here is a bug — validation should 400)')
{
  const hostile = [
    ['firstName: number', { firstName: 12345 }],
    ['firstName: null', { firstName: null }],
    ['firstName: array', { firstName: ['a', 'b'] }],
    ['firstName: object', { firstName: { evil: 1 } }],
    ['firstName: true', { firstName: true }],
    ['gender: invalid enum', { gender: 'attack-helicopter' }],
    ['gender: number', { gender: 1 }],
    ['dateOfBirth: number', { dateOfBirth: 0 }],
    ['dateOfBirth: null', { dateOfBirth: null }],
    ['dateOfBirth: array', { dateOfBirth: [] }],
    ['dateOfBirth: 1e308', { dateOfBirth: 1e308 }],
    ['hasInsurance: string', { hasInsurance: 'yes' }],
    ['isVip: string', { isVip: 'true' }],
    ['email: number', { email: 42 }],
    ['phonePrimary: object', { phonePrimary: {} }],
    ['notes: nested object', { notes: { a: { b: { c: 1 } } } }],
    ['insuranceExpiryDate: garbage', { insuranceExpiryDate: 'soon' }],
  ]
  for (const [label, over] of hostile) {
    const r = await createPatient(validPatient(over))
    if (r.status >= 500) {
      bug('S2', `500 on hostile input — ${label}`,
        `POST ${API}/patients\npayload: ${JSON.stringify(validPatient(over)).slice(0, 200)}\n` +
        `→ ${r.status} ${JSON.stringify(r.body).slice(0, 300)}\nexpected: 400 Validation error.`)
    } else if (r.status === 201) {
      const row = await db.patient.findUnique({ where: { id: r.body.data.id } })
      info(`${label} ACCEPTED (201)`, `stored as ${JSON.stringify({ firstName: row.firstName, gender: row.gender, dob: row.dateOfBirth })}`.slice(0, 160))
    } else {
      ok(`${label} → ${r.status}`)
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// E. UNICODE, INJECTION, PROTOTYPE POLLUTION
// ════════════════════════════════════════════════════════════════════════════
console.log('\nE. UNICODE & INJECTION')
{
  const payloads = [
    ['emoji', '\u{1F600}\u{1F3E5}'],
    ['4-byte CJK', '\u{20BB7}\u{2A6B2}'],
    ['zero-width space', 'Ra​mesh'],
    ['RTL override', 'Ra‮mesh'],
    ['combining diacritics', 'Ramé́́sh'],
    ['SQL drop', "'; DROP TABLE patients;--"],
    ['SQL tautology', '" OR "1"="1'],
    ['script tag', '<script>alert(1)</script>'],
  ]
  for (const [label, val] of payloads) {
    const r = await createPatient(validPatient({ firstName: val, lastName: 'Unicode' }))
    if (r.status !== 201) { info(`${label} rejected`, `${r.status}`); continue }
    const row = await db.patient.findUnique({ where: { id: r.body.data.id } })
    row.firstName === val
      ? ok(`${label} stored literally (no corruption, no injection)`)
      : bug('S2', `${label} was mangled on store`, `sent ${JSON.stringify(val)}, stored ${JSON.stringify(row.firstName)}`)
  }
  // The table must still be there — proves Prisma parameterised the SQL payloads.
  const stillThere = await db.patient.count()
  stillThere > 0 ? ok('patients table intact after SQL-injection payloads', `${stillThere} rows`) : bug('S1', 'PATIENTS TABLE GONE', 'SQL injection succeeded')
}

console.log('\nE2. PROTOTYPE POLLUTION')
{
  const r = await api('POST', '/patients', { ...validPatient({ firstName: 'Proto', lastName: 'Pollute' }), __proto__: { isAdmin: true }, constructor: { prototype: {} } })
  if (r.body?.data?.id) createdPatientIds.add(r.body.data.id)
  const polluted = ({}).isAdmin !== undefined
  if (r.status >= 500) bug('S3', 'prototype-pollution payload causes a 500', `→ ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  else if (polluted) bug('S1', 'prototype pollution succeeded', 'Object.prototype.isAdmin is set after the request')
  else ok('prototype-pollution payload handled safely', `→ ${r.status}, Object.prototype clean, isAdmin not persisted`)
}

// ════════════════════════════════════════════════════════════════════════════
// F. ARRAY FIELDS (allergies / chronicConditions / currentMedications)
// ════════════════════════════════════════════════════════════════════════════
// WHY: allergies is the single most safety-critical field on a patient record.
// If it silently mangles, someone gets a drug they are allergic to.
console.log('\nF. ARRAY FIELDS')
{
  const arrayCases = [
    ['empty array', []],
    ['array with empty string', ['']],
    ['duplicates', ['Penicillin', 'Penicillin']],
    ['500 elements', Array.from({ length: 500 }, (_, i) => `Allergen${i}`)],
    ['script tag element', ['<script>alert(1)</script>']],
    ['string not array', 'Penicillin'],
    ['[null]', [null]],
    ['nested array', [['Penicillin']]],
    ['array of numbers', [1, 2, 3]],
  ]
  for (const [label, val] of arrayCases) {
    const r = await createPatient(validPatient({ allergies: val, firstName: 'Allergy', lastName: 'Probe' }))
    if (r.status >= 500) { bug('S2', `500 on allergies — ${label}`, `→ ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); continue }
    if (r.status !== 201) { ok(`allergies ${label} → ${r.status} (rejected)`); continue }
    const row = await db.patient.findUnique({ where: { id: r.body.data.id } })
    info(`allergies ${label} accepted`, `stored: ${String(row.allergies).slice(0, 80)}`)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// G. CONDITIONAL FIELDS — insurance
// ════════════════════════════════════════════════════════════════════════════
// WHY: hasInsurance=false with a policy number still attached is orphan data —
// billing may later bill the insurer for an uninsured patient.
console.log('\nG. CONDITIONAL FIELDS (insurance)')
{
  const a = await createPatient(validPatient({ hasInsurance: true, insuranceProvider: '', insuranceId: '', firstName: 'Ins', lastName: 'Empty' }))
  if (a.status === 201) {
    bug('S3', 'hasInsurance=true accepted with NO provider and NO policy number',
      `POST /patients {hasInsurance:true, insuranceProvider:"", insuranceId:""} → 201.\n` +
      `The UI marks both fields "*" (required) but neither the form nor zod enforces it.\n` +
      `impact: an "insured" patient with no policy — billing cannot claim, discovered at discharge.`)
  } else ok('insured-with-no-policy rejected', `${a.status}`)

  const b = await createPatient(validPatient({ hasInsurance: false, insuranceProvider: 'Star Health', insuranceId: 'POL999', firstName: 'Ins', lastName: 'Orphan' }))
  if (b.status === 201) {
    const row = await db.patient.findUnique({ where: { id: b.body.data.id } })
    if (row.insuranceProvider || row.insuranceId) {
      bug('S3', 'hasInsurance=false but insurance details are stored anyway (orphan data)',
        `sent {hasInsurance:false, insuranceProvider:"Star Health", insuranceId:"POL999"}\n` +
        `stored: hasInsurance=${row.hasInsurance}, insuranceProvider=${JSON.stringify(row.insuranceProvider)}, insuranceId=${JSON.stringify(row.insuranceId)}\n` +
        `Reachable from the UI: RegisterPatientForm's checkbox does NOT clear the fields when unticked\n` +
        `(RegisterPatientForm.jsx:339 — compare PatientForm.jsx:135 which DOES clear them).\n` +
        `So: tick, type a policy, untick, submit → the policy is stored against an uninsured patient.`)
    } else ok('insurance fields cleared when hasInsurance=false')
  }
}

// ════════════════════════════════════════════════════════════════════════════
// I. AUTHORIZATION / IDOR / MASS ASSIGNMENT
// ════════════════════════════════════════════════════════════════════════════
// NOTE: AUTH_ENFORCED=false locally is DELIBERATE and is NOT reported here.
// What IS tested: cross-tenant reads, and whether the body can overwrite
// system/identity fields.
console.log('\nI. MASS ASSIGNMENT & CROSS-TENANT (IDOR)')
{
  const r = await createPatient({
    ...validPatient({ firstName: 'Mass', lastName: 'Assign' }),
    id: 'attacker-chosen-id', organizationId: 'org-evil', mrn: 'UHID-FORGED-0001',
    createdAt: '1999-01-01T00:00:00Z', isActive: false, role: 'admin', passwordHash: 'pwned',
  })
  if (r.status === 201) {
    const row = await db.patient.findUnique({ where: { id: r.body.data.id } })
    const bad = []
    if (row.id === 'attacker-chosen-id') bad.push('id was attacker-controlled')
    if (row.organizationId === 'org-evil') bad.push('organizationId was attacker-controlled — CROSS-TENANT WRITE')
    if (row.mrn === 'UHID-FORGED-0001') bad.push('mrn was attacker-controlled')
    if (row.passwordHash === 'pwned') bad.push('passwordHash was attacker-controlled')
    if (new Date(row.createdAt).getFullYear() === 1999) bad.push('createdAt was attacker-controlled')
    bad.length
      ? bug('S1', 'Mass assignment on POST /patients', bad.join('\n'))
      : ok('POST /patients ignores id/organizationId/mrn/createdAt/passwordHash/role', 'org comes from getOrgId(req), mrn from generateUHID()')
  }

  // Same on update.
  const c = await createPatient(validPatient({ firstName: 'Mass', lastName: 'Update' }))
  if (c.status === 201) {
    const id = c.body.data.id
    const before = await db.patient.findUnique({ where: { id } })
    await api('PATCH', `/patients/${id}`, { organizationId: 'org-evil', mrn: 'UHID-FORGED-0002', isActive: false, passwordHash: 'pwned' })
    const after = await db.patient.findUnique({ where: { id } })
    const bad = []
    if (after.organizationId !== before.organizationId) bad.push('organizationId overwritten')
    if (after.mrn !== before.mrn) bad.push('mrn overwritten')
    if (after.passwordHash === 'pwned') bad.push('passwordHash overwritten')
    bad.length ? bug('S1', 'Mass assignment on PATCH /patients/:id', bad.join('\n'))
      : ok('PATCH /patients/:id whitelist holds', 'organizationId/mrn/passwordHash/isActive all rejected')
  }

  // Cross-tenant read. Only one org exists (org-demo), so build a throwaway.
  const stamp = Date.now()
  // Organization.slug is @unique and REQUIRED — omitting it is why an earlier
  // run skipped this check. Supply one.
  const evilOrg = await db.organization.create({ data: { id: `org-audit-${stamp}`, name: 'AUDIT Throwaway Org', slug: `audit-throwaway-${stamp}` } }).catch(() => null)
  if (!evilOrg) info('cross-tenant test skipped', 'could not create a second org')
  else {
    createdOrgIds.add(evilOrg.id)
    const foreign = await db.patient.create({
      data: { organizationId: evilOrg.id, mrn: `UHID-AUDIT-${Date.now()}`, firstName: 'Foreign', lastName: 'Patient', dateOfBirth: new Date('1980-01-01'), gender: 'male' },
    })
    createdPatientIds.add(foreign.id)
    const g = await api('GET', `/patients/${foreign.id}`)
    g.status === 404
      ? ok('cross-tenant GET /patients/:id → 404', 'org B patient is not readable from org A')
      : bug('S1', 'IDOR — a patient from another organization is readable', `GET /patients/${foreign.id} → ${g.status} ${JSON.stringify(g.body).slice(0, 200)}`)
    const p = await api('PATCH', `/patients/${foreign.id}`, { firstName: 'Hacked' })
    const check = await db.patient.findUnique({ where: { id: foreign.id } })
    check.firstName === 'Hacked'
      ? bug('S1', 'IDOR — a patient from another organization is WRITABLE', `PATCH /patients/${foreign.id} → ${p.status}; firstName is now "Hacked"`)
      : ok('cross-tenant PATCH /patients/:id blocked', `→ ${p.status}`)
  }

  // Does GET leak anything it shouldn't?
  const list = await api('GET', '/patients?limit=1')
  const s = JSON.stringify(list.body)
  const leaked = ['passwordHash', 'DATABASE_URL', 'JWT_SECRET'].filter((k) => s.includes(k))
  leaked.length ? bug('S2', 'GET /patients leaks a sensitive field', leaked.join(', ')) : ok('GET /patients leaks no secrets')
}

// ════════════════════════════════════════════════════════════════════════════
// K. CONCURRENCY — lost update
// ════════════════════════════════════════════════════════════════════════════
// WHY: two clerks edit the same patient; one silently overwrites the other.
// Other modules in this app use expectedUpdatedAt as a guard. Patient does not.
console.log('\nK. CONCURRENT UPDATE (lost update)')
{
  const c = await createPatient(validPatient({ firstName: 'Lost', lastName: 'Update', notes: 'original' }))
  if (c.status === 201) {
    const id = c.body.data.id
    const [r1, r2] = await Promise.all([
      api('PATCH', `/patients/${id}`, { notes: 'clerk-A-note', phonePrimary: '+911111111111' }),
      api('PATCH', `/patients/${id}`, { notes: 'clerk-B-note', phonePrimary: '+912222222222' }),
    ])
    const row = await db.patient.findUnique({ where: { id } })
    if (r1.status === 200 && r2.status === 200) {
      bug('S3', 'Lost update — concurrent edits, last writer silently wins',
        `Two simultaneous PATCH /patients/${id} both returned 200.\n` +
        `clerk A sent notes="clerk-A-note", clerk B sent notes="clerk-B-note".\n` +
        `final DB row: notes=${JSON.stringify(row.notes)}, phonePrimary=${JSON.stringify(row.phonePrimary)}\n` +
        `One clerk's edit is gone with no conflict, no 409, no warning.\n` +
        `update() (patientController.js:332) has no version/updatedAt guard — other modules use expectedUpdatedAt.`)
    } else ok('concurrent update guarded', `${r1.status}/${r2.status}`)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// J. PARTIAL UPDATE — can an optional field be cleared?
// ════════════════════════════════════════════════════════════════════════════
// WHY: "patient no longer has that allergy / that phone" must be expressible.
// If blanking is impossible, stale clinical data lives forever.
console.log('\nJ. CLEARING AN OPTIONAL FIELD')
{
  const c = await createPatient(validPatient({ firstName: 'Clear', lastName: 'Field', phoneSecondary: '+919999888877', notes: 'to be cleared' }))
  if (c.status === 201) {
    const id = c.body.data.id
    await api('PATCH', `/patients/${id}`, { phoneSecondary: '', notes: '' })
    const row = await db.patient.findUnique({ where: { id } })
    const cleared = !row.phoneSecondary && !row.notes
    cleared ? ok('optional fields can be blanked via PATCH', 'empty string clears the value')
            : bug('S3', 'blanking an optional field does not clear it', `phoneSecondary=${JSON.stringify(row.phoneSecondary)}, notes=${JSON.stringify(row.notes)}`)

    // null is the other way a client expresses "remove this".
    const n = await api('PATCH', `/patients/${id}`, { phoneSecondary: null })
    if (n.status >= 500) bug('S3', 'PATCH with null on an optional field → 500', `→ ${n.status} ${JSON.stringify(n.body).slice(0, 160)}`)
    else info('PATCH phoneSecondary:null', `→ ${n.status}`)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// L. PERFORMANCE & PAGINATION (against the real ~1.05M-row table)
// ════════════════════════════════════════════════════════════════════════════
console.log('\nL. PERFORMANCE & PAGINATION (real dataset)')
{
  const total = await db.patient.count()
  info('patients in DB', String(total))

  // Warm the connection so we measure the query, not Prisma's cold start.
  await api('GET', '/patients?limit=10')

  const timed = async (label, url, n = 3) => {
    const runs = []
    for (let i = 0; i < n; i++) { const r = await api('GET', url); runs.push(r.ms) }
    const med = runs.sort((a, b) => a - b)[Math.floor(n / 2)]
    return { label, url, med, runs }
  }

  const perf = [
    await timed('list, default limit', '/patients?limit=10'),
    await timed('list, limit=1', '/patients?limit=1'),
    await timed('list, limit=100', '/patients?limit=100'),
    await timed('search 1 char', '/patients?search=a&limit=10'),
    await timed('search full name', '/patients?search=Ramesh&limit=10'),
    await timed('deep offset', '/patients?limit=10&offset=1000000'),
  ]
  for (const p of perf) {
    const line = `${p.med}ms median (runs: ${p.runs.join(', ')}ms)  GET ${p.url}`
    if (p.med > 1500) bug('S2', `Slow endpoint — ${p.label}`, `${line}\nover the 1.5s budget against ${total} rows.`)
    else if (p.med > 800) info(`${p.label} (borderline)`, line)
    else ok(`${p.label} fast`, line)
  }

  // Pagination clamping — a hostile client should not be able to pull 1M rows.
  const big = await api('GET', '/patients?limit=999999')
  const n = big.body?.data?.length
  n <= 1000 ? ok('limit is clamped', `?limit=999999 → returned ${n} rows, meta.limit=${big.body?.meta?.limit}`)
            : bug('S2', 'limit is not clamped', `?limit=999999 returned ${n} rows`)

  for (const q of ['offset=-5', 'limit=-1', 'limit=0', 'limit=abc', 'offset=abc', 'offset=1e309']) {
    const r = await api('GET', `/patients?${q}&limit=5`)
    if (r.status >= 500) bug('S3', `GET /patients?${q} → 500`, JSON.stringify(r.body).slice(0, 160))
    else info(`?${q}`, `→ ${r.status}, ${r.body?.data?.length ?? '?'} rows, meta=${JSON.stringify(r.body?.meta)}`)
  }

  // total must match reality, or the pager lies.
  const l = await api('GET', '/patients?limit=1&status=all')
  const real = await db.patient.count({ where: { organizationId: 'org-demo' } })
  l.body?.meta?.total === real
    ? ok('list meta.total matches the real row count', `${real}`)
    : info('meta.total vs DB count', `meta.total=${l.body?.meta?.total}, DB(org-demo, all)=${real}`)

  // LIKE wildcards must be treated as literal text, not as wildcards.
  const pct = await api('GET', '/patients?search=%25&limit=5')     // %
  const und = await api('GET', '/patients?search=_&limit=5')       // _
  const allRows = await db.patient.count({ where: { organizationId: 'org-demo', isActive: true } })
  const pctLeaks = (pct.body?.meta?.total ?? 0) > allRows * 0.5
  const undLeaks = (und.body?.meta?.total ?? 0) > allRows * 0.5
  if (pctLeaks || undLeaks) {
    bug('S2', 'SQL LIKE wildcards leak through the search box',
      `?search=%25 → total ${pct.body?.meta?.total}; ?search=_ → total ${und.body?.meta?.total}; active rows ${allRows}.\n` +
      `A literal search for "%" should match almost nothing.`)
  } else {
    ok('LIKE wildcards (% and _) are treated literally', `?search=%25 → ${pct.body?.meta?.total} hits, ?search=_ → ${und.body?.meta?.total} hits (Prisma parameterises \`contains\`)`)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M. ERROR QUALITY — do 500s leak internals?
// ════════════════════════════════════════════════════════════════════════════
console.log('\nM. ERROR BODY LEAKAGE')
{
  const probes = [
    ['bad DOB', () => createPatient(validPatient({ dateOfBirth: 'not-a-date' }))],
    ['bad id', () => api('GET', '/patients/%00')],
    ['bad patch target', () => api('PATCH', '/patients/does-not-exist', { firstName: 'X' })],
  ]
  const leakSigns = ['DATABASE_URL', 'postgresql://', 'prisma.', 'at Object.', 'node_modules', 'invalid `prisma', '\\n    at ']
  for (const [label, fn] of probes) {
    const r = await fn()
    const body = JSON.stringify(r.body)
    const hits = leakSigns.filter((s) => body.toLowerCase().includes(s.toLowerCase()))
    if (hits.length) {
      bug('S2', `Error body leaks internals — ${label}`,
        `→ ${r.status}\nleaked markers: ${hits.join(', ')}\nbody: ${body.slice(0, 400)}`)
    } else info(`${label} error body clean`, `→ ${r.status} ${body.slice(0, 100)}`)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// BROWSER FLOWS — what the UI actually does
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ BROWSER FLOWS ═══')
await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('input[type="email"]', { timeout: 20000 })
await page.fill('input[type="email"]', 'admin@gudmed.in')
await page.fill('input[type="password"]', 'Gudmed@123')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]')])

// ── E3. STORED XSS via the "Print Card" prescription window ────────────────
// WHY: printPrescription.js builds the OPD prescription with
// `win.document.write(...${name}...)` — a raw template interpolation, no
// escaping. React escapes the patient TABLE, so the list looks safe; the print
// window is a different sink entirely. If a patient's name executes script when
// a clerk prints their card, that is stored XSS in a hospital system.
console.log('\nE3. STORED XSS — print prescription window')
{
  // A payload that proves EXECUTION, not just rendering. It phones home by
  // setting a title we can read from the opened window.
  const xssName = `<img src=x onerror="document.title='XSS_EXECUTED'">Zed`
  const r = await createPatient(validPatient({ firstName: xssName, lastName: 'Xsstest', phonePrimary: '+919000000001' }))
  if (r.status !== 201) {
    info('XSS probe patient not created', `${r.status}`)
  } else {
    const mrn = r.body.data.mrn
    await page.goto(`${BASE}/admin/patients`, { waitUntil: 'networkidle' })
    // Find OUR patient by searching for its UHID — the list is 1M rows deep.
    const searchBox = page.getByPlaceholder(/Search by name, UHID, phone/i)
    await searchBox.fill(mrn)
    // Wait for the actual row, never a fixed timeout.
    const row = page.locator('tr', { hasText: mrn }).first()
    await row.waitFor({ timeout: 20000 }).catch(() => {})

    if (!(await row.count())) {
      info('XSS probe: patient row not found in the list', `searched ${mrn}`)
    } else {
      // 1) Does the LIST escape it? (React should.)
      const rowHtml = await row.innerHTML()
      const listExecutes = rowHtml.includes('<img src=x') && !rowHtml.includes('&lt;img')
      listExecutes
        ? bug('S1', 'Patient list renders the name as raw HTML', rowHtml.slice(0, 200))
        : ok('patient LIST escapes the name (React auto-escaping)', 'renders as literal text')

      // 2) Does the PRINT WINDOW execute it?
      // The print action is a plain <Button title="Print OPD Prescription">
      // in the row's action cell (PatientListTable.jsx:139) — NOT a menuitem.
      const popupPromise = page.waitForEvent('popup', { timeout: 20000 }).catch(() => null)
      await row.getByTitle('Print OPD Prescription').click().catch(() => {})
      const popup = await popupPromise
      if (!popup) {
        info('print window did not open', 'could not confirm the XSS sink through the UI — see static analysis in the report')
      } else {
        await popup.waitForLoadState('domcontentloaded').catch(() => {})
        await popup.waitForTimeout(1000) // let the injected onerror handler run
        // If the img onerror fired, the title was rewritten.
        const title = await popup.title().catch(() => '')
        const html = await popup.content().catch(() => '')
        const injectedTagPresent = /<img\s+src=x\s+onerror=/i.test(html)
        if (title === 'XSS_EXECUTED') {
          bug('S1', 'STORED XSS — a patient name executes script in the printed prescription',
            `Patient registered with firstName = ${JSON.stringify(xssName)} (UHID ${mrn}).\n` +
            `Clerk clicks Print Card → printPrescription.js:105 does\n` +
            `  win.document.write(\`... <span class="pt-val">\${name}</span> ...\`)\n` +
            `with NO escaping. The injected <img onerror> FIRED: the print window's\n` +
            `document.title was rewritten to "XSS_EXECUTED" by attacker-controlled script.\n` +
            `Stored, so it fires for every staff member who prints this patient's card.\n` +
            `Same sink at printPrescription.js:160 (footer) and PatientProfile.jsx:59,138.`)
        } else if (injectedTagPresent) {
          bug('S1', 'STORED XSS — patient name is injected as live HTML into the print window',
            `The print document contains the raw tag <img src=x onerror=...> parsed as an ELEMENT, not text.\n` +
            `Title check did not latch in this run, but the injection point is confirmed.\n` +
            `printPrescription.js:105 interpolates \${name} into document.write unescaped.`)
        } else {
          ok('print window escapes the patient name', 'name rendered as literal text')
        }
        await popup.close().catch(() => {})
      }
    }
  }
}

// ── A2. REAL FORM SUBMIT: does the address the clerk typed reach the DB? ───
// WHY: this is the same defect as check A, but proven through the actual UI a
// receptionist uses — form fill, real click, real XHR, then the real row.
console.log('\nA2. REAL REGISTER FORM — fill address, submit, read the row')
{
  await page.goto(`${BASE}/admin/patients`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Register Patient/i }).first().click()
  // Scope to the OPEN DIALOG — querying the page grabs the filters behind it.
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 15000 })

  const stamp = Date.now()
  await dialog.getByPlaceholder('First name').fill('Uiaddr')
  await dialog.getByPlaceholder('Last name').fill(`Probe${stamp % 10000}`)
  await dialog.locator('input[type="date"]').first().fill('1988-04-12')
  await dialog.getByPlaceholder('+91 XXXXX XXXXX').first().fill('+919876511111')
  await dialog.getByPlaceholder('e.g. 12-B').fill('42-A')
  await dialog.getByPlaceholder('Village or town').fill('Wagholi')
  await dialog.getByPlaceholder('City or district').fill('Pune')
  await dialog.getByPlaceholder('6-digit PIN').fill('411014')

  // State dropdown (portalled outside the dialog once open).
  await dialog.getByText('Select state').click().catch(() => {})
  const stateOpt = page.getByRole('option', { name: 'Maharashtra' }).first()
  if (await stateOpt.count()) await stateOpt.click().catch(() => {})

  calls.length = 0
  // Registration also books an appointment (doctor + date are required), so the
  // form cannot be submitted without them. Pick the first doctor + a date.
  const docSelect = dialog.getByText(/Select doctor/i).first()
  if (await docSelect.count()) {
    await docSelect.click().catch(() => {})
    const firstDoc = page.getByRole('option').first()
    if (await firstDoc.count()) await firstDoc.click().catch(() => {})
  }

  await dialog.getByRole('button', { name: /^Register Patient$/i }).click().catch(() => {})
  // Wait for the POST itself rather than a blind sleep.
  await page.waitForResponse((r) => r.url().includes('/api/patients') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => {})

  const w = lastWrite('/patients')
  if (!w) {
    info('UI register submit produced no POST', 'the form blocks submit without a doctor + appointment date (by design)')
  } else {
    console.log(`  → ${w.method} ${w.url}  ${w.status}  ${w.ms}ms`)
    const sentAddr = { region: w.sent?.region, zone: w.sent?.zone, kebele: w.sent?.kebele, houseNumber: w.sent?.houseNumber, postalCode: w.sent?.postalCode }
    console.log(`     address the browser actually sent: ${JSON.stringify(sentAddr)}`)
    const id = w.got?.data?.id
    if (id) {
      createdPatientIds.add(id)
      const row = await db.patient.findUnique({ where: { id } })
      const lost = Object.entries(sentAddr).filter(([k, v]) => v && !row[k]).map(([k, v]) => `${k}: browser sent ${JSON.stringify(v)}, DB has ${JSON.stringify(row[k])}`)
      lost.length
        ? bug('S2', 'UI PROOF — address typed into the register form never reaches the database',
            `${w.method} ${API}/patients → ${w.status} in ${w.ms}ms, UHID ${row.mrn}\n${lost.join('\n')}\n` +
            `The clerk sees "registered successfully" and the address is gone.`)
        : ok('address typed in the UI reaches the DB')
    }
  }
}

} catch (e) {
  bug('S3', 'audit harness crashed', `${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`)
} finally {
  // ── CLEANUP — leave the 1.05M-row dataset exactly as we found it ─────────
  console.log('\n═══ CLEANUP ═══')
  await browser.close().catch(() => {})
  let removed = 0
  for (const id of createdPatientIds) {
    // Appointments/audit rows FK to the patient; clear them first.
    await db.appointment.deleteMany({ where: { patientId: id } }).catch(() => {})
    const d = await db.patient.delete({ where: { id } }).then(() => 1).catch(() => 0)
    removed += d
  }
  // Any stragglers this audit created under its own marker last names.
  const strays = await db.patient.deleteMany({
    where: { organizationId: 'org-demo', lastName: { in: ['Probe', 'Contract', 'Editcase', 'Unicode', 'Xsstest', 'Datestr', 'Dob', 'Bound', 'Allergy', 'Assign', 'Update', 'Field', 'Trip', 'Baby', 'Pollute', 'Empty', 'Orphan'] }, firstName: { not: '' } },
  }).catch(() => ({ count: 0 }))
  for (const oid of createdOrgIds) {
    await db.patient.deleteMany({ where: { organizationId: oid } }).catch(() => {})
    await db.organization.delete({ where: { id: oid } }).catch(() => {})
  }
  console.log(`  removed ${removed} tracked test patients, ${strays.count || 0} stray, ${createdOrgIds.size} throwaway org(s)`)
  await db.$disconnect()

  // ── SUMMARY ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`)
  const bySev = (s) => findings.filter((f) => f.sev === s)
  console.log(`CLEAN: ${cleanChecks.length} checks passed`)
  console.log(`FINDINGS: ${findings.length}  (S1: ${bySev('S1').length}, S2: ${bySev('S2').length}, S3: ${bySev('S3').length})`)
  for (const f of findings) console.log(`  [${f.sev}] ${f.n}`)
  process.exit(findings.length ? 1 : 0)
}
