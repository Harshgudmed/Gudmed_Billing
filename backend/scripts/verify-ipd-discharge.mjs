// End-to-end verification of Phase 3 (discharge clearances + bed turnover + exits).
const API = 'http://localhost:5000/api'
async function j(path, opts) {
  const r = await fetch(API + path, opts)
  const b = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, body: b }
}
async function must(path, opts) {
  const r = await j(path, opts)
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}
async function main() {
  const login = await must('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@gudmed.in', password: 'Gudmed@123' }) })
  const token = login.token || login.data?.token
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }

  const wards = (await must('/inpatient?resource=wards', { headers: H })).data
  const ward = wards.find((w) => (w.beds || []).some((b) => b.status === 'available'))
  const bed = (await must(`/inpatient?resource=beds&wardId=${ward.id}&status=available`, { headers: H })).data[0]
  const patient = (await must('/patients?limit=1', { headers: H })).data[0]

  // ───── Scenario A: NORMAL clearance-gated discharge ─────
  const admA = (await must('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'admission', patientId: patient.id, bedId: bed.id, admissionType: 'elective', admissionDiagnosis: 'DISCHARGE VERIFY A', chiefComplaint: 'x' }) })).data
  console.log(`[A] Admitted #${admA.id} in bed ${bed.bedNumber}`)

  await must('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'discharge-initiate', admissionId: admA.id }) })
  const cl = (await must(`/inpatient?resource=clearances&admissionId=${admA.id}`, { headers: H })).data
  console.log(`    clearances created: ${cl.map((c) => c.type).join(', ')} [expect DOCTOR,NURSING,PHARMACY,BILLING]`)

  // Try to finalize with nothing cleared → expect 409 blocked
  const blocked = await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'discharge-finalize', admissionId: admA.id }) })
  console.log(`    finalize w/o clearances → HTTP ${blocked.status} ${blocked.body.code || ''} [expect 409 blocked], pending: ${blocked.body.pending?.join(',')}`)

  // Clear all four
  for (const t of ['DOCTOR', 'NURSING', 'PHARMACY', 'BILLING']) {
    await must('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'clearance', admissionId: admA.id, type: t, status: 'CLEARED', clearedByName: 'Test ' + t }) })
  }
  const fin = await must('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'discharge-finalize', admissionId: admA.id, dischargeDiagnosis: 'Resolved', dischargeCondition: 'Recovered' }) })
  console.log(`    finalize after clearances → state ${fin.data.admissionState}, dischargeType ${fin.data.dischargeType} [expect DISCHARGED/NORMAL]`)
  console.log(`    housekeeping task opened: ${!!fin.housekeepingTask} (status ${fin.housekeepingTask?.status})`)

  // Bed should now be DIRTY
  const bedAfter = (await must(`/inpatient?resource=beds&wardId=${ward.id}`, { headers: H })).data.find((b) => b.id === bed.id)
  console.log(`    bed status after discharge → ${bedAfter.status} [expect dirty]`)

  // Housekeeping worklist shows the dirty bed
  const hk = (await must(`/inpatient?resource=housekeeping&status=OPEN`, { headers: H })).data.find((t) => t.bedId === bed.id)
  console.log(`    housekeeping worklist has bed ${hk?.bedNumber} in ${hk?.wardName}`)

  // Clean it: IN_PROGRESS → DONE, bed returns to available
  await must('/inpatient', { method: 'PATCH', headers: H, body: JSON.stringify({ resource: 'housekeeping', id: hk.id, status: 'IN_PROGRESS', assignedToName: 'Housekeeper 1' }) })
  const cleaning = (await must(`/inpatient?resource=beds&wardId=${ward.id}`, { headers: H })).data.find((b) => b.id === bed.id)
  await must('/inpatient', { method: 'PATCH', headers: H, body: JSON.stringify({ resource: 'housekeeping', id: hk.id, status: 'DONE' }) })
  const ready = (await must(`/inpatient?resource=beds&wardId=${ward.id}`, { headers: H })).data.find((b) => b.id === bed.id)
  console.log(`    turnover: dirty → ${cleaning.status} → ${ready.status} [expect cleaning → available]`)

  // ───── Scenario B: LAMA quick exit (bypasses clearances) ─────
  const bed2 = (await must(`/inpatient?resource=beds&wardId=${ward.id}&status=available`, { headers: H })).data[0]
  const admB = (await must('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'admission', patientId: patient.id, bedId: bed2.id, admissionType: 'emergency', admissionDiagnosis: 'DISCHARGE VERIFY B', chiefComplaint: 'x' }) })).data
  const lama = await must('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'mark-exit', admissionId: admB.id, dischargeType: 'LAMA', reason: 'Patient left against advice' }) })
  console.log(`\n[B] LAMA exit #${admB.id} → state ${lama.data.admissionState}, dischargeType ${lama.data.dischargeType} [expect LAMA/LAMA], bed turnover: ${!!lama.housekeepingTask}`)

  console.log(`\nCLEANUP_A=${admA.id}`)
  console.log(`CLEANUP_B=${admB.id}`)
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1) })
