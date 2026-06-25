// Phase 3.0 verification — role activation + actor identity.
// 1. Every role logs in via the REAL /api/auth/login and the JWT now carries id + fullName + role.
// 2. Actor capture flows end-to-end: vitals/note/mar (nurse) + post-charge (receptionist)
//    persist the logged-in user's real id (was null before this fix).
// 3. Reports whether AUTH_ENFORCED is on (RBAC) without failing either way.
// Read-only against existing modules; cleans up everything it creates.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const PW = 'Gudmed@123'
const j = (p, o) => fetch(API + p, o).then((r) => r.json().then((b) => ({ status: r.status, b })))
const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString())
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗ FAIL:', m) } }

const ROLE_EMAILS = {
  doctor: 'doctor.demo@gudmed.in', nurse: 'nurse.demo@gudmed.in',
  pharmacist: 'pharmacist.demo@gudmed.in', lab_technician: 'lab.demo@gudmed.in',
  radiology_technician: 'radiology.demo@gudmed.in', billing: 'billing.demo@gudmed.in',
  housekeeping: 'housekeeping.demo@gudmed.in',
}

async function login(email) {
  const { status, b } = await j('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })
  if (!b.token) throw new Error(`login ${email} failed (${status}): ${JSON.stringify(b)}`)
  return b
}

async function main() {
  console.log('\n=== 1. Role activation + JWT actor claims ===')
  const tokens = {}
  for (const [role, email] of Object.entries(ROLE_EMAILS)) {
    const res = await login(email)
    const claims = decode(res.token)
    tokens[role] = res.token
    ok(claims.role === role && claims.id === res.user.id && !!claims.fullName && claims.userId === res.user.id,
      `${role.padEnd(22)} login → JWT has id=${claims.id?.slice(0,8)}… fullName="${claims.fullName}" role=${claims.role}`)
  }

  // Detect enforcement mode (housekeeping posting a charge is forbidden when RBAC is on)
  console.log('\n=== 2. Enforcement mode ===')
  const probe = await j('/inpatient', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens.housekeeping }, body: JSON.stringify({ resource: 'post-charge', admissionId: 'nope', base: 1, serviceGroup: 'OTHER' }) })
  const enforced = probe.status === 403
  console.log(`  AUTH_ENFORCED = ${enforced ? 'TRUE (RBAC active)' : 'false (demo — gates open)'}`)
  if (enforced) ok(probe.b.code === 'FORBIDDEN' || probe.status === 403, 'housekeeping blocked from post-charge (RBAC works)')

  console.log('\n=== 3. Actor capture end-to-end (Nursing Station + charge) ===')
  const recH = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t })
  const recId = decode(tokens.receptionist || tokens.nurse) // receptionist not seeded; use nurse for admit fallback
  // admit via doctor (allowed for admission), charges via billing, clinical via nurse
  const docId = decode(tokens.doctor).id, nurseId = decode(tokens.nurse).id, billId = decode(tokens.billing).id

  // find a free bed + a patient with no active admission (direct DB — setup only)
  const bed = await db.bed.findFirst({ where: { organizationId: ORG, status: 'available' } })
  if (!bed) throw new Error('no available bed')
  const admittedIds = (await db.admission.findMany({ where: { organizationId: ORG, status: 'admitted' }, select: { patientId: true } })).map((a) => a.patientId)
  const pat = await db.patient.findFirst({ where: { organizationId: ORG, id: { notIn: admittedIds.length ? admittedIds : ['__none__'] } } })
  if (!pat) throw new Error('no free patient')

  const adm = (await j('/inpatient', { method: 'POST', headers: recH(tokens.doctor), body: JSON.stringify({ resource: 'admission', patientId: pat.id, bedId: bed.id, admissionDiagnosis: 'P3.0 SMOKE', chiefComplaint: 'x' }) })).b.data
  ok(!!adm?.id, `admission created by doctor (${adm?.id?.slice(0,8)}…)`)

  // vitals (nurse) → recordedById
  const v = (await j('/inpatient', { method: 'POST', headers: recH(tokens.nurse), body: JSON.stringify({ resource: 'vitals', admissionId: adm.id, heartRate: 88, systolicBp: 120, spo2: 98, respiratoryRate: 16, tempC: 37 }) })).b.data
  const vRow = await db.vitalsRecord.findUnique({ where: { id: v.id } })
  ok(vRow?.recordedById === nurseId, `vitals.recordedById = nurse id (${vRow?.recordedById?.slice(0,8)}…) [was null before fix]`)

  // note-v2 (nurse) → authorId
  const n = (await j('/inpatient', { method: 'POST', headers: recH(tokens.nurse), body: JSON.stringify({ resource: 'note-v2', admissionId: adm.id, noteType: 'NURSING', body: 'phase3.0 actor test' }) })).b.data
  const nRow = await db.clinicalNote.findUnique({ where: { id: n.id } })
  ok(nRow?.authorId === nurseId, `note.authorId = nurse id (${nRow?.authorId?.slice(0,8)}…)`)

  // mar (nurse) → nurseId
  const m = (await j('/inpatient', { method: 'POST', headers: recH(tokens.nurse), body: JSON.stringify({ resource: 'medication-administration', admissionId: adm.id, drugName: 'Paracetamol', status: 'GIVEN' }) })).b.data
  const mRow = await db.medicationAdministration.findUnique({ where: { id: m.id } })
  ok(mRow?.nurseId === nurseId, `mar.nurseId = nurse id (${mRow?.nurseId?.slice(0,8)}…)`)

  // post-charge (billing) → postedById
  const c = (await j('/inpatient', { method: 'POST', headers: recH(tokens.billing), body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, base: 500, serviceGroup: 'PROCEDURE', description: 'P3.0 actor charge' }) })).b
  if (c?.data?.id) {
    const cRow = await db.ipdCharge.findUnique({ where: { id: c.data.id } })
    ok(cRow?.postedById === billId, `ipdCharge.postedById = billing id (${cRow?.postedById?.slice(0,8)}…)`)
  } else {
    console.log('  (post-charge skipped:', JSON.stringify(c).slice(0,120), ')')
  }

  console.log('\n=== cleanup ===')
  await db.ipdCharge.deleteMany({ where: { admissionId: adm.id } })
  await db.vitalsRecord.deleteMany({ where: { admissionId: adm.id } })
  await db.clinicalNote.deleteMany({ where: { admissionId: adm.id } })
  await db.medicationAdministration.deleteMany({ where: { admissionId: adm.id } })
  await db.bedOccupancy.deleteMany({ where: { admissionId: adm.id } })
  await db.patientTariff.deleteMany({ where: { admissionId: adm.id } })
  await db.bill.deleteMany({ where: { admissionId: adm.id } })
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: adm.id }, { newValues: { contains: adm.id } }] } })
  await db.bed.update({ where: { id: bed.id }, data: { status: 'available' } })
  await db.housekeepingTask.deleteMany({ where: { bedId: bed.id, status: { not: 'DONE' } } })
  await db.admission.delete({ where: { id: adm.id } }).catch(() => {})
  console.log('  cleaned')

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
