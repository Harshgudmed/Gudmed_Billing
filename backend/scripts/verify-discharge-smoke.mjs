import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = 'org-demo'
const S = process.env.JWT_SECRET || 'change-me-in-production'
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: 't-admin', role: 'admin', organizationId: ORG, email: 'a@b', fullName: 'Admin' }, S) }
const c = (p, o) => fetch(API + p, o).then((r) => r.json())

async function main() {
  const wards = (await c('/inpatient?resource=wards', { headers: H })).data
  const w = wards.find((x) => (x.beds || []).some((b) => b.status === 'available'))
  const bed = (await c(`/inpatient?resource=beds&wardId=${w.id}&status=available`, { headers: H })).data[0]
  // pick a patient with no active admission
  const pats = (await c('/patients?limit=25', { headers: H })).data
  let pat = null
  for (const p of pats) {
    const active = await db.admission.findFirst({ where: { organizationId: ORG, patientId: p.id, status: 'admitted' } })
    if (!active) { pat = p; break }
  }
  if (!pat) { console.log('no free patient'); process.exit(1) }

  const adm = (await c('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'admission', patientId: pat.id, bedId: bed.id, admissionDiagnosis: 'DISCHARGE SMOKE', chiefComplaint: 'x' }) })).data
  await c('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'bill-generate', admissionId: adm.id }) })
  const fin = (await c('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'bill-finalize', admissionId: adm.id }) })).data
  // pay off the balance so the billing gate (balanceDue == 0) passes
  if ((fin.balanceDue || 0) > 0) {
    const pay = await c('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'payment', billId: fin.id, amount: fin.balanceDue, method: 'CASH' }) })
    console.log('payment:', pay.data?.receiptNumber, '· balance now', pay.totals?.balanceDue)
  }
  // Discharge is now gated on a paid bill (clearances removed).
  const dis = await c('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'discharge-finalize', admissionId: adm.id, dischargeDiagnosis: 'ok', dischargeCondition: 'Recovered' }) })

  console.log('bill finalized:', fin.billNumber, '| balance', fin.balanceDue)
  console.log('discharge-finalize:', dis.success ? 'SUCCESS · state=' + dis.data.admissionState + ' · bill=' + (dis.bill?.billNumber || '—') : 'FAIL ' + JSON.stringify(dis))

  // cleanup
  for (const id of [adm.id]) {
    await db.billPayment.deleteMany({ where: { admissionId: id } })
    await db.ipdCharge.deleteMany({ where: { admissionId: id } })
    await db.bill.deleteMany({ where: { admissionId: id } })
    await db.dischargeClearance.deleteMany({ where: { admissionId: id } })
    await db.bedOccupancy.deleteMany({ where: { admissionId: id } })
    await db.patientTariff.deleteMany({ where: { admissionId: id } })
    await db.auditLog.deleteMany({ where: { OR: [{ entityId: id }, { newValues: { contains: id } }] } })
  }
  await db.housekeepingTask.deleteMany({ where: { bedId: bed.id, status: { not: 'DONE' } } })
  await db.billCounter.updateMany({ where: { organizationId: ORG }, data: { value: 0 } })
  await db.bed.update({ where: { id: bed.id }, data: { status: 'available' } })
  await db.admission.delete({ where: { id: adm.id } }).catch(() => {})
  console.log('cleaned')
  process.exit(0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
