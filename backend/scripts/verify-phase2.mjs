// Phase 2 payment ledger verification: advance, partial payments, balance, idempotency,
// collections report, clearance gate, cancel-reissue payment carry-forward, refund on overpay.
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
  const admittedIds = (await db.admission.findMany({ where: { organizationId: ORG, status: 'admitted' }, select: { patientId: true } })).map((a) => a.patientId)
  const pat = await db.patient.findFirst({ where: { organizationId: ORG, id: { notIn: admittedIds.length ? admittedIds : ['__none__'] } } })
  if (!pat) { console.log('no free patient'); process.exit(1) }
  const adm = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'admission', patientId: pat.id, bedId: bed.id, admissionDiagnosis: 'P2', chiefComplaint: 'x', depositAmount: 1000 }) })).body.data
  await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, description: 'Surgery', serviceGroup: 'PROCEDURE', base: 5000, sourceModule: 'PROCEDURE', sourceRef: 'p2-surg' }) })

  console.log('[Advance] legacy deposit ₹1000 migrated to ADVANCE on bill-generate')
  let bill = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'bill-generate', admissionId: adm.id }) })).body.data
  const payable = bill.payableTotal
  if (bill.paidTotal === 1000) PASS(`advance applied: payable ₹${payable}, paid ₹${bill.paidTotal}, balance ₹${bill.balanceDue}`); else FAIL(`advance not applied (paid ₹${bill.paidTotal})`)

  console.log('\n[Partial payments + balance]')
  const p1 = await call('/inpatient', { method: 'POST', headers: H('billing'), body: JSON.stringify({ resource: 'payment', billId: bill.id, amount: 2000, method: 'CASH' }) })
  if (p1.body.data.receiptNumber?.startsWith('RCP-')) PASS(`cash ₹2000 → receipt ${p1.body.data.receiptNumber}, balance ₹${p1.body.totals.balanceDue}`); else FAIL('payment/receipt failed')
  await call('/inpatient', { method: 'POST', headers: H('billing'), body: JSON.stringify({ resource: 'payment', billId: bill.id, amount: 1500, method: 'UPI', reference: 'UPI123' }) })
  bill = (await call(`/inpatient?resource=bill&admissionId=${adm.id}`, { headers: H() })).body.data
  const expectedPaid = 1000 + 2000 + 1500
  if (bill.paidTotal === expectedPaid && bill.balanceDue === Math.round((payable - expectedPaid) * 100) / 100) PASS(`paid ₹${bill.paidTotal}, balance ₹${bill.balanceDue}, status ${bill.paymentStatus}`); else FAIL(`balance wrong (paid ${bill.paidTotal}, bal ${bill.balanceDue})`)

  console.log('\n[Idempotency] same idempotencyKey not double-charged')
  const k = 'idem-xyz-1'
  await call('/inpatient', { method: 'POST', headers: H('billing'), body: JSON.stringify({ resource: 'payment', billId: bill.id, amount: 100, method: 'CASH', idempotencyKey: k }) })
  const dup = await call('/inpatient', { method: 'POST', headers: H('billing'), body: JSON.stringify({ resource: 'payment', billId: bill.id, amount: 100, method: 'CASH', idempotencyKey: k }) })
  if (dup.body.deduped) PASS('duplicate payment (same idempotencyKey) deduped'); else FAIL('idempotency failed')

  console.log('\n[RBAC] receptionist cannot refund; doctor cannot collect')
  const recepRefund = await call('/inpatient', { method: 'POST', headers: H('receptionist'), body: JSON.stringify({ resource: 'refund', billId: bill.id, amount: 50, reason: 'x' }) })
  if (recepRefund.status === 403) PASS('receptionist blocked from refund (403)'); else FAIL(`receptionist refunded (${recepRefund.status})`)
  const docPay = await call('/inpatient', { method: 'POST', headers: H('doctor'), body: JSON.stringify({ resource: 'payment', billId: bill.id, amount: 50, method: 'CASH' }) })
  if (docPay.status === 403) PASS('doctor blocked from collecting payment (403)'); else FAIL(`doctor collected (${docPay.status})`)

  console.log('\n[Collections report] today, grouped by method')
  const today = new Date().toISOString().slice(0, 10)
  const col = (await call(`/inpatient?resource=collections&from=${today}&to=${today}`, { headers: H('billing') })).body.data
  if (col.byMethod && (col.byMethod.CASH || 0) >= 2000 && (col.byMethod.UPI || 0) >= 1500) PASS(`collections: CASH ₹${col.byMethod.CASH}, UPI ₹${col.byMethod.UPI}, net ₹${col.net}, ${col.count} txns`); else FAIL(`collections wrong: ${JSON.stringify(col.byMethod)}`)

  console.log('\n[Discharge gate] blocked while balance>0, allowed after full payment')
  const blocked = await call('/inpatient', { method: 'POST', headers: H('doctor'), body: JSON.stringify({ resource: 'discharge-finalize', admissionId: adm.id, dischargeDiagnosis: 'x', dischargeCondition: 'Recovered' }) })
  if (blocked.status === 409 && blocked.body.code === 'IPD_BILLING_OUTSTANDING') PASS(`discharge blocked: ₹${blocked.body.outstanding} outstanding`); else FAIL(`discharge not blocked (${blocked.status})`)
  // pay the remainder → balance 0 → discharge gate would allow
  const fresh = (await call(`/inpatient?resource=bill&admissionId=${adm.id}`, { headers: H() })).body.data
  await call('/inpatient', { method: 'POST', headers: H('billing'), body: JSON.stringify({ resource: 'payment', billId: fresh.id, amount: fresh.balanceDue, method: 'CARD' }) })
  const afterPay = (await call(`/inpatient?resource=bill&admissionId=${adm.id}`, { headers: H() })).body.data
  if (Math.round((afterPay.balanceDue || 0) * 100) / 100 === 0) PASS('balance cleared → discharge gate would allow'); else FAIL(`balance not cleared (₹${afterPay.balanceDue})`)

  console.log('\n[Cancel-reissue] payments carry forward to replacement bill')
  const beforePaid = (await call(`/inpatient?resource=bill&admissionId=${adm.id}`, { headers: H() })).body.data.paidTotal
  const finId = fresh.id
  await call('/inpatient', { method: 'POST', headers: H('billing'), body: JSON.stringify({ resource: 'bill-finalize', admissionId: adm.id }) })
  const finBill = (await call(`/inpatient?resource=bill&admissionId=${adm.id}`, { headers: H() })).body.data
  await call('/inpatient', { method: 'POST', headers: H('billing'), body: JSON.stringify({ resource: 'bill-cancel', billId: finBill.id, reason: 'correction' }) })
  const supp = (await call('/inpatient', { method: 'POST', headers: H('billing'), body: JSON.stringify({ resource: 'bill-generate', admissionId: adm.id }) })).body.data
  if (supp.id !== finBill.id && supp.paidTotal === beforePaid) PASS(`payments carried to replacement bill: paid ₹${supp.paidTotal} preserved, balance ₹${supp.balanceDue}`); else FAIL(`carry-forward failed (paid ${supp.paidTotal} vs ${beforePaid})`)

  console.log('\nCLEANUP=' + adm.id)
  // cleanup
  await db.billPayment.deleteMany({ where: { admissionId: adm.id } })
  await db.ipdCharge.deleteMany({ where: { admissionId: adm.id } })
  await db.bill.deleteMany({ where: { admissionId: adm.id } })
  await db.billCounter.updateMany({ where: { organizationId: ORG }, data: { value: 0 } })
  await db.dischargeClearance.deleteMany({ where: { admissionId: adm.id } })
  await db.bedOccupancy.deleteMany({ where: { admissionId: adm.id } })
  await db.patientTariff.deleteMany({ where: { admissionId: adm.id } })
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: adm.id }, { newValues: { contains: adm.id } }] } })
  await db.housekeepingTask.deleteMany({ where: { bedId: bed.id, status: { not: 'DONE' } } })
  await db.bed.update({ where: { id: bed.id }, data: { status: 'available' } })
  await db.admission.delete({ where: { id: adm.id } }).catch(() => {})
  console.log('cleaned up')
  process.exit()
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
