// ============================================================================
// HOSTILE QA — APPOINTMENT -> INVOICE -> COMMISSION pipeline, fee-slab matrix
// ----------------------------------------------------------------------------
//   node e2e/audit-feeslab-matrix.js
//
// This drives the REAL running backend at http://127.0.0.1:5000 over HTTP (the
// same POST /api/appointments the receptionist's browser fires) and then reads
// the actual rows back out of the database with Prisma. It never trusts the API
// response alone — every fee / invoice / commission claim is verified against
// the stored row.
//
// It builds a MATRIX of throwaway doctors (each with a different DoctorFeeSlab
// set + a commission config) and books an anchor `new_patient` visit followed
// by a `follow_up` at a sweep of boundary days (0,1,7,8,14,15,29,30,31,45),
// asserting for every cell the user's three questions:
//   (a) exactly ONE draft invoice, right amount, right description for the type
//   (b) the doctor's commission is correct (fixed pays even at Rs.0; percentage
//       tracks the charge)
//   (c) invoice.totalAmount == appointment.consultationFee == commission.invoiceAmount
//
// Setup data (doctors, patients, slabs, commission configs) is created directly
// via Prisma because THAT is not the system under test — the appointment create
// transaction is. Every scenario is reproduced TWICE (two fresh patients) and
// ALL created rows are torn down at the end (and any residue from a prior run
// carrying the same prefix is swept first).
//
// NO source file is edited, NO commit, NO server restart. Read-only against code.
// ============================================================================

import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backend = path.join(__dirname, '..', 'backend')
const require = createRequire(path.join(backend, 'package.json'))
const { PrismaClient } = require('@prisma/client')

// backend/.env holds DATABASE_URL; nothing loads it for a script run from here.
for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const API = process.env.QA_API || 'http://127.0.0.1:5000'
const db = new PrismaClient()

// A prefix that tags every row we create, so cleanup can find them by pattern
// even if the process dies mid-run. Timestamp keeps concurrent runs distinct.
const PREFIX = 'zzqa_fsm_'
const RUN = PREFIX + Date.now().toString(36)
const BASE_FEE = 500          // DEFAULT_CONSULTATION_FEE for a doctor with no override
const ANCHOR_DAY = '2026-04-01'

let ORG = 'org-demo'
let TOKEN = ''

// ---- reporting ------------------------------------------------------------
const findings = []   // confirmed bugs / observations
const clean = []      // things that passed
const matrixRows = [] // representative day->fee->invoice->commission table
const F = (sev, title, detail) => { findings.push({ sev, title, detail }); console.log(`  [${sev}] ${title}\n        ${String(detail).replace(/\n/g, '\n        ')}`) }
const OK = (t) => { clean.push(t); }

// ---- http -----------------------------------------------------------------
async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* non-json */ }
  return { status: res.status, body: json }
}

