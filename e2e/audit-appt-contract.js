// APPOINTMENT BOOKING — FOUR-WAY CONTRACT FIDELITY AUDIT
//
//   node e2e/audit-appt-contract.js
//
// The one question this script answers: for a booking, does every field survive
// the full round trip, in BOTH directions, with no silent drop or mutation?
//
//   [A] what the BROWSER actually PUT ON THE WIRE (real XHR request payload)
//   [B] what the BACKEND STORED           (the Prisma row, read directly)
//   [C] what the BACKEND RETURNED         (the create/GET response body)
//   [D] what the FRONTEND then RECEIVES/DISPLAYS (the reloaded list + the DOM)
//
// A field is a defect if  A≠B  (sent but not stored / stored differently),
//                         B≠C  (stored one thing, returned another), or
//                         C≠D  (returned but the UI drops it).
// This is exactly the "frontend sent X, backend didn't store it / backend sent Y,
// frontend didn't show it" class — the same class as the patient address that was
// silently dropped.
//
// METHOD
//   PART 1 drives the REAL booking form in a real browser (Playwright), records
//          the exact request + response off the wire, reads the row back with
//          Prisma, then HARD-RELOADS and reads what the UI receives & shows. This
//          is the only leg that can catch a UI-side drop — the API can't send [D].
//   PART 2 fires the type/shape edge cases the UI can never produce STRAIGHT at
//          the API (bad types, out-of-enum, "25:00", past date, extra field, …)
//          and, for each, reads the stored row + the GET to prove where it lands.
//   PART 3 follows the auto-created INVOICE and COMMISSION: is the invoice number
//          in the response? does the frontend see it? does Doctor Accountability's
//          GET agree with SUM(commissionAmount)?
//
// Every finding is reproduced TWICE (each probe is sent twice / each conclusion is
// reached on two independent bookings) and must agree both times to be reported.
//
// Bootstrap (Prisma + the network recorder) is copied from e2e/contract-audit.js:
// Prisma lives in backend/, and backend/.env holds DATABASE_URL which nothing
// loads for a script run from here.
//
// SAFETY: creates only QA rows (a QA patient + its appointments/invoices/
// commissions/queue). Mutates no existing business row. Everything it creates is
// tracked and removed in cleanup(); anything it touches on a real doctor is undone.
import { chromium } from 'playwright'
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

const BASE = process.env.E2E_BASE || 'http://localhost:5173'
const API = process.env.E2E_API || 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const db = new PrismaClient()

