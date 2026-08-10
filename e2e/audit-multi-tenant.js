// MULTI-TENANT ISOLATION AUDIT — can Hospital B see or touch Hospital A's data?
//
//   node backend/scripts/seed-second-org.mjs      # required first
//   node e2e/audit-multi-tenant.js
//   node backend/scripts/seed-second-org.mjs --cleanup
//
// WHY THIS EXISTS: this product is sold as multi-hospital SaaS, and until now the
// database held exactly ONE organization. Every test in this project's history was
// therefore tenant-blind: there was no second tenant for data to leak into, so no
// cross-tenant bug could be detected and a clean result proved nothing. The
// appointments audit says so in its own output: "cross-org IDOR: NOT TESTED".
//
// The entire tenant boundary is ONE function, called 163 times across 33 controllers:
//
//   // backend/src/lib/reqContext.js:17
//   export function getOrgId(req) {
//     return req.organizationId || process.env.ORGANIZATION_ID || "org-demo"
//   }
//
// It fails OPEN. backend/render.yaml:43 sets ORGANIZATION_ID=org-demo in production.
// So any path where req.organizationId is falsy silently resolves to a REAL hospital.
//
// NOTE ON LOCAL AUTH: backend/.env has AUTH_ENFORCED=false. That does NOT invalidate
// these tests. Read middleware/auth.js:39 — when a token IS supplied, the org comes
// from the token's claim either way; the DEFAULT_ORG fallback only fires when the
// claim is missing. So a real org-test-b login is honoured locally, and the tests
// below are meaningful. Section D tests the fallback itself, separately.
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backend = path.join(__dirname, '..', 'backend')
const require = createRequire(path.join(backend, 'package.json'))
const { PrismaClient } = require('@prisma/client')
const jwt = require('jsonwebtoken')

for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const API = process.env.E2E_API || 'http://localhost:5000/api'
const SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const A = 'org-demo'
const B = 'org-test-b'
const db = new PrismaClient()

