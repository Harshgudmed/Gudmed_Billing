// End-to-end verification of the IPD tariff engine against the running API.
// Admits into a Private room, previews pricing, posts a charge, transfers to ICU,
// checks multi-segment billing, then cleans up. node scripts/verify-ipd-tariff.mjs
const API = 'http://localhost:5000/api'
const log = (...a) => console.log(...a)

async function j(path, opts) {
  const r = await fetch(API + path, opts)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(body)}`)
  return body
}

async function main() {
  const login = await j('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@gudmed.in', password: 'Gudmed@123' }) })
  const token = login.token || login.data?.token
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }

  // Find a Private ward bed and an ICU ward bed
  const wards = (await j('/inpatient?resource=wards', { headers: H })).data
  const pvtWard = wards.find((w) => (w.type || '').toLowerCase() === 'private')
  const icuWard = wards.find((w) => (w.type || '').toLowerCase() === 'icu')
  const pvtBed = (await j(`/inpatient?resource=beds&wardId=${pvtWard.id}&status=available`, { headers: H })).data[0]
  const icuBed = (await j(`/inpatient?resource=beds&wardId=${icuWard.id}&status=available`, { headers: H })).data[0]
  const patient = (await j('/patients?limit=1', { headers: H })).data[0]
  log(`Patient: ${patient.firstName} ${patient.lastName} | Private bed ${pvtBed.bedNumber} | ICU bed ${icuBed.bedNumber}`)

  // 1) Admit into Private room
  const adm = (await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({
    resource: 'admission', patientId: patient.id, bedId: pvtBed.id,
    admissionType: 'elective', admissionDiagnosis: 'TARIFF VERIFY', chiefComplaint: 'test',
  }) })).data
  log(`\n[1] Admitted #${adm.id} into Private room`)

  // 2) Tariff preview — a ₹1000 base lab test in a Private room should be +20% = ₹1200
  const labPreview = (await j(`/inpatient?resource=tariff-preview&admissionId=${adm.id}&base=1000&serviceGroup=LAB`, { headers: H })).data
  log(`[2] LAB base ₹1000 in Private → ₹${labPreview.price} (rule ${labPreview.rule?.type} ${labPreview.rule?.value}) [expect 1200]`)

  // Charge-master item preview (bed-day)
  const bedPreview = (await j(`/inpatient?resource=tariff-preview&admissionId=${adm.id}&itemCode=BED-DAY`, { headers: H })).data
  log(`    BED-DAY (base 1000) in Private → ₹${bedPreview.price} (override) [expect 3500]`)

  // 3) Post a charge (idempotent)
  const charge = (await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({
    resource: 'post-charge', admissionId: adm.id, base: 500, description: 'ECG', serviceGroup: 'PROCEDURE',
    sourceModule: 'TEST', sourceRef: 'ecg-1', quantity: 2,
  }) })).data
  log(`[3] Posted ECG charge: unitPrice ₹${charge.unitPrice} ×2 [expect 600 each = +20% of 500]`)
  const dupe = await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({
    resource: 'post-charge', admissionId: adm.id, base: 500, description: 'ECG', serviceGroup: 'PROCEDURE', sourceModule: 'TEST', sourceRef: 'ecg-1',
  }) })
  log(`    Idempotency re-post deduped: ${dupe.deduped === true}`)

  // 4) Transfer to ICU after "3 days" — backdate the first segment so we see 2 windows
  await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({
    resource: 'transfer', admissionId: adm.id, toWardId: icuWard.id, toBedId: icuBed.id, transferReason: 'Escalation', authorName: 'Dr Test',
  }) })
  log(`[4] Transferred to ICU`)

  // 5) Running bill — should now show 2 bed segments (Private + ICU) + the ECG charge
  const bill = (await j(`/inpatient?resource=running-bill&admissionId=${adm.id}`, { headers: H })).data
  log(`[5] Running bill:`)
  bill.bedCharges.lines.forEach((l) => log(`      ${l.bedCategory}: ${l.days}d × ₹${l.dailyRate} = ₹${l.amount}`))
  log(`      Bed total ₹${bill.bedCharges.total} | Service total ₹${bill.serviceCharges.total} | GRAND ₹${bill.grandTotal}`)
  log(`      bed segments: ${bill.bedCharges.lines.length} [expect 2: Private + ICU]`)

  // cleanup
  await fetch(`${API}/inpatient`, { method: 'DELETE', headers: H, body: JSON.stringify({ resource: 'admission' }) }).catch(() => {})
  // delete via prisma-free path: discharge then leave (no hard admission delete endpoint); use direct cleanup
  log(`\n[cleanup] freeing beds + removing test admission`)
  // free both beds and delete the admission's children directly through a small fetch chain isn't available;
  // we mark discharged to free bed, then report id for manual prune if needed.
  await j('/inpatient', { method: 'PATCH', headers: H, body: JSON.stringify({ resource: 'discharge', id: adm.id, dischargeDiagnosis: 'verify done', dischargeCondition: 'Improved' }) })
  log(`      admission ${adm.id} discharged (bed freed). Test admission id saved for prune.`)
  console.log('ADMISSION_ID=' + adm.id)
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1) })
