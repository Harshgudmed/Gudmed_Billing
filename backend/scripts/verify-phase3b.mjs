// Phase 3B verification — Procedure auto-billing through the EXISTING engines.
// Proves: tariff→IpdCharge on complete; idempotency; running bill; bill generation;
// supplementary after FINAL; and that other order types stay spine-only.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const PW = 'Gudmed@123'
const jr = (p, o) => fetch(API + p, o).then((r) => r.json().then((b) => ({ status: r.status, b })))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗ FAIL:', m) } }
const login = async (e) => (await jr('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: PW }) })).b.token
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t })
const post = (t, body) => jr('/inpatient', { method: 'POST', headers: H(t), body: JSON.stringify(body) })
const get = (t, qs) => jr('/inpatient?' + qs, { headers: H(t) })
const r2 = (n) => Math.round((n || 0) * 100) / 100

async function runProcedure(nurse, admissionId, cm) {
  const ord = (await post(nurse, { resource: 'order', admissionId, orderType: 'PROCEDURE', serviceGroup: 'PROCEDURE', catalogModel: 'ChargeMaster', catalogItemId: cm.id, itemName: cm.name, itemCode: cm.code, priority: 'ROUTINE' })).b.data
  await post(nurse, { resource: 'order-ack', id: ord.id })
  await post(nurse, { resource: 'order-start', id: ord.id })
  return ord
}

