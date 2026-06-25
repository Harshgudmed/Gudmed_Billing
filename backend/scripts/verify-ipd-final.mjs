// Final adversarial regression: re-attempts the residual exploits + verifies DB-level guards.
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const PASS = (m) => console.log('  ✓ ' + m)
const FAIL = (m) => { console.log('  ✗ FAIL: ' + m); process.exitCode = 1 }
const tok = (role) => jwt.sign({ id: `test-${role}`, role, organizationId: ORG, email: `${role}@t` }, SECRET)
const H = (role = 'admin') => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(role) })
async function call(path, opts) { const r = await fetch(API + path, opts); const b = await r.json().catch(() => ({})); return { status: r.status, ok: r.ok, body: b } }

async function main() {
  const wards = (await call('/inpatient?resource=wards', { headers: H() })).body.data
  const ward = wards.find((w) => (w.beds || []).filter((b) => b.status === 'available').length >= 3)
  const free = (await call(`/inpatient?resource=beds&wardId=${ward.id}&status=available`, { headers: H() })).body.data
  const pat = (await call('/patients?limit=1', { headers: H() })).body.data[0]
  const created = []

  console.log('\n[C1-residual] Legacy billing resource cannot zero a bill cross-tenant / on unknown id')
  const foreignBill = await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'billing', admissionId: 'cmFOREIGNxxxx', dailyRate: 0 }) })
  if (foreignBill.status === 404) PASS('billing on unknown/foreign admission → 404 (org-scoped)'); else FAIL(`billing accepted foreign id (${foreignBill.status})`)
  const foreignCharge = await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'charge', billingId: 'cmFOREIGNxxxx', name: 'x', amount: 1 }) })
  if (foreignCharge.status === 404) PASS('charge on unknown/foreign admission → 404 (org-scoped)'); else FAIL(`charge accepted foreign id (${foreignCharge.status})`)
  const foreignNote = await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'note', admissionId: 'cmFOREIGNxxxx', text: 'x' }) })
  if (foreignNote.status === 404) PASS('note on unknown/foreign admission → 404 (org-scoped)'); else FAIL(`note accepted foreign id (${foreignNote.status})`)

  console.log('\n[H4 DB-guard] 3 concurrent admits, same patient, different beds → only 1 wins')
  const results = await Promise.all([0, 1, 2].map((i) =>
    call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'admission', patientId: pat.id, bedId: free[i].id, admissionDiagnosis: 'race ' + i, chiefComplaint: 'x' }) })
  ))
  const ok = results.filter((r) => r.ok)
  ok.forEach((r) => created.push(r.body.data.id))
  if (ok.length === 1) PASS(`exactly 1 of 3 concurrent same-patient admits succeeded (DB partial-unique held)`); else FAIL(`${ok.length} concurrent same-patient admits succeeded (expected 1)`)
  const adm = ok[0]?.body.data

  console.log('\n[C3 DB-guard] partial-unique open-occupancy index exists')
  const idx = await db.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE indexname IN ('uniq_active_admission_per_patient','uniq_open_occupancy_per_bed')")
  if (idx.length === 2) PASS('both DB partial-unique indexes present'); else FAIL(`only ${idx.length}/2 DB guards present`)

  if (adm) {
    console.log('\n[H8] Clinical writes (vitals/note/mar) now audited')
    await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'vitals', admissionId: adm.id, systolicBp: 120, heartRate: 78 }) })
    await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'note-v2', admissionId: adm.id, body: 'audit test note' }) })
    await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'medication-administration', admissionId: adm.id, drugName: 'Test 1g', status: 'GIVEN' }) })
    const logs = await db.auditLog.findMany({ where: { organizationId: ORG, entityType: { in: ['ipd.vitals', 'ipd.note', 'ipd.medication-administration'] }, newValues: { contains: adm.id } } })
    const types = [...new Set(logs.map((l) => l.entityType))]
    if (types.length === 3) PASS(`clinical audit present: ${types.join(', ')}`); else FAIL(`clinical audit incomplete: ${types.join(', ')}`)
  }

  console.log('\nCLEANUP=' + created.join(','))
  process.exit()
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
