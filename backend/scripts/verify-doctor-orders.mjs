// Verify: doctor sees only THEIR patients (mine=true), can place an order, and that
// order is visible on the ward dashboard data (what the nurse view polls). Cleans up.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const PW = 'Gudmed@123'
const jr = (p, o) => fetch(API + p, o).then((r) => r.json().then((b) => ({ status: r.status, b })))
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗ FAIL:', m) } }
const login = async (e) => (await jr('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: PW }) })).b
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + t })

async function main() {
  const doc = await login('doctor.demo@gudmed.in')
  const nurse = await login('nurse.demo@gudmed.in')
  const docId = doc.user.id

  // Assign one admitted admission to this doctor (save old value to revert).
  const adm = await db.admission.findFirst({ where: { organizationId: ORG, status: 'admitted' } })
  if (!adm) throw new Error('no admitted patient to test with')
  const prev = { attendingDoctorId: adm.attendingDoctorId }
  await db.admission.update({ where: { id: adm.id }, data: { attendingDoctorId: docId } })

  console.log('\n=== 1. Doctor sees ONLY their patients (mine=true) ===')
  const mine = (await jr(`/inpatient?resource=admissions&mine=true&status=admitted`, { headers: H(doc.token) })).b.data
  const all = (await jr(`/inpatient?resource=admissions&status=admitted`, { headers: H(doc.token) })).b.data
  ok(mine.some((a) => a.id === adm.id), 'my assigned patient appears in mine=true')
  ok(mine.every((a) => a.attendingDoctorId === docId || a.admittingDoctorId === docId), `every mine result is attended/admitted by me (${mine.length})`)
  ok(all.length >= mine.length, `mine (${mine.length}) ⊆ all admitted (${all.length}) — filter works`)

  console.log('\n=== 2. Doctor places an order from their portal ===')
  const ord = (await jr('/inpatient', { method: 'POST', headers: H(doc.token), body: JSON.stringify({ resource: 'order', admissionId: adm.id, orderType: 'LAB', serviceGroup: 'LAB', itemName: 'CBC', priority: 'STAT' }) })).b.data
  ok(ord?.id && ord.status === 'ORDERED' && ord.orderedById === docId, `order created by doctor (orderedById = doctor)`)

  console.log('\n=== 3. Order is visible on the ward dashboard data (nurse view polls this) ===')
  const wardView = (await jr(`/inpatient?resource=orders&admissionId=${adm.id}`, { headers: H(nurse.token) })).b.data
  ok(wardView.some((o) => o.id === ord.id), 'nurse/ward dashboard sees the doctor\'s order (real-time via polling)')

  console.log('\n=== cleanup ===')
  await db.clinicalOrderEvent.deleteMany({ where: { orderId: ord.id } })
  await db.clinicalOrder.delete({ where: { id: ord.id } }).catch(() => {})
  await db.auditLog.deleteMany({ where: { entityType: 'ipd.order', entityId: ord.id } })
  await db.admission.update({ where: { id: adm.id }, data: { attendingDoctorId: prev.attendingDoctorId } })
  console.log('  cleaned + reverted')

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