let s1 = 0, s2 = 0, s3 = 0, clean = 0
const bug = (sev, title, detail) => {
  if (sev === 'S1') s1++; else if (sev === 'S2') s2++; else s3++
  console.log(`  [${sev}] ${title}`)
  if (detail) console.log(String(detail).split('\n').map((l) => `        ${l}`).join('\n'))
}
const ok = (m, d = '') => { clean++; console.log(`   ok   ${m}${d ? ` — ${d}` : ''}`) }
const info = (m, d = '') => console.log(`   ..   ${m}${d ? ` — ${d}` : ''}`)
const H = (t) => console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`)

// Log in for real and keep the cookie, exactly as a browser would.
async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Gudmed@123' }),
  })
  const setC = r.headers.get('set-cookie')
  return { status: r.status, cookie: setC ? setC.split(';')[0] : null, body: await r.json().catch(() => null) }
}

async function call(pathname, { cookie, token, method = 'GET', body } = {}) {
  const t0 = Date.now()
  const r = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await r.json() } catch { /* non-JSON */ }
  return { status: r.status, json, ms: Date.now() - t0 }
}

console.log('\n╔══════════════════════════════════════════════════════════════════════════╗')
console.log('║  MULTI-TENANT ISOLATION AUDIT — Hospital B vs Hospital A                  ║')
console.log('╚══════════════════════════════════════════════════════════════════════════╝')

try {
  const orgs = await db.organization.count()
  if (orgs < 2) {
    console.log('\n  Run `node backend/scripts/seed-second-org.mjs` first — this audit needs two hospitals.\n')
    process.exit(2)
  }

  // Real records belonging to Hospital A that B must never reach.
  const aPatient = await db.patient.findFirst({ where: { organizationId: A }, select: { id: true, mrn: true, firstName: true, lastName: true } })
  const aAppt = await db.appointment.findFirst({ where: { organizationId: A }, select: { id: true } })
  const aInvoice = await db.invoice.findFirst({ where: { organizationId: A }, select: { id: true, invoiceNumber: true, totalAmount: true } })
  const aRoom = await db.room.findFirst({ where: { organizationId: A }, select: { id: true, roomNumber: true } })
  const aDoctor = await db.user.findFirst({ where: { organizationId: A, role: 'doctor' }, select: { id: true, fullName: true } })
  const aQueue = await db.queueManagement.findFirst({ where: { organizationId: A }, select: { id: true } })
  const aFloor = await db.floor.findFirst({ where: { organizationId: A }, select: { id: true } })

  const bAdmin = await db.user.findUnique({ where: { email: 'admin@testb.local' }, select: { id: true, organizationId: true } })
  const bPatient = await db.patient.findFirst({ where: { organizationId: B }, select: { id: true } })
  const bDoctor = await db.user.findFirst({ where: { organizationId: B, role: 'doctor' }, select: { id: true } })
  const bRoom = await db.room.findFirst({ where: { organizationId: B }, select: { id: true } })

  info('Hospital A targets', `patient=${aPatient?.mrn} invoice=${aInvoice?.invoiceNumber} room=${aRoom?.roomNumber} doctor=${aDoctor?.fullName}`)

  // ══════════════════════════════════════════════════════════════════════════
  H('A. LOGIN — does Hospital B get a token scoped to Hospital B?')
  const bLogin = await login('admin@testb.local')
  if (bLogin.status !== 200 || !bLogin.cookie) {
    console.log(`  login failed (${bLogin.status}) — cannot continue`)
    process.exit(2)
  }
  const bCookie = bLogin.cookie
  const decoded = jwt.decode(bCookie.split('=')[1])
  decoded?.organizationId === B
    ? ok('B admin logs in and the token carries organizationId=org-test-b', `role=${decoded.role}`)
    : bug('S1', 'B admin login does not scope the token to B', `token organizationId = ${JSON.stringify(decoded?.organizationId)}`)

  // ══════════════════════════════════════════════════════════════════════════
  H('B. CROSS-ORG READ — B asks for A\'s records by id')
  const reads = [
    ['patient',  `/patients/${aPatient?.id}`,                       aPatient?.id],
    ['appointment', `/appointments/${aAppt?.id}`,                   aAppt?.id],
    ['invoice',  `/billing?resource=invoices&invoiceId=${aInvoice?.id}`, aInvoice?.id],
    ['room',     `/rooms/${aRoom?.id}`,                             aRoom?.id],
    ['display queue', `/display/queue?roomId=${aRoom?.id}`,         aRoom?.id],
    ['timetable', `/doctor-accountability?resource=timetable&doctorId=${aDoctor?.id}`, aDoctor?.id],
    ['fee slabs', `/fee-slabs?doctorId=${aDoctor?.id}`,             aDoctor?.id],
    ['queue row', `/queue/${aQueue?.id}`,                           aQueue?.id],
  ]
  for (const [label, url, guard] of reads) {
    if (!guard) { info(`${label} — skipped, no A record to target`); continue }
    const r = await call(url, { cookie: bCookie })
    const leaked = r.status === 200 && r.json?.data && (Array.isArray(r.json.data) ? r.json.data.length > 0 : Object.keys(r.json.data).length > 0)
    if (leaked) {
      bug('S1', `B can READ A's ${label}`, `GET ${url}\n-> ${r.status} ${r.ms}ms\n${JSON.stringify(r.json?.data).slice(0, 220)}`)
    } else if (r.status >= 500) {
      bug('S2', `B reading A's ${label} returns ${r.status} instead of 404`, `GET ${url} -> ${JSON.stringify(r.json).slice(0, 160)}`)
    } else {
      ok(`A's ${label} is invisible to B`, `${r.status}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('C. CROSS-ORG WRITE — B tries to modify or destroy A\'s records')
  const writes = [
    ['update A\'s patient', 'PUT', `/patients/${aPatient?.id}`, { firstName: 'HIJACKED' }, aPatient?.id],
    ['cancel A\'s appointment', 'PATCH', `/appointments/${aAppt?.id}`, { status: 'cancelled' }, aAppt?.id],
    ['delete A\'s appointment', 'DELETE', `/appointments/${aAppt?.id}`, null, aAppt?.id],
    ['pay A\'s invoice', 'POST', '/billing?resource=payment', { invoiceId: aInvoice?.id, amount: 1, paymentMethod: 'cash' }, aInvoice?.id],
    ['delete A\'s room', 'DELETE', `/rooms/${aRoom?.id}`, null, aRoom?.id],
    ['override A\'s room', 'POST', `/rooms/${aRoom?.id}/override`, { doctorId: bDoctor?.id }, aRoom?.id],
  ]
  for (const [label, method, url, body, guard] of writes) {
    if (!guard) { info(`${label} — skipped`); continue }
    const r = await call(url, { cookie: bCookie, method, body })
    if (r.status >= 200 && r.status < 300) {
      bug('S1', `B can WRITE to A: ${label}`, `${method} ${url} -> ${r.status}\n${JSON.stringify(r.json).slice(0, 200)}`)
    } else if (r.status >= 500) {
      bug('S2', `B writing to A (${label}) returns ${r.status} instead of 404`, `${method} ${url} -> ${JSON.stringify(r.json).slice(0, 160)}`)
    } else {
      ok(`A's records reject B's ${label}`, `${r.status}`)
    }
  }
  // Prove nothing actually changed.
  const stillThere = await db.patient.findUnique({ where: { id: aPatient.id }, select: { firstName: true } })
  stillThere?.firstName === aPatient.firstName
    ? ok('A\'s patient row is byte-identical after every B write attempt', `firstName still "${aPatient.firstName}"`)
    : bug('S1', 'A\'s patient row was MUTATED by Hospital B', `firstName was "${aPatient.firstName}", is now "${stillThere?.firstName}"`)

  // ══════════════════════════════════════════════════════════════════════════
  H('D. CROSS-TENANT FK INJECTION — B creates its own row pointing at A')
  // Reads and writes are usually scoped; the CREATE path taking a foreign id in
  // the body is the classic miss, because the id never gets compared to the org.
  {
    const r = await call('/appointments', {
      cookie: bCookie, method: 'POST',
      body: {
        patientId: bPatient?.id, doctorId: aDoctor?.id,
        appointmentDate: '2027-03-03', appointmentTime: '11:00', appointmentType: 'new_patient',
      },
    })
    if (r.status === 201) {
      bug('S1', 'B booked its own patient with HOSPITAL A\'s doctor', `POST /appointments {doctorId: "${aDoctor.id}" /* org-demo */} -> 201\nappointment ${r.json?.data?.id}`)
      await db.appointment.delete({ where: { id: r.json.data.id } }).catch(() => {})
    } else ok('B cannot book A\'s doctor', `${r.status} ${r.json?.error || ''}`.slice(0, 80))
  }
  {
    const r = await call('/rooms', {
      cookie: bCookie, method: 'POST',
      body: { roomNumber: '777', floorId: aFloor?.id, sittingType: 'single' },
    })
    if (r.status === 201) {
      bug('S1', 'B created a room on HOSPITAL A\'s floor', `POST /rooms {floorId: "${aFloor.id}" /* org-demo */} -> 201`)
      await db.room.delete({ where: { id: r.json.data.id } }).catch(() => {})
    } else ok('B cannot put a room on A\'s floor', `${r.status}`)
  }
  {
    const r = await call('/billing?resource=invoice', {
      cookie: bCookie, method: 'POST',
      body: { patientId: aPatient?.id, items: [{ serviceName: 'X', quantity: 1, unitPrice: 100, total: 100 }] },
    })
    if (r.status === 201) {
      bug('S1', 'B raised an invoice against HOSPITAL A\'s patient', `POST /billing?resource=invoice {patientId: "${aPatient.id}"} -> 201`)
      await db.invoice.delete({ where: { id: r.json.data.id } }).catch(() => {})
    } else ok('B cannot bill A\'s patient', `${r.status}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('E. THE TOKEN\'S ORG CLAIM — trusted, and that is the design')
  // Worth measuring, but read the result carefully before calling it a bug.
  // Forging this token requires JWT_SECRET, and anyone holding JWT_SECRET can
  // simply mint a super_admin of any org — so "the claim is not cross-checked"
  // grants an attacker nothing they did not already have. Trusting a correctly
  // signed claim IS how stateless JWT auth works; re-verifying the user's org on
  // every request would mean a DB round-trip per call.
  // The genuine (small) consequence is staleness: move a user between hospitals
  // and their existing token keeps the old org until it expires.
  {
    const forged = jwt.sign(
      { id: bAdmin.id, userId: bAdmin.id, email: 'admin@testb.local', role: 'admin', organizationId: A },
      SECRET, { expiresIn: '1h' },
    )
    const r = await call(`/patients/${aPatient.id}`, { token: forged })
    if (r.status === 200 && r.json?.data) {
      info('the org claim is taken from the token and not re-checked against the user',
        `A token signed with JWT_SECRET claiming organizationId="org-demo" reads org-demo data, even though\n` +
        `        its user id belongs to org-test-b (middleware/auth.js:39). This needs the signing secret, so it is\n` +
        `        not an escalation — it is standard JWT behaviour. Consequence: a user moved between hospitals keeps\n` +
        `        their old org until the token expires. Noted, not filed as a defect.`)
    } else ok('a forged org claim does not grant access', `${r.status}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('F. THE FAIL-OPEN — what happens when the org claim is missing or junk')
  const AUTH_ON = process.env.AUTH_ENFORCED === 'true'
  info('local AUTH_ENFORCED', `${process.env.AUTH_ENFORCED} (production sets "true" — render.yaml:19)`)
  for (const [label, claim] of [
    ['no organizationId claim at all', undefined],
    ['organizationId: null', null],
    ['organizationId: ""', ''],
    ['organizationId: "ORG-DEMO" (wrong case)', 'ORG-DEMO'],
    ['organizationId: "org-demo " (trailing space)', 'org-demo '],
    ['organizationId: "does-not-exist"', 'does-not-exist'],
  ]) {
    const payload = { id: bAdmin.id, userId: bAdmin.id, email: 'admin@testb.local', role: 'admin' }
    if (claim !== undefined) payload.organizationId = claim
    const token = jwt.sign(payload, SECRET, { expiresIn: '1h' })
    const r = await call(`/patients/${aPatient.id}`, { token })
    const reachedA = r.status === 200 && r.json?.data?.mrn === aPatient.mrn
    if (reachedA && AUTH_ON) {
      // Enforcement is ON and the request STILL reached another hospital. That is
      // a real defect: auth.js:40 is supposed to 401 a token with no org.
      bug('S1', `AUTH_ENFORCED is ON and ${label} still lands on HOSPITAL A`,
        `GET /patients/${aPatient.id} -> 200, returned A's patient ${aPatient.mrn}\n` +
        `middleware/auth.js:40 should have returned 401 NO_ORG. getOrgId() (reqContext.js:17) fell through\n` +
        `to ORGANIZATION_ID || "org-demo" instead.`)
    } else if (reachedA) {
      // AUTH_ENFORCED=false locally is a deliberate dev convenience, documented in
      // auth.js:6-8. Reporting it as a defect would be a false positive.
      info(`${label} -> resolves to org-demo (expected: AUTH_ENFORCED=false locally)`,
        `This is the documented dev fallback, NOT a defect. Production sets AUTH_ENFORCED=true\n` +
        `        (render.yaml:19), where authenticate() 401s before getOrgId is ever reached. Re-run this\n` +
        `        section with AUTH_ENFORCED=true to test the path that actually ships.`)
    } else {
      ok(`${label} -> refused`, `${r.status}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('G. MASS ASSIGNMENT ACROSS THE BOUNDARY — organizationId in the body')
  {
    const r = await call('/patients', {
      cookie: bCookie, method: 'POST',
      body: {
        firstName: 'Boundary', lastName: 'Probe', dateOfBirth: '1990-01-01', gender: 'male',
        phonePrimary: '+919000000000', organizationId: A,
      },
    })
    if (r.status === 201 || r.status === 200) {
      const row = await db.patient.findUnique({ where: { id: r.json?.data?.id }, select: { organizationId: true, mrn: true } })
      row?.organizationId === A
        ? bug('S1', 'B created a patient INSIDE Hospital A by putting organizationId in the body', `POST /patients {organizationId: "org-demo"} -> ${r.status}\nstored organizationId = ${row.organizationId}`)
        : ok('organizationId in the body is ignored', `stored in ${row?.organizationId}`)
      if (r.json?.data?.id) await db.patient.delete({ where: { id: r.json.data.id } }).catch(() => {})
    } else info('patient create rejected', `${r.status} — cannot test mass assignment this way`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('H. SCHEMA — can hospital #2 actually operate?')
  // A globally-unique column that should be per-org does not leak data; it stops
  // the second hospital from functioning at all. That is a product bug, and it
  // only ever shows up once a second tenant exists — which is why it is here.
  {
    // Room numbering: proven by the seed itself.
    const aRoom101 = await db.room.findFirst({ where: { organizationId: A, roomNumber: '101' } })
    const bRoom101 = await db.room.findFirst({ where: { organizationId: B, roomNumber: '101' } })
    aRoom101 && bRoom101
      ? ok('both hospitals can have a "Room 101"', '@@unique([organizationId, floorId, roomNumber]) is correctly per-org')
      : info('room-number collision', 'could not verify — one of the orgs has no Room 101')

    // MRN: globally unique.
    try {
      await db.patient.create({
        data: { organizationId: B, mrn: aPatient.mrn, firstName: 'Collide', lastName: 'Probe', dateOfBirth: new Date('1990-01-01'), gender: 'male' },
      })
      ok('two hospitals can issue the same MRN', 'unexpected — the schema says otherwise')
      await db.patient.deleteMany({ where: { organizationId: B, firstName: 'Collide' } })
    } catch (e) {
      if (e.code === 'P2002') {
        bug('S2', 'Patient.mrn is GLOBALLY unique — hospital #2 cannot issue the same MRN as hospital #1',
          `Creating org-test-b patient with mrn="${aPatient.mrn}" (already used by org-demo) -> P2002\n` +
          `schema.prisma:264  mrn String @unique\n` +
          `Every hospital numbers its own charts from 1. With a global constraint the second hospital\n` +
          `to sign up silently fails to register patients whose MRN the first already used. Should be\n` +
          `@@unique([organizationId, mrn]).`)
      } else info('MRN probe inconclusive', e.code || e.message)
    }

    // Invoice number: globally unique, but the counter is per-org — so two orgs
    // WILL generate the same number and the second one to commit fails.
    try {
      await db.invoice.create({
        data: {
          organizationId: B, patientId: bPatient.id, invoiceNumber: aInvoice.invoiceNumber,
          items: JSON.stringify([]), subtotal: 0, totalAmount: 0, balanceDue: 0,
        },
      })
      ok('two hospitals can issue the same invoice number', 'unexpected')
      await db.invoice.deleteMany({ where: { organizationId: B, invoiceNumber: aInvoice.invoiceNumber } })
    } catch (e) {
      if (e.code === 'P2002') {
        bug('S1', 'Invoice.invoiceNumber is GLOBALLY unique while the counter that mints it is PER-ORG',
          `Creating org-test-b invoice with invoiceNumber="${aInvoice.invoiceNumber}" (org-demo's) -> P2002\n` +
          `schema.prisma:1029   invoiceNumber String @unique          <- global\n` +
          `schema.prisma:1893   @@unique([organizationId, series, year])  <- BillCounter is per-org\n` +
          `nextSeriesNumber() counts per org+series+year, so hospital B's first invoice of the year is\n` +
          `also "INV-2026-27-000001" — the exact string hospital A already holds. B's invoice create\n` +
          `throws P2002 and the visit cannot be billed. This is not a leak; it is hospital #2 being\n` +
          `unable to invoice at all. Should be @@unique([organizationId, invoiceNumber]).`)
      } else info('invoice-number probe inconclusive', e.code || e.message)
    }

    // User email: globally unique.
    const emailGlobal = await db.$queryRawUnsafe(`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'User' AND indexdef ILIKE '%email%'
    `)
    const perOrgEmail = JSON.stringify(emailGlobal).includes('organizationId')
    perOrgEmail
      ? ok('User.email is scoped per organization')
      : bug('S3', 'User.email is globally unique — one person cannot work at two hospitals',
          `schema.prisma:130  email String @unique\n` +
          `A visiting consultant who works at both hospitals needs two different email addresses.\n` +
          `Defensible as a product decision, but it IS a decision, and nothing records it.`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('I. HARDCODED TENANT — anything that assumes one hospital')
  {
    const hits = []
    const scan = (dir, rel = '') => {
      for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = path.join(rel, e.name)
        if (e.isDirectory()) { if (!/node_modules|\.git|dist|build/.test(e.name)) scan(dir, r); continue }
        if (!/\.(js|jsx|ts|tsx)$/.test(e.name)) continue
        const txt = fs.readFileSync(path.join(dir, r), 'utf8')
        for (const [i, line] of txt.split('\n').entries()) {
          if (/['"]org-demo['"]/.test(line)) hits.push(`${r}:${i + 1}  ${line.trim().slice(0, 92)}`)
        }
      }
    }
    scan(path.join(backend, 'src'))
    scan(path.join(__dirname, '..', 'src'))
    if (hits.length === 0) ok('no runtime file hardcodes an org id')
    else bug('S2', `${hits.length} runtime reference(s) to the literal "org-demo"`, hits.join('\n'))
  }

} catch (e) {
  bug('S3', 'audit crashed', e.stack?.split('\n').slice(0, 4).join('\n') || e.message)
} finally {
  await db.$disconnect()
}

console.log(`\n${'─'.repeat(74)}`)
console.log(`S1: ${s1}   S2: ${s2}   S3: ${s3}   |   ${clean} check(s) clean`)
console.log('S1 here means one hospital can reach another\'s data, or cannot operate at all.\n')
process.exit(s1 ? 1 : 0)
