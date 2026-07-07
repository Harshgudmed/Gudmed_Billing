#!/usr/bin/env node
/**
 * Reads ALL local data and POSTs it to the production /import endpoint
 * over HTTPS (port 443 — not blocked by the ISP, unlike Postgres 5432).
 * The server does the FK-ordered, self-healing insert.
 */
import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const LOCAL_URL = 'postgresql://postgres:password@localhost:5432/hospital_db'
const PROD_API  = 'https://gudmed-api.onrender.com/api/import'
// Read the secret from the environment — never hardcode it.
// Run as:  IMPORT_SECRET="<value>" node upload-to-prod.js
const SECRET    = process.env.IMPORT_SECRET
if (!SECRET) { console.error('Set IMPORT_SECRET env var before running.'); process.exit(1) }

const local = new PrismaClient({ datasources: { db: { url: LOCAL_URL } } })

async function grab(model) {
  try { return await local[model].findMany() } catch { return [] }
}

async function main() {
  console.log('Reading local data…')
  const payload = {
    purgeDemo: true,  // clear old appt-demo-/inv-demo-/drug-demo- rows first
    organizations:          await grab('organization'),
    departments:            await grab('department'),
    users:                  await grab('user'),
    // Strip addressDescription: the local DB/stale client still has this column,
    // but production's schema dropped it, so prod rejects patients that include it.
    patients:               (await grab('patient')).map(({ addressDescription, ...p }) => p),
    wards:                  await grab('ward'),
    beds:                   await grab('bed'),
    admissions:             await grab('admission'),
    appointments:           await grab('appointment'),
    consultations:          await grab('consultation'),
    preTriages:             await grab('preTriage'),
    triageAssessments:      await grab('triageAssessment'),
    queueItems:             await grab('queueManagement'),
    pharmacyDrugs:          await grab('pharmacyDrug'),
    prescriptions:          await grab('prescription'),
    pharmacySales:          await grab('pharmacySale'),
    labTests:               await grab('labTest'),
    radiologyExams:         await grab('radiologyExam'),
    labOrders:              await grab('labOrder'),
    labResults:             await grab('labResult'),
    radiologyOrders:        await grab('radiologyOrder'),
    radiologyReports:       await grab('radiologyReport'),
    invoices:               await grab('invoice'),
    payments:               await grab('payment'),
    deathCertificates:      await grab('deathCertificate'),
    doctorCommissionConfigs:await grab('doctorCommissionConfig'),
    doctorCommissions:      await grab('doctorCommission'),
  }

  console.log('\nLocal record counts:')
  for (const [k, v] of Object.entries(payload)) {
    if (v.length) console.log(`  ${k}: ${v.length}`)
  }

  console.log('\nUploading to production…')
  const res = await axios.post(PROD_API, payload, {
    headers: { 'x-import-secret': SECRET, 'Content-Type': 'application/json' },
    timeout: 180000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  })

  console.log('\n✅ Server response:')
  console.log(`  ${res.data.message}`)
  if (res.data.results) {
    console.log('\nImported (ok / failed / skipped / total):')
    for (const [model, r] of Object.entries(res.data.results)) {
      console.log(`  ${model.padEnd(22)} ${r.ok} / ${r.fail} / ${r.skip} / ${r.total}`)
    }
  }
  if (res.data.errors?.length) {
    console.log('\nSample errors:')
    res.data.errors.forEach(e => console.log(`  - ${e}`))
  }
  console.log('\nVerify at: https://gudmed.vercel.app\n')
}

main()
  .catch(e => {
    console.error('\n❌ Upload failed:', e.response?.data?.error || e.message)
    if (e.response?.status) console.error('   HTTP', e.response.status)
    process.exit(1)
  })
  .finally(() => local.$disconnect())
