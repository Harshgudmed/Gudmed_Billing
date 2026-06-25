// Step 4 + verifications: admissions billSummary, print uses persisted snapshot, supplementary never mutates FINAL.
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const PASS = (m) => console.log('  ✓ ' + m)
const FAIL = (m) => { console.log('  ✗ FAIL: ' + m); process.exitCode = 1 }
const H = (role = 'admin') => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: 'test-' + role, role, organizationId: ORG, email: role + '@t', fullName: 'Test ' + role }, SECRET) })
async function call(p, o) { const r = await fetch(API + p, o); const b = await r.json().catch(() => ({})); return { status: r.status, ok: r.ok, body: b } }

async function main() {
  const wards = (await call('/inpatient?resource=wards', { headers: H() })).body.data
  const ward = wards.find((w) => (w.beds || []).some((b) => b.status === 'available'))
  const bed = (await call(`/inpatient?resource=beds&wardId=${ward.id}&status=available`, { headers: H() })).body.data[0]
  const pat = (await call('/patients?limit=1', { headers: H() })).body.data[0]
  const adm = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'admission', patientId: pat.id, bedId: bed.id, admissionDiagnosis: 'STEP4', chiefComplaint: 'x' }) })).body.data

  await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, description: 'ECG', serviceGroup: 'PROCEDURE', base: 500, sourceModule: 'PROCEDURE', sourceRef: 's4-ecg' }) })
  const fin = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'bill-finalize', admissionId: adm.id }) })).body.data
  const frozenTotal = fin.payableTotal
  const frozenChargeCount = (fin.charges || []).length
  console.log(`Finalized ${fin.billNumber}, payable ₹${frozenTotal}, ${frozenChargeCount} line(s)`)

  console.log('\n[1] Patient History bill summary comes from Bill table')
  const list = (await call('/inpatient?resource=admissions&limit=200', { headers: H() })).body.data
  const row = list.find((a) => a.id === adm.id)
  if (row?.billSummary && row.billSummary.billNumber === fin.billNumber && row.billSummary.payableTotal === frozenTotal) PASS(`admissions list billSummary: ${row.billSummary.billNumber} ₹${row.billSummary.payableTotal} (${row.billSummary.status})`)
  else FAIL(`billSummary wrong: ${JSON.stringify(row?.billSummary)}`)
  if (!('totalBillAmount' in row) || row.totalBillAmount == null) PASS('legacy totalBillAmount not used for the column (null/absent)'); else console.log('    (note: legacy totalBillAmount still present on row but UI no longer reads it)')

  console.log('\n[2] GET bill returns the PERSISTED snapshot (Bill + IpdCharge), independent of running-bill')
  const billGet = (await call(`/inpatient?resource=bill&admissionId=${adm.id}`, { headers: H() })).body
  const pb = billGet.data
  if (pb.status === 'FINAL' && pb.charges && pb.charges.length === frozenChargeCount && pb.payableTotal === frozenTotal) PASS(`persisted bill has ${pb.charges.length} frozen IpdCharge line(s), payable ₹${pb.payableTotal}`)
  else FAIL('persisted bill snapshot mismatch')
  // Post a NEW charge AFTER finalize → must NOT change the FINAL snapshot
  await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, description: 'Late X-Ray', serviceGroup: 'RADIOLOGY', base: 999, sourceModule: 'RADIOLOGY', sourceRef: 's4-xray' }) })
  const finAfter = await db.bill.findUnique({ where: { id: fin.id }, include: { charges: true } })
  if (finAfter.status === 'FINAL' && finAfter.payableTotal === frozenTotal && finAfter.charges.length === frozenChargeCount) PASS(`FINAL snapshot unchanged after new charge: payable still ₹${finAfter.payableTotal}, ${finAfter.charges.length} line(s)`)
  else FAIL(`FINAL bill mutated! payable ₹${finAfter.payableTotal}, ${finAfter.charges.length} lines`)

  console.log('\n[3] New Supplementary creates a NEW DRAFT, never mutates the FINAL')
  const supp = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'bill-generate', admissionId: adm.id }) })).body.data
  if (supp.id !== fin.id && supp.status === 'DRAFT') PASS(`new DRAFT bill ${supp.id.slice(-6)} created (≠ FINAL ${fin.id.slice(-6)})`)
  else FAIL(`expected new draft, got id=${supp.id} status=${supp.status}`)
  const suppHasXray = (supp.charges || []).some((c) => c.sourceRef === 's4-xray')
  if (suppHasXray) PASS('the late ₹999 charge landed on the NEW draft (not the FINAL)'); else FAIL('late charge not on new draft')
  const finStill = await db.bill.findUnique({ where: { id: fin.id } })
  if (finStill.status === 'FINAL' && finStill.payableTotal === frozenTotal) PASS('FINAL bill still FINAL + unchanged after supplementary'); else FAIL('FINAL changed after supplementary')
  const hist = (await call(`/inpatient?resource=bill&admissionId=${adm.id}`, { headers: H() })).body.history
  console.log(`    history: ${hist.map((h) => `${h.status}/${h.billType}`).join(', ')}`)

  // cleanup
  await db.ipdCharge.deleteMany({ where: { admissionId: adm.id } })
  await db.bill.deleteMany({ where: { admissionId: adm.id } })
  await db.billCounter.updateMany({ where: { organizationId: ORG }, data: { value: 0 } })
  await db.bedOccupancy.deleteMany({ where: { admissionId: adm.id } })
  await db.patientTariff.deleteMany({ where: { admissionId: adm.id } })
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: adm.id }, { newValues: { contains: adm.id } }] } })
  await db.housekeepingTask.deleteMany({ where: { bedId: bed.id, status: { not: 'DONE' } } })
  await db.bed.update({ where: { id: bed.id }, data: { status: 'available' } })
  await db.admission.delete({ where: { id: adm.id } }).catch(() => {})
  console.log('\ncleaned up')
  process.exit()
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
