// One-time migration: push the REAL, richly-linked patients (those with at
// least one invoice/consultation/admission/order/etc — not just the most
// recently-created dummy rows) plus all their related records to the new
// Render production database. Reads the remote connection string from
// process.env.REMOTE_DATABASE_URL — never logs it.
import { PrismaClient } from '@prisma/client'

let remoteUrl = process.env.REMOTE_DATABASE_URL
if (!remoteUrl) {
  console.error('REMOTE_DATABASE_URL env var not set — aborting')
  process.exit(1)
}
if (!remoteUrl.includes('sslmode=')) {
  remoteUrl += (remoteUrl.includes('?') ? '&' : '?') + 'sslmode=require&connect_timeout=30&pool_timeout=30'
}

const localDb = new PrismaClient()

async function copyInBatches(remoteDb, name, rows, modelName, batchSize = 100) {
  let done = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    await remoteDb[modelName].createMany({ data: batch, skipDuplicates: true })
    done += batch.length
    process.stdout.write(`\r${name}: ${done}/${rows.length}`)
  }
  console.log('')
}

// Opens a brand-new connection just for this one table, then closes it —
// avoids reusing a connection Render's proxy may have silently dropped.
async function copyAll(modelName, where = undefined, retries = 3) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const remoteDb = new PrismaClient({ datasources: { db: { url: remoteUrl } } })
    try {
      const rows = await localDb[modelName].findMany(where ? { where } : undefined)
      await copyInBatches(remoteDb, modelName, rows, modelName)
      console.log(`${modelName}: OK (${rows.length} rows)`)
      await remoteDb.$disconnect()
      return rows
    } catch (e) {
      await remoteDb.$disconnect().catch(() => {})
      const flat = (e.message || String(e)).trim().replace(/\s+/g, ' ')
      const msg = flat.length > 400 ? '…' + flat.slice(-400) : flat
      if (attempt <= retries) {
        console.log(`${modelName}: retry ${attempt} after error — ${msg}`)
        await new Promise((r) => setTimeout(r, 3000))
      } else {
        console.log(`${modelName}: FAILED — ${msg}`)
        return []
      }
    }
  }
  return []
}

async function distinctPatientIds(modelName) {
  const rows = await localDb[modelName].findMany({ distinct: ['patientId'], select: { patientId: true } })
  return rows.map((r) => r.patientId).filter(Boolean)
}

async function main() {
  console.log('Finding real patients (those with actual activity records)...')
  const sets = await Promise.all([
    'invoice', 'consultation', 'admission', 'labOrder', 'radiologyOrder',
    'prescription', 'pharmacySale', 'preTriage', 'queueManagement',
    'dayCareCase', 'ambulanceTrip', 'insuranceCase', 'deathCertificate',
  ].map(distinctPatientIds))
  const realPatientIds = [...new Set(sets.flat())]
  console.log(`Real patients with activity: ${realPatientIds.length}`)

  console.log('Writing patients (skipDuplicates — the earlier 2000 dummy sample stays too)...')
  const patients = await localDb.patient.findMany({ where: { id: { in: realPatientIds } } })
  await (async () => {
    const remoteDb = new PrismaClient({ datasources: { db: { url: remoteUrl } } })
    try { await copyInBatches(remoteDb, 'patients', patients, 'patient'); console.log(`patients: OK (${patients.length})`) }
    catch (e) { console.log('patients: FAILED —', e.message.slice(0, 300)) }
    await remoteDb.$disconnect()
  })()

  const pWhere = { patientId: { in: realPatientIds } }
  console.log('Writing patient-scoped tables for the real patients...')
  await copyAll('consultation', pWhere)
  await copyAll('admission', pWhere)
  await copyAll('prescription', pWhere)
  await copyAll('pharmacySale', pWhere)
  await copyAll('invoice', pWhere)
  await copyAll('patientDocument', pWhere)
  await copyAll('labOrder', pWhere)
  await copyAll('radiologyOrder', pWhere)
  await copyAll('preTriage', pWhere)
  await copyAll('queueManagement', pWhere)
  await copyAll('dayCareCase', pWhere)
  await copyAll('ambulanceTrip', pWhere)
  await copyAll('insuranceCase', pWhere)
  await copyAll('deathCertificate', pWhere)
  await copyAll('appointment', pWhere)

  console.log('Writing tables that depend on the above...')
  await copyAll('payment', pWhere)

  const admissions = await localDb.admission.findMany({ where: pWhere, select: { id: true } })
  const admissionIds = admissions.map((a) => a.id)
  await copyAll('patientTariff', { admissionId: { in: admissionIds } })
  await copyAll('vitalsRecord', { admissionId: { in: admissionIds } })
  await copyAll('clinicalNote', { admissionId: { in: admissionIds } })

  const labOrders = await localDb.labOrder.findMany({ where: pWhere, select: { id: true } })
  await copyAll('labResult', { orderId: { in: labOrders.map((o) => o.id) } })

  const radOrders = await localDb.radiologyOrder.findMany({ where: pWhere, select: { id: true } })
  await copyAll('radiologyReport', { orderId: { in: radOrders.map((o) => o.id) } })

  const insCases = await localDb.insuranceCase.findMany({ where: pWhere, select: { id: true } })
  await copyAll('insuranceClaim', { caseId: { in: insCases.map((c) => c.id) } })

  console.log('DONE')
}

main()
  .catch((e) => { console.error('MIGRATION FAILED:', e.message) })
  .finally(async () => { await localDb.$disconnect() })