// ---- date helper ----------------------------------------------------------
// A YYYY-MM-DD `days` after the fixed anchor day (may be negative).
function dayFrom(anchor, days) {
  const d = new Date(anchor + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ---- unique slot time allocator (per doctor+date must be unique) -----------
let slotCounter = 0
function nextTime() {
  const c = slotCounter++
  const hh = 8 + Math.floor(c / 60)
  const mm = c % 60
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
}

// ---- setup builders (Prisma) ----------------------------------------------
let seq = 0
async function makeDoctor({ consultationFee = null, slabs = [], commission = null, label = '' } = {}) {
  seq++
  const id = `${RUN}_doc${seq}`
  const doctor = await db.user.create({
    data: {
      id,
      organizationId: ORG,
      email: `${id}@qa.local`,
      fullName: `QA Doctor ${seq} ${label}`.trim(),
      role: 'doctor',
      consultationFee,
      isActive: true,
    },
  })
  for (const s of slabs) {
    await db.doctorFeeSlab.create({
      data: {
        organizationId: ORG,
        doctorId: id,
        fromDays: s.fromDays,
        toDays: s.toDays,
        feeAmount: s.feeAmount,
        isActive: s.isActive !== false,
      },
    })
  }
  if (commission) {
    await db.doctorCommissionConfig.create({
      data: {
        organizationId: ORG,
        doctorId: id,
        commissionType: commission.type,
        commissionRate: commission.rate,
        isActive: commission.isActive !== false,
      },
    })
  }
  return doctor
}

async function makePatient() {
  seq++
  const id = `${RUN}_pat${seq}`
  return db.patient.create({
    data: {
      id,
      organizationId: ORG,
      mrn: `${RUN}M${seq}`,
      firstName: 'QA',
      lastName: `Patient${seq}`,
      dateOfBirth: new Date('1990-01-01'),
      gender: 'male',
    },
  })
}

// ---- book an appointment via the REAL API and read the rows back ----------
async function book({ doctor, patient, date, type }) {
  const time = nextTime()
  const resp = await api('POST', '/api/appointments', {
    patientId: patient.id,
    doctorId: doctor.id,
    appointmentDate: date,
    appointmentTime: time,
    appointmentType: type,
    notes: RUN, // tag for good measure
  })
  const apptId = resp.body?.data?.id || null
  let appt = null, invoices = [], commissions = []
  if (apptId) {
    appt = await db.appointment.findUnique({ where: { id: apptId } })
    invoices = await db.invoice.findMany({ where: { appointmentId: apptId } })
    const invIds = invoices.map((i) => i.id)
    commissions = invIds.length
      ? await db.doctorCommission.findMany({ where: { invoiceId: { in: invIds } } })
      : []
  }
  return { resp, apptId, appt, invoices, commissions, time }
}

// ---- the rule, reimplemented locally to derive EXPECTED values ------------
function expectedFee(slabs, baseFee, days) {
  if (days === null) return { fee: baseFee, reason: 'new_patient', slab: null }
  if (days > 30) return { fee: baseFee, reason: 'reset', slab: null }
  const slab = slabs.find((s) => s.isActive !== false && s.fromDays <= days && s.toDays > days)
  if (slab) return { fee: slab.feeAmount, reason: 'slab', slab }
  return { fee: baseFee, reason: 'default', slab: null }
}
const VISIT_LABEL = {
  follow_up: 'Follow-up Consultation',
  new_patient: 'OPD Consultation (New Patient)',
  emergency: 'Emergency Consultation',
}

// Assert one booked follow-up cell against expectations. `days` is the
// EXPECTED daysSinceLastVisit (null when treated as fresh). Returns the fee.
function assertCell(tag, booked, { slabs, baseFee, commission, days, type, doctorName }) {
  const { resp, appt, invoices, commissions } = booked
  const exp = expectedFee(slabs, baseFee, days)
  const problems = []

  if (resp.status !== 201) { F('S1', `${tag}: booking failed`, `status ${resp.status} body ${JSON.stringify(resp.body)}`); return null }
  if (!appt) { F('S1', `${tag}: appointment row missing`, `API said 201 but no row for ${booked.apptId}`); return null }

  // (fee)
  if (appt.consultationFee !== exp.fee) problems.push(`fee: stored ${appt.consultationFee}, expected ${exp.fee} (reason ${exp.reason})`)

  // (a) exactly one invoice, right amount, right description
  if (invoices.length !== 1) problems.push(`invoice count: ${invoices.length}, expected exactly 1`)
  const inv = invoices[0]
  if (inv) {
    if (inv.totalAmount !== exp.fee) problems.push(`invoice.totalAmount ${inv.totalAmount}, expected ${exp.fee}`)
    let desc = ''
    try { desc = JSON.parse(inv.items)[0]?.description || '' } catch { desc = '(unparseable items)' }
    const wantLabel = VISIT_LABEL[type] || `${type} Consultation`
    const wantDesc = doctorName ? `${wantLabel} — ${doctorName}` : wantLabel
    if (desc !== wantDesc) problems.push(`invoice description "${desc}", expected "${wantDesc}"`)
    if (inv.status !== 'draft') problems.push(`invoice.status ${inv.status}, expected draft`)
  }

  // (b) commission
  let expCommAmount = null
  if (commission && commission.isActive !== false) {
    expCommAmount = commission.type === 'percentage'
      ? (exp.fee * commission.rate) / 100
      : commission.rate
  }
  const expCommRow = expCommAmount !== null && expCommAmount > 0
  if (expCommRow) {
    if (commissions.length !== 1) problems.push(`commission count: ${commissions.length}, expected 1 (amount ${expCommAmount})`)
    const c = commissions[0]
    if (c) {
      if (Math.abs(c.commissionAmount - expCommAmount) > 1e-9) problems.push(`commissionAmount ${c.commissionAmount}, expected ${expCommAmount}`)
      if (c.commissionType !== commission.type) problems.push(`commissionType ${c.commissionType}, expected ${commission.type}`)
      if (c.invoiceAmount !== exp.fee) problems.push(`commission.invoiceAmount ${c.invoiceAmount}, expected ${exp.fee}`)
    }
  } else {
    if (commissions.length !== 0) problems.push(`commission count: ${commissions.length}, expected 0`)
  }

  // (c) three-way agreement
  if (inv && commissions[0]) {
    const a = inv.totalAmount, b = appt.consultationFee, cc = commissions[0].invoiceAmount
    if (!(a === b && b === cc)) problems.push(`THREE-WAY DISAGREEMENT invoice=${a} appt=${b} commission.invoiceAmount=${cc}`)
  } else if (inv) {
    if (inv.totalAmount !== appt.consultationFee) problems.push(`invoice=${inv.totalAmount} != appt=${appt.consultationFee}`)
  }

  if (problems.length) F('S2', `${tag}`, problems.join('\n'))
  else OK(tag)
  return exp.fee
}

// ==========================================================================
async function main() {
  console.log('\n=== FEE-SLAB MATRIX AUDIT ===\n')

  // Sweep clean any residue from a previous run (same PREFIX).
  await cleanup(PREFIX)

  // login
  const lg = await api('POST', '/api/auth/login', { email: 'admin@gudmed.in', password: 'Gudmed@123' })
  if (lg.status !== 200 || !lg.body?.token) throw new Error('login failed: ' + JSON.stringify(lg))
  TOKEN = lg.body.token
  ORG = lg.body.user?.organizationId || 'org-demo'
  console.log(`logged in, org=${ORG}\n`)

  const SWEEP = [0, 1, 7, 8, 14, 15, 29, 30, 31, 45]

  // ---- slab configs under test --------------------------------------------
  const CONFIGS = {
    single_free_0_30: [{ fromDays: 0, toDays: 30, feeAmount: 0 }],
    tiered: [
      { fromDays: 0, toDays: 7, feeAmount: 0 },
      { fromDays: 8, toDays: 15, feeAmount: 100 },
      { fromDays: 16, toDays: 30, feeAmount: 250 },
    ],
    gap_8_14: [
      { fromDays: 0, toDays: 7, feeAmount: 0 },
      { fromDays: 15, toDays: 30, feeAmount: 200 },
    ],
    overlap: [
      { fromDays: 0, toDays: 15, feeAmount: 100 },
      { fromDays: 10, toDays: 30, feeAmount: 200 },
    ],
    beyond_30: [{ fromDays: 0, toDays: 45, feeAmount: 150 }],
    equal_base: [{ fromDays: 0, toDays: 30, feeAmount: BASE_FEE }],
    none: [],
  }
  const PERCENT = { type: 'percentage', rate: 10 }
  const FIXED = { type: 'fixed_per_consultation', rate: 200 }

  // ---- 1) Representative full sweep: tiered config, BOTH commission types ---
  console.log('--- SWEEP: tiered slabs, follow_up, both commission types ---')
  for (const comm of [PERCENT, FIXED]) {
    const doctor = await makeDoctor({ slabs: CONFIGS.tiered, commission: comm, label: `tiered ${comm.type}` })
    for (const gap of SWEEP) {
      // twice, two fresh patients — reproduce every cell
      let firstFee = null
      for (let rep = 0; rep < 2; rep++) {
        const patient = await makePatient()
        // anchor new_patient at ANCHOR_DAY
        const anchor = await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
        if (anchor.resp.status !== 201) { F('S1', 'anchor booking failed', JSON.stringify(anchor.resp.body)); continue }
        // follow_up gap days later
        const fu = await book({ doctor, patient, date: dayFrom(ANCHOR_DAY, gap), type: 'follow_up' })
        const expDays = gap === 0 ? null : gap
        const fee = assertCell(`tiered/${comm.type}/day${gap}/rep${rep}`, fu, {
          slabs: CONFIGS.tiered, baseFee: BASE_FEE, commission: comm, days: expDays,
          type: 'follow_up', doctorName: doctor.fullName,
        })
        if (rep === 0) {
          firstFee = fee
          // capture representative matrix row (percentage run only, to keep table single-config)
          if (comm.type === 'percentage') {
            const inv = fu.invoices[0]
            const c = fu.commissions[0]
            matrixRows.push({
              day: gap, days: expDays === null ? 'null' : expDays,
              fee: fu.appt?.consultationFee, invoice: inv?.totalAmount,
              comm: c ? `${c.commissionType} ${c.commissionAmount}` : 'none',
            })
          }
        } else if (fee !== firstFee) {
          F('S2', `NON-DETERMINISTIC: tiered/${comm.type}/day${gap}`, `rep0 fee=${firstFee} rep1 fee=${fee}`)
        }
      }
    }
  }

  // ---- 2) Other slab shapes at their interesting boundary days -------------
  console.log('\n--- CONFIG SHAPES at boundary days (percentage commission) ---')
  const shapeTests = [
    { name: 'single_free_0_30', slabs: CONFIGS.single_free_0_30, days: [0, 1, 29, 30, 31] },
    { name: 'gap_8_14', slabs: CONFIGS.gap_8_14, days: [7, 8, 10, 14, 15, 20] },
    { name: 'overlap', slabs: CONFIGS.overlap, days: [5, 10, 12, 14, 20] },
    { name: 'beyond_30', slabs: CONFIGS.beyond_30, days: [0, 29, 30, 31, 40, 45] },
    { name: 'equal_base', slabs: CONFIGS.equal_base, days: [0, 15, 29] },
    { name: 'none', slabs: CONFIGS.none, days: [0, 1, 15, 30, 31] },
  ]
  for (const st of shapeTests) {
    const doctor = await makeDoctor({ slabs: st.slabs, commission: PERCENT, label: st.name })
    for (const gap of st.days) {
      for (let rep = 0; rep < 2; rep++) {
        const patient = await makePatient()
        const anchor = await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
        if (anchor.resp.status !== 201) continue
        const fu = await book({ doctor, patient, date: dayFrom(ANCHOR_DAY, gap), type: 'follow_up' })
        const expDays = gap === 0 ? null : gap
        // For OVERLAP the engine uses findFirst with no orderBy -> which slab wins
        // is DB-order dependent. Trust the API's appliedSlabInfo for the expected
        // fee so we assert consistency, not a guessed winner.
        let slabsForExp = st.slabs
        if (st.name === 'overlap' && fu.resp.body?.data?.appliedSlabInfo?.slabId) {
          const chosen = await db.doctorFeeSlab.findUnique({ where: { id: fu.resp.body.data.appliedSlabInfo.slabId } })
          if (chosen) slabsForExp = [chosen]
        }
        assertCell(`${st.name}/day${gap}/rep${rep}`, fu, {
          slabs: slabsForExp, baseFee: BASE_FEE, commission: PERCENT, days: expDays,
          type: 'follow_up', doctorName: doctor.fullName,
        })
      }
    }
  }

  // ---- 3) Visit-type / invoice-description dimension -----------------------
  console.log('\n--- VISIT TYPE -> invoice description (new_patient / follow_up / emergency) ---')
  {
    const doctor = await makeDoctor({ slabs: CONFIGS.tiered, commission: PERCENT, label: 'desc' })
    for (const type of ['new_patient', 'follow_up', 'emergency']) {
      const patient = await makePatient()
      const b = await book({ doctor, patient, date: ANCHOR_DAY, type })
      // first-ever visit -> new_patient base fee regardless of the typed value
      assertCell(`desc/${type}`, b, {
        slabs: CONFIGS.tiered, baseFee: BASE_FEE, commission: PERCENT, days: null,
        type, doctorName: doctor.fullName,
      })
    }
  }

  // ---- 4) ENEMY EDGE CASES -------------------------------------------------
  console.log('\n--- ENEMY EDGE CASES ---')
  await edgeCases(CONFIGS, PERCENT, FIXED)

  // ---- report --------------------------------------------------------------
  report()
}

// --------------------------------------------------------------------------
async function edgeCases(CONFIGS, PERCENT, FIXED) {
  // E1: two follow-ups the SAME day -> each independent invoice+commission
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ slabs: CONFIGS.tiered, commission: PERCENT, label: 'e1' })
    const patient = await makePatient()
    await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
    const day = dayFrom(ANCHOR_DAY, 8) // slab {8,15}=100
    const a = await book({ doctor, patient, date: day, type: 'follow_up' })
    const b = await book({ doctor, patient, date: day, type: 'follow_up' })
    const okA = a.appt?.consultationFee === 100 && a.invoices.length === 1
    const okB = b.appt?.consultationFee === 100 && b.invoices.length === 1
    if (okA && okB) OK(`E1 two same-day follow-ups both billed 100 (rep${rep})`)
    else F('S2', `E1 two same-day follow-ups (rep${rep})`, `a.fee=${a.appt?.consultationFee} a.inv=${a.invoices.length} b.fee=${b.appt?.consultationFee} b.inv=${b.invoices.length}`)
  }

  // E2: follow-up dated BEFORE the anchor -> no anchor in the past -> new patient
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ slabs: CONFIGS.tiered, commission: PERCENT, label: 'e2' })
    const patient = await makePatient()
    await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
    const before = await book({ doctor, patient, date: dayFrom(ANCHOR_DAY, -5), type: 'follow_up' })
    if (before.appt?.consultationFee === BASE_FEE) OK(`E2 pre-anchor follow-up billed base ${BASE_FEE} (rep${rep})`)
    else F('S3', `E2 pre-anchor follow-up (rep${rep})`, `fee=${before.appt?.consultationFee}, expected base ${BASE_FEE} (anchor is in the future relative to it)`)
  }

  // E3: first-ever visit typed follow_up -> base fee but "Follow-up" description
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ slabs: CONFIGS.tiered, commission: PERCENT, label: 'e3' })
    const patient = await makePatient()
    const b = await book({ doctor, patient, date: ANCHOR_DAY, type: 'follow_up' })
    let desc = ''
    try { desc = JSON.parse(b.invoices[0].items)[0].description } catch {}
    const feeIsBase = b.appt?.consultationFee === BASE_FEE
    const labeledFollowUp = /Follow-up/.test(desc)
    if (feeIsBase && labeledFollowUp) {
      F('S3', `E3 label/charge mismatch on first-ever 'follow_up' (rep${rep})`,
        `charged full new-patient fee Rs.${BASE_FEE} but the receipt line reads "${desc}". Patient sees "Follow-up Consultation" yet pays the full consult.`)
    } else OK(`E3 first-ever follow_up handled (rep${rep})`)
  }

  // E4a: anchor cancelled AFTER follow-up booked -> stored follow-up fee unchanged
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ slabs: CONFIGS.tiered, commission: PERCENT, label: 'e4a' })
    const patient = await makePatient()
    const anchor = await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
    const fu = await book({ doctor, patient, date: dayFrom(ANCHOR_DAY, 8), type: 'follow_up' }) // 100
    await api('PATCH', `/api/appointments/${anchor.apptId}`, { status: 'cancelled' })
    const after = await db.appointment.findUnique({ where: { id: fu.apptId } })
    if (after.consultationFee === 100) OK(`E4a follow-up fee stays 100 after anchor cancel (snapshot) (rep${rep})`)
    else F('S3', `E4a follow-up fee changed after anchor cancel (rep${rep})`, `now ${after.consultationFee}`)
  }

  // E4b: anchor cancelled FIRST, then follow-up booked -> engine ignores cancelled anchor -> new patient
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ slabs: CONFIGS.tiered, commission: PERCENT, label: 'e4b' })
    const patient = await makePatient()
    const anchor = await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
    await api('PATCH', `/api/appointments/${anchor.apptId}`, { status: 'cancelled' })
    const fu = await book({ doctor, patient, date: dayFrom(ANCHOR_DAY, 8), type: 'follow_up' })
    if (fu.appt?.consultationFee === BASE_FEE) OK(`E4b follow-up after cancelled anchor billed base ${BASE_FEE} (rep${rep})`)
    else F('S2', `E4b follow-up after cancelled anchor (rep${rep})`, `fee=${fu.appt?.consultationFee}, expected base ${BASE_FEE}`)
  }

  // E5: doctor.consultationFee = 0  -> base should be 0, but `|| DEFAULT` flips to 500
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ consultationFee: 0, slabs: [], commission: PERCENT, label: 'e5-zero-base' })
    const patient = await makePatient()
    const b = await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
    if (b.appt?.consultationFee === 0) OK(`E5 zero-base doctor charged 0 (rep${rep})`)
    else F('S2', `E5 doctor.consultationFee=0 charged ${b.appt?.consultationFee} not 0 (rep${rep})`,
      `A doctor explicitly configured free (consultationFee 0) still bills Rs.${b.appt?.consultationFee}. Root: \`doctor.consultationFee || DEFAULT\` treats 0 as "unset".`)
  }

  // E6: slab feeAmount NEGATIVE -> negative fee/invoice/commission stored
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ slabs: [{ fromDays: 0, toDays: 30, feeAmount: -100 }], commission: PERCENT, label: 'e6-neg' })
    const patient = await makePatient()
    await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
    const fu = await book({ doctor, patient, date: dayFrom(ANCHOR_DAY, 5), type: 'follow_up' })
    const inv = fu.invoices[0]
    if (fu.appt?.consultationFee < 0 || (inv && inv.totalAmount < 0)) {
      F('S2', `E6 negative slab feeAmount accepted end-to-end (rep${rep})`,
        `fee=${fu.appt?.consultationFee}, invoice.totalAmount=${inv?.totalAmount}, invoice.balanceDue=${inv?.balanceDue}. A negative slab produces a negative invoice (a credit) and skews commissions/revenue.`)
    } else OK(`E6 negative slab did not produce negative invoice (rep${rep})`)
  }

  // E7: book, change the slab, book again -> first keeps old fee, second gets new
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ slabs: [{ fromDays: 0, toDays: 30, feeAmount: 100 }], commission: PERCENT, label: 'e7' })
    const patient1 = await makePatient()
    await book({ doctor, patient1, date: ANCHOR_DAY, type: 'new_patient' }).catch(() => {})
    // proper anchors per patient
    const pA = await makePatient()
    await book({ doctor, patient: pA, date: ANCHOR_DAY, type: 'new_patient' })
    const first = await book({ doctor, patient: pA, date: dayFrom(ANCHOR_DAY, 5), type: 'follow_up' }) // 100
    // mutate the slab
    await db.doctorFeeSlab.updateMany({ where: { doctorId: doctor.id }, data: { feeAmount: 300 } })
    const pB = await makePatient()
    await book({ doctor, patient: pB, date: ANCHOR_DAY, type: 'new_patient' })
    const second = await book({ doctor, patient: pB, date: dayFrom(ANCHOR_DAY, 5), type: 'follow_up' }) // 300
    const firstStill = await db.appointment.findUnique({ where: { id: first.apptId } })
    if (firstStill.consultationFee === 100 && second.appt?.consultationFee === 300)
      OK(`E7 slab change: first stays 100, second becomes 300 (rep${rep})`)
    else F('S3', `E7 slab-change snapshot (rep${rep})`, `first=${firstStill.consultationFee} (want 100), second=${second.appt?.consultationFee} (want 300)`)
  }

  // E8: fixed commission on a Rs.0 free follow-up -> doctor STILL paid the flat amount
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ slabs: [{ fromDays: 0, toDays: 30, feeAmount: 0 }], commission: FIXED, label: 'e8-fixed-free' })
    const patient = await makePatient()
    await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
    const fu = await book({ doctor, patient, date: dayFrom(ANCHOR_DAY, 5), type: 'follow_up' }) // fee 0
    const c = fu.commissions[0]
    if (fu.appt?.consultationFee === 0 && c && c.commissionAmount === FIXED.rate && c.invoiceAmount === 0)
      OK(`E8 fixed commission pays Rs.${FIXED.rate} on a free (Rs.0) follow-up (rep${rep})`)
    else F('S2', `E8 fixed commission on free follow-up (rep${rep})`,
      `fee=${fu.appt?.consultationFee}, commission=${c ? c.commissionAmount : 'NONE'} (expected ${FIXED.rate}), invoiceAmount=${c?.invoiceAmount}`)
  }

  // E9: percentage commission on a Rs.0 free follow-up -> NO commission row
  for (let rep = 0; rep < 2; rep++) {
    const doctor = await makeDoctor({ slabs: [{ fromDays: 0, toDays: 30, feeAmount: 0 }], commission: PERCENT, label: 'e9-pct-free' })
    const patient = await makePatient()
    await book({ doctor, patient, date: ANCHOR_DAY, type: 'new_patient' })
    const fu = await book({ doctor, patient, date: dayFrom(ANCHOR_DAY, 5), type: 'follow_up' }) // fee 0
    if (fu.appt?.consultationFee === 0 && fu.commissions.length === 0)
      OK(`E9 percentage commission = no row on a free (Rs.0) follow-up (rep${rep})`)
    else F('S2', `E9 percentage commission on free follow-up (rep${rep})`,
      `fee=${fu.appt?.consultationFee}, commission rows=${fu.commissions.length} (expected 0)`)
  }
}