async function main() {
  const doctor = await login('doctor.demo@gudmed.in')
  const nurse = await login('nurse.demo@gudmed.in')
  const lab = await login('lab.demo@gudmed.in')
  const billing = await login('billing.demo@gudmed.in')

  // ensure a PROCEDURE catalog item
  let cm = await db.chargeMaster.findFirst({ where: { organizationId: ORG, serviceGroup: 'PROCEDURE', isActive: true } })
  let cmCreated = false
  if (!cm) { cm = await db.chargeMaster.create({ data: { organizationId: ORG, code: 'PW-PROC-3B', name: 'PW Test Procedure', serviceGroup: 'PROCEDURE', basePrice: 800, taxRatePct: 0, isActive: true } }); cmCreated = true }

  // setup admission (doctor admits)
  const bed = await db.bed.findFirst({ where: { organizationId: ORG, status: 'available' } })
  const admittedIds = (await db.admission.findMany({ where: { organizationId: ORG, status: 'admitted' }, select: { patientId: true } })).map((a) => a.patientId)
  const pat = await db.patient.findFirst({ where: { organizationId: ORG, id: { notIn: admittedIds.length ? admittedIds : ['__none__'] } } })
  const adm = (await post(doctor, { resource: 'admission', patientId: pat.id, bedId: bed.id, admissionDiagnosis: 'P3B', chiefComplaint: 'x' })).b.data

  const baseCharges = await db.ipdCharge.count({ where: { organizationId: ORG } })

  console.log('\n=== 1. Success path: complete PROCEDURE → 1 IpdCharge ===')
  const ord = await runProcedure(nurse, adm.id, cm)
  const comp = await post(nurse, { resource: 'order-complete', id: ord.id })
  const charge = comp.b.charge
  ok(comp.b.data?.status === 'COMPLETED' && comp.b.data?.billed === true && comp.b.data?.ipdChargeId, 'order COMPLETED + billed=true + ipdChargeId set')
  const chRow = await db.ipdCharge.findFirst({ where: { organizationId: ORG, sourceModule: 'PROCEDURE', sourceRef: ord.id } })
  ok(chRow && chRow.status === 'ACTIVE' && chRow.sourceRef === ord.id, `IpdCharge ACTIVE with sourceModule=PROCEDURE sourceRef=order.id`)
  const ordRow = await db.clinicalOrder.findUnique({ where: { id: ord.id } })
  ok(ordRow.executorModel === 'ClinicalOrder' && ordRow.executorId === ord.id, 'order.executorModel/executorId set to self')

  console.log('\n=== 2. Tariff pricing verification ===')
  const prev = await get(nurse, `resource=tariff-preview&admissionId=${adm.id}&itemCode=${cm.code}`)
  const previewPrice = prev.b?.data?.price ?? prev.b?.price
  ok(charge.unitPrice > 0, `charge.unitPrice > 0 (₹${charge.unitPrice})`)
  if (previewPrice != null) ok(r2(previewPrice) === r2(charge.unitPrice), `unitPrice matches tariff-preview (₹${previewPrice})`)
  const expectedLine = r2(r2(charge.unitPrice * charge.quantity) + (charge.taxAmount || 0))
  ok(r2(charge.lineTotal) === expectedLine, `lineTotal correct (₹${charge.lineTotal})`)
  ok(chRow.resolvedFrom && JSON.stringify(chRow.resolvedFrom).includes('planId'), 'resolvedFrom captured (planId)')

  console.log('\n=== 3+4. Double-complete + duplicate-billing prevention ===')
  const again = await post(nurse, { resource: 'order-complete', id: ord.id })
  ok(again.status === 400 && again.b.code === 'IPD_ORDER_BAD_TRANSITION', `re-complete rejected (400 ${again.b.code})`)
  const cnt = await db.ipdCharge.count({ where: { organizationId: ORG, sourceModule: 'PROCEDURE', sourceRef: ord.id } })
  ok(cnt === 1, `exactly 1 charge for the order (got ${cnt})`)

  console.log('\n=== 5. Running bill includes the procedure charge ===')
  const rb = await get(nurse, `resource=running-bill&admissionId=${adm.id}`)
  const rbStr = JSON.stringify(rb.b)
  ok(rb.b && (rbStr.includes(cm.name) || rbStr.includes(charge.id)) , 'running-bill references the procedure charge')

  console.log('\n=== 6. Bill generation links the charge ===')
  const gen = await post(billing, { resource: 'bill-generate', admissionId: adm.id })
  const bill1 = gen.b.data
  const chAfterGen = await db.ipdCharge.findUnique({ where: { id: chRow.id } })
  ok(bill1?.id && chAfterGen.billId === bill1.id, `charge linked to DRAFT bill (billId=${chAfterGen.billId?.slice(0, 8)}…)`)
  ok((bill1.payableTotal || 0) >= charge.lineTotal, `bill payableTotal (₹${bill1.payableTotal}) includes charge (₹${charge.lineTotal})`)

  console.log('\n=== 7. Supplementary after FINAL (FINAL never mutated) ===')
  const fin = await post(billing, { resource: 'bill-finalize', admissionId: adm.id })
  const finalBill = fin.b.data
  const finalTotalBefore = finalBill.payableTotal
  const ord2 = await runProcedure(nurse, adm.id, cm)
  await post(nurse, { resource: 'order-complete', id: ord2.id })
  const gen2 = await post(billing, { resource: 'bill-generate', admissionId: adm.id })
  const bill2 = gen2.b.data
  const finalReread = await db.bill.findUnique({ where: { id: finalBill.id } })
  ok(bill2?.id && bill2.id !== finalBill.id && bill2.status === 'DRAFT', 'new DRAFT (supplementary) bill created')
  ok(r2(finalReread.payableTotal) === r2(finalTotalBefore), `FINAL bill payableTotal unchanged (₹${finalReread.payableTotal})`)

  console.log('\n=== 8. Spine-only preserved for non-PROCEDURE ===')
  const labOrd = (await post(nurse, { resource: 'order', admissionId: adm.id, orderType: 'LAB', serviceGroup: 'LAB', itemName: 'CBC', priority: 'ROUTINE' })).b.data
  await post(nurse, { resource: 'order-ack', id: labOrd.id })
  await post(nurse, { resource: 'order-start', id: labOrd.id })
  const labComp = await post(lab, { resource: 'order-complete', id: labOrd.id })
  const labCharge = await db.ipdCharge.count({ where: { organizationId: ORG, sourceRef: labOrd.id } })
  ok(labComp.b.data?.status === 'COMPLETED' && labComp.b.data?.billed === false && labCharge === 0, 'LAB completion creates 0 charge (spine-only)')

  console.log('\n=== cleanup ===')
  await db.clinicalOrderEvent.deleteMany({ where: { order: { admissionId: adm.id } } })
  await db.clinicalOrder.deleteMany({ where: { admissionId: adm.id } })
  await db.billPayment.deleteMany({ where: { admissionId: adm.id } })
  await db.ipdCharge.deleteMany({ where: { admissionId: adm.id } })
  await db.bill.deleteMany({ where: { admissionId: adm.id } })
  await db.bedOccupancy.deleteMany({ where: { admissionId: adm.id } })
  await db.patientTariff.deleteMany({ where: { admissionId: adm.id } })
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: adm.id }, { entityId: ord.id }, { entityId: ord2.id }, { entityId: labOrd.id }, { newValues: { contains: adm.id } }] } })
  await db.bed.update({ where: { id: bed.id }, data: { status: 'available' } })
  await db.housekeepingTask.deleteMany({ where: { bedId: bed.id, status: { not: 'DONE' } } })
  await db.admission.delete({ where: { id: adm.id } }).catch(() => {})
  await db.billCounter.updateMany({ where: { organizationId: ORG }, data: { value: 0 } })
  if (cmCreated) await db.chargeMaster.delete({ where: { id: cm.id } }).catch(() => {})
  const finalCharges = await db.ipdCharge.count({ where: { organizationId: ORG } })
  ok(finalCharges === baseCharges, `IpdCharge count restored to baseline (${baseCharges})`)
  console.log('  cleaned')

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
