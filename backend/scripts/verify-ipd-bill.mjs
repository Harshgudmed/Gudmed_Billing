// Phase 1 billing verification: admit → charges → generate → finalize (numbered, immutable)
// → post-finalize correction via cancel-and-reissue → supplementary.
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const PASS = (m) => console.log('  ✓ ' + m)
const FAIL = (m) => { console.log('  ✗ FAIL: ' + m); process.exitCode = 1 }
const H = (role = 'admin') => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: 'test-' + role, role, organizationId: ORG, email: role + '@t', fullName: 'Test ' + role }, SECRET) })
async function call(path, opts) { const r = await fetch(API + path, opts); const b = await r.json().catch(() => ({})); return { status: r.status, ok: r.ok, body: b } }

async function main() {
  const wards = (await call('/inpatient?resource=wards', { headers: H() })).body.data
  const ward = wards.find((w) => (w.beds || []).some((b) => b.status === 'available'))
  const bed = (await call(`/inpatient?resource=beds&wardId=${ward.id}&status=available`, { headers: H() })).body.data[0]
  const pat = (await call('/patients?limit=1', { headers: H() })).body.data[0]
  const drug = await db.pharmacyDrug.findFirst({ where: { organizationId: ORG, drugName: 'Paracetamol 500mg' } })
  const adm = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'admission', patientId: pat.id, bedId: bed.id, admissionDiagnosis: 'BILL P1', chiefComplaint: 'x', depositAmount: 1000 }) })).body.data
  console.log(`Admitted ${adm.id} in ${ward.name}`)

  console.log('\n[Post charges] pharmacy + procedure (frozen tax)')
  const c1 = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, pharmacyDrugId: drug.id, quantity: 10, sourceModule: 'PHARMACY', sourceRef: 'disp-1' }) })).body.data
  const c2 = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, description: 'ECG', serviceGroup: 'PROCEDURE', base: 500, sourceModule: 'PROCEDURE', sourceRef: 'ecg-1' }) })).body.data
  if (c1.taxAmount > 0 && c1.lineTotal > 0 && c1.postedByName) PASS(`pharmacy charge frozen: unit ₹${c1.unitPrice}, tax ₹${c1.taxAmount}, lineTotal ₹${c1.lineTotal}, postedBy ${c1.postedByName}`); else FAIL('pharmacy charge not frozen')
  if (c2.status === 'ACTIVE') PASS(`procedure charge posted (status ${c2.status})`); else FAIL('procedure charge bad')

  console.log('\n[Generate DRAFT bill]')
  const gen = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'bill-generate', admissionId: adm.id }) })).body.data
  if (gen.status === 'DRAFT' && gen.charges.length === 2) PASS(`DRAFT bill: ${gen.charges.length} lines, payable ₹${gen.payableTotal}, deposit ₹${gen.depositTotal}`); else FAIL(`draft wrong (${gen.status}, ${gen.charges?.length} lines)`)

  console.log('\n[One open draft enforced] second generate returns SAME draft')
  const gen2 = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'bill-generate', admissionId: adm.id }) })).body.data
  if (gen2.id === gen.id) PASS('second generate reused the same open draft (no duplicate)'); else FAIL('duplicate draft created')

  console.log('\n[Finalize] numbered + immutable')
  const fin = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'bill-finalize', admissionId: adm.id }) })).body.data
  if (fin.status === 'FINAL' && /^IPD-\d{4}-\d{2}-\d{6}$/.test(fin.billNumber)) PASS(`FINAL bill ${fin.billNumber}, payable ₹${fin.payableTotal}`); else FAIL(`finalize wrong (${fin.status}, ${fin.billNumber})`)

  console.log('\n[Immutability] cannot cancel a charge on a FINAL bill')
  const onFinal = await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'cancel-charge', chargeId: c1.id, reason: 'return' }) })
  if (onFinal.status === 409 && onFinal.body.code === 'IPD_CHARGE_ON_FINAL_BILL') PASS('charge on FINAL bill is protected (409)'); else FAIL(`charge on final not protected (${onFinal.status})`)

  console.log('\n[Cancel-and-reissue] void FINAL → correct → re-finalize (supplementary)')
  await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'bill-cancel', billId: fin.id, reason: 'pharmacy return correction' }) })
  // now charges are released; cancel the returned pharmacy charge
  const ret = await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'cancel-charge', chargeId: c1.id, status: 'RETURNED', reason: 'unused meds returned' }) })
  if (ret.ok && ret.body.data.status === 'RETURNED') PASS('returned pharmacy charge marked RETURNED (audit-safe, not deleted)'); else FAIL('return failed')
  const reissue = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'bill-finalize', admissionId: adm.id, billType: 'SUPPLEMENTARY' }) })).body.data
  if (reissue.status === 'FINAL' && reissue.billNumber !== fin.billNumber) PASS(`reissued bill ${reissue.billNumber} (new number), payable ₹${reissue.payableTotal} (excludes returned drug)`); else FAIL('reissue failed')
  if (reissue.payableTotal < fin.payableTotal) PASS(`corrected total dropped: ₹${fin.payableTotal} → ₹${reissue.payableTotal}`); else FAIL('total did not drop after return')

  console.log('\n[History] both bills retained')
  const hist = (await call(`/inpatient?resource=bill&admissionId=${adm.id}`, { headers: H() })).body.history
  const cancelled = hist.filter((b) => b.status === 'CANCELLED').length
  const finals = hist.filter((b) => b.status === 'FINAL').length
  if (cancelled === 1 && finals === 1) PASS(`bill history: ${finals} FINAL + ${cancelled} CANCELLED (nothing deleted)`); else FAIL(`history wrong (${finals} final, ${cancelled} cancelled)`)

  // cleanup
  await db.ipdCharge.deleteMany({ where: { admissionId: adm.id } })
  await db.bill.deleteMany({ where: { admissionId: adm.id } })
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
