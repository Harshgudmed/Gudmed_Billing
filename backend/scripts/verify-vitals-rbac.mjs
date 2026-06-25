// Verifies the vitals RBAC matrix: nurse create/update ✅, doctor create/update ❌, both view ✅.
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const PASS = (m) => console.log('  ✓ ' + m)
const FAIL = (m) => { console.log('  ✗ FAIL: ' + m); process.exitCode = 1 }
const H = (role) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: 'test-' + role, role, organizationId: ORG, email: role + '@t' }, SECRET) })
async function call(path, opts) { const r = await fetch(API + path, opts); const b = await r.json().catch(() => ({})); return { status: r.status, ok: r.ok, body: b } }

async function main() {
  const wards = (await call('/inpatient?resource=wards', { headers: H('admin') })).body.data
  const ward = wards.find((w) => (w.beds || []).some((b) => b.status === 'available'))
  const bed = (await call(`/inpatient?resource=beds&wardId=${ward.id}&status=available`, { headers: H('admin') })).body.data[0]
  const pat = (await call('/patients?limit=1', { headers: H('admin') })).body.data[0]
  const adm = (await call('/inpatient', { method: 'POST', headers: H('admin'), body: JSON.stringify({ resource: 'admission', patientId: pat.id, bedId: bed.id, admissionDiagnosis: 'VITALS RBAC', chiefComplaint: 'x' }) })).body.data
  const V = (role) => ({ resource: 'vitals', admissionId: adm.id, systolicBp: 120, heartRate: 80, spo2: 98, respiratoryRate: 16, tempC: 37 })

  console.log('\n[Nurse] create / update / view')
  const nCreate = await call('/inpatient', { method: 'POST', headers: H('nurse'), body: JSON.stringify(V()) })
  if (nCreate.ok) PASS('nurse CREATE vitals ✅'); else FAIL(`nurse create blocked (${nCreate.status} ${nCreate.body.error})`)
  const vid = nCreate.body?.data?.id
  const nUpdate = vid ? await call('/inpatient', { method: 'PATCH', headers: H('nurse'), body: JSON.stringify({ resource: 'vitals', id: vid, systolicBp: 130 }) }) : { ok: false }
  if (nUpdate.ok && nUpdate.body.data.systolicBp === 130) PASS('nurse UPDATE vitals ✅ (NEWS recomputed)'); else FAIL('nurse update failed')
  const nView = await call(`/inpatient?resource=vitals&admissionId=${adm.id}`, { headers: H('nurse') })
  if (nView.ok && nView.body.data.length) PASS('nurse VIEW vitals ✅'); else FAIL('nurse view failed')

  console.log('\n[Doctor] view ✅, create ❌, update ❌')
  const dView = await call(`/inpatient?resource=vitals&admissionId=${adm.id}`, { headers: H('doctor') })
  if (dView.ok && dView.body.data.length) PASS('doctor VIEW vitals ✅'); else FAIL('doctor view failed')
  const dCreate = await call('/inpatient', { method: 'POST', headers: H('doctor'), body: JSON.stringify(V()) })
  if (dCreate.status === 403) PASS('doctor CREATE vitals BLOCKED ❌ (403)'); else FAIL(`doctor created vitals (${dCreate.status})`)
  const dUpdate = await call('/inpatient', { method: 'PATCH', headers: H('doctor'), body: JSON.stringify({ resource: 'vitals', id: vid, systolicBp: 200 }) })
  if (dUpdate.status === 403) PASS('doctor UPDATE vitals BLOCKED ❌ (403)'); else FAIL(`doctor updated vitals (${dUpdate.status})`)

  // cleanup
  await db.vitalsRecord.deleteMany({ where: { admissionId: adm.id } })
  await db.dischargeClearance.deleteMany({ where: { admissionId: adm.id } })
  await db.bedOccupancy.deleteMany({ where: { admissionId: adm.id } })
  await db.patientTariff.deleteMany({ where: { admissionId: adm.id } })
  await db.ipdCharge.deleteMany({ where: { admissionId: adm.id } })
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: adm.id }, { newValues: { contains: adm.id } }, { entityId: vid }] } })
  await db.bed.update({ where: { id: bed.id }, data: { status: 'available' } })
  await db.admission.delete({ where: { id: adm.id } }).catch(() => {})
  console.log('\ncleaned up')
  process.exit()
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
