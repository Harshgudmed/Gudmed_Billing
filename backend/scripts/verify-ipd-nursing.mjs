// End-to-end verification of Phase 2 (nursing station) against the running API.
const API = 'http://localhost:5000/api'
async function j(path, opts) {
  const r = await fetch(API + path, opts)
  const b = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(b)}`)
  return b
}
async function main() {
  const login = await j('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@gudmed.in', password: 'Gudmed@123' }) })
  const token = login.token || login.data?.token
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }

  const wards = (await j('/inpatient?resource=wards', { headers: H })).data
  const ward = wards.find((w) => (w.beds || []).some((b) => b.status === 'available'))
  const bed = (await j(`/inpatient?resource=beds&wardId=${ward.id}&status=available`, { headers: H })).data[0]
  const patient = (await j('/patients?limit=1', { headers: H })).data[0]
  const adm = (await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'admission', patientId: patient.id, bedId: bed.id, admissionType: 'elective', admissionDiagnosis: 'NURSING VERIFY', chiefComplaint: 'test' }) })).data
  console.log(`Admitted #${adm.id} for nursing tests`)

  // 1) Critical vitals → expect HIGH
  const crit = (await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'vitals', admissionId: adm.id, respiratoryRate: 28, spo2: 90, systolicBp: 85, heartRate: 135, tempC: 39.5, consciousness: 'VOICE' }) })).data
  console.log(`[1] Critical vitals → NEWS ${crit.newsScore} / ${crit.newsRisk} [expect HIGH, score ~17]`)

  // 2) Normal vitals → expect LOW
  const norm = (await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'vitals', admissionId: adm.id, respiratoryRate: 16, spo2: 98, systolicBp: 120, heartRate: 75, tempC: 37.0, consciousness: 'ALERT' }) })).data
  console.log(`[2] Normal vitals → NEWS ${norm.newsScore} / ${norm.newsRisk} [expect LOW, score 0]`)

  const vlist = (await j(`/inpatient?resource=vitals&admissionId=${adm.id}`, { headers: H })).data
  console.log(`    vitals list count: ${vlist.length} [expect 2]`)

  // 3) Clinical note v2
  await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'note-v2', admissionId: adm.id, noteType: 'DOCTOR', body: 'Patient stable post-round. Continue IV antibiotics.', authorName: 'Dr Test' }) })
  const notes = (await j(`/inpatient?resource=clinical-notes-v2&admissionId=${adm.id}`, { headers: H })).data
  console.log(`[3] Clinical notes (table) count: ${notes.length} [expect 1] → "${notes[0]?.body?.slice(0, 30)}..."`)

  // 4) eMAR — GIVEN + MISSED
  await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'medication-administration', admissionId: adm.id, drugName: 'Paracetamol 650mg', route: 'Oral', status: 'GIVEN', nurseName: 'Nurse Test' }) })
  await j('/inpatient', { method: 'POST', headers: H, body: JSON.stringify({ resource: 'medication-administration', admissionId: adm.id, drugName: 'Ceftriaxone 1g', route: 'IV', status: 'MISSED', reason: 'IV access lost', nurseName: 'Nurse Test' }) })
  const mar = (await j(`/inpatient?resource=medication-administration&admissionId=${adm.id}`, { headers: H })).data
  console.log(`[4] eMAR records: ${mar.length} [expect 2] → statuses: ${mar.map((m) => `${m.drugName}=${m.status}`).join(', ')}`)
  const given = mar.find((m) => m.status === 'GIVEN')
  console.log(`    GIVEN has administeredAt: ${!!given?.administeredAt}`)

  console.log('CLEANUP_ADMISSION_ID=' + adm.id)
}
main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1) })
