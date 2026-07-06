// One-time migration: push essential local data (org, users, full pharmacy
// catalog, full lab/radiology test catalogs, a small patient sample) to the
// new Render production database. Reads the remote connection string from
// process.env.REMOTE_DATABASE_URL — never logs it.
import { PrismaClient } from '@prisma/client'

const PATIENT_SAMPLE_SIZE = 2000

let remoteUrl = process.env.REMOTE_DATABASE_URL
if (!remoteUrl) {
  console.error('REMOTE_DATABASE_URL env var not set — aborting')
  process.exit(1)
}
// External Render Postgres connections require SSL; force it + a larger pool
// timeout so a big createMany batch doesn't get dropped mid-write.
if (!remoteUrl.includes('sslmode=')) {
  remoteUrl += (remoteUrl.includes('?') ? '&' : '?') + 'sslmode=require&connect_timeout=30&pool_timeout=30'
}

const localDb = new PrismaClient()
const remoteDb = new PrismaClient({ datasources: { db: { url: remoteUrl } } })

async function copyInBatches(name, rows, createFn, batchSize = 500) {
  let done = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    await createFn(batch)
    done += batch.length
    process.stdout.write(`\r${name}: ${done}/${rows.length}`)
  }
  console.log('')
}

async function safeStep(name, fn) {
  try {
    await fn()
    console.log(`${name}: OK`)
  } catch (e) {
    console.log(`${name}: FAILED — ${e.message.split('\n')[0]}`)
  }
}

async function main() {
  console.log('Fetching from local...')
  const orgs = await localDb.organization.findMany()
  const departments = await localDb.department.findMany()
  const users = await localDb.user.findMany()
  const drugs = await localDb.pharmacyDrug.findMany()
  const labTests = await localDb.labTest.findMany()
  const radiologyExams = await localDb.radiologyExam.findMany()
  const patients = await localDb.patient.findMany({ take: PATIENT_SAMPLE_SIZE, orderBy: { createdAt: 'desc' } })

  console.log(`Counts — orgs:${orgs.length} departments:${departments.length} users:${users.length} drugs:${drugs.length} labTests:${labTests.length} radiologyExams:${radiologyExams.length} patients:${patients.length}`)

  console.log('Writing to remote...')
  await safeStep('orgs', () => remoteDb.organization.createMany({ data: orgs, skipDuplicates: true }))
  await safeStep('departments', () => remoteDb.department.createMany({ data: departments, skipDuplicates: true }))
  await safeStep('users', () => remoteDb.user.createMany({ data: users, skipDuplicates: true }))
  await safeStep('drugs', () => copyInBatches('drugs', drugs, (batch) => remoteDb.pharmacyDrug.createMany({ data: batch, skipDuplicates: true })))
  await safeStep('labTests', () => copyInBatches('labTests', labTests, (batch) => remoteDb.labTest.createMany({ data: batch, skipDuplicates: true })))
  await safeStep('radiologyExams', () => copyInBatches('radiologyExams', radiologyExams, (batch) => remoteDb.radiologyExam.createMany({ data: batch, skipDuplicates: true })))
  await safeStep('patients', () => copyInBatches('patients', patients, (batch) => remoteDb.patient.createMany({ data: batch, skipDuplicates: true })))

  console.log('DONE')
}

main()
  .catch((e) => { console.error('MIGRATION FAILED:', e.message); process.exit(1) })
  .finally(async () => { await localDb.$disconnect(); await remoteDb.$disconnect() })
