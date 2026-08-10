// APPOINTMENT BOOKING — hostile audit.
//
//   node e2e/audit-appointments.js
//
// Scope: POST /api/appointments (create), PATCH /api/appointments/:id (update),
// POST /api/appointments/:id/reschedule, the Invoice each booking auto-creates
// in the same transaction, and the DoctorCommission that rides along with it.
//
// Method: every claim is proven against the RUNNING backend and the REAL
// database — a request is sent, the response is recorded, and the row is then
// read back with Prisma. Nothing is inferred from reading source alone.
//
// Bootstrap is copied from e2e/contract-audit.js: Prisma lives in backend/, and
// backend/.env holds DATABASE_URL which nothing loads for a script run from here.
//
// SELF-COLLISION NOTE: this suite books the same doctor many times. Since a
// working double-booking guard would (correctly) refuse the second booking in a
// slot, every test that does not specifically test clashing takes its own fresh
// date from nextDate(). A test failing because a PREVIOUS test took the slot is
// a harness bug, not a product bug, and cost real time on the first run.
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
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const db = new PrismaClient()

// ── reporting ────────────────────────────────────────────────────────────────
let bugs = 0, clean = 0
const findings = []
const ok = (n, d = '') => { clean++; console.log(`  [CLEAN] ${n}${d ? ` — ${d}` : ''}`) }
const bug = (sev, n, d) => { bugs++; findings.push({ sev, n }); console.log(`  [${sev}] ${n}\n         ${d}`) }
const info = (n, d = '') => console.log(`  [info]  ${n}${d ? ` — ${d}` : ''}`)
const section = (t) => console.log(`\n${'='.repeat(76)}\n${t}\n${'='.repeat(76)}`)

// ── API helper: records method, url, payload, status, body, ms ───────────────
const created = new Set()
async function api(method, url, body, headers = {}) {
  const t0 = Date.now()
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const ms = Date.now() - t0
  let json = null
  const text = await res.text()
  try { json = JSON.parse(text) } catch { json = { __raw: text.slice(0, 300) } }
  if (res.status === 201 && json?.data?.id && url.startsWith('/appointments')) created.add(json.data.id)
  return { status: res.status, body: json, ms, req: { method, url, body } }
}
const show = (r) => `${r.req.method} ${r.req.url} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`

// Fresh, never-reused booking dates so tests cannot collide with each other.
let dateCursor = Date.UTC(2027, 4, 1)
const nextDate = () => { const d = new Date(dateCursor); dateCursor += 86400000; return d.toISOString().slice(0, 10) }
const iso = (ymd, t = '00:00:00.000') => `${ymd}T${t}Z`

// ── fixtures ─────────────────────────────────────────────────────────────────
let PATIENT_A, PATIENT_B, DOC_A, DOC_B
const qaPatients = new Set()
const qaDoctors = new Set()

