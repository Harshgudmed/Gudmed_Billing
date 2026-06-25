// Verifies hidden dynamic pharmacy pricing: base from catalog → ward markup → GST,
// auto-pop, role-gated breakdown, posting + running-bill integration.
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const API = 'http://localhost:5000/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const PASS = (m) => console.log('  ✓ ' + m)
const FAIL = (m) => { console.log('  ✗ FAIL: ' + m); process.exitCode = 1 }
const H = (role = 'admin') => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id: 'test-' + role, role, organizationId: ORG, email: role + '@t' }, SECRET) })
async function call(path, opts) { const r = await fetch(API + path, opts); const b = await r.json().catch(() => ({})); return { status: r.status, ok: r.ok, body: b } }

async function main() {
  const drug = await db.pharmacyDrug.findFirst({ where: { organizationId: ORG, drugName: 'Paracetamol 500mg' } })
  console.log(`Drug: ${drug.drugName} · selling ₹${drug.sellingPrice} · GST ${drug.gstRate}%`)
  const wards = (await call('/inpatient?resource=wards', { headers: H() })).body.data
  const findBed = async (type) => { const w = wards.find((x) => (x.type || '').toLowerCase() === type); const b = (await call(`/inpatient?resource=beds&wardId=${w.id}&status=available`, { headers: H() })).body.data[0]; return { w, b } }
  const pat = (await call('/patients?limit=1', { headers: H() })).body.data[0]

  // Admit into a PRIVATE room (expect +20% pharmacy markup)
  const pvt = await findBed('private')
  const adm = (await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'admission', patientId: pat.id, bedId: pvt.b.id, admissionDiagnosis: 'PHARM', chiefComplaint: 'x' }) })).body.data
  console.log(`Admitted into ${pvt.w.name}`)

  console.log('\n[Auto-pop] price reflects ward markup automatically (Private +20%)')
  const q = 10
  const priced = (await call(`/inpatient?resource=pharmacy-price&admissionId=${adm.id}&drugId=${drug.id}&quantity=${q}`, { headers: H() })).body.data
  const expectedUnit = Math.round(drug.sellingPrice * 1.2 * 100) / 100  // +20%
  const expectedSub = Math.round(expectedUnit * q * 100) / 100
  const expectedTax = Math.round(expectedSub * drug.gstRate / 100 * 100) / 100
  const expectedTotal = Math.round((expectedSub + expectedTax) * 100) / 100
  if (priced.unitPrice === expectedUnit) PASS(`unit ₹${priced.unitPrice} = base ₹${drug.sellingPrice} +20% (auto)`); else FAIL(`unit ₹${priced.unitPrice}, expected ₹${expectedUnit}`)
  if (priced.lineTotal === expectedTotal) PASS(`qty ${q} → subtotal ₹${priced.lineSubtotal} + GST ₹${priced.taxAmount} = ₹${priced.lineTotal}`); else FAIL(`lineTotal ₹${priced.lineTotal}, expected ₹${expectedTotal}`)

  console.log('\n[Role visibility] breakdown hidden from normal users, shown to admin')
  const asNurse = (await call(`/inpatient?resource=pharmacy-price&admissionId=${adm.id}&drugId=${drug.id}&quantity=1`, { headers: H('doctor') })).body.data
  const asAdmin = (await call(`/inpatient?resource=pharmacy-price&admissionId=${adm.id}&drugId=${drug.id}&quantity=1`, { headers: H('admin') })).body.data
  if (!asNurse.breakdown && asNurse.unitPrice) PASS('normal user sees final price only (no breakdown)'); else FAIL('breakdown leaked to normal user')
  if (asAdmin.breakdown && asAdmin.breakdown.basePrice === drug.sellingPrice) PASS(`admin sees breakdown: base ₹${asAdmin.breakdown.basePrice}, markup ${asAdmin.breakdown.markup?.value}%`); else FAIL('admin breakdown missing')

  console.log('\n[Dynamic on ward change] same drug in General = 0% markup')
  // Transfer to General and re-price
  const gen = await findBed('general')
  await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'transfer', admissionId: adm.id, toWardId: gen.w.id, toBedId: gen.b.id, transferReason: 'reprice test' }) })
  const genPrice = (await call(`/inpatient?resource=pharmacy-price&admissionId=${adm.id}&drugId=${drug.id}&quantity=1`, { headers: H() })).body.data
  if (genPrice.unitPrice === drug.sellingPrice) PASS(`after transfer to General, unit ₹${genPrice.unitPrice} = base (0% markup) — price auto-updated by ward`); else FAIL(`General unit ₹${genPrice.unitPrice}, expected ₹${drug.sellingPrice}`)

  console.log('\n[Post + bill] pharmacy charge posts with GST and appears in running bill')
  await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, pharmacyDrugId: drug.id, quantity: 4, sourceModule: 'PHARMACY', sourceRef: 'dispense-1' }) })
  const dup = await call('/inpatient', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, pharmacyDrugId: drug.id, quantity: 4, sourceModule: 'PHARMACY', sourceRef: 'dispense-1' }) })
  const bill = (await call(`/inpatient?resource=running-bill&admissionId=${adm.id}`, { headers: H() })).body.data
  const pharmLine = bill.serviceCharges.lines.find((l) => l.serviceGroup === 'PHARMACY')
  if (pharmLine) PASS(`pharmacy line in bill: ${pharmLine.description} ₹${pharmLine.unitPrice}×${pharmLine.quantity}, tax ${pharmLine.taxPct}% = ₹${pharmLine.tax}`); else FAIL('pharmacy charge missing from bill')
  if (dup.body.deduped) PASS('duplicate dispense (same sourceRef) deduped'); else FAIL('idempotency failed')
  if (bill.taxTotal > 0) PASS(`GST applied in bill: taxTotal ₹${bill.taxTotal}, grand ₹${bill.grandTotal}`); else FAIL('GST not in bill total')

  // cleanup (Restrict FKs → children first)
  await db.ipdCharge.deleteMany({ where: { admissionId: adm.id } })
  await db.dischargeClearance.deleteMany({ where: { admissionId: adm.id } })
  await db.bedOccupancy.deleteMany({ where: { admissionId: adm.id } })
  await db.patientTariff.deleteMany({ where: { admissionId: adm.id } })
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: adm.id }, { newValues: { contains: adm.id } }] } })
  await db.housekeepingTask.deleteMany({ where: { bedId: { in: [pvt.b.id, gen.b.id] }, status: { not: 'DONE' } } })
  await db.bed.updateMany({ where: { id: { in: [pvt.b.id, gen.b.id] } }, data: { status: 'available' } })
  await db.admission.delete({ where: { id: adm.id } }).catch(() => {})
  console.log('\ncleaned up')
  process.exit()
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
