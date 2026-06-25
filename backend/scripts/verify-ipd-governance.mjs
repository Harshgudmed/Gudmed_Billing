// Verifies C6 (RBAC), H8 (audit), M3 (billing balance gate), H7 (tariff warning).
// Mints role tokens directly (AUTH_ENFORCED=true) to test per-role permissions.
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const PASS = (m) => console.log('  ✓ ' + m)
const FAIL = (m) => { console.log('  ✗ FAIL: ' + m); process.exitCode = 1 }

const tok = (role) => jwt.sign({ id: `test-${role}`, role, organizationId: ORG, email: `${role}@test`, fullName: `Test ${role}` }, SECRET)
const H = (role) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(role) })
async function call(path, opts) { const r = await fetch(API + path, opts); const b = await r.json().catch(() => ({})); return { status: r.status, ok: r.ok, body: b } }

async function main() {
  const wards = (await call('/inpatient?resource=wards', { headers: H('admin') })).body.data
  const ward = wards.find((w) => (w.beds || []).some((b) => b.status === 'available'))
  const bed = (await call(`/inpatient?resource=beds&wardId=${ward.id}&status=available`, { headers: H('admin') })).body.data[0]
  const patient = (await call('/patients?limit=1', { headers: H('admin') })).body.data[0]

  console.log('\n[C6] Per-action RBAC')
  // doctor may NOT create/delete a ward
  const wardByDoctor = await call('/inpatient', { method: 'POST', headers: H('doctor'), body: JSON.stringify({ resource: 'ward', name: 'X', code: 'X', capacity: 1 }) })
  if (wardByDoctor.status === 403) PASS('doctor blocked from creating a ward (403)'); else FAIL(`doctor created ward (status ${wardByDoctor.status})`)
  // receptionist may NOT finalize a discharge
  const dischByRecep = await call('/inpatient', { method: 'POST', headers: H('receptionist'), body: JSON.stringify({ resource: 'discharge-finalize', admissionId: 'whatever' }) })
  if (dischByRecep.status === 403) PASS('receptionist blocked from discharge-finalize (403)'); else FAIL(`receptionist finalized discharge (status ${dischByRecep.status})`)
  // admin may admit
  const adm = await call('/inpatient', { method: 'POST', headers: H('admin'), body: JSON.stringify({ resource: 'admission', patientId: patient.id, bedId: bed.id, admissionDiagnosis: 'GOV VERIFY', chiefComplaint: 'x' }) })
  if (adm.ok) PASS('admin may admit'); else { FAIL('admin admit failed: ' + JSON.stringify(adm.body)); return }
  const admissionId = adm.body.data.id

  console.log('\n[M3] BILLING clearance blocked while cash balance outstanding')
  await call('/inpatient', { method: 'POST', headers: H('admin'), body: JSON.stringify({ resource: 'post-charge', admissionId, base: 5000, description: 'Procedure', serviceGroup: 'PROCEDURE' }) })
  await call('/inpatient', { method: 'POST', headers: H('admin'), body: JSON.stringify({ resource: 'discharge-initiate', admissionId }) })
  const billClear = await call('/inpatient', { method: 'POST', headers: H('admin'), body: JSON.stringify({ resource: 'clearance', admissionId, type: 'BILLING', status: 'CLEARED' }) })
  if (billClear.status === 409 && billClear.body.code === 'IPD_BILLING_OUTSTANDING') PASS(`BILLING clearance blocked: ₹${billClear.body.outstanding} outstanding`); else FAIL(`billing cleared despite balance (status ${billClear.status})`)
  const billForce = await call('/inpatient', { method: 'POST', headers: H('admin'), body: JSON.stringify({ resource: 'clearance', admissionId, type: 'BILLING', status: 'CLEARED', force: true }) })
  if (billForce.ok) PASS('BILLING clearance allowed with explicit force override'); else FAIL('force override did not work')

  console.log('\n[H7] Bill exposes tariff warnings array')
  const bill = (await call(`/inpatient?resource=running-bill&admissionId=${admissionId}`, { headers: H('admin') })).body.data
  if (Array.isArray(bill.warnings)) PASS(`bill.warnings present (${bill.warnings.length} warning(s))`); else FAIL('warnings array missing')

  console.log('\n[H8] NABH audit trail written for IPD actions')
  // Charges audit under the charge's own id; match those via newValues referencing the admission.
  const logs = await db.auditLog.findMany({ where: { organizationId: ORG, entityType: { startsWith: 'ipd.' }, OR: [{ entityId: admissionId }, { newValues: { contains: admissionId } }] }, orderBy: { performedAt: 'asc' } })
  const actions = logs.map((l) => `${l.action}/${l.userRole}`)
  const hasCreate = logs.some((l) => l.action === 'create' && l.entityType === 'ipd.admission')
  const hasCharge = logs.some((l) => l.action === 'charge')
  const hasClearance = logs.some((l) => l.action === 'clearance')
  if (hasCreate && hasCharge && hasClearance) PASS(`audit captured: ${actions.join(', ')}`); else FAIL(`audit incomplete: ${actions.join(', ')}`)
  const withRole = logs.find((l) => l.userRole)
  if (withRole) PASS(`audit records who (role=${withRole.userRole}) + before/after JSON`); else FAIL('audit missing userRole')

  console.log('\nCLEANUP_ID=' + admissionId)
  process.exit()
}
main().catch((e) => { console.error('VERIFY ERROR:', e.message); process.exit(1) })
