// Phase 3A verification — ClinicalOrder spine, unified search, RBAC, audit.
// Proves: lifecycle + events + audit; state-machine guard; discipline-scoped RBAC;
// virtual-union search; progress notes (existing note-v2) actor capture; and
// SPINE-ONLY (zero IpdCharge / LabOrder / RadiologyOrder / Prescription writes).
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const PW = 'Gudmed@123'
const j = (p, o) => fetch(API + p, o).then((r) => r.json().then((b) => ({ status: r.status, b })))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗ FAIL:', m) } }
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t })

async function login(email) {
  const { b } = await j('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })
  if (!b.token) throw new Error('login failed ' + email)
  return b
}
const post = (t, body) => j('/inpatient', { method: 'POST', headers: H(t), body: JSON.stringify(body) })
const get = (t, qs) => j('/inpatient?' + qs, { headers: H(t) })

async function main() {
  const doctor = (await login('doctor.demo@gudmed.in')).token
  const nurse = (await login('nurse.demo@gudmed.in'))
  const lab = (await login('lab.demo@gudmed.in')).token
  const radio = (await login('radiology.demo@gudmed.in')).token
  const house = (await login('housekeeping.demo@gudmed.in')).token

  // setup: free bed + unadmitted patient (DB direct)
  const bed = await db.bed.findFirst({ where: { organizationId: ORG, status: 'available' } })
  const admittedIds = (await db.admission.findMany({ where: { organizationId: ORG, status: 'admitted' }, select: { patientId: true } })).map((a) => a.patientId)
  const pat = await db.patient.findFirst({ where: { organizationId: ORG, id: { notIn: admittedIds.length ? admittedIds : ['__none__'] } } })
  const adm = (await post(doctor, { resource: 'admission', patientId: pat.id, bedId: bed.id, admissionDiagnosis: 'P3A', chiefComplaint: 'x' })).b.data

  // baseline counts to prove SPINE-ONLY
  const base = {
    charge: await db.ipdCharge.count(), lab: await db.labOrder.count(),
    rad: await db.radiologyOrder.count(), rx: await db.prescription.count(),
  }

  console.log('\n=== 1. Unified search (virtual union) ===')
  const sLab = (await get(doctor, 'resource=orderables&type=LAB')).b.data
  ok(Array.isArray(sLab) && sLab.every((x) => x.orderType === 'LAB' && x.serviceGroup === 'LAB'), `LAB search → ${sLab.length} rows, all typed LAB`)
  const sAll = (await get(doctor, 'resource=orderables')).b.data
  const types = [...new Set(sAll.map((x) => x.orderType))]
  ok(Array.isArray(sAll), `no-type search unions catalogs → ${sAll.length} rows, types: ${types.join(',') || '(empty catalogs)'}`)

  console.log('\n=== 2. Order lifecycle + events + audit ===')
  const ord = (await post(doctor, { resource: 'order', admissionId: adm.id, orderType: 'LAB', itemName: 'CBC', serviceGroup: 'LAB', priority: 'STAT' })).b.data
  ok(ord?.status === 'ORDERED' && ord.orderedById, `LAB order created by doctor (status ORDERED, orderedById set)`)
  await post(lab, { resource: 'order-ack', id: ord.id })
  await post(lab, { resource: 'order-start', id: ord.id })
  const done = (await post(lab, { resource: 'order-complete', id: ord.id })).b.data
  ok(done?.status === 'COMPLETED' && done.completedById, 'lab_technician completed LAB order (completedById set)')
  const detail = (await get(doctor, 'resource=order&id=' + ord.id)).b.data
  ok(detail.events?.length === 4, `timeline has 4 events (ORDERED→ACK→IN_PROGRESS→COMPLETED): got ${detail.events?.length}`)
  const audits = await db.auditLog.count({ where: { entityType: 'ipd.order', entityId: ord.id } })
  ok(audits === 4, `4 AuditLog rows for order transitions: got ${audits}`)

  console.log('\n=== 3. SPINE ONLY — no billing / no executor writes ===')
  const after = {
    charge: await db.ipdCharge.count(), lab: await db.labOrder.count(),
    rad: await db.radiologyOrder.count(), rx: await db.prescription.count(),
  }
  ok(after.charge === base.charge, `IpdCharge unchanged (${base.charge}→${after.charge})`)
  ok(after.lab === base.lab && after.rad === base.rad && after.rx === base.rx, `LabOrder/RadiologyOrder/Prescription unchanged`)
  const ordRow = await db.clinicalOrder.findUnique({ where: { id: ord.id } })
  ok(ordRow.billed === false && !ordRow.ipdChargeId && !ordRow.executorId, 'order.billed=false, no ipdChargeId, no executor dispatch')

  console.log('\n=== 4. State machine guard ===')
  const o2 = (await post(doctor, { resource: 'order', admissionId: adm.id, orderType: 'PROCEDURE', itemName: 'Dressing', serviceGroup: 'PROCEDURE' })).b.data
  const badComplete = await post(doctor, { resource: 'order-complete', id: o2.id }) // ORDERED→COMPLETED illegal
  ok(badComplete.status === 400 && badComplete.b.code === 'IPD_ORDER_BAD_TRANSITION', `ORDERED→COMPLETED rejected (400 ${badComplete.b.code})`)

  console.log('\n=== 5. RBAC (discipline-scoped) ===')
  const radOrd = (await post(doctor, { resource: 'order', admissionId: adm.id, orderType: 'RADIOLOGY', itemName: 'Chest X-Ray', serviceGroup: 'RADIOLOGY' })).b.data
  await post(nurse.token, { resource: 'order-ack', id: radOrd.id })
  await post(nurse.token, { resource: 'order-start', id: radOrd.id })
  const labOnRad = await post(lab, { resource: 'order-complete', id: radOrd.id })
  ok(labOnRad.status === 403, `lab_technician blocked from completing RADIOLOGY (403)`)
  const radOnRad = await post(radio, { resource: 'order-complete', id: radOrd.id })
  ok(radOnRad.status === 200 && radOnRad.b.data.status === 'COMPLETED', 'radiology_technician completes RADIOLOGY (200)')
  const houseCreate = await post(house, { resource: 'order', admissionId: adm.id, orderType: 'LAB', itemName: 'KFT', serviceGroup: 'LAB' })
  ok(houseCreate.status === 403, 'housekeeping blocked from creating an order (403)')
  const docCancel = await post(doctor, { resource: 'order-cancel', id: o2.id, reason: 'duplicate' })
  ok(docCancel.status === 200 && docCancel.b.data.status === 'CANCELLED', 'doctor cancels a pending order (200)')

  console.log('\n=== 6. Progress notes (existing note-v2) + actor capture ===')
  const note = (await post(doctor, { resource: 'note-v2', admissionId: adm.id, noteType: 'PROGRESS', body: 'Improving; continue antibiotics' })).b.data
  const add = (await post(doctor, { resource: 'note-v2', admissionId: adm.id, noteType: 'PROGRESS', body: 'Repeat CBC tomorrow', parentId: note.id })).b.data
  const noteRow = await db.clinicalNote.findUnique({ where: { id: note.id } })
  const addRow = await db.clinicalNote.findUnique({ where: { id: add.id } })
  ok(noteRow.authorId && addRow.parentId === note.id, `progress note + addendum (addendum.parentId links original; author captured)`)

  console.log('\n=== cleanup ===')
  await db.clinicalOrderEvent.deleteMany({ where: { order: { admissionId: adm.id } } })
  await db.clinicalOrder.deleteMany({ where: { admissionId: adm.id } })
  await db.clinicalNote.deleteMany({ where: { admissionId: adm.id } })
  await db.bedOccupancy.deleteMany({ where: { admissionId: adm.id } })
  await db.patientTariff.deleteMany({ where: { admissionId: adm.id } })
  await db.bill.deleteMany({ where: { admissionId: adm.id } })
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: adm.id }, { entityId: ord.id }, { entityId: radOrd.id }, { entityId: o2.id }, { newValues: { contains: adm.id } }] } })
  await db.bed.update({ where: { id: bed.id }, data: { status: 'available' } })
  await db.housekeepingTask.deleteMany({ where: { bedId: bed.id, status: { not: 'DONE' } } })
  await db.admission.delete({ where: { id: adm.id } }).catch(() => {})
  console.log('  cleaned')

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