// --------------------------------------------------------------------------
function report() {
  console.log('\n\n============================================================')
  console.log('REPORT')
  console.log('============================================================\n')

  // (2) representative matrix
  console.log('MATRIX — tiered slabs {0-7:free, 8-15:Rs.100, 16-30:Rs.250}, base Rs.500, 10% commission')
  console.log('  gap | daysSince | fee  | invoice | commission')
  console.log('  ----+-----------+------+---------+-----------')
  for (const r of matrixRows) {
    console.log(`  ${String(r.day).padStart(3)} | ${String(r.days).padStart(9)} | ${String(r.fee).padStart(4)} | ${String(r.invoice).padStart(7)} | ${r.comm}`)
  }

  // (1) findings
  console.log('\nFINDINGS (severity-ordered):')
  const order = { S1: 0, S2: 1, S3: 2 }
  const uniq = []
  const seen = new Set()
  for (const f of findings.sort((a, b) => order[a.sev] - order[b.sev])) {
    const key = f.sev + '|' + f.title.replace(/rep\d+|day\d+/g, '')
    // keep every raw finding but flag the dedup key so twice-repro is visible
    uniq.push(f)
  }
  if (uniq.length === 0) console.log('  none')
  for (const f of uniq) console.log(`  [${f.sev}] ${f.title}`)

  // (3) clean
  console.log(`\nCLEAN (${clean.length} assertions passed). Sample:`)
  for (const c of clean.slice(0, 20)) console.log(`  ok  ${c}`)
  if (clean.length > 20) console.log(`  ... and ${clean.length - 20} more`)

  console.log(`\nTOTAL findings: ${findings.length}`)
}

