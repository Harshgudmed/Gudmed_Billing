// Verifies the audit fixes by ATTEMPTING the exploits/bugs and asserting they're blocked.
const API = 'http://localhost:5000/api'
async function call(path, opts) {
  const r = await fetch(API + path, opts)
  const b = await r.json().catch(() => ({}))
  return { status: r.status, ok: r.ok, body: b }
}
const PASS = (m) => console.log('  ✓ ' + m)
const FAIL = (m) => { console.log('  ✗ FAIL: ' + m); process.exitCode = 1 }

async function main() {
  const login = await call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@gudmed.in', password: 'Gudmed@123' }) })
  const token = login.body.token || login.body.data?.token
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }

  const wards = (await call('/inpatient?resource=wards', { headers: H })).body.data
  const pvt = wards.find((w) => (w.type || '').toLowerCase() === 'private')
  const icu = wards.find((w) => (w.type || '').toLowerCase() === 'icu')
  const bed = (await call(`/inpatient?resource=beds&wardId=${pvt.id}&status=available`, { headers: H })).body.data[0]
  const bed2 = (await call(`/inpatient?resource=beds&wardId=${pvt.id}&status=available`, { headers: H })).body.data[1]
  const icuBed = (await call(`/inpatient?resource=beds&wardId=${icu.id}&status=available`, { headers: H })).body.data[0]
  const patient = (await call('/patients?limit=2', { headers: H })).body.data[0]
  const patient2 = (await call('/patients?limit=2', { headers: H })).body.data[1]
  const created = []

  console.log('\n[C3] Bed double-booking race (two admits, same bed, concurrent)')
  const [r1, r2] = await Promise.all([
    call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'admission', patientId: patient.id, bedId: bed.id, admissionDiagnosis: 'race A', chiefComplaint: 'x' }) }),
    call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'admission', patientId: patient2.id, bedId: bed.id, admissionDiagnosis: 'race B', chiefComplaint: 'x' }) }),
  ])
  const wins = [r1, r2].filter((r) => r.ok)
  const losers = [r1, r2].filter((r) => !r.ok)
  if (wins.length === 1 && losers[0]?.body?.code === 'IPD_BED_UNAVAILABLE') PASS('exactly one admit won; the other got 409 IPD_BED_UNAVAILABLE')
  else FAIL(`double-booking not prevented (wins=${wins.length})`)
  wins.forEach((w) => created.push(w.body.data.id))
  const adm = wins[0].body.data

  console.log('\n[H4] Duplicate active admission for same patient')
  const dup = await call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'admission', patientId: adm.patient?.id || patient.id, bedId: bed2.id, admissionDiagnosis: 'dup', chiefComplaint: 'x' }) })
  if (dup.status === 409 && dup.body.code === 'IPD_PATIENT_ALREADY_ADMITTED') PASS('second active admission for same patient blocked (409)')
  else FAIL(`duplicate admission not blocked (status ${dup.status})`)

  console.log('\n[C1] Mass-assignment: try to zero the bill + change org via generic update')
  await call('/inpatient', { method: 'PATCH', headers: H, body: JSON.stringify({ resource: 'admission', id: adm.id, organizationId: 'attacker-org', totalBillAmount: 0, billGenerated: true, status: 'discharged' }) })
  const check = (await call('/inpatient?resource=admissions&status=admitted', { headers: H })).body.data.find((a) => a.id === adm.id)
  if (check && check.status === 'admitted' && !check.billGenerated) PASS('protected fields (org/bill/status) were NOT changed via generic update')
  else FAIL('mass-assignment succeeded — protected fields changed')

  console.log('\n[H3] Same-day transfer should bill 1 day total, not 2')
  await call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'transfer', admissionId: adm.id, toWardId: icu.id, toBedId: icuBed.id, transferReason: 'same-day escalation' }) })
  const bill = (await call(`/inpatient?resource=running-bill&admissionId=${adm.id}`, { headers: H })).body.data
  const bedDays = bill.bedCharges.totalDays
  if (bedDays === 1) PASS(`same-day admit+transfer billed ${bedDays} bed-day (segments: ${bill.bedCharges.lines.length})`)
  else FAIL(`same-day transfer billed ${bedDays} bed-days (expected 1)`)

  console.log('\n[M5] Tax fields present on running bill')
  if ('taxTotal' in bill && 'subtotal' in bill) PASS(`bill exposes subtotal ₹${bill.subtotal} + tax ₹${bill.taxTotal} = grand ₹${bill.grandTotal}`)
  else FAIL('tax/subtotal missing from bill')

  console.log('\n[H2] Idempotency is org-scoped (re-post same sourceRef dedupes within org)')
  await call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, base: 500, description: 'XRay', serviceGroup: 'RADIOLOGY', sourceModule: 'RAD', sourceRef: 'x1' }) })
  const re = await call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'post-charge', admissionId: adm.id, base: 500, description: 'XRay', serviceGroup: 'RADIOLOGY', sourceModule: 'RAD', sourceRef: 'x1' }) })
  if (re.body.deduped === true) PASS('duplicate source charge deduped')
  else FAIL('idempotency failed')

  console.log('\n[C5] Legacy discharge endpoint cannot bypass an initiated clearance gate')
  await call('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'discharge-initiate', admissionId: adm.id }) })
  const legacy = await call('/inpatient', { method: 'PATCH', headers: H, body: JSON.stringify({ resource: 'discharge', id: adm.id, dischargeDiagnosis: 'x', dischargeCondition: 'Improved' }) })
  if (legacy.status === 409 && legacy.body.code === 'IPD_DISCHARGE_BLOCKED_CLEARANCE') PASS('legacy discharge blocked by pending clearances (409)')
  else FAIL(`legacy discharge bypassed the gate (status ${legacy.status})`)

  console.log('\n[H1] Cross-tenant read: running-bill for a non-existent/foreign admission id')
  const foreign = await call('/inpatient?resource=running-bill&admissionId=cmZZZZforeignZZZ', { headers: H })
  if (foreign.status === 404) PASS('unknown/foreign admissionId rejected (404)')
  else FAIL(`foreign admission billing returned ${foreign.status}`)

  console.log('\nCLEANUP_IDS=' + created.join(','))
}
main().catch((e) => { console.error('VERIFY ERROR:', e.message); process.exit(1) })