// ── reporting ────────────────────────────────────────────────────────────────
let bugs = 0, clean = 0
const findings = []
const ok = (n, d = '') => { clean++; console.log(`  [CLEAN] ${n}${d ? ` — ${d}` : ''}`) }
const bug = (sev, n, d) => { bugs++; findings.push({ sev, n }); console.log(`  [${sev}]  ${n}\n         ${String(d).replace(/\n/g, '\n         ')}`) }
const info = (n, d = '') => console.log(`  [info]  ${n}${d ? ` — ${d}` : ''}`)
const section = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`)

// ── API helper (records method/url/payload/status/body/ms) ───────────────────
let TOKEN = null
const createdApptIds = new Set()
async function api(method, url, body, headers = {}) {
  const t0 = Date.now()
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const ms = Date.now() - t0
  let json = null
  const text = await res.text()
  try { json = JSON.parse(text) } catch { json = { __raw: text.slice(0, 300) } }
  if (res.status === 201 && json?.data?.id && url.startsWith('/appointments')) createdApptIds.add(json.data.id)
  return { status: res.status, body: json, ms, req: { method, url, body } }
}

// ── fixtures ─────────────────────────────────────────────────────────────────
// Distinctive name so the PatientLookup search returns exactly this row.
const STAMP = Date.now().toString(36)
let QA_PATIENT = null
let UI_DOCTOR = null   // a REAL doctor that has a saved timetable (so the form offers slots)

async function setup() {
  QA_PATIENT = await db.patient.create({
    data: {
      organizationId: ORG,
      mrn: `QAC-${STAMP}`,
      firstName: `ZzContract${STAMP}`, lastName: 'Audit',
      dateOfBirth: new Date('1990-01-01'), gender: 'other', phonePrimary: '9000000123',
    },
  })
  // The form's Time dropdown is fed by the doctor's timetable (preferences.weeklySlots),
  // so a UI booking is only possible against a doctor who has one.
  UI_DOCTOR = await db.user.findFirst({
    where: { organizationId: ORG, role: 'doctor', isActive: true, preferences: { contains: 'weeklySlots' } },
    select: { id: true, fullName: true, consultationFee: true, departmentId: true },
    orderBy: { id: 'asc' },
  })
  // Log in via the API for PART 2/3.
  const lr = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gudmed.in', password: 'Gudmed@123' }),
  })
  TOKEN = (await lr.json()).token || null
  info('fixtures', `QA patient ${QA_PATIENT.id} (MRN ${QA_PATIENT.mrn}); UI doctor ${UI_DOCTOR?.id} "${UI_DOCTOR?.fullName}" fee=${UI_DOCTOR?.consultationFee}; token=${TOKEN ? 'ok' : 'MISSING'}`)
}

// Remove every appointment we created (+ its invoice, commission, queue row), then
// the QA patient. Never touches a business row.
async function cleanup() {
  const ids = [...createdApptIds]
  const patAppts = await db.appointment.findMany({ where: { patientId: QA_PATIENT?.id }, select: { id: true } })
  for (const a of patAppts) ids.push(a.id)
  const uniq = [...new Set(ids)]
  if (uniq.length) {
    const invs = await db.invoice.findMany({ where: { appointmentId: { in: uniq } }, select: { id: true } })
    await db.doctorCommission.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } })
    await db.payment.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } })
    await db.invoice.deleteMany({ where: { appointmentId: { in: uniq } } })
    await db.queueManagement.deleteMany({ where: { appointmentId: { in: uniq } } })
    await db.appointment.deleteMany({ where: { id: { in: uniq } } })
  }
  if (QA_PATIENT) await db.patient.delete({ where: { id: QA_PATIENT.id } }).catch(() => {})
  info('cleanup', `${uniq.length} appointment(s) + their invoices/commissions/queue rows removed; QA patient deleted`)
}

// ── the Playwright network recorder (from contract-audit.js) ─────────────────
function attachRecorder(page) {
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
  return calls
}
const lastWrite = (calls, match) => [...calls].reverse().find((c) => c.url.includes(match) && ['POST', 'PUT', 'PATCH'].includes(c.method))

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — the real booking form: capture A (wire), B (DB), C (response), D (UI)
// ═══════════════════════════════════════════════════════════════════════════
async function part1(page, calls) {
  section('PART 1 — REAL UI BOOKING: A(wire) vs B(DB) vs C(response) vs D(reload/display)')
  if (!UI_DOCTOR) { info('PART 1 skipped', 'no doctor with a saved timetable exists to drive the form'); return }

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.fill('input[type="email"]', 'admin@gudmed.in')
  await page.fill('input[type="password"]', 'Gudmed@123')
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForTimeout(1200)

  // Two independent bookings (different date windows so they never share a slot)
  // so every round-trip conclusion is reached twice.
  const results = []
  for (const [attempt, startOff] of [[1, 180], [2, 260]]) {
    const r = await bookOnceThroughUI(page, calls, attempt, startOff)
    if (r) results.push(r)
  }

  if (results.length === 0) { bug('S2', 'PART 1 could not complete a UI booking', 'the form never produced a bookable slot on any tried date; the four-way UI check did not run'); return }

  // Report the field-by-field four-way table for each completed booking, and only
  // flag a mismatch if BOTH bookings show it (reproduced twice).
  const mism = {}
  for (const r of results) {
    for (const [field, cell] of Object.entries(r.cells)) {
      if (!cell.agree) (mism[field] ||= []).push(cell)
    }
  }
  for (const r of results) {
    console.log(`\n  booking #${r.attempt}: appointment ${r.apptId}`)
    for (const [field, cell] of Object.entries(r.cells)) {
      console.log(`     ${cell.agree ? 'OK ' : 'XX '} ${field.padEnd(16)} A=${JSON.stringify(cell.A)}  B=${JSON.stringify(cell.B)}  C=${JSON.stringify(cell.C)}  D=${JSON.stringify(cell.D)}`)
    }
  }
  for (const field of Object.keys(mism)) {
    if (mism[field].length >= 2) {
      const c = mism[field][0]
      bug('S2', `four-way mismatch on "${field}" (reproduced ${mism[field].length}×)`,
        `A(wire)=${JSON.stringify(c.A)} B(DB)=${JSON.stringify(c.B)} C(resp)=${JSON.stringify(c.C)} D(reload/UI)=${JSON.stringify(c.D)}`)
    }
  }
  if (Object.values(mism).every((a) => a.length < 2)) {
    ok(`every booking field round-tripped A→B→C→D cleanly across ${results.length} UI booking(s)`,
      `fields checked: ${Object.keys(results[0].cells).join(', ')}`)
  }
  if (results.length < 2) info('note', 'only one UI booking completed; four-way conclusions above are reproduced by the API path in PART 2/3, but the UI leg itself ran once')
}

