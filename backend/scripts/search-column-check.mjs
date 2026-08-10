// Does every column named in a search where-clause actually exist on that model?
// One commit standardised search across 11 modules; two of them named columns the
// model does not have, and each is a hard 400 on the first keystroke.
import fs from 'node:fs'
import path from 'node:path'

// Resolve from THIS file, not from the working directory. Run from backend/ the
// cwd-relative version looked for backend/backend/prisma and died with ENOENT —
// a check that only works from one directory is a check people stop running.
const ROOT = path.resolve(import.meta.dirname, '..', '..')
const schema = fs.readFileSync(path.join(ROOT, 'backend/prisma/schema.prisma'), 'utf8')
const models = {}
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  models[m[1]] = new Set([...m[2].matchAll(/^\s{2}(\w+)\s+\S/gm)].map((f) => f[1]))
}
// controller file -> prisma model it queries
const OWNER = {
  ambulance: 'AmbulanceTrip', appointment: 'Appointment', billing: 'Invoice',
  consultation: 'Consultation', dayCare: 'DayCareCase', deathCertificate: 'DeathCertificate',
  insurance: 'InsurancePolicy', laboratory: 'LabOrder', patient: 'Patient',
  preTriage: 'PreTriage', radiology: 'RadiologyOrder',
}
const PATIENT_FIELDS = ['firstName', 'middleName', 'lastName', 'mrn', 'phonePrimary']
let bad = 0
for (const [file, model] of Object.entries(OWNER)) {
  const src = fs.readFileSync(path.join(ROOT, `backend/src/controllers/${file}Controller.js`), 'utf8')
  const call = src.match(/patientSearchWhere\(search,\s*(null|'patient')([\s\S]*?)\n\s*\]?\)/)
  if (!call) { console.log(`  ?  ${file} — no call found`); continue }
  const cols = [...call[2].matchAll(/\{ (\w+): \{ contains/g)].map((m) => m[1])
  if (call[1] === 'null') cols.push(...PATIENT_FIELDS)
  const fields = models[model]
  if (!fields) { console.log(`  ?  ${file} — model ${model} not in schema`); continue }
  const missing = cols.filter((c) => !fields.has(c))
  if (missing.length) { bad++; console.log(`  ✗  ${file.padEnd(18)} ${model.padEnd(18)} MISSING: ${missing.join(', ')}`) }
  else console.log(`  ✓  ${file.padEnd(18)} ${model.padEnd(18)} ${cols.length} columns all exist`)
}
console.log(`\n  ${bad} module(s) will 400 on any search term`)