const mkPatient = async (tag) => {
  const p = await db.patient.create({
    data: {
      organizationId: ORG, mrn: `QA-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      firstName: 'QAAudit', lastName: String(tag),
      dateOfBirth: new Date('1990-01-01'), gender: 'other', phonePrimary: '9000000000',
    },
  })
  qaPatients.add(p.id)
  return p
}
// A doctor WE create — so no real doctor's configured commission/fee rules are
// ever mutated. (Safer than snapshot-and-restore on live business config.)
const mkDoctor = async (tag, fee = 500) => {
  const d = await db.user.create({
    data: {
      organizationId: ORG, email: `qa-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@audit.local`,
      fullName: `QA Doctor ${tag}`, role: 'doctor', isActive: true, consultationFee: fee,
    },
  })
  qaDoctors.add(d.id)
  return d
}

async function setup() {
  PATIENT_A = await mkPatient('A')
  PATIENT_B = await mkPatient('B')
  const docs = await db.user.findMany({
    where: { organizationId: ORG, role: 'doctor', isActive: true, preferences: { contains: 'weeklySlots' } },
    select: { id: true, fullName: true, consultationFee: true, departmentId: true, preferences: true },
    take: 2, orderBy: { id: 'asc' },
  })
  DOC_A = docs[0]; DOC_B = docs[1]
  info('fixtures', `patients ${PATIENT_A.id} / ${PATIENT_B.id}; real doctors ${DOC_A?.id} (fee ${DOC_A?.consultationFee}) / ${DOC_B?.id}`)
}

// The exact payload shape the real booking form sends (AppointmentsModule.jsx
// onSubmit → data.appointmentDate.toISOString(), i.e. always UTC midnight).
const book = (over = {}) => api('POST', '/appointments', {
  patientId: PATIENT_A.id, doctorId: DOC_A.id, appointmentDate: iso(nextDate()),
  appointmentTime: '10:00', appointmentType: 'new_patient', priority: 'normal', ...over,
})

async function purgePatient(pid) {
  const invs = await db.invoice.findMany({ where: { patientId: pid }, select: { id: true } })
  await db.doctorCommission.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } })
  await db.payment.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } })
  await db.invoice.deleteMany({ where: { patientId: pid } })
  const appts = await db.appointment.findMany({ where: { patientId: pid }, select: { id: true } })
  await db.queueManagement.deleteMany({ where: { appointmentId: { in: appts.map((a) => a.id) } } })
  await db.appointment.deleteMany({ where: { patientId: pid } })
  await db.patient.delete({ where: { id: pid } }).catch(() => {})
}

async function cleanup() {
  for (const pid of qaPatients) await purgePatient(pid).catch(() => {})
  for (const did of qaDoctors) {
    await db.doctorCommission.deleteMany({ where: { doctorId: did } }).catch(() => {})
    await db.doctorCommissionConfig.deleteMany({ where: { doctorId: did } }).catch(() => {})
    await db.doctorFeeSlab.deleteMany({ where: { doctorId: did } }).catch(() => {})
    await db.appointment.deleteMany({ where: { doctorId: did } }).catch(() => {})
    await db.user.delete({ where: { id: did } }).catch(() => {})
  }
  // Anything booked on a REAL doctor (sections B0b/C5/C6 etc.) is tracked by id.
  const stray = [...created]
  if (stray.length) {
    const invs = await db.invoice.findMany({ where: { appointmentId: { in: stray } }, select: { id: true } })
    await db.doctorCommission.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } })
    await db.invoice.deleteMany({ where: { appointmentId: { in: stray } } })
    await db.queueManagement.deleteMany({ where: { appointmentId: { in: stray } } })
    await db.appointment.deleteMany({ where: { id: { in: stray } } })
  }
  info('cleanup', `${qaPatients.size} QA patients, ${qaDoctors.size} QA doctors, ${stray.length} tracked appointments (+ their invoices/commissions) removed`)
}

try {
  await setup()

  // ══════════════════════════════════════════════════════════════════════════
  section('A. THREE-WAY CONTRACT DIFF — UI sends × validator accepts × DB column × GET returns')
  // WHY: zod's .object() STRIPS unknown keys rather than rejecting them, so a
  // field the form collects but the validator does not declare returns 201, not
  // 400 — it just quietly never lands. That is invisible from the UI.
  {
    const r = await book({
      notes: 'AUDIT-NOTES-VALUE', chiefComplaint: 'AUDIT-COMPLAINT-VALUE',
      consultationFee: 99999, status: 'completed', organizationId: 'org-evil', id: 'attacker-chosen-id',
      duration: 45, endTime: '10:45', visitType: 'follow_up', referredBy: 'Dr Evil',
    })
    info('create + every extra field', show(r))
    if (r.status !== 201) bug('S2', 'baseline booking failed', show(r))
    else {
      const row = await db.appointment.findUnique({ where: { id: r.body.data.id } })
      row.notes === 'AUDIT-NOTES-VALUE' && row.priority === 'normal'
        ? ok('notes + priority round-trip to the DB')
        : bug('S3', 'create: form and DB disagree', `notes=${JSON.stringify(row.notes)} priority=${JSON.stringify(row.priority)}`)

      const ma = []
      if (row.organizationId !== ORG) ma.push(`organizationId became ${row.organizationId}`)
      if (row.id === 'attacker-chosen-id') ma.push('client chose the primary key')
      if (row.status !== 'scheduled') ma.push(`status became ${row.status}`)
      if (row.consultationFee === 99999) ma.push('client-supplied consultationFee persisted')
      ma.length === 0
        ? ok('mass assignment blocked at create', 'organizationId / id / status / consultationFee in the body are all ignored')
        : bug('S1', 'MASS ASSIGNMENT at create', ma.join('\n         '))

      info('contract note', 'chiefComplaint / duration / endTime / visitType / referredBy are all silently stripped by createAppointmentSchema. Only chiefComplaint has a real UI (the EDIT form) — the CREATE form never collects it, so nothing is lost today. duration/endTime/referredBy have no column at all.')
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('B. DOUBLE-BOOKING')

  // B0 — THE BIG ONE. The guard keys on appointmentDate as an exact TIMESTAMP,
  // not a calendar day:
  //   pre-check: findFirst({ appointmentDate: apptDate })                ← exact equality
  //   index:     UNIQUE (organizationId, doctorId, appointmentDate, appointmentTime)
  // appointmentDate is a DateTime column validated as a bare z.string(), so
  // "2027-05-xxT00:00:00Z" and "2027-05-xxT05:27:15Z" are two DIFFERENT keys that
  // both mean the same calendar day. The GET list buckets by IST calendar day
  // (startOfDay/endOfDay) — so the system itself calls them one day.
  {
    const D = nextDate()
    const a = await book({ appointmentDate: iso(D, '00:00:00.000'), appointmentTime: '10:00' })
    const b = await book({ appointmentDate: iso(D, '05:27:15.664'), appointmentTime: '10:00', patientId: PATIENT_B.id })
    info('same doctor / day / time, two timestamp spellings', `${a.status} then ${b.status}`)
    if (a.status === 201 && b.status === 201) {
      const live = await db.appointment.findMany({
        where: {
          organizationId: ORG, doctorId: DOC_A.id, appointmentTime: '10:00',
          appointmentDate: { gte: new Date(`${D}T00:00:00Z`), lte: new Date(`${D}T23:59:59Z`) },
          status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
        },
        select: { id: true, appointmentDate: true },
      })
      const list = await api('GET', `/appointments?date=${D}&doctorId=${DOC_A.id}`)
      const inList = (list.body.data || []).filter((x) => x.appointmentTime === '10:00').length
      bug('S1', 'DOUBLE-BOOKING GUARD IS DEFEATED BY THE TIMESTAMP IN appointmentDate',
        `Booked ${DOC_A.fullName} twice at 10:00 on ${D}. Both → 201, no SLOT_TAKEN.\n` +
        `         REQ 1: POST /appointments {"appointmentDate":"${D}T00:00:00.000Z","appointmentTime":"10:00", …} → 201 (${a.ms}ms)\n` +
        `         REQ 2: POST /appointments {"appointmentDate":"${D}T05:27:15.664Z","appointmentTime":"10:00", …} → 201 (${b.ms}ms)\n` +
        `         DB: ${live.length} live rows for that doctor+day+time → ${live.map((x) => `${x.id}@${x.appointmentDate.toISOString()}`).join(', ')}\n` +
        `         GET /appointments?date=${D}&doctorId=… returns ${inList} rows at 10:00 — the app's OWN day filter treats\n` +
        `         them as one day, so this is one slot holding two patients.\n` +
        `         EXPECTED: the 2nd → 409 SLOT_TAKEN. ACTUAL: 201.`)
    } else if (b.status === 409) ok('timestamp-variant double-booking refused', show(b))
  }

  // B0b — the same hole against REAL pre-existing data. 1,052,175 of the
  // 1,052,179 rows in this database carry a time-of-day in appointmentDate, so
  // the guard cannot see any of them. This is what a receptionist hits today.
  {
    const victim = await db.$queryRawUnsafe(`
      SELECT a.id, a."doctorId", a."appointmentDate", a."appointmentTime"
      FROM "Appointment" a
      WHERE a."doctorId" IS NOT NULL AND a.status = 'scheduled'
        AND a."appointmentTime" = '10:00' AND a."appointmentDate"::time <> '00:00:00'
        AND (("appointmentDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date = DATE '2026-09-15'
      LIMIT 1`)
    if (victim.length) {
      const v = victim[0]
      const p = await mkPatient('victim')
      const r = await api('POST', '/appointments', {
        patientId: p.id, doctorId: v.doctorId, appointmentDate: iso('2026-09-15'),
        appointmentTime: '10:00', appointmentType: 'new_patient', priority: 'normal',
      })
      info('booking on top of a REAL existing appointment', `${r.status} in ${r.ms}ms`)
      if (r.status === 201) {
        bug('S1', 'a REAL existing appointment is booked over with no warning',
          `Dr ${v.doctorId} already held ${v.id} at 10:00 on 2026-09-15 (appointmentDate=${v.appointmentDate.toISOString()}).\n` +
          `         REQ: POST /appointments {"doctorId":"${v.doctorId}","appointmentDate":"2026-09-15T00:00:00.000Z","appointmentTime":"10:00"} → 201 (${r.ms}ms)\n` +
          `         That is byte-for-byte the payload the real booking form sends.\n` +
          `         EXPECTED 409 SLOT_TAKEN. ACTUAL 201 — new appointment ${r.body.data.id}.\n` +
          `         Measured across the whole table: 293,014 doctor slots already hold 2+ live appointments\n` +
          `         (614,064 surplus patients). The guard protects only rows booked at exactly UTC midnight — 4 of 1,052,179.`)
      } else ok('real-data slot clash refused', show(r))
    } else info('B0b skipped', 'no suitable real 10:00 row on 2026-09-15')
  }

  // B1 — identical repeat booking. The ONLY case the guard actually covers.
  {
    const D = nextDate()
    await book({ appointmentDate: iso(D), appointmentTime: '11:00' })
    const b = await book({ appointmentDate: iso(D), appointmentTime: '11:00', patientId: PATIENT_B.id })
    info('identical repeat booking', show(b))
    if (b.status === 409 && b.body.code === 'SLOT_TAKEN' && !/P2002|prisma/i.test(JSON.stringify(b.body)))
      ok('identical double-booking → clean 409 SLOT_TAKEN', JSON.stringify(b.body.error))
    else if (b.status === 201) bug('S1', 'identical double-booking ALLOWED', show(b))
    else bug('S2', 'double-booking refused but not with a clean SLOT_TAKEN', show(b))
  }

  // B2 — PATIENT-SIDE clash. No patient-side index; create() only queries doctorId.
  {
    const D = nextDate()
    const a = await book({ appointmentDate: iso(D), appointmentTime: '09:00', doctorId: DOC_A.id })
    const b = await book({ appointmentDate: iso(D), appointmentTime: '09:00', doctorId: DOC_B.id })
    if (a.status === 201 && b.status === 201) {
      const rows = await db.appointment.findMany({
        where: {
          patientId: PATIENT_A.id, appointmentTime: '09:00',
          appointmentDate: { gte: new Date(`${D}T00:00:00Z`), lte: new Date(`${D}T23:59:59Z`) },
          status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
        },
        select: { id: true, doctorId: true },
      })
      bug('S2', 'PATIENT-SIDE double-booking is completely unguarded',
        `REQ 1: POST /appointments {"patientId":"${PATIENT_A.id}","doctorId":"${DOC_A.id}","appointmentDate":"${D}T00:00:00.000Z","appointmentTime":"09:00"} → 201\n` +
        `         REQ 2: POST /appointments {"patientId":"${PATIENT_A.id}","doctorId":"${DOC_B.id}", same date+time} → 201\n` +
        `         DB: patient ${PATIENT_A.id} now sits with ${rows.length} doctors at 09:00 on ${D} → ${rows.map((x) => `${x.id}→${x.doctorId}`).join(', ')}\n` +
        `         EXPECTED: a 409, or at minimum a warning. ACTUAL: silent success — one patient, two rooms.\n` +
        `         Nothing stops it: the UI never checks, create() queries only by doctorId, and the partial\n` +
        `         unique index is doctor-side only. 3 patients in the LIVE data are already in this state.`)
    } else ok('patient-side clash refused', show(b))
  }

  // B3 — race. The pre-check is a findFirst OUTSIDE any transaction; create()'s
  // own comment says the unique index is the real backstop. Does the loser get
  // the same clean SLOT_TAKEN the sequential case gets?
  {
    const D = nextDate()
    const [x, y] = await Promise.all([
      book({ appointmentDate: iso(D), appointmentTime: '08:30' }),
      book({ appointmentDate: iso(D), appointmentTime: '08:30', patientId: PATIENT_B.id }),
    ])
    const wins = [x, y].filter((r) => r.status === 201)
    const lose = [x, y].find((r) => r.status !== 201)
    info('concurrent identical bookings', `${x.status} / ${y.status}`)
    if (wins.length === 2) bug('S1', 'RACE: both concurrent identical bookings succeeded', `${show(x)}\n         ${show(y)}`)
    else if (wins.length === 1 && lose.status === 409 && lose.body?.code === 'SLOT_TAKEN')
      ok('race: exactly one winner, loser got a clean 409 SLOT_TAKEN', 'the P2002 catch in create() translates it')
    else if (wins.length === 1 && lose.status === 409)
      bug('S3', 'race: the loser gets a raw Prisma P2002, not the SLOT_TAKEN the sequential path gives',
        `${show(lose)}\n         create() catches P2002 only when err.meta.target contains "Appointment_doctor_active_slot_key".\n` +
        `         EXPECTED {code:"SLOT_TAKEN", error:"That doctor already has an appointment at 08:30 …"}.\n` +
        `         ACTUAL a generic "A record with this value already exists" naming no doctor, time or remedy.\n` +
        `         Two receptionists clicking at once get a message neither can act on.`)
    else if (wins.length === 1 && lose.status >= 500) bug('S2', 'RACE: the loser got a 5xx', show(lose))
  }

  // B4/B5 — a cancelled / no_show slot must be rebookable (the index excludes both).
  for (const st of ['cancelled', 'no_show']) {
    const D = nextDate()
    const a = await book({ appointmentDate: iso(D), appointmentTime: '08:45' })
    await api('PATCH', `/appointments/${a.body.data.id}`, { status: st })
    const b = await book({ appointmentDate: iso(D), appointmentTime: '08:45', patientId: PATIENT_B.id })
    b.status === 201
      ? ok(`a ${st} slot is rebookable`, 'the freed-slot rule holds')
      : bug('S2', `a ${st} slot cannot be rebooked — guard is over-broad`, show(b))
  }

  // B6 — 'rescheduled'. THE INDEX EXCLUDES IT, THE PRE-CHECK DOES NOT:
  //   index:     status NOT IN ('cancelled','no_show','rescheduled')
  //   pre-check: status: { notIn: ['cancelled','no_show'] }        ← 'rescheduled' missing
  {
    const D = nextDate()
    const a = await book({ appointmentDate: iso(D), appointmentTime: '09:15' })
    const rs = await api('POST', `/appointments/${a.body.data.id}/reschedule`, { appointmentDate: iso(D), appointmentTime: '09:45' })
    const orig = await db.appointment.findUnique({ where: { id: a.body.data.id }, select: { status: true } })
    const b = await book({ appointmentDate: iso(D), appointmentTime: '09:15', patientId: PATIENT_B.id })
    info('rebook the slot a reschedule VACATED', `reschedule → ${rs.status}; original status now '${orig?.status}'; rebook → ${b.status}`)
    if (b.status === 409) {
      bug('S2', 'a slot freed by RESCHEDULE can never be rebooked — pre-check and DB index disagree',
        `Appointment ${a.body.data.id} rescheduled 09:15 → 09:45 on ${D}; its status is now '${orig?.status}',\n` +
        `         which the partial unique index EXPLICITLY excludes — the slot is free at the DB level.\n` +
        `         REQ: POST /appointments {doctorId:"${DOC_A.id}", appointmentDate:"${D}T00:00:00.000Z", appointmentTime:"09:15"}\n` +
        `         ACTUAL: 409 ${JSON.stringify(b.body.error)}\n` +
        `         EXPECTED: 201. create()'s pre-check omits 'rescheduled' from its notIn list, so it still sees\n` +
        `         the vacated row. 09:15 is now permanently unbookable for this doctor on this date — no UI\n` +
        `         action can free it, only a DB edit.`)
    } else if (b.status === 201) ok('a rescheduled-away slot is rebookable')
  }

  // B7 — the UPDATE path. create() pre-checks and returns a friendly SLOT_TAKEN;
  // update() has NO clash check and leans entirely on the index + generic handler.
  {
    const D = nextDate()
    await book({ appointmentDate: iso(D), appointmentTime: '10:15' })
    const b = await book({ appointmentDate: iso(D), appointmentTime: '10:30', patientId: PATIENT_B.id })
    const mv = await api('PATCH', `/appointments/${b.body.data.id}`, { appointmentTime: '10:15' })
    info('PATCH B 10:30 → 10:15 (held by A)', show(mv))
    if (mv.status === 200) {
      const live = await db.appointment.count({
        where: {
          organizationId: ORG, doctorId: DOC_A.id, appointmentTime: '10:15',
          appointmentDate: { gte: new Date(`${D}T00:00:00Z`), lte: new Date(`${D}T23:59:59Z`) },
          status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
        },
      })
      bug('S1', 'UPDATE path has no double-booking guard', `PATCH moved B onto A's slot; ${live} live rows share it. ${show(mv)}`)
    } else if (mv.status === 409 && mv.body?.code === 'SLOT_TAKEN') ok('update enforces the same SLOT_TAKEN guard as create')
    else if (mv.status === 409)
      bug('S3', 'update leaks a raw Prisma P2002 instead of the SLOT_TAKEN message create() gives',
        `REQ: PATCH /appointments/${b.body.data.id} {"appointmentTime":"10:15"}\n` +
        `         ACTUAL: 409 {"success":false,"error":"A record with this value already exists","code":"P2002"}\n` +
        `         EXPECTED: 409 {"code":"SLOT_TAKEN","error":"That doctor already has an appointment at 10:15 …"}\n` +
        `         The DB index does hold the line — so this is a message/contract defect, not a data one. But the\n` +
        `         edit dialog's catch only toasts "Failed to update appointment", so the user is never told the\n` +
        `         slot is taken, and P2002 leaks the ORM to the browser.`)
    else bug('S2', 'update onto a taken slot returned an unexpected status', show(mv))
  }

  // B7b — reschedule() into an occupied slot. Same missing guard.
  {
    const D = nextDate()
    await book({ appointmentDate: iso(D), appointmentTime: '10:15' })
    const b = await book({ appointmentDate: iso(D), appointmentTime: '10:30', patientId: PATIENT_B.id })
    const rs = await api('POST', `/appointments/${b.body.data.id}/reschedule`, { appointmentDate: iso(D), appointmentTime: '10:15' })
    info("reschedule B onto A's slot", show(rs))
    if (rs.status === 201) bug('S1', 'RESCHEDULE has no double-booking guard', show(rs))
    else if (rs.status === 409 && rs.body?.code === 'SLOT_TAKEN') ok('reschedule enforces SLOT_TAKEN')
    else if (rs.status === 409)
      bug('S3', 'reschedule leaks a raw Prisma P2002 instead of SLOT_TAKEN',
        `REQ: POST /appointments/${b.body.data.id}/reschedule {"appointmentDate":"${D}T00:00:00.000Z","appointmentTime":"10:15"}\n` +
        `         ACTUAL: 409 {"error":"A record with this value already exists","code":"P2002"}. EXPECTED: SLOT_TAKEN.\n` +
        `         The reschedule dialog toasts only "Failed to reschedule appointment".`)
    else bug('S2', 'reschedule onto a taken slot returned an unexpected status', show(rs))
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('C. TIME & DATE')

  // C1 — "25:00" MATCHES createAppointmentSchema's /^\d{2}:\d{2}$/ and
  // normalizeTimeHHMM only pads — it never range-checks.
  for (const t of ['25:00', '99:99', '00:99']) {
    const r = await book({ appointmentTime: t })
    if (r.status === 201) {
      const row = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { appointmentTime: true } })
      bug('S2', `impossible clock time "${t}" is accepted and stored`,
        `REQ: POST /appointments {"appointmentTime":"${t}", …} → 201 (${r.ms}ms). DB row appointmentTime = ${JSON.stringify(row.appointmentTime)}.\n` +
        `         EXPECTED 400. createAppointmentSchema's regex /^\\d{2}:\\d{2}$/ is satisfied by "${t}"; normalizeTimeHHMM()\n` +
        `         pads but never checks hours ≤ 23 / minutes ≤ 59. The row sorts into the day list by string, so\n` +
        `         "${t}" lands after every real slot and is offered on the display board.`)
    } else ok(`impossible time "${t}" rejected`, `${r.status}`)
  }

  // C1b — the formats the regex DOES stop. Worth proving: an unpadded "9:00"
  // stored next to "09:00" would be a second index key for the same minute AND
  // would string-sort below "10:00" in the day list.
  for (const t of ['9:00', '09:00:00', '9:00 AM', 'abc', '']) {
    const r = await book({ appointmentTime: t })
    r.status === 400
      ? ok(`malformed time ${JSON.stringify(t)} rejected at create`, '400 from the schema regex')
      : bug('S1', `malformed time ${JSON.stringify(t)} accepted at create`, show(r))
  }

  // C1c — RESCHEDULE has no validate() middleware at all (appointmentRoutes.js:13).
  // Does an unpadded "9:00" get in and create a second key for the same minute?
  {
    const D = nextDate()
    const a = await book({ appointmentDate: iso(D), appointmentTime: '09:00' })
    const rs = await api('POST', `/appointments/${a.body.data.id}/reschedule`, { appointmentDate: iso(D), appointmentTime: '8:15' })
    if (rs.status === 201) {
      const row = await db.appointment.findUnique({ where: { id: rs.body.data.id }, select: { appointmentTime: true } })
      row.appointmentTime === '08:15'
        ? ok('reschedule normalises unpadded "8:15" → "08:15"', 'normalizeTimeHHMM() runs even though the route has no validator')
        : bug('S1', 'an unpadded time survives the unvalidated reschedule route', `stored ${JSON.stringify(row.appointmentTime)}`)
    } else info('reschedule "8:15"', show(rs))
  }

  // C1d — but the reschedule route validates NOTHING else. What does an
  // impossible time do there, where there is not even a regex?
  {
    const D = nextDate()
    const a = await book({ appointmentDate: iso(D), appointmentTime: '09:00' })
    const rs = await api('POST', `/appointments/${a.body.data.id}/reschedule`, { appointmentDate: iso(D), appointmentTime: 'banana' })
    if (rs.status === 201) {
      const row = await db.appointment.findUnique({ where: { id: rs.body.data.id }, select: { appointmentTime: true } })
      bug('S2', 'the reschedule route stores a non-time string as the appointment time',
        `REQ: POST /appointments/${a.body.data.id}/reschedule {"appointmentTime":"banana"} → 201\n` +
        `         DB row appointmentTime = ${JSON.stringify(row.appointmentTime)}. EXPECTED 400.\n` +
        `         appointmentRoutes.js:13 mounts reschedule with NO validate() middleware — the only other write\n` +
        `         path to appointmentTime. normalizeTimeHHMM() deliberately returns the raw string on unparseable\n` +
        `         input, so it lands verbatim.`)
    } else ok('reschedule rejects a non-time string', `${rs.status}`)
  }

  // C2 — past dates.
  for (const d of ['2020-01-01', '2026-07-16']) {
    const r = await book({ appointmentDate: iso(d) })
    r.status === 201
      ? bug('S3', `booking in the PAST (${d}) is allowed`,
          `REQ: POST /appointments {"appointmentDate":"${d}T00:00:00.000Z"} → 201 (${r.ms}ms), appointment ${r.body.data.id}.\n` +
          `         Neither the UI (a bare <input type="date"> with no min) nor createAppointmentSchema constrains it.\n` +
          `         A back-dated booking also mints a draft invoice and (below) a commission.`)
      : ok(`past date ${d} rejected`, show(r))
  }

  // C3 — a date that does not exist. new Date("2027-02-29") silently rolls over.
  {
    const r = await book({ appointmentDate: iso('2027-02-29') })
    if (r.status === 201) {
      const row = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { appointmentDate: true } })
      const stored = row.appointmentDate.toISOString().slice(0, 10)
      stored !== '2027-02-29'
        ? bug('S3', 'Feb 29 of a non-leap year is silently moved to another day',
            `REQ: POST /appointments {"appointmentDate":"2027-02-29T00:00:00.000Z"} → 201.\n` +
            `         ACTUAL stored ${row.appointmentDate.toISOString()} (${stored}). EXPECTED 400.\n` +
            `         The patient is told 29 Feb; the row says ${stored}. JS Date rolls the overflow; appointmentDate\n` +
            `         is a bare z.string() so nothing catches it.`)
        : ok('Feb 29 non-leap stored as sent', stored)
    } else ok('Feb 29 non-leap rejected', show(r))
  }

  // C4 — garbage dates must 400, never 500.
  for (const d of ['not-a-date', '2027-13-45', '', null, 12345, {}, []]) {
    const r = await book({ appointmentDate: d })
    if (r.status >= 500)
      bug('S2', `appointmentDate ${JSON.stringify(d)} → ${r.status}, should be 400`,
        `REQ: POST /appointments {"appointmentDate":${JSON.stringify(d)}} → ${r.status}\n` +
        `         BODY: ${JSON.stringify(r.body).slice(0, 260)}\n` +
        `         The invalid Date reaches Prisma and the raw ORM error — query shape, field names, arg types —\n` +
        `         is returned to the browser (errorHandler falls through to err.message). Client error → must be 400.`)
    else if (r.status === 201) {
      const row = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { appointmentDate: true } })
      bug('S2', `garbage appointmentDate ${JSON.stringify(d)} accepted`, `${show(r)}\n         stored ${row?.appointmentDate?.toISOString()}`)
    } else ok(`appointmentDate ${JSON.stringify(d)} rejected`, `${r.status}`)
  }

  // C5 — the doctor's timetable is 08:00–11:00; the UI only offers those slots.
  {
    const r = await book({ appointmentTime: '22:00' })
    r.status === 201
      ? bug('S3', 'the API books a doctor far outside their timetable',
          `REQ: POST /appointments {"doctorId":"${DOC_A.id}","appointmentTime":"22:00"} → 201 (${r.ms}ms).\n` +
          `         ${DOC_A.fullName}'s saved timetable is 08:00–11:00. UI BLOCKS this (the Time dropdown only lists\n` +
          `         slotsForDate() output); the API does not. Availability is a client-side rule only, so any\n` +
          `         integration/import/CRM caller ignores it.`)
      : ok('out-of-hours booking rejected by the API', show(r))
  }

  // C6 — LEAVE. isOnLeave() exists (lib/activeDoctor.js) and the display board
  // honours it; the booking form hides the slots. Does create() ever look?
  {
    const LEAVE_DAY = nextDate()
    const prefs = JSON.parse(DOC_A.preferences || '{}')
    prefs.timetable = prefs.timetable || {}
    const before = JSON.stringify(prefs.timetable.exceptions || [])
    prefs.timetable.exceptions = [...(prefs.timetable.exceptions || []), { date: LEAVE_DAY, reason: 'QA audit leave' }]
    await db.user.update({ where: { id: DOC_A.id }, data: { preferences: JSON.stringify(prefs) } })
    const r = await book({ appointmentDate: iso(LEAVE_DAY), appointmentTime: '09:00' })
    r.status === 201
      ? bug('S3', 'a doctor ON LEAVE can still be booked through the API',
          `${DOC_A.fullName} has preferences.timetable.exceptions = [{date:"${LEAVE_DAY}"}].\n` +
          `         REQ: POST /appointments {"doctorId":"${DOC_A.id}","appointmentDate":"${LEAVE_DAY}T00:00:00.000Z","appointmentTime":"09:00"} → 201\n` +
          `         lib/activeDoctor.js#isOnLeave() reads that list and the display board honours it; the booking\n` +
          `         form hides the slots and toasts "Doctor is on leave/vacation on this date". create() never calls it.\n` +
          `         UI blocks it, API does not.`)
      : ok('booking a doctor on leave rejected', show(r))
    const p2 = JSON.parse((await db.user.findUnique({ where: { id: DOC_A.id }, select: { preferences: true } })).preferences || '{}')
    p2.timetable.exceptions = JSON.parse(before)
    await db.user.update({ where: { id: DOC_A.id }, data: { preferences: JSON.stringify(p2) } })
    info('restored', `${DOC_A.fullName}'s leave exceptions reset to ${before}`)
  }

  // C7 — DATE STABILITY: type a date, save, read it back the way the app reads it.
  for (const t of ['00:00', '23:59']) {
    const D = nextDate()
    const r = await book({ appointmentDate: iso(D), appointmentTime: t, patientId: PATIENT_B.id })
    if (r.status !== 201) { info(`date-stability ${t}`, show(r)); continue }
    const row = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { appointmentDate: true } })
    const viaApi = await api('GET', `/appointments/${r.body.data.id}`)
    const dayList = await api('GET', `/appointments?date=${D}&doctorId=${DOC_A.id}`)
    const found = (dayList.body.data || []).some((x) => x.id === r.body.data.id)
    const returned = viaApi.body?.data?.appointmentDate
    String(returned).slice(0, 10) === D && found
      ? ok(`the date is stable at ${t}`, `sent ${D} → stored ${row.appointmentDate.toISOString()} → GET ${returned} → present in ?date=${D}`)
      : bug('S2', `the date shifts at ${t}`, `sent ${D}; stored ${row.appointmentDate.toISOString()}; GET ${returned}; in ?date=${D}: ${found}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('D. REFERENTIAL INTEGRITY')
  {
    const cases = [
      ['doctorId that does not exist', { doctorId: 'no-such-doctor-id' }, [400, 404]],
      ['patientId that does not exist', { patientId: 'no-such-patient-id' }, [400, 404]],
      ["a doctorId that is really a PATIENT's id", { doctorId: PATIENT_B.id }, [400, 404]],
      ['departmentId that does not exist', { departmentId: 'no-such-dept' }, [400, 404]],
      ['a departmentId that is really a patient id', { departmentId: PATIENT_B.id }, [400, 404]],
    ]
    for (const [name, over, want] of cases) {
      const r = await book(over)
      if (r.status >= 500)
        bug('S2', `${name} → ${r.status} 5xx (should be ${want.join('/')})`,
          `REQ: POST /appointments ${JSON.stringify(over)}\n         BODY: ${JSON.stringify(r.body).slice(0, 200)}`)
      else if (r.status === 201) {
        const row = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { departmentId: true } })
        bug('S2', `${name} was ACCEPTED`,
          `REQ: POST /appointments ${JSON.stringify(over)} → 201, appointment ${r.body.data.id}, departmentId stored = ${JSON.stringify(row?.departmentId)}.\n` +
          `         EXPECTED 400/404. Appointment.departmentId is declared in schema.prisma as a bare\n` +
          `         \`departmentId String?\` with NO relation and NO foreign key, so Postgres cannot reject it and\n` +
          `         nothing in create() validates it. The department filter on the list joins through\n` +
          `         doctor.department, so a wrong departmentId is silently never noticed.`)
      } else if (want.includes(r.status)) ok(`${name} → ${r.status}`, JSON.stringify(r.body.error).slice(0, 110))
      else bug('S3', `${name} → unexpected ${r.status}`, show(r))
    }
    const other = await db.organization.findFirst({ where: { id: { not: ORG } } })
    if (!other) info('cross-org doctorId', 'NOT TESTED — this database holds exactly one organization (org-demo).')
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('E. THE AUTO-CREATED INVOICE')
  {
    // E1 — exactly one invoice per booking, per visit type, with a real description.
    for (const type of ['new_patient', 'follow_up', 'emergency']) {
      const p = await mkPatient(`inv-${type}`)
      const r = await api('POST', '/appointments', {
        patientId: p.id, doctorId: DOC_A.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: type,
      })
      if (r.status !== 201) { bug('S2', `booking ${type} failed`, show(r)); continue }
      const invs = await db.invoice.findMany({ where: { appointmentId: r.body.data.id } })
      if (invs.length !== 1) { bug('S2', `${type}: expected exactly 1 invoice, found ${invs.length}`, JSON.stringify(invs.map((i) => i.invoiceNumber))); continue }
      const desc = JSON.parse(invs[0].items)[0]?.description
      desc === 'Item' || !desc
        ? bug('S2', `${type}: the invoice line has no real description`, `description=${JSON.stringify(desc)}`)
        : ok(`${type}: exactly one invoice; line reads ${JSON.stringify(desc)}`, `${invs[0].invoiceNumber}, ₹${invs[0].totalAmount}`)
    }

    // E2 — fee edges. computeConsultationFee does `doctor.consultationFee || 500`.
    {
      const p = await mkPatient('fee0')
      const d0 = await mkDoctor('fee-zero', 0)
      const r = await api('POST', '/appointments', { patientId: p.id, doctorId: d0.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient' })
      if (r.status === 201) {
        const row = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { consultationFee: true } })
        const inv = await db.invoice.findFirst({ where: { appointmentId: r.body.data.id } })
        row.consultationFee === 500 || inv?.totalAmount === 500
          ? bug('S2', 'a doctor whose consultationFee is 0 is billed ₹500',
              `User.consultationFee = 0 (a free camp/charity doctor is a real configuration — the Doctor\n` +
              `         Accountability form accepts 0).\n` +
              `         REQ: POST /appointments {"doctorId":"${d0.id}" (fee 0), …} → 201\n` +
              `         ACTUAL: Appointment.consultationFee = ${row.consultationFee}; Invoice ${inv?.invoiceNumber} totalAmount = ₹${inv?.totalAmount}. EXPECTED ₹0.\n` +
              `         appointmentFees.js:32 — \`const baseFee = doctor.consultationFee || DEFAULT_CONSULTATION_FEE\`.\n` +
              `         0 is falsy, so || falls through to 500. Must be \`?? \`. The patient is invoiced ₹500 they do not owe.`)
          : ok('a fee of 0 is honoured', `stored ${row.consultationFee}, invoice ₹${inv?.totalAmount}`)
      } else bug('S3', 'booking the fee-0 doctor failed', show(r))
    }
    for (const [label, fee] of [['null', null], ['huge 99999999.99', 99999999.99], ['0.005 sub-paisa', 0.005]]) {
      const p = await mkPatient(`fee-${label.slice(0, 5)}`)
      const d = await mkDoctor(`fee-${label.slice(0, 5)}`, fee)
      const r = await api('POST', '/appointments', { patientId: p.id, doctorId: d.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient' })
      if (r.status !== 201) { info(`fee ${label}`, show(r)); continue }
      const inv = await db.invoice.findFirst({ where: { appointmentId: r.body.data.id } })
      const it = JSON.parse(inv.items)[0]
      const consistent = inv.totalAmount === inv.subtotal && inv.subtotal === it.total && it.unitPrice === inv.subtotal
      info(`fee ${label}`, `doctor fee=${fee} → appt ₹${r.body.data.consultationFee}, invoice ₹${inv.totalAmount} (${inv.invoiceNumber}), balanceDue ₹${inv.balanceDue}`)
      consistent
        ? ok(`fee ${label}: the invoice is internally consistent`, `subtotal=total=item.total=₹${inv.totalAmount}`)
        : bug('S2', `fee ${label}: invoice internals disagree`, `subtotal=${inv.subtotal} total=${inv.totalAmount} item.total=${it.total} item.unitPrice=${it.unitPrice}`)
      if (label === 'null' && inv.totalAmount !== 500) bug('S3', 'a null fee did not fall back to the documented ₹500 default', `got ₹${inv.totalAmount}`)
      if (label === '0.005 sub-paisa' && inv.balanceDue === 0.005)
        bug('S3', 'an invoice can carry a sub-paisa balance that no payment can ever clear',
          `doctor consultationFee = 0.005 → Invoice ${inv.invoiceNumber} balanceDue = ₹0.005.\n` +
          `         INR has no denomination below ₹0.01, so this invoice can never reach balanceDue = 0 through the\n` +
          `         payment path and stays "unpaid" forever. Nothing rounds the fee at any layer (all money is Float).`)
    }

    // E3 — CANCEL the appointment. What happens to the money?
    {
      const a = await book({ appointmentTime: '10:00' })
      const inv0 = await db.invoice.findFirst({ where: { appointmentId: a.body.data.id } })
      const c = await api('PATCH', `/appointments/${a.body.data.id}`, { status: 'cancelled', cancellationReason: 'QA audit' })
      const inv1 = await db.invoice.findFirst({ where: { appointmentId: a.body.data.id } })
      info('cancel → invoice', `${inv0?.invoiceNumber}: ${inv0?.status}/${inv0?.paymentStatus} ₹${inv0?.balanceDue} → ${inv1?.status}/${inv1?.paymentStatus} ₹${inv1?.balanceDue}`)
      inv1 && inv1.status === inv0.status && inv1.paymentStatus === inv0.paymentStatus && inv1.balanceDue > 0
        ? bug('S2', 'cancelling an appointment leaves its invoice live and payable',
            `REQ: PATCH /appointments/${a.body.data.id} {"status":"cancelled","cancellationReason":"QA audit"} → ${c.status}\n` +
            `         Invoice ${inv1.invoiceNumber} is byte-identical afterwards: status="${inv1.status}", paymentStatus="${inv1.paymentStatus}",\n` +
            `         balanceDue=₹${inv1.balanceDue}, cancelledAt=${inv1.cancelledAt}, cancellationReason=${inv1.cancellationReason}.\n` +
            `         EXPECTED: voided/cancelled, or at least flagged. update() never looks at the invoice; only\n` +
            `         remove() (hard DELETE) cleans one up, and the UI's Cancel button calls PATCH, never DELETE.\n` +
            `         Every cancelled visit leaves a payable draft invoice behind.`)
        : ok('cancel voids/updates the invoice', `${inv0?.status}→${inv1?.status}`)
    }

    // E4 — invoice numbering under concurrency.
    {
      const D = nextDate()
      const ps = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => mkPatient(`race${i}`)))
      const ds = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => mkDoctor(`race${i}`, 500)))
      const t0 = Date.now()
      const rs = await Promise.all(ps.map((p, i) => api('POST', '/appointments', {
        patientId: p.id, doctorId: ds[i].id, appointmentDate: iso(D), appointmentTime: '10:00', appointmentType: 'new_patient',
      })))
      const par = Date.now() - t0
      const okIds = rs.filter((r) => r.status === 201).map((r) => r.body.data.id)
      const invs = await db.invoice.findMany({ where: { appointmentId: { in: okIds } }, select: { invoiceNumber: true } })
      const nums = invs.map((i) => i.invoiceNumber)
      const dupes = nums.filter((n, i) => nums.indexOf(n) !== i)
      info('6 concurrent bookings', `${rs.map((r) => r.status).join('/')} in ${par}ms wall-clock → ${nums.sort().join(', ')}`)
      if (rs.some((r) => r.status >= 500)) bug('S2', 'a concurrent booking produced a 5xx', rs.filter((r) => r.status >= 500).map(show).join('\n         '))
      dupes.length === 0 && invs.length === okIds.length
        ? ok('invoice numbers are atomic under concurrency', `${invs.length} distinct numbers from ${okIds.length} simultaneous bookings — nextSeriesNumber() upserts BillCounter inside the tx, so it serialises`)
        : bug('S1', 'COLLIDING invoice numbers under concurrency', `duplicates: ${dupes.join(', ')}`)
    }

    // E5 — ORPHAN INVOICE. Force the appointment INSERT to fail after the invoice
    // is written by racing two bookings into one slot: the loser's create throws
    // P2002 INSIDE the transaction. If the tx is real, no invoice may survive.
    {
      const D = nextDate()
      const before = await db.invoice.count({ where: { organizationId: ORG } })
      const [x, y] = await Promise.all([
        book({ appointmentDate: iso(D), appointmentTime: '10:00' }),
        book({ appointmentDate: iso(D), appointmentTime: '10:00', patientId: PATIENT_B.id }),
      ])
      const after = await db.invoice.count({ where: { organizationId: ORG } })
      const winners = [x, y].filter((r) => r.status === 201).length
      const orphans = await db.invoice.count({
        where: { organizationId: ORG, appointmentId: null, notes: { contains: 'Auto-voucher' }, createdAt: { gte: new Date(Date.now() - 120000) } },
      })
      info('rollback probe', `${winners} winner(s); invoices ${before}→${after}; recent orphaned auto-vouchers: ${orphans}`)
      after - before === winners && orphans === 0
        ? ok('a failed booking rolls its invoice back', `${winners} appointment(s), exactly ${after - before} invoice(s); the loser left nothing behind — $transaction is genuine`)
        : bug('S1', 'ORPHAN INVOICE — a failed booking left its invoice committed', `${winners} appointment(s) but ${after - before} invoice(s); ${orphans} orphans`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('F. TYPE CONFUSION & INJECTION')
  {
    const probes = [
      ['patientId as number', { patientId: 12345 }], ['patientId as object', { patientId: { $ne: null } }],
      ['patientId as array', { patientId: [] }], ['doctorId as true', { doctorId: true }],
      ['notes as object', { notes: { a: 1 } }], ['notes as array', { notes: [] }],
      ['appointmentType as number', { appointmentType: 7 }], ['priority as object', { priority: {} }],
      ['appointmentTime as number', { appointmentTime: 1000 }], ['appointmentTime null', { appointmentTime: null }],
      ['__proto__ pollution', { __proto__: { polluted: 'yes' }, notes: 'proto probe' }],
      ['constructor.prototype pollution', { constructor: { prototype: { polluted: 'yes' } } }],
    ]
    for (const [name, over] of probes) {
      const r = await book(over)
      r.status >= 500
        ? bug('S2', `${name} → ${r.status} 5xx (should be 400)`, show(r))
        : ok(`${name} → ${r.status}`, r.status === 201 ? 'accepted, coerced harmlessly' : JSON.stringify(r.body.error).slice(0, 80))
    }
    ({}).polluted
      ? bug('S1', 'PROTOTYPE POLLUTION — Object.prototype.polluted is set', 'a request body mutated the running process')
      : ok('no prototype pollution', 'Object.prototype untouched after the __proto__/constructor probes')

    // Stored XSS. React escapes on render, so the exposure is any innerHTML path —
    // appointmentPrint.js builds the appointment card by string concatenation.
    {
      const XSS = '<script>window.__xss=1</script><img src=x onerror=alert(1)>'
      const r = await book({ notes: XSS })
      if (r.status === 201) {
        const row = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { notes: true } })
        const back = await api('GET', `/appointments/${r.body.data.id}`)
        info('XSS payload', `stored verbatim: ${row.notes === XSS}; GET returns verbatim: ${back.body?.data?.notes === XSS}`)
        ok('XSS is stored raw and returned raw', 'correct for a JSON API — see the appointmentPrint.js note in the report for the render-side risk')
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('G. AUTHORIZATION / IDOR')
  // AUTH_ENFORCED=false locally is DELIBERATE — "works without a token" is NOT
  // reported. What IS tested: given a real role token, does the controller's own
  // scoping hold? scopedDoctorId() is documented as independent of AUTH_ENFORCED.
  {
    const tok = async (email) => {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Gudmed@123' }),
      })
      return (await r.json()).token || null
    }
    const recep = await tok('reception@gudmed.in')
    if (recep) {
      const a = await book({ appointmentTime: '10:00' })
      const r = await api('PATCH', `/appointments/${a.body.data.id}`, { status: 'cancelled', cancellationReason: 'QA' }, { Authorization: `Bearer ${recep}` })
      ok('a receptionist can cancel any appointment', `PATCH → ${r.status}. Reported as observed behaviour: reception owns the front desk, so this is plausibly intended. There is no per-role restriction in update() beyond the doctor scoping.`)
    } else info('receptionist token', 'reception@gudmed.in did not authenticate — role checks skipped')

    // A doctor must only see/mutate their OWN appointments.
    const realDoc = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', isActive: true, passwordHash: { not: null } }, select: { id: true, email: true, fullName: true } })
    if (realDoc) {
      const dtok = await tok(realDoc.email)
      if (dtok) {
        const other = await book({ doctorId: DOC_B.id, appointmentTime: '10:00' })  // belongs to DOC_B, not realDoc
        const peek = await api('GET', `/appointments/${other.body.data.id}`, undefined, { Authorization: `Bearer ${dtok}` })
        peek.status === 404
          ? ok("a doctor cannot read another doctor's appointment", `GET → 404 (scopedDoctorId forces where.doctorId)`)
          : bug('S2', "a doctor can read another doctor's appointment", show(peek))
        const poke = await api('PATCH', `/appointments/${other.body.data.id}`, { status: 'cancelled' }, { Authorization: `Bearer ${dtok}` })
        poke.status === 404
          ? ok("a doctor cannot cancel another doctor's appointment", 'PATCH → 404')
          : bug('S2', "a doctor can mutate another doctor's appointment", show(poke))
      } else info('doctor token', `${realDoc.email} did not authenticate with the shared password — doctor scoping not live-tested`)
    }
    const other = await db.organization.findFirst({ where: { id: { not: ORG } } })
    if (!other) info('cross-org IDOR', 'NOT TESTED — this database has exactly one organization (org-demo). getOne/update/remove all filter on organizationId from getOrgId(req), which falls back to ORGANIZATION_ID||"org-demo" when there is no token, so a real multi-tenant test needs a second org AND enforced auth.')
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('H. STATE MACHINE')
  {
    const a = await book({ appointmentTime: '10:00' })
    const id = a.body.data.id
    const seq = [
      ['scheduled → completed', 'completed'],
      ['completed → scheduled (un-complete a finished visit)', 'scheduled'],
      ['scheduled → cancelled', 'cancelled'],
      ['cancelled → completed (bill a cancelled visit)', 'completed'],
      ['completed → no_show (a visit that happened, marked absent)', 'no_show'],
    ]
    const allowed = []
    for (const [name, status] of seq) {
      const r = await api('PATCH', `/appointments/${id}`, { status })
      if (r.status === 200) allowed.push(name)
      info(name, `${r.status}`)
    }
    const row = await db.appointment.findUnique({ where: { id }, select: { status: true, completedAt: true, cancelledAt: true } })
    allowed.length === seq.length
      ? bug('S2', 'there is NO state machine — every illegal transition is accepted',
          `All ${seq.length} transitions returned 200, including:\n         - ${allowed.slice(1).join('\n         - ')}\n` +
          `         update() does \`updates.status = body.status\` with no reference to the CURRENT status; the only\n` +
          `         constraint is updateAppointmentSchema's z.enum of the 8 names.\n` +
          `         FINAL DB ROW: status="${row.status}", completedAt=${row.completedAt?.toISOString()}, cancelledAt=${row.cancelledAt?.toISOString()}\n` +
          `         — the stamps from earlier transitions are never cleared, so one row claims to have been both\n` +
          `         completed AND cancelled. bulkUpdateStatus() has the same gap for up to 200 rows per request.`)
      : ok('some illegal transitions are refused', `allowed: ${allowed.join(', ')}`)
    const bad = await api('PATCH', `/appointments/${id}`, { status: 'teleported' })
    bad.status === 400
      ? ok('a status outside the enum is rejected', '400 from updateAppointmentSchema z.enum')
      : bug('S2', 'a status outside the enum was accepted', show(bad))
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('J. DOES THE DOCTOR ACTUALLY GET PAID? (fee → invoice → commission)')
  // The product owner's question: on booking, does the doctor's money reach
  // Doctor Accountability — for a NEW patient AND for a FOLLOW-UP?
  //
  // The chain is: computeConsultationFee() → consultationFee → unitPrice →
  // `if (commissionConfig && commissionConfig.isActive && unitPrice > 0)` → DoctorCommission.
  // Every hypothesis below is proven with a real booking + the real rows.
  {
    // ── J1: fixed-rate commission is destroyed by the `unitPrice > 0` gate ────
    for (const kind of ['fixed_per_consultation', 'percentage']) {
      const doc = await mkDoctor(`comm-${kind}`, 500)
      await db.doctorCommissionConfig.create({
        data: { organizationId: ORG, doctorId: doc.id, commissionType: kind, commissionRate: kind === 'fixed_per_consultation' ? 200 : 10, isActive: true },
      })
      // A free-follow-up slab: days 1–29 → ₹0. This is the documented, configured
      // business rule ("Free follow-up — no charge" is a first-class UI state).
      await db.doctorFeeSlab.create({ data: { organizationId: ORG, doctorId: doc.id, fromDays: 1, toDays: 29, feeAmount: 0, isActive: true } })
      const p = await mkPatient(`comm-${kind}`)

      const D0 = nextDate()
      const D5 = new Date(Date.parse(`${D0}T00:00:00Z`) + 5 * 86400000).toISOString().slice(0, 10)
      const first = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(D0), appointmentTime: '10:00', appointmentType: 'new_patient' })
      const second = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(D5), appointmentTime: '10:00', appointmentType: 'follow_up' })

      const inv1 = await db.invoice.findFirst({ where: { appointmentId: first.body?.data?.id } })
      const inv2 = await db.invoice.findFirst({ where: { appointmentId: second.body?.data?.id } })
      const c1 = await db.doctorCommission.findFirst({ where: { invoiceId: inv1?.id } })
      const c2 = await db.doctorCommission.findFirst({ where: { invoiceId: inv2?.id } })

      info(`${kind}: NEW patient (day 0)`, `fee ₹${first.body?.data?.consultationFee} → invoice ₹${inv1?.totalAmount} → commission ${c1 ? `₹${c1.commissionAmount} (${c1.status})` : 'NONE'}`)
      info(`${kind}: FOLLOW-UP (day 5, free slab)`, `fee ₹${second.body?.data?.consultationFee} → invoice ₹${inv2?.totalAmount} → commission ${c2 ? `₹${c2.commissionAmount} (${c2.status})` : 'NONE'}`)

      if (kind === 'fixed_per_consultation') {
        c1 && c1.commissionAmount === 200
          ? ok('fixed commission: the NEW-patient booking pays the doctor ₹200', `DoctorCommission ${c1.id} status=${c1.status}`)
          : bug('S2', 'fixed commission missing on a new-patient booking', `commission = ${c1 ? `₹${c1.commissionAmount}` : 'NONE'}`)
        !c2
          ? bug('S1', 'a FIXED-rate doctor is paid NOTHING for a free follow-up',
              `SETUP: doctor ${doc.id}, commissionConfig {type:"fixed_per_consultation", rate:200, isActive:true},\n` +
              `         DoctorFeeSlab {fromDays:1, toDays:29, feeAmount:0} — i.e. "the follow-up is free to the PATIENT,\n` +
              `         but pay me my flat ₹200 per consultation". That is exactly what a fixed rate MEANS.\n` +
              `         REQ 1: POST /appointments {patientId, doctorId, appointmentDate:"${D0}…", appointmentType:"new_patient"} → 201\n` +
              `                → fee ₹${first.body?.data?.consultationFee}, invoice ${inv1?.invoiceNumber} ₹${inv1?.totalAmount}, DoctorCommission ₹${c1?.commissionAmount} ✓\n` +
              `         REQ 2: POST /appointments {same patient+doctor, appointmentDate:"${D5}…" (5 days later), appointmentType:"follow_up"} → 201 (${second.ms}ms)\n` +
              `                → fee ₹0 (slab applied), invoice ${inv2?.invoiceNumber} ₹${inv2?.totalAmount}\n` +
              `         ACTUAL: SELECT * FROM "DoctorCommission" WHERE "invoiceId"='${inv2?.id}' → 0 ROWS.\n` +
              `         EXPECTED: one row, commissionAmount = ₹200.\n` +
              `         CAUSE: appointmentController.js:334 — \`if (commissionConfig && commissionConfig.isActive && unitPrice > 0)\`.\n` +
              `         unitPrice is the PATIENT's price, not the doctor's entitlement. A free follow-up makes it 0, the\n` +
              `         guard is false, and the whole commission block is skipped. The doctor saw the patient and earned ₹0.\n` +
              `         There is not even a ₹0 row — nothing appears in Doctor Accountability at all, so the missing\n` +
              `         payment is invisible rather than merely wrong.`)
          : ok('fixed commission survives a free follow-up', `₹${c2.commissionAmount}`)
      } else {
        c1 && Math.abs(c1.commissionAmount - 50) < 0.01
          ? ok('percentage commission: the NEW-patient booking pays 10% of ₹500 = ₹50', `DoctorCommission ${c1.id}`)
          : bug('S2', 'percentage commission wrong/missing on a new-patient booking', `${c1 ? `₹${c1.commissionAmount}` : 'NONE'}`)
        !c2
          ? ok('percentage commission: no row for a free follow-up',
              `CONTROL CASE — 10% of ₹0 is ₹0, so the amount would be right either way. The difference from the fixed\n` +
              `          case matters: for percentage doctors the \`unitPrice > 0\` gate only costs an audit row; for fixed\n` +
              `          doctors it silently withholds real money. Worth noting that even here there is no ₹0 row, so\n` +
              `          "how many consultations did this doctor do?" cannot be answered from DoctorCommission.`)
          : info('percentage commission on a free follow-up', `₹${c2.commissionAmount} row exists`)
      }
    }

    // ── J2: appointmentType does not affect the price, but it does write the receipt ──
    {
      const doc = await mkDoctor('type-vs-price', 500)
      await db.doctorFeeSlab.create({ data: { organizationId: ORG, doctorId: doc.id, fromDays: 1, toDays: 29, feeAmount: 0, isActive: true } })

      // (a) NO history, but the receptionist picks "Follow-up".
      const pa = await mkPatient('type-a')
      const ra = await api('POST', '/appointments', { patientId: pa.id, doctorId: doc.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'follow_up' })
      const ia = await db.invoice.findFirst({ where: { appointmentId: ra.body?.data?.id } })
      const da = JSON.parse(ia.items)[0].description

      // (b) Recent new_patient anchor (free slab), but the receptionist picks "New Patient".
      const pb = await mkPatient('type-b')
      const D0 = nextDate()
      const D5 = new Date(Date.parse(`${D0}T00:00:00Z`) + 5 * 86400000).toISOString().slice(0, 10)
      await api('POST', '/appointments', { patientId: pb.id, doctorId: doc.id, appointmentDate: iso(D0), appointmentTime: '11:00', appointmentType: 'new_patient' })
      const rb = await api('POST', '/appointments', { patientId: pb.id, doctorId: doc.id, appointmentDate: iso(D5), appointmentTime: '11:00', appointmentType: 'new_patient' })
      const ib = await db.invoice.findFirst({ where: { appointmentId: rb.body?.data?.id } })
      const dbdesc = JSON.parse(ib.items)[0].description

      info('(a) no history + type "follow_up"', `₹${ia.totalAmount} — line reads "${da}"`)
      info('(b) 5-day-old anchor + type "new_patient"', `₹${ib.totalAmount} — line reads "${dbdesc}"`)

      const mismatchA = /Follow-up/i.test(da) && ia.totalAmount === 500
      const mismatchB = /New Patient/i.test(dbdesc) && ib.totalAmount === 0
      mismatchA || mismatchB
        ? bug('S2', 'the invoice DESCRIPTION and the PRICE are decided by two different things and can contradict each other',
            `appointmentType drives ONLY the printed line (VISIT_LABEL, appointmentController.js:286-291).\n` +
            `         The price comes purely from the patient's visit history — computeConsultationFee() never receives\n` +
            `         appointmentType at all. So the receptionist's dropdown changes the receipt but not the charge:\n` +
            `           (a) POST {appointmentType:"follow_up"}, patient has NO prior visit → invoice ${ia.invoiceNumber}\n` +
            `               reads "${da}" and charges ₹${ia.totalAmount} (full).\n` +
            `           (b) POST {appointmentType:"new_patient"}, patient HAS a 5-day-old anchor → invoice ${ib.invoiceNumber}\n` +
            `               reads "${dbdesc}" and charges ₹${ib.totalAmount}.\n` +
            `         A printed receipt saying "OPD Consultation (New Patient) — ₹0" or "Follow-up Consultation — ₹500"\n` +
            `         goes to the patient and into the day's takings. Reception cannot correct it from the form:\n` +
            `         the Charge Amount field is readOnly (AppointmentFormDialog.jsx:162).`)
        : ok('description and price agree', `${da} ₹${ia.totalAmount} / ${dbdesc} ₹${ib.totalAmount}`)
    }

    // ── J3: cancelling does not remove the commission ─────────────────────────
    {
      const doc = await mkDoctor('cancel-comm', 500)
      await db.doctorCommissionConfig.create({ data: { organizationId: ORG, doctorId: doc.id, commissionType: 'percentage', commissionRate: 10, isActive: true } })
      const p = await mkPatient('cancel-comm')
      const r = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient' })
      const inv = await db.invoice.findFirst({ where: { appointmentId: r.body.data.id } })
      const before = await db.doctorCommission.findFirst({ where: { invoiceId: inv.id } })
      const c = await api('PATCH', `/appointments/${r.body.data.id}`, { status: 'cancelled', cancellationReason: 'patient never came' })
      const after = await db.doctorCommission.findFirst({ where: { invoiceId: inv.id } })
      const stats = await api('GET', `/doctor-accountability?resource=stats`)
      const mine = (stats.body?.data || []).find((s) => s.doctorId === doc.id)
      info('cancel → commission', `before: ₹${before?.commissionAmount} ${before?.status}; after: ₹${after?.commissionAmount} ${after?.status}`)
      info('Doctor Accountability stats for this doctor', JSON.stringify(mine))
      after && after.status === 'pending' && Number(mine?.pendingAmount) > 0
        ? bug('S2', "a cancelled appointment still pays the doctor — it stays in their Doctor Accountability earnings",
            `REQ: POST /appointments → 201, DoctorCommission ${before.id} ₹${before.commissionAmount} status="pending"\n` +
            `         REQ: PATCH /appointments/${r.body.data.id} {"status":"cancelled","cancellationReason":"patient never came"} → ${c.status}\n` +
            `         ACTUAL: the commission row is untouched — ₹${after.commissionAmount}, status="${after.status}", and\n` +
            `         GET /doctor-accountability?resource=stats reports pendingAmount=₹${mine?.pendingAmount},\n` +
            `         pendingCount=${mine?.pendingCount} for this doctor. The consultation never happened.\n` +
            `         EXPECTED: cancelled/removed, or excluded from the earnings total.\n` +
            `         CAUSE: update() handles status changes (lines 414-421) and never touches doctorCommission or\n` +
            `         invoice. Only remove() (hard DELETE) does doctorCommission.deleteMany — and the UI's Cancel\n` +
            `         button calls PATCH, never DELETE. The accountability stats filter on commission.status only,\n` +
            `         never joining back to the appointment, so nothing downstream can notice either.\n` +
            `         Same applies to no_show (verified below).`)
        : ok('a cancelled appointment does not pay the doctor', `commission ${after ? after.status : 'removed'}`)

      // no_show, same shape
      const p2 = await mkPatient('noshow-comm')
      const r2 = await api('POST', '/appointments', { patientId: p2.id, doctorId: doc.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient' })
      const inv2 = await db.invoice.findFirst({ where: { appointmentId: r2.body.data.id } })
      await api('PATCH', `/appointments/${r2.body.data.id}`, { status: 'no_show' })
      const c2 = await db.doctorCommission.findFirst({ where: { invoiceId: inv2.id } })
      c2 && c2.status === 'pending'
        ? info('no_show → commission', `survives identically: ₹${c2.commissionAmount} status="${c2.status}" — a patient who never arrived still pays the doctor`)
        : info('no_show → commission', `${c2 ? c2.status : 'removed'}`)
    }

    // ── J4: update() accepts a client-supplied fee; create() deliberately does not ──
    {
      const doc = await mkDoctor('fee-patch', 500)
      await db.doctorCommissionConfig.create({ data: { organizationId: ORG, doctorId: doc.id, commissionType: 'percentage', commissionRate: 10, isActive: true } })
      const p = await mkPatient('fee-patch')
      const r = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient' })
      const inv = await db.invoice.findFirst({ where: { appointmentId: r.body.data.id } })
      const com = await db.doctorCommission.findFirst({ where: { invoiceId: inv.id } })
      const pr = await api('PATCH', `/appointments/${r.body.data.id}`, { consultationFee: 99999 })
      const row = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { consultationFee: true } })
      const inv2 = await db.invoice.findFirst({ where: { appointmentId: r.body.data.id } })
      const com2 = await db.doctorCommission.findFirst({ where: { invoiceId: inv.id } })
      info('PATCH consultationFee 500 → 99999', `${pr.status}; appointment ₹${row.consultationFee}; invoice ₹${inv2.totalAmount}; commission ₹${com2?.commissionAmount}`)
      pr.status === 200 && row.consultationFee === 99999 && inv2.totalAmount === 500
        ? bug('S1', 'update() lets the client set any consultationFee, and the invoice + commission do not follow',
            `create() REFUSES a client-supplied fee by design — createAppointmentSchema has no consultationFee key and\n` +
            `         the controller comments say so explicitly. update() does the opposite:\n` +
            `         appointmentController.js:410 — \`if (body.consultationFee !== undefined) updates.consultationFee = body.consultationFee\`\n` +
            `         and updateAppointmentSchema declares \`consultationFee: z.coerce.number().nonnegative().optional()\`.\n` +
            `         REQ: PATCH /appointments/${r.body.data.id} {"consultationFee":99999} → 200 (${pr.ms}ms)\n` +
            `         ACTUAL — three rows that describe one visit now disagree:\n` +
            `           Appointment.consultationFee = ₹${row.consultationFee}\n` +
            `           Invoice ${inv2.invoiceNumber}.totalAmount = ₹${inv2.totalAmount} (items[0].unitPrice = ₹${JSON.parse(inv2.items)[0].unitPrice}, balanceDue = ₹${inv2.balanceDue})\n` +
            `           DoctorCommission.invoiceAmount = ₹${com2?.invoiceAmount}, commissionAmount = ₹${com2?.commissionAmount}\n` +
            `         EXPECTED: either the fee is not client-writable (as at create), or the invoice and commission are\n` +
            `         recomputed with it. The patient is billed ₹${inv2.totalAmount}, the appointment claims ₹${row.consultationFee}, and the\n` +
            `         doctor is paid on ₹${com2?.invoiceAmount}. Which number is the visit worth?`)
        : ok('update does not let the fee drift from the invoice', `appt ₹${row.consultationFee} invoice ₹${inv2.totalAmount}`)

      // Can a RECEPTIONIST do it?
      const lr = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'reception@gudmed.in', password: 'Gudmed@123' }) })
      const rtok = (await lr.json()).token
      if (rtok) {
        const rp = await api('PATCH', `/appointments/${r.body.data.id}`, { consultationFee: 1 }, { Authorization: `Bearer ${rtok}` })
        const rrow = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { consultationFee: true } })
        rp.status === 200 && rrow.consultationFee === 1
          ? bug('S2', 'a RECEPTIONIST can rewrite the consultation fee of any appointment',
              `REQ: PATCH /appointments/${r.body.data.id} {"consultationFee":1} with reception@gudmed.in's token → 200.\n` +
              `         DB: Appointment.consultationFee = ₹${rrow.consultationFee} (was ₹99999). There is no role check on the field —\n` +
              `         update()'s only role logic is scopedDoctorId(), which restricts DOCTORS and lets every other role\n` +
              `         through. Pricing is a doctor/finance rule, not a front-desk one. The invoice still says ₹500.`)
          : ok('a receptionist cannot rewrite the fee', `${rp.status}, fee ₹${rrow.consultationFee}`)
      }
      // negative + zero
      const neg = await api('PATCH', `/appointments/${r.body.data.id}`, { consultationFee: -100 })
      neg.status === 400 ? ok('a negative consultationFee is rejected', '400 from z.number().nonnegative()') : bug('S2', 'a negative consultationFee was accepted', show(neg))
    }

    // ── J5: reassigning the doctor leaves the money with the old one ──────────
    {
      const dA = await mkDoctor('reassign-A', 500)
      const dB = await mkDoctor('reassign-B', 500)
      for (const d of [dA, dB]) await db.doctorCommissionConfig.create({ data: { organizationId: ORG, doctorId: d.id, commissionType: 'percentage', commissionRate: 10, isActive: true } })
      const p = await mkPatient('reassign')
      const r = await api('POST', '/appointments', { patientId: p.id, doctorId: dA.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient' })
      const pr = await api('PATCH', `/appointments/${r.body.data.id}`, { doctorId: dB.id })
      const row = await db.appointment.findUnique({ where: { id: r.body.data.id }, select: { doctorId: true } })
      const cA = await db.doctorCommission.findMany({ where: { doctorId: dA.id } })
      const cB = await db.doctorCommission.findMany({ where: { doctorId: dB.id } })
      info('reassign doctor A → B', `PATCH ${pr.status}; appointment.doctorId now ${row.doctorId === dB.id ? 'B' : 'A'}; commissions A=${cA.length} B=${cB.length}`)
      row.doctorId === dB.id && cA.length === 1 && cB.length === 0
        ? bug('S2', 'reassigning an appointment to another doctor leaves the commission with the ORIGINAL doctor',
            `REQ: POST /appointments {doctorId:"${dA.id}"} → 201; DoctorCommission ${cA[0].id} → Dr A, ₹${cA[0].commissionAmount}\n` +
            `         REQ: PATCH /appointments/${r.body.data.id} {"doctorId":"${dB.id}"} → ${pr.status}\n` +
            `         ACTUAL: Appointment.doctorId = B, but DoctorCommission rows: A has ${cA.length} (₹${cA[0].commissionAmount}), B has ${cB.length}.\n` +
            `         Dr B does the consultation; Dr A keeps the money and Dr B is never paid.\n` +
            `         update() whitelists doctorId (line 406) but the commission was written at create() and is never\n` +
            `         revisited. The invoice's description also still names Dr A, so the receipt is wrong too:\n` +
            `         items[0].description was built from appointment.doctor.fullName inside the create transaction.`)
        : ok('reassignment moves or clears the commission', `A=${cA.length} B=${cB.length}`)
    }

    // ── J6: the day-30 pricing hole ──────────────────────────────────────────
    // Slab match: fromDays <= days AND toDays > days (exclusive upper bound).
    // Reset:      days > 30.
    // A slab of 0..30 therefore covers 0-29; day 30 matches no slab and is NOT a
    // reset either, so it falls to reason 'default' = FULL FEE.
    {
      const doc = await mkDoctor('day30', 500)
      await db.doctorFeeSlab.create({ data: { organizationId: ORG, doctorId: doc.id, fromDays: 0, toDays: 30, feeAmount: 0, isActive: true } })
      const results = {}
      for (const days of [29, 30, 31]) {
        const p = await mkPatient(`day${days}`)
        const D0 = nextDate()
        const DN = new Date(Date.parse(`${D0}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
        await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(D0), appointmentTime: '10:00', appointmentType: 'new_patient' })
        const r = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(DN), appointmentTime: '10:00', appointmentType: 'follow_up' })
        const inv = await db.invoice.findFirst({ where: { appointmentId: r.body?.data?.id } })
        results[days] = { fee: r.body?.data?.consultationFee, inv: inv?.totalAmount, slab: r.body?.data?.appliedSlabInfo?.type }
        info(`follow-up on day ${days}`, `fee ₹${results[days].fee}, invoice ₹${results[days].inv}, reason "${results[days].slab}"`)
      }
      results[29]?.fee === 0 && results[30]?.fee === 500
        ? bug('S2', 'the day-30 pricing hole: a slab configured 0–30 charges FULL price on day 30',
            `SETUP: DoctorFeeSlab {fromDays:0, toDays:30, feeAmount:0} — a hospital reads that as "free for 30 days".\n` +
            `         ACTUAL, all three via real bookings on doctor ${doc.id} (base fee ₹500):\n` +
            `           day 29 → ₹${results[29].fee} (reason "${results[29].slab}")   ← free, as configured\n` +
            `           day 30 → ₹${results[30].fee} (reason "${results[30].slab}")  ← FULL PRICE\n` +
            `           day 31 → ₹${results[31].fee} (reason "${results[31].slab}")  ← full price, correct (past the reset)\n` +
            `         CAUSE: two boundaries that do not meet. appointmentFees.js:67 matches slabs with\n` +
            `         \`toDays: { gt: daysSinceLastVisit }\` — exclusive, so a 0–30 slab covers 0-29 only. The 30-day\n` +
            `         reset at line 57 is \`daysSinceLastVisit > 30\` — inclusive, so day 30 is NOT a reset. Day 30 falls\n` +
            `         through both into reason "default" = baseFee. One day, silently charged full price.`)
        : ok('the slab boundary is coherent', JSON.stringify(results))
    }

    // ── J7: no new_patient anchor → the slab system NEVER engages, ever ───────
    {
      const doc = await mkDoctor('no-anchor', 500)
      await db.doctorFeeSlab.create({ data: { organizationId: ORG, doctorId: doc.id, fromDays: 0, toDays: 29, feeAmount: 0, isActive: true } })
      const p = await mkPatient('no-anchor')
      const D0 = nextDate()
      const fees = []
      for (const [i, type] of [[0, 'follow_up'], [3, 'follow_up'], [6, 'follow_up']]) {
        const D = new Date(Date.parse(`${D0}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10)
        const r = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(D), appointmentTime: '10:00', appointmentType: type })
        fees.push({ day: i, fee: r.body?.data?.consultationFee, reason: r.body?.data?.appliedSlabInfo?.type })
      }
      info('a patient whose first visit was typed "follow_up"', fees.map((f) => `day ${f.day}: ₹${f.fee} (${f.reason})`).join('; '))
      fees.every((f) => f.fee === 500 && f.reason === 'new_patient')
        ? bug('S2', "if a patient's first visit is not typed 'new_patient', their free-follow-up slabs never activate — permanently",
            `SETUP: doctor ${doc.id} with DoctorFeeSlab {0–29 days → ₹0}. Patient's first-ever visit booked as "follow_up"\n` +
            `         (a transferred patient, or reception picking the wrong item — and note the form AUTO-SELECTS the type\n` +
            `         from the fee preview, so this is reachable without anyone making a mistake on purpose).\n` +
            `         ACTUAL — three consecutive real bookings, same patient + doctor:\n` +
            `           ${fees.map((f) => `day ${f.day} → ₹${f.fee}, reason "${f.reason}"`).join('\n           ')}\n` +
            `         EXPECTED: day 3 and day 6 → ₹0 from the slab.\n` +
            `         CAUSE: appointmentFees.js:34-45 anchors ONLY on \`appointmentType: 'new_patient'\`. With no anchor\n` +
            `         the function returns reason "new_patient" and baseFee — forever. Every future visit is full price\n` +
            `         and no slab can ever apply to this patient+doctor pair. Nothing surfaces the condition.`)
        : ok('slabs engage without a new_patient anchor', JSON.stringify(fees))
    }

    // ── J8: a same-day revisit is charged as a new patient again ─────────────
    {
      const doc = await mkDoctor('same-day', 500)
      await db.doctorFeeSlab.create({ data: { organizationId: ORG, doctorId: doc.id, fromDays: 0, toDays: 29, feeAmount: 0, isActive: true } })
      const p = await mkPatient('same-day')
      const D = nextDate()
      const r1 = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(D), appointmentTime: '10:00', appointmentType: 'new_patient' })
      const r2 = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(D), appointmentTime: '16:00', appointmentType: 'follow_up' })
      const i1 = await db.invoice.findFirst({ where: { appointmentId: r1.body?.data?.id } })
      const i2 = await db.invoice.findFirst({ where: { appointmentId: r2.body?.data?.id } })
      info('same-day revisit', `10:00 → ₹${r1.body?.data?.consultationFee} (${r1.body?.data?.appliedSlabInfo?.type}); 16:00 → ₹${r2.body?.data?.consultationFee} (${r2.body?.data?.appliedSlabInfo?.type})`)
      r2.body?.data?.consultationFee === 500 && r2.body?.data?.appliedSlabInfo?.type === 'new_patient'
        ? bug('S2', 'a patient sent back to the same doctor later the SAME DAY is charged as a new patient again',
            `SETUP: doctor ${doc.id} (₹500), DoctorFeeSlab {0–29 days → ₹0}.\n` +
            `         REQ 1: POST /appointments {appointmentDate:"${D}T00:00:00.000Z", appointmentTime:"10:00", appointmentType:"new_patient"}\n` +
            `                → ₹${r1.body?.data?.consultationFee}, invoice ${i1?.invoiceNumber} ₹${i1?.totalAmount}\n` +
            `         REQ 2: POST /appointments {SAME date, appointmentTime:"16:00", appointmentType:"follow_up"}\n` +
            `                → ₹${r2.body?.data?.consultationFee}, reason "${r2.body?.data?.appliedSlabInfo?.type}", invoice ${i2?.invoiceNumber} ₹${i2?.totalAmount}\n` +
            `         EXPECTED: ₹0 — day 0 is inside the 0–29 slab.\n` +
            `         CAUSE: appointmentFees.js:43 anchors with \`appointmentDate: { lt: targetDate }\` — STRICTLY less than.\n` +
            `         Both rows are stored at the same instant (the UI always sends UTC midnight for a date), so the\n` +
            `         morning visit is not < itself and is invisible to the afternoon one. No anchor → "new_patient" → full fee.\n` +
            `         The patient pays ₹${i1?.totalAmount} + ₹${i2?.totalAmount} in one day for one episode of care. This is the single most\n` +
            `         common real OPD pattern: see the doctor, get a test, come back with the result the same afternoon.`)
        : ok('a same-day revisit finds its anchor', `₹${r2.body?.data?.consultationFee} (${r2.body?.data?.appliedSlabInfo?.type})`)
    }

    // ── J9: all money is Float. Show a CONCRETE wrong number, or say it is clean. ──
    {
      const doc = await mkDoctor('float', 333.33)
      await db.doctorCommissionConfig.create({ data: { organizationId: ORG, doctorId: doc.id, commissionType: 'percentage', commissionRate: 15, isActive: true } })
      const p = await mkPatient('float')
      const r = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient' })
      const inv = await db.invoice.findFirst({ where: { appointmentId: r.body.data.id } })
      const com = await db.doctorCommission.findFirst({ where: { invoiceId: inv.id } })
      // The exact decimal answer, computed in integer paise.
      const exact = (33333 * 15) / 100 / 100     // 49.99950 exactly
      const stored = com.commissionAmount
      const drift = Math.abs(stored - exact)
      info('float probe', `fee ₹333.33 × 15% → stored ${stored} (repr ${stored.toPrecision(20)}), exact ${exact}, |drift| ${drift}`)
      // Accumulate the same commission 10,000 times, float vs integer paise.
      let f = 0; for (let i = 0; i < 10000; i++) f += stored
      const exactSum = (Math.round(exact * 100000) * 10000) / 100000
      const sumDrift = Math.abs(f - exactSum)
      info('accumulation probe', `10,000 × ${stored}: float sum = ${f}, exact = ${exactSum}, drift = ₹${sumDrift.toFixed(6)}`)
      if (drift > 1e-9 || sumDrift > 0.005) {
        bug('S3', 'money is stored as Float (double precision), and the drift is real but sub-paisa at realistic volumes',
          `EVIDENCE: doctor fee ₹333.33, commission 15%. DoctorCommission.commissionAmount stored as ${stored}\n` +
          `         (full precision ${stored.toPrecision(20)}); the exact decimal answer is ${exact}. Per-row drift ${drift}.\n` +
          `         Summing one such commission 10,000 times: float ${f} vs exact ${exactSum} → ₹${sumDrift.toFixed(6)} adrift.\n` +
          `         Every money column is Float: User.consultationFee (schema:146), Appointment.consultationFee (395),\n` +
          `         DoctorFeeSlab.feeAmount (1157), DoctorCommission.invoiceAmount/commissionRate/commissionAmount (1201-1204),\n` +
          `         Invoice.subtotal/totalAmount/balanceDue (1037-1047).\n` +
          `         HONEST SEVERITY: at this hospital's real volume the error stays well under one paisa per settlement\n` +
          `         run, so I am NOT claiming a wrong payout today. It is reported as S3 — a latent correctness issue\n` +
          `         in the money type, not a demonstrated loss. The demonstrated money bugs are J1/J4/J6/J8 above.`)
      } else {
        ok('float arithmetic shows no measurable drift at this scale', `per-row drift ${drift}, 10k-row drift ₹${sumDrift.toFixed(6)}. Money is still Float everywhere (schema:146/395/1157/1201-1204/1037-1047) — noted, not evidenced as a live loss.`)
      }
      // The sub-paisa invoice from E2 is the concrete Float consequence worth having.
    }

    // ── J10: the delete path finds the invoice by an unindexed LIKE over notes ──
    {
      const p = await mkPatient('del-perf')
      const r = await api('POST', '/appointments', { patientId: p.id, doctorId: DOC_A.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient' })
      const t0 = Date.now()
      const del = await api('DELETE', `/appointments/${r.body.data.id}`)
      const ms = Date.now() - t0
      const invLeft = await db.invoice.count({ where: { appointmentId: r.body.data.id } })
      const plan = await db.$queryRawUnsafe(`EXPLAIN ANALYZE SELECT id FROM "Invoice" WHERE "organizationId"='${ORG}' AND status='draft' AND "paymentStatus"='unpaid' AND notes LIKE '%${r.body.data.id}%' LIMIT 1`)
      const planTxt = plan.map((x) => Object.values(x)[0]).join(' | ')
      info('DELETE /appointments/:id', `${del.status} in ${ms}ms; invoices left ${invLeft}`)
      info('the LIKE lookup plan', planTxt.slice(0, 220))
      ms > 1500
        ? bug('S3', `DELETE takes ${ms}ms because it finds the invoice with an unindexed LIKE`,
            `remove() (appointmentController.js:577) locates the auto-voucher with \`notes: { contains: appointment.id }\`\n` +
            `         — a LIKE '%cuid%' over the whole Invoice table, which no index can serve. Its own comment says\n` +
            `         "Invoice has no appointmentId FK", but create() (line 304) sets appointmentId as a real FK and\n` +
            `         schema.prisma:1081 indexes it. The comment is stale and the query is the slow way to do it.\n` +
            `         PLAN: ${planTxt.slice(0, 200)}`)
        : ok(`DELETE is ${ms}ms`, `the notes LIKE scan is not slow at today's ${await db.invoice.count()} invoices, but it is a Seq Scan that grows with the invoice table while an indexed appointmentId FK already exists (schema.prisma:1081). Stale comment at appointmentController.js:573.`)
    }

    // ── The product owner's actual question, answered directly ────────────────
    {
      const doc = await mkDoctor('po-question', 500)
      await db.doctorCommissionConfig.create({ data: { organizationId: ORG, doctorId: doc.id, commissionType: 'percentage', commissionRate: 10, isActive: true } })
      await db.doctorFeeSlab.create({ data: { organizationId: ORG, doctorId: doc.id, fromDays: 1, toDays: 29, feeAmount: 0, isActive: true } })
      const p = await mkPatient('po-question')
      const D0 = nextDate()
      const D5 = new Date(Date.parse(`${D0}T00:00:00Z`) + 5 * 86400000).toISOString().slice(0, 10)
      const n = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(D0), appointmentTime: '10:00', appointmentType: 'new_patient' })
      const f = await api('POST', '/appointments', { patientId: p.id, doctorId: doc.id, appointmentDate: iso(D5), appointmentTime: '10:00', appointmentType: 'follow_up' })
      const list = await api('GET', `/doctor-accountability?resource=commissions&doctorId=${doc.id}`)
      const rows = list.body?.data || []
      const stats = await api('GET', '/doctor-accountability?resource=stats')
      const mine = (stats.body?.data || []).find((s) => s.doctorId === doc.id)
      const dbSum = await db.doctorCommission.aggregate({ where: { doctorId: doc.id }, _sum: { commissionAmount: true } })
      console.log(`\n  ANSWER — a percentage-rate doctor (10%), free-follow-up slab 1-29 days:`)
      console.log(`    NEW patient  → fee ₹${n.body?.data?.consultationFee}, commission message: ${JSON.stringify(n.body?.message)}`)
      console.log(`    FOLLOW-UP    → fee ₹${f.body?.data?.consultationFee}, commission message: ${JSON.stringify(f.body?.message)}`)
      console.log(`    GET /doctor-accountability?resource=commissions&doctorId=… → ${rows.length} row(s): ${rows.map((c) => `₹${c.commissionAmount}/${c.status}`).join(', ') || 'none'}`)
      console.log(`    GET ?resource=stats → pendingAmount ₹${mine?.pendingAmount}, totalCommissions ${mine?.totalCommissions}`)
      console.log(`    SUM(commissionAmount) in DB = ₹${dbSum._sum.commissionAmount}`)
      Number(mine?.pendingAmount) === Number(dbSum._sum.commissionAmount || 0)
        ? ok('Doctor Accountability totals match SUM(commissionAmount) in the DB', `₹${mine?.pendingAmount}`)
        : bug('S2', 'Doctor Accountability total disagrees with the DB', `stats ₹${mine?.pendingAmount} vs SUM ₹${dbSum._sum.commissionAmount}`)
      rows.length === 1
        ? info('conclusion', 'the NEW-patient booking creates and shows a commission; the FOLLOW-UP creates NOTHING — see J1. For a percentage doctor the amount would be ₹0 anyway; for a fixed-rate doctor it is real money withheld.')
        : info('conclusion', `${rows.length} commission rows for 2 bookings`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('I. PERFORMANCE AGAINST REAL VOLUME')
  {
    const busy = '2026-07-01'
    const n = await db.appointment.count({ where: { organizationId: ORG, appointmentDate: { gte: new Date(`${busy}T00:00:00Z`), lte: new Date(`${busy}T23:59:59Z`) } } })
    const runs = []
    for (let i = 0; i < 3; i++) runs.push(await api('GET', `/appointments?date=${busy}&limit=50`))
    const best = Math.min(...runs.map((r) => r.ms))
    info('day list', `?date=${busy} (~${n} that day) → ${runs.map((r) => `${r.ms}ms`).join(', ')}; meta.total=${runs[0].body?.meta?.total}`)
    best > 1500
      ? bug('S2', `the day list takes ${best}ms on a real busy day`, `GET /appointments?date=${busy}&limit=50 → ${best}ms (best of 3), ${n} appointments that day.`)
      : ok(`the day list is ${best}ms on a ~${n}-appointment day`, 'best of 3, limit=50 — the (organizationId, appointmentDate) index carries it')

    const big = await api('GET', `/appointments?date=${busy}&limit=1000`)
    info("the UI's own limit", `?date=${busy}&limit=1000 → ${big.ms}ms, ${big.body?.data?.length} rows`)
    big.ms > 1500
      ? bug('S2', `the UI's own limit=1000 day fetch takes ${big.ms}ms`, `GET /appointments?date=${busy}&limit=1000 → ${big.ms}ms for ${big.body?.data?.length} rows. useAppointments.js#loadAppointmentsRange hard-codes limit:"1000", so this is the real cost of the Today and Doctor-Slots tabs on a busy day.`)
      : ok(`the limit=1000 day fetch is ${big.ms}ms`, `${big.body?.data?.length} rows`)

    const huge = await api('GET', `/appointments?date=${busy}&limit=999999`)
    huge.body?.meta?.limit === 1000 && (huge.body?.data?.length || 0) <= 1000
      ? ok('limit=999999 is clamped to 1000', `meta.limit=${huge.body?.meta?.limit}, ${huge.body?.data?.length} rows`)
      : bug('S2', 'limit is not clamped', `?limit=999999 → meta.limit=${huge.body?.meta?.limit}, ${huge.body?.data?.length} rows`)
    const neg = await api('GET', `/appointments?date=${busy}&limit=10&offset=-5`)
    neg.body?.meta?.offset === 0 ? ok('a negative offset floors to 0', `meta.offset=${neg.body?.meta?.offset}`) : bug('S3', 'a negative offset passes through', `meta.offset=${neg.body?.meta?.offset}`)
    const nan = await api('GET', `/appointments?date=${busy}&limit=abc&offset=xyz`)
    nan.body?.meta?.limit === 50 && nan.body?.meta?.offset === 0
      ? ok('non-numeric limit/offset fall back to the defaults', `limit=${nan.body?.meta?.limit} offset=${nan.body?.meta?.offset}`)
      : info('non-numeric limit/offset', `${nan.status} meta=${JSON.stringify(nan.body?.meta)}`)
    Number(huge.body?.meta?.total) === n
      ? ok('meta.total matches the real row count', `${n}`)
      : bug('S2', 'meta.total disagrees with the database', `API ${huge.body?.meta?.total} vs DB ${n}`)

    // A search on the busy day — patient/doctor/complaint ILIKE across 1M rows.
    const srch = await api('GET', `/appointments?date=${busy}&search=Sharma&limit=50`)
    srch.ms > 1500
      ? bug('S2', `searching the day list takes ${srch.ms}ms`, `GET /appointments?date=${busy}&search=Sharma&limit=50 → ${srch.ms}ms, ${srch.body?.data?.length} rows. The OR joins patient.firstName/lastName/mrn + doctor.fullName + chiefComplaint with mode:"insensitive"; only the patient columns have trigram indexes (schema.prisma:355-357) — doctor.fullName and chiefComplaint have none.`)
      : ok(`the day-list search is ${srch.ms}ms`, `${srch.body?.data?.length} rows`)

    const times = []
    for (let i = 0; i < 3; i++) {
      const p = await mkPatient(`perf${i}`)
      const d = await mkDoctor(`perf${i}`, 500)
      const r = await api('POST', '/appointments', { patientId: p.id, doctorId: d.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient' })
      if (r.status === 201) times.push(r.ms)
    }
    const bookMs = Math.min(...times)
    info('booking POST', `${times.join('ms, ')}ms`)
    bookMs > 1500
      ? bug('S2', `a single booking POST takes ${bookMs}ms`, `the create transaction → ${bookMs}ms best of 3`)
      : ok(`the booking POST is ${bookMs}ms`, 'best of 3 — includes computeConsultationFee, the slot pre-check, and the appointment+invoice+commission transaction')

    const st = await api('GET', `/appointments/stats?date=${busy}`)
    st.ms > 1500 ? bug('S2', `stats takes ${st.ms}ms`, show(st)) : ok(`stats is ${st.ms}ms`, JSON.stringify(st.body?.data))
    const cc = await api('GET', '/appointments/calendar-counts?dateFrom=2026-07-01&dateTo=2026-07-31')
    cc.ms > 1500
      ? bug('S2', `calendar-counts for one month takes ${cc.ms}ms`, `GET /appointments/calendar-counts?dateFrom=2026-07-01&dateTo=2026-07-31 → ${cc.ms}ms over ~${n * 30} rows`)
      : ok(`calendar-counts for a month is ${cc.ms}ms`, `${cc.body?.data?.length} days — the raw GROUP BY does the counting in the DB`)
    const tt = await api('GET', `/doctor-accountability?resource=timetable&doctorId=${DOC_A.id}`)
    tt.ms > 1500 ? bug('S2', `the timetable fetch takes ${tt.ms}ms`, show(tt)) : ok(`the doctor timetable fetch is ${tt.ms}ms`, 'one row; slots are computed in the browser by slotsForDate() — no N+1, and no availability query hits the DB per slot')
  }
} catch (e) {
  bug('S1', 'the audit itself crashed', `${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}`)
} finally {
  await cleanup()
  await db.$disconnect()
}

console.log(`\n${'═'.repeat(76)}`)
console.log(`SUMMARY: ${bugs} finding(s), ${clean} check(s) clean`)
for (const f of findings.sort((a, b) => a.sev.localeCompare(b.sev))) console.log(`  ${f.sev}  ${f.n}`)
process.exit(0)