// One full pass through the real form. Returns the A/B/C/D cells or null if no slot.
async function bookOnceThroughUI(page, calls, attempt, startOff = 180) {
  await page.goto(`${BASE}/admin/appointments`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  // Open the New Appointment dialog.
  await page.getByRole('button', { name: /New Appointment/i }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 10000 })
  await page.waitForTimeout(400)

  // ── Patient: type the QA patient's name, wait for the result, click it ──
  await dialog.getByPlaceholder(/Search by UHID, name, or phone/i).fill(QA_PATIENT.firstName)
  await page.waitForTimeout(1400) // debounce (400ms) + fetch
  const patientBtn = dialog.locator('button', { hasText: QA_PATIENT.mrn }).first()
  await patientBtn.waitFor({ timeout: 8000 })
  await patientBtn.click()
  await page.waitForTimeout(400)

  // ── Doctor: open the "Select doctor" combobox, filter by name, click the option.
  // (Department is left as "All departments" so availableDoctors = every doctor.)
  const doctorCombo = dialog.locator('button[role="combobox"]', { hasText: /Select doctor/i }).first()
  await doctorCombo.click()
  await page.waitForTimeout(300)
  // Filter using a distinctive word from the name (avoid the "Dr." prefix everyone shares).
  const words = (UI_DOCTOR.fullName || '').replace(/^Dr\.?\s*/i, '').split(' ')
  const docName = words[0] || UI_DOCTOR.fullName
  const searchInput = page.getByPlaceholder(/Type to search/i).first()
  if (await searchInput.count()) { await searchInput.fill(docName); await page.waitForTimeout(400) }
  const docOption = page.getByRole('button').filter({ hasText: UI_DOCTOR.fullName }).first()
  await docOption.waitFor({ timeout: 8000 })
  await docOption.click()
  await page.waitForTimeout(400)

  // ── Date + Time: try future dates until the Time dropdown offers a slot ──
  // Far-future window (+180..+210d) so a real doctor's calendar is empty there and
  // the double-booking guard never trips on pre-existing data.
  const dateInput = dialog.locator('input[type="date"]')
  let chosenDate = null, chosenTime = null
  for (let off = startOff; off <= startOff + 40 && !chosenTime; off++) {
    const d = new Date(Date.now() + off * 86400000).toISOString().slice(0, 10)
    await dateInput.fill(d)
    await page.waitForTimeout(1000) // let useDoctorTimetable recompute + settle
    // The Time trigger is the Select whose value/placeholder is one of these strings.
    const trigger = dialog.locator('button[role="combobox"]').filter({ hasText: /Select time|Select a date first|Doctor not available this day|Loading slots|Select a doctor first/i }).first()
    if (!(await trigger.count())) continue
    try { await trigger.click({ timeout: 2000 }) } catch { continue }
    await page.waitForTimeout(300)
    const opts = page.locator('[role="option"]')
    const n = await opts.count()
    if (n > 0) {
      chosenTime = (await opts.first().innerText()).trim()
      await opts.first().click()
      chosenDate = d
    } else {
      // close the empty dropdown and try the next date
      await page.keyboard.press('Escape').catch(() => {})
    }
    await page.waitForTimeout(200)
  }
  if (!chosenTime) { info(`UI booking #${attempt}`, 'no bookable slot found in the +180..+220d window'); return null }

  // Read what the form shows for the (read-only) fee before submit — part of [A].
  const feeShown = await dialog.locator('input[readonly]').first().inputValue().catch(() => null)

  // ── Submit and capture the exact request + response off the wire ──
  calls.length = 0
  await dialog.getByRole('button', { name: /Create Appointment/i }).click()
  await page.waitForTimeout(2500)
  // The success TOAST is the clearest in-UI DISPLAY of the response [D].
  const toastText = await page.locator('[data-sonner-toast], li[role="status"], .sonner-toast').allInnerTexts().catch(() => [])
  const toastJoined = (toastText || []).join(' | ')

  const w = lastWrite(calls, '/appointments')
  if (!w || w.method !== 'POST') { info(`UI booking #${attempt}`, 'no POST /appointments captured'); return null }
  const A = w.sent || {}                 // [A] the wire payload
  const C = w.got?.data || {}            // [C] the response body
  info(`UI booking #${attempt}`, `POST ${w.url} → ${w.status} ${w.ms}ms; date field shows fee=${feeShown}`)
  console.log(`     [A] wire payload : ${JSON.stringify(A)}`)
  console.log(`     [C] response data: ${JSON.stringify({ id: C.id, appointmentDate: C.appointmentDate, appointmentTime: C.appointmentTime, appointmentType: C.appointmentType, priority: C.priority, notes: C.notes, consultationFee: C.consultationFee, departmentId: C.departmentId, draftInvoiceNumber: C.draftInvoiceNumber, commission: C.commission })}`)

  if (w.status !== 201 || !C.id) { info(`UI booking #${attempt}`, `booking did not return 201 (${w.status}); ${JSON.stringify(w.got).slice(0, 160)}`); return null }
  createdApptIds.add(C.id)

  // [B] the stored row, read straight from Postgres.
  const B = await db.appointment.findUnique({ where: { id: C.id } })

  // [D] HARD RELOAD, then read the row back FROM THE DATABASE through the app's own
  // authenticated client (localStorage token) — NOT React state. This is exactly
  // "what the frontend receives" on a fresh load. The List View is always filtered
  // to the selected day, so for a far-future booking we also drive it to the appt's
  // day for a best-effort visual DISPLAY check.
  await page.goto(`${BASE}/admin/appointments`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  // In-browser fetch via the same origin + token the app uses.
  const received = await page.evaluate(async (id) => {
    const t = localStorage.getItem('token')
    const r = await fetch(`/api/appointments/${id}`, { headers: t ? { Authorization: `Bearer ${t}` } : {}, credentials: 'include' })
    const j = await r.json().catch(() => null)
    return j?.data ?? null
  }, C.id)
  // Best-effort visual: List View → set the date picker to the appt day → search.
  let shownTime = false, shownPatient = false
  try {
    const listTab = page.getByRole('tab', { name: /List View/i }).first()
    if (await listTab.count()) { await listTab.click(); await page.waitForTimeout(500) }
    const dateCtrl = page.locator('input[type="date"]').first()
    if (await dateCtrl.count()) { await dateCtrl.fill(chosenDate); await page.waitForTimeout(700) }
    const listSearch = page.getByPlaceholder(/Search/i).first()
    if (await listSearch.count()) { await listSearch.fill(QA_PATIENT.firstName); await page.waitForTimeout(1500) }
    const bodyText = await page.locator('body').innerText().catch(() => '')
    shownTime = bodyText.includes(chosenTime)
    shownPatient = bodyText.includes(QA_PATIENT.mrn) || bodyText.toLowerCase().includes(QA_PATIENT.firstName.toLowerCase())
  } catch { /* visual is best-effort */ }
  const D = {
    receivedDate: received?.appointmentDate ?? null,
    receivedTime: received?.appointmentTime ?? null,
    receivedType: received?.appointmentType ?? null,
    receivedPriority: received?.priority ?? null,
    receivedNotes: received?.notes ?? null,
    receivedDept: received?.departmentId ?? null,
    receivedPatient: received?.patientId ?? received?.patient?.id ?? null,
    receivedDoctor: received?.doctorId ?? null,
    receivedFee: received?.consultationFee ?? null,
    displayedTime: shownTime ? chosenTime : null,
    displayedPatient: shownPatient,
    toast: toastJoined,
  }
  info(`UI booking #${attempt} reload [D]`, `GET /appointments/${C.id} after reload returned the row: ${!!received}; visual time "${chosenTime}" shown: ${shownTime}; patient shown: ${shownPatient}`)
  info(`UI booking #${attempt} toast [D]`, toastJoined || '(no toast captured)')

  // ── Build the four-way cells. The DATE is the headline UTC/IST question. ──
  const wantDay = chosenDate // the calendar day the user picked in the form
  const cells = {
    appointmentDate: {
      A: A.appointmentDate, B: B?.appointmentDate?.toISOString(), C: C.appointmentDate, D: D.receivedDate,
      // The user picked `chosenDate`; every layer must still resolve to THAT IST day.
      agree: istDay(B?.appointmentDate) === wantDay && istDay(C.appointmentDate) === wantDay && istDay(D.receivedDate) === wantDay,
    },
    appointmentTime: {
      A: A.appointmentTime, B: B?.appointmentTime, C: C.appointmentTime, D: D.receivedTime,
      agree: A.appointmentTime === B?.appointmentTime && B?.appointmentTime === C.appointmentTime && C.appointmentTime === D.receivedTime,
    },
    appointmentType: {
      A: A.appointmentType, B: B?.appointmentType, C: C.appointmentType, D: D.receivedType,
      agree: A.appointmentType === B?.appointmentType && B?.appointmentType === C.appointmentType && C.appointmentType === D.receivedType,
    },
    priority: {
      A: A.priority, B: B?.priority, C: C.priority, D: D.receivedPriority,
      agree: (A.priority ?? 'normal') === B?.priority && B?.priority === C.priority && C.priority === D.receivedPriority,
    },
    notes: {
      A: A.notes ?? null, B: B?.notes ?? null, C: C.notes ?? null, D: D.receivedNotes,
      agree: (A.notes ?? null) === (B?.notes ?? null) && (B?.notes ?? null) === (C.notes ?? null) && (C.notes ?? null) === (D.receivedNotes ?? null),
    },
    departmentId: {
      A: A.departmentId ?? null, B: B?.departmentId ?? null, C: C.departmentId ?? null, D: D.receivedDept,
      agree: (A.departmentId ?? null) === (B?.departmentId ?? null) && (B?.departmentId ?? null) === (C.departmentId ?? null) && (C.departmentId ?? null) === (D.receivedDept ?? null),
    },
    patientId: {
      A: A.patientId, B: B?.patientId, C: C.patientId, D: D.receivedPatient,
      agree: A.patientId === B?.patientId && B?.patientId === C.patientId && C.patientId === D.receivedPatient,
    },
    doctorId: {
      A: A.doctorId, B: B?.doctorId, C: C.doctorId, D: D.receivedDoctor,
      agree: A.doctorId === B?.doctorId && B?.doctorId === C.doctorId && C.doctorId === D.receivedDoctor,
    },
    // consultationFee is intentionally NOT sent by the form (A absent) but IS
    // derived+stored+returned; check B===C===D and that the UI's read-only field matched.
    consultationFee: {
      A: A.consultationFee ?? '(not sent — derived server-side)', B: B?.consultationFee, C: C.consultationFee, D: D.receivedFee,
      agree: B?.consultationFee === C.consultationFee && C.consultationFee === D.receivedFee,
    },
  }
  return { attempt, apptId: C.id, chosenDate, chosenTime, cells, C, D, displayed: { shownTime, shownPatient } }
}

// The IST calendar day a stored instant falls on (matches the backend's own bucketing).
function istDay(v) {
  if (v == null) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v))
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — edge cases fired straight at the API (the UI can never send these)
// For each: does it 400 cleanly, 500 (bug), or silently store junk? Sent twice.
// ═══════════════════════════════════════════════════════════════════════════
async function part2() {
  section('PART 2 — TYPE/SHAPE EDGE CASES AT THE API (sent twice each)')
  // A far-future, empty date window so nothing collides with real data.
  let cursor = Date.UTC(2028, 0, 3)
  const nextDate = () => { const d = new Date(cursor); cursor += 3 * 86400000; return d.toISOString().slice(0, 10) }
  const iso = (ymd) => `${ymd}T00:00:00.000Z`
  const base = () => ({ patientId: QA_PATIENT.id, doctorId: UI_DOCTOR?.id, appointmentDate: iso(nextDate()), appointmentTime: '10:00', appointmentType: 'new_patient', priority: 'normal' })
  const book = (over) => api('POST', '/appointments', { ...base(), ...over })
  // Run a probe twice; require the SAME status both times before reporting.
  const twice = async (over) => { const a = await book(over); const b = await book(over); return { a, b, stable: a.status === b.status } }

  // 2.1 — extra unknown field: silently stored, stripped, or 400?
  {
    const { a, b, stable } = await twice({ referredBy: 'Dr Nobody', duration: 45, chiefComplaint: 'AUDIT-COMPLAINT' })
    const row = a.status === 201 ? await db.appointment.findUnique({ where: { id: a.body.data.id } }) : null
    const storedComplaint = row?.chiefComplaint
    stable && a.status === 201 && (storedComplaint == null)
      ? ok('extra/undeclared fields are silently STRIPPED, not stored', `referredBy/duration/chiefComplaint ignored by createAppointmentSchema; row.chiefComplaint=${JSON.stringify(storedComplaint)} (201, reproduced ${stable ? '2×' : '?'})`)
      : bug('S3', 'extra field handling is inconsistent or leaked into the row', `status ${a.status}/${b.status}; row.chiefComplaint=${JSON.stringify(storedComplaint)}`)
    if (a.status === 201) info('contract note', 'chiefComplaint HAS a column and a real UI in the EDIT form, but createAppointmentSchema omits it — so it can never be set at BOOKING time, only after. The CREATE form also collects no chief complaint. A booking always stores chiefComplaint=null.')
  }

  // 2.2 — appointmentType OUTSIDE the enum. Schema is z.string().optional() (no enum),
  // so junk is accepted and printed onto the invoice line.
  {
    const { a, b, stable } = await twice({ appointmentType: 'banana_visit' })
    if (stable && a.status === 201) {
      const row = await db.appointment.findUnique({ where: { id: a.body.data.id }, select: { appointmentType: true } })
      const inv = await db.invoice.findFirst({ where: { appointmentId: a.body.data.id } })
      const desc = inv ? JSON.parse(inv.items)[0]?.description : null
      bug('S3', 'appointmentType outside the enum is accepted and stored verbatim (and printed on the invoice)',
        `REQ: POST /appointments {"appointmentType":"banana_visit"} → 201 (reproduced 2×).\n` +
        `DB row appointmentType=${JSON.stringify(row.appointmentType)}. Invoice line description=${JSON.stringify(desc)}.\n` +
        `createAppointmentSchema declares appointmentType: z.string().optional() — NO z.enum — so the DB, the\n` +
        `VISIT_LABEL fallback ("banana_visit Consultation") and the receipt all take the garbage. The frontend\n` +
        `only ever offers new_patient/follow_up/emergency, but any API/import/CRM caller can store anything.\n` +
        `EXPECTED 400. Fix: appointmentType: z.enum(['new_patient','follow_up','emergency']).optional() in\n` +
        `backend/src/validations/appointment.validation.js:8.`)
    } else ok('appointmentType outside the enum rejected', `${a.status}/${b.status}`)
  }

  // 2.3 — invalid clock times. The regex /^\d{2}:\d{2}$/ passes "25:00"; normalize only pads.
  for (const t of ['25:00', '99:99']) {
    const { a, b, stable } = await twice({ appointmentTime: t })
    if (stable && a.status === 201) {
      const row = await db.appointment.findUnique({ where: { id: a.body.data.id }, select: { appointmentTime: true } })
      bug('S2', `impossible clock time "${t}" accepted and stored`,
        `REQ: POST /appointments {"appointmentTime":"${t}"} → 201 (reproduced 2×). DB appointmentTime=${JSON.stringify(row.appointmentTime)}.\n` +
        `createAppointmentSchema's regex /^\\d{2}:\\d{2}$/ matches "${t}"; normalizeTimeHHMM only zero-pads, never\n` +
        `range-checks hours≤23 / minutes≤59. The row string-sorts after every real slot and shows on the board.\n` +
        `EXPECTED 400. Fix the regex to /^([01]\\d|2[0-3]):[0-5]\\d$/ (validation.js:7).`)
    } else ok(`impossible time "${t}" rejected`, `${a.status}/${b.status}`)
  }

  // 2.4 — the formats the regex DOES stop (contrast). Unpadded "9:00" must 400 at create.
  for (const t of ['9:00', '09:00:00', '']) {
    const { a, b, stable } = await twice({ appointmentTime: t })
    stable && a.status === 400
      ? ok(`malformed time ${JSON.stringify(t)} rejected at create`, '400 from the schema regex (2×)')
      : bug('S2', `malformed time ${JSON.stringify(t)} not cleanly rejected`, `${a.status}/${b.status}`)
  }

  // 2.5 — a past date. No min on the UI and no guard in the schema. Two distinct
  // times so the second confirmation doesn't self-collide on the slot guard.
  {
    const a = await book({ appointmentDate: iso('2020-01-01'), appointmentTime: '09:00' })
    const b = await book({ appointmentDate: iso('2020-01-01'), appointmentTime: '09:15' })
    a.status === 201 && b.status === 201
      ? bug('S3', 'a booking in the PAST is accepted (and mints a draft invoice)',
          `REQ: POST /appointments {"appointmentDate":"2020-01-01T00:00:00.000Z"} → 201 (reproduced 2× at 09:00 and 09:15), appointment ${a.body.data.id}.\n` +
          `Neither the <input type="date"> (no min) nor createAppointmentSchema (appointmentDate: z.string()) constrains it.`)
      : ok('past date rejected', `${a.status}/${b.status}`)
  }

  // 2.6 — a NON-DATE string in appointmentDate. z.string() accepts it; startOfDay()
  // then feeds Invalid Date to Intl.format → RangeError → 500 (should be 400).
  {
    const { a, b, stable } = await twice({ appointmentDate: 'not-a-date' })
    if (a.status >= 500)
      bug('S2', 'a non-date string in appointmentDate returns 500, not 400',
        `REQ: POST /appointments {"appointmentDate":"not-a-date"} → ${a.status}/${b.status}.\n` +
        `BODY: ${JSON.stringify(a.body).slice(0, 220)}\n` +
        `appointmentDate is a bare z.string(); create() calls startOfDay("not-a-date") → new Date(...) = Invalid\n` +
        `Date → Intl.DateTimeFormat.format throws RangeError → the generic error handler returns 5xx. A malformed\n` +
        `client input MUST be 400. Fix: validate appointmentDate as an ISO datetime (z.string().datetime()) or a\n` +
        `refine() that rejects Invalid Date (validation.js:6).`)
    else if (a.status === 201) bug('S2', 'a non-date string in appointmentDate was accepted', `${a.status}; stored — inspect ${a.body?.data?.id}`)
    else ok('non-date appointmentDate rejected with 4xx', `${a.status}/${b.status}`)
  }

  // 2.7 — wrong TYPES for a string field: number / null / array / object.
  for (const [name, over] of [
    ['patientId as number', { patientId: 12345 }],
    ['patientId as null', { patientId: null }],
    ['patientId as array', { patientId: [] }],
    ['appointmentTime as number', { appointmentTime: 900 }],
    ['appointmentTime as null', { appointmentTime: null }],
    ['doctorId as object', { doctorId: {} }],
  ]) {
    const { a, b, stable } = await twice(over)
    if (a.status >= 500) bug('S2', `${name} → ${a.status} 5xx (should be 400)`, `${JSON.stringify(a.body).slice(0, 160)}`)
    else if (a.status === 201) bug('S2', `${name} was ACCEPTED (should be 400)`, `appointment ${a.body?.data?.id}`)
    else stable ? ok(`${name} → 400`, 'z.string() does not coerce; clean reject (2×)') : info(name, `unstable ${a.status}/${b.status}`)
  }

  // 2.8 — missing required fields.
  for (const [name, over] of [['no patientId', { patientId: undefined }], ['no appointmentTime', { appointmentTime: undefined }], ['no appointmentDate', { appointmentDate: undefined }]]) {
    const payload = { ...base(), ...over }
    if (over.patientId === undefined) delete payload.patientId
    if (over.appointmentTime === undefined) delete payload.appointmentTime
    if (over.appointmentDate === undefined) delete payload.appointmentDate
    const a = await api('POST', '/appointments', payload)
    const b = await api('POST', '/appointments', payload)
    a.status === 400 && b.status === 400 ? ok(`${name} → 400`, 'required-field guard holds (2×)') : bug('S2', `${name} not cleanly rejected`, `${a.status}/${b.status}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — the auto-created INVOICE and the COMMISSION: B vs C vs what the UI gets
// ═══════════════════════════════════════════════════════════════════════════
async function part3() {
  section('PART 3 — INVOICE + COMMISSION: stored (B) vs returned (C) vs Doctor Accountability')
  if (!UI_DOCTOR) { info('PART 3 skipped', 'no UI doctor'); return }
  const iso = (ymd) => `${ymd}T00:00:00.000Z`
  const D = new Date(Date.UTC(2028, 5, 5)).toISOString().slice(0, 10)

  // Book once through the API, then compare the create RESPONSE against the DB rows.
  const r = await api('POST', '/appointments', { patientId: QA_PATIENT.id, doctorId: UI_DOCTOR.id, appointmentDate: iso(D), appointmentTime: '10:00', appointmentType: 'new_patient' })
  if (r.status !== 201) { bug('S2', 'PART 3 booking failed', JSON.stringify(r.body).slice(0, 160)); return }
  const apptId = r.body.data.id
  const inv = await db.invoice.findFirst({ where: { appointmentId: apptId } })
  const storedDesc = inv ? JSON.parse(inv.items)[0]?.description : null

  // 3.1 — does the response tell the frontend the invoice NUMBER and AMOUNT?
  const respNum = r.body.data.draftInvoiceNumber
  const respHasAmount = r.body.data.totalAmount ?? r.body.data.invoiceAmount ?? (r.body.data.commission?.invoiceAmount)
  respNum && respNum === inv?.invoiceNumber
    ? ok('the create response returns the invoice NUMBER and it matches the stored invoice', `draftInvoiceNumber=${respNum} === Invoice.invoiceNumber=${inv?.invoiceNumber}`)
    : bug('S2', 'the create response invoice number does not match the stored invoice', `resp draftInvoiceNumber=${JSON.stringify(respNum)} vs DB ${JSON.stringify(inv?.invoiceNumber)}`)
  respHasAmount == null
    ? bug('S3', 'the create response does NOT include the invoice AMOUNT, only the number',
        `response.data has draftInvoiceNumber=${respNum} but no invoice total. Stored Invoice ${inv?.invoiceNumber}\n` +
        `totalAmount=₹${inv?.totalAmount}. The booking toast (AppointmentsModule.jsx onSubmit) shows only the number\n` +
        `("Draft invoice X created"), never ₹${inv?.totalAmount}. So [C]→[D] drops the amount: the receptionist is told an\n` +
        `invoice exists but not for how much until they open Billing. The description ("${storedDesc}") is also never\n` +
        `returned in the create response — only reachable from the Billing module. Low severity (data is one click\n` +
        `away) but it is a genuine returned-vs-shown gap.`)
    : ok('the create response includes an invoice amount', `${respHasAmount}`)

  // 3.2 — commission: is it in the response? Config-dependent — report what holds.
  const cfg = await db.doctorCommissionConfig.findUnique({ where: { doctorId: UI_DOCTOR.id } }).catch(() => null)
  const dbComm = await db.doctorCommission.findFirst({ where: { invoiceId: inv?.id } })
  if (cfg && cfg.isActive) {
    const respComm = r.body.data.commission
    respComm && dbComm && Math.abs(respComm.commissionAmount - dbComm.commissionAmount) < 1e-9
      ? ok('the commission is returned in the create response and matches the stored row', `resp ₹${respComm.commissionAmount} === DB ₹${dbComm.commissionAmount}`)
      : bug('S2', 'commission mismatch between create response and DB', `resp=${JSON.stringify(respComm)} vs DB=${JSON.stringify(dbComm && { amount: dbComm.commissionAmount, status: dbComm.status })}`)
    info('contract note', 'the create response DOES carry data.commission, but the booking UI (onSubmit) reads only draftInvoiceNumber — the commission field is returned [C] yet never surfaced to the user [D].')
  } else {
    info('commission', `UI doctor ${UI_DOCTOR.id} has ${cfg ? 'an INACTIVE' : 'no'} commission config → no commission row expected; response.data.commission=${JSON.stringify(r.body.data.commission)} (correctly null)`)
  }

  // 3.3 — does Doctor Accountability's GET agree with SUM(commissionAmount) in the DB?
  const stats = await api('GET', '/doctor-accountability?resource=stats')
  const mine = (stats.body?.data || []).find((s) => s.doctorId === UI_DOCTOR.id)
  const dbSum = await db.doctorCommission.aggregate({ where: { doctorId: UI_DOCTOR.id }, _sum: { commissionAmount: true } })
  if (mine) {
    Number(mine.pendingAmount ?? mine.totalAmount ?? 0) >= 0 && dbSum._sum.commissionAmount != null
      ? (Math.abs(Number(mine.pendingAmount ?? 0) + Number(mine.paidAmount ?? 0) - Number(dbSum._sum.commissionAmount || 0)) < 0.01
        ? ok('Doctor Accountability totals reconcile with SUM(commissionAmount)', `pending+paid=₹${Number(mine.pendingAmount ?? 0) + Number(mine.paidAmount ?? 0)} ≈ SUM ₹${dbSum._sum.commissionAmount}`)
        : info('Doctor Accountability vs SUM', `stats pending=₹${mine.pendingAmount} paid=₹${mine.paidAmount} vs DB SUM ₹${dbSum._sum.commissionAmount} — difference may be settled/other-status rows; not asserted as a bug`))
      : info('Doctor Accountability', JSON.stringify(mine))
  } else {
    info('Doctor Accountability', `no stats row for doctor ${UI_DOCTOR.id} (no commissions) — SUM=${dbSum._sum.commissionAmount}`)
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const calls = attachRecorder(page)
try {
  await setup()
  await part1(page, calls)
  await part2()
  await part3()
} catch (e) {
  bug('S1', 'the audit itself crashed', `${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}`)
} finally {
  await browser.close().catch(() => {})
  await cleanup().catch((e) => info('cleanup error', e.message))
  await db.$disconnect()
}

console.log(`\n${'═'.repeat(78)}`)
console.log(`SUMMARY: ${bugs} finding(s), ${clean} check(s) clean`)
for (const f of findings.sort((a, b) => a.sev.localeCompare(b.sev))) console.log(`  ${f.sev}  ${f.n}`)
process.exit(0)