// --------------------------------------------------------------------------
// Tear down everything created under a prefix, in FK-safe order.
async function cleanup(prefix) {
  const docs = await db.user.findMany({ where: { email: { startsWith: prefix }, role: 'doctor' }, select: { id: true } })
  const docIds = docs.map((d) => d.id)
  if (docIds.length) {
    const appts = await db.appointment.findMany({ where: { doctorId: { in: docIds } }, select: { id: true } })
    const apptIds = appts.map((a) => a.id)
    const invs = apptIds.length ? await db.invoice.findMany({ where: { appointmentId: { in: apptIds } }, select: { id: true } }) : []
    const invIds = invs.map((i) => i.id)
    await db.doctorCommission.deleteMany({ where: { OR: [{ doctorId: { in: docIds } }, ...(invIds.length ? [{ invoiceId: { in: invIds } }] : [])] } })
    if (invIds.length) await db.invoice.deleteMany({ where: { id: { in: invIds } } })
    await db.appointment.deleteMany({ where: { doctorId: { in: docIds } } })
    await db.doctorFeeSlab.deleteMany({ where: { doctorId: { in: docIds } } })
    await db.doctorCommissionConfig.deleteMany({ where: { doctorId: { in: docIds } } })
    await db.user.deleteMany({ where: { id: { in: docIds } } })
  }
  const pats = await db.patient.findMany({ where: { mrn: { startsWith: prefix } }, select: { id: true } })
  const patIds = pats.map((p) => p.id)
  if (patIds.length) {
    const appts = await db.appointment.findMany({ where: { patientId: { in: patIds } }, select: { id: true } })
    const apptIds = appts.map((a) => a.id)
    const invs = apptIds.length ? await db.invoice.findMany({ where: { appointmentId: { in: apptIds } }, select: { id: true } }) : []
    const invIds = invs.map((i) => i.id)
    if (invIds.length) {
      await db.doctorCommission.deleteMany({ where: { invoiceId: { in: invIds } } })
      await db.invoice.deleteMany({ where: { id: { in: invIds } } })
    }
    await db.appointment.deleteMany({ where: { patientId: { in: patIds } } })
    await db.patient.deleteMany({ where: { id: { in: patIds } } })
  }
  return { docIds: docIds.length, patIds: patIds.length }
}

// --------------------------------------------------------------------------
try {
  await main()
} catch (e) {
  console.error('\nAUDIT CRASHED:', e)
} finally {
  console.log('\n--- CLEANUP ---')
  const c = await cleanup(PREFIX).catch((e) => { console.error('cleanup error', e); return null })
  if (c) console.log(`removed ${c.docIds} doctors, ${c.patIds} patients (+ their appts/invoices/commissions/slabs/configs)`)
  // Verify nothing with our prefix remains.
  const leftDocs = await db.user.count({ where: { email: { startsWith: PREFIX } } }).catch(() => -1)
  const leftPats = await db.patient.count({ where: { mrn: { startsWith: PREFIX } } }).catch(() => -1)
  console.log(`residue check: doctors=${leftDocs}, patients=${leftPats} (want 0/0)`)
  await db.$disconnect()
}
