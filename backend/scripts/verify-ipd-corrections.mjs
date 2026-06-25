// Verifies this correction batch: C5 single discharge gate, clinical retention
// (Restrict FK), C7 production fail-closed, and DB indexes present.
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const PASS = (m) => console.log('  ✓ ' + m)
const FAIL = (m) => { console.log('  ✗ FAIL: ' + m); process.exitCode = 1 }
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: 'test-admin', role: 'admin', organizationId: ORG, email: 'a@t' }, SECRET) }
async function call(path, opts) { const r = await fetch(API + path, opts); const b = await r.json().catch(() => ({})); return { status: r.status, ok: r.ok, body: b } }

async function main() {
  const wards = (await call('/inpatient?resource=wards', { headers: H })).body.data
  const ward = wards.find((w) => (w.beds || []).some((b) => b.status === 'available'))
  const bed = (await call(`/inpatient?resource=beds&wardId=${ward.id}&status=available`, { headers: H })).body.data[0]
  const pat = (await call('/patients?limit=1', { headers: H })).body.data[0]
  const adm = (await call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'admission', patientId: pat.id, bedId: bed.id, admissionDiagnosis: 'CORRECTIONS', chiefComplaint: 'x' }) })).body.data

  console.log('\n[C5] Legacy discharge can no longer bypass clearances')
  const legacy = await call('/inpatient', { method: 'PATCH', headers: H, body: JSON.stringify({ resource: 'discharge', id: adm.id, dischargeDiagnosis: 'x', dischargeCondition: 'Improved' }) })
  if (legacy.status === 409 && legacy.body.code === 'IPD_DISCHARGE_BLOCKED_CLEARANCE') PASS(`legacy discharge auto-required clearances (409; pending ${legacy.body.pending?.join(',')})`)
  else FAIL(`legacy discharge bypassed clearances (status ${legacy.status})`)

  console.log('\n[Retention] Admission with clinical/billing records cannot be hard-deleted')
  await call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, base: 500, description: 'X', serviceGroup: 'PROCEDURE' }) })
  await call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'vitals', admissionId: adm.id, heartRate: 80 }) })
  let blocked = false
  try { await db.admission.delete({ where: { id: adm.id } }) } catch (e) { blocked = e.code === 'P2003' || /constraint|foreign key/i.test(e.message) }
  if (blocked) PASS('admission delete blocked by Restrict FK while records exist (medico-legal retention)')
  else FAIL('admission with records was hard-deleted (Restrict not enforced)')

  console.log('\n[C7] Production fail-closed + JWT validation logic')
  const mod = await import('../src/config/security.js')
  // Simulate production with a weak secret → must throw
  const origEnv = process.env.NODE_ENV, origSecret = process.env.JWT_SECRET
  process.env.NODE_ENV = 'production'; process.env.JWT_SECRET = 'change-me-in-production'
  let threw = false
  try { mod.assertSecurityConfig() } catch { threw = true }
  process.env.NODE_ENV = origEnv; process.env.JWT_SECRET = origSecret
  if (threw) PASS('production boot refuses a known-default JWT_SECRET'); else FAIL('weak secret accepted in production')

  console.log('\n[Indexes] DB partial-unique guards present')
  const idx = await db.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE indexname IN ('uniq_active_admission_per_patient','uniq_open_occupancy_per_bed')")
  if (idx.length === 2) PASS('both DB partial-unique indexes present'); else FAIL(`${idx.length}/2 indexes present`)

  // cleanup (delete children first because of Restrict)
  await db.ipdCharge.deleteMany({ where: { admissionId: adm.id } })
  await db.vitalsRecord.deleteMany({ where: { admissionId: adm.id } })
  await db.dischargeClearance.deleteMany({ where: { admissionId: adm.id } })
  await db.bedOccupancy.deleteMany({ where: { admissionId: adm.id } })
  await db.patientTariff.deleteMany({ where: { admissionId: adm.id } })
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: adm.id }, { newValues: { contains: adm.id } }] } })
  if (bed) await db.bed.update({ where: { id: bed.id }, data: { status: 'available' } })
  await db.housekeepingTask.deleteMany({ where: { bedId: bed.id, status: { not: 'DONE' } } })
  await db.admission.delete({ where: { id: adm.id } }).catch(() => {})
  console.log('\ncleaned up')
  process.exit()
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
