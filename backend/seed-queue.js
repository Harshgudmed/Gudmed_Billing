// Seed the patient Queue (QueueManagement) using patients that ALREADY EXIST
// in the database. Mirrors how triageController.addToQueue() builds a queue item.
//
// Run:  node seed-queue.js
import { db } from './src/config/db.js'

const HOW_MANY = 10 // number of queue entries to create

const SERVICE_AREAS = ['opd', 'emergency', 'mch', 'psychiatric']
const SERVICE_TYPES = ['consultation', 'procedure', 'review']
const PRIORITIES = ['urgent', 'normal', 'normal', 'low'] // weighted toward normal
const STATUSES = ['waiting', 'waiting', 'called', 'in_service'] // mostly waiting

function pick(arr, i) { return arr[i % arr.length] }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

function queueNumber(serviceArea, i) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = serviceArea.substring(0, 3).toUpperCase()
  const seq = String(i).padStart(4, '0')
  return `${prefix}${date}${seq}`
}

async function main() {
  console.log('Seeding patient Queue (linked to existing patients)...\n')

  const org = await db.organization.findFirst({ select: { id: true, name: true } })
  if (!org) throw new Error('No organization found — seed the org first.')
  console.log('Organization:', org.name, `(${org.id})`)

  // Only ever link to patients that ALREADY exist in this org.
  const patients = await db.patient.findMany({
    where: { organizationId: org.id },
    take: HOW_MANY,
    orderBy: { createdAt: 'desc' },
    select: { id: true, mrn: true, firstName: true, lastName: true },
  })
  if (patients.length === 0) throw new Error('No patients found in DB for this org.')
  console.log(`Found ${patients.length} existing patients to queue.\n`)

  // Optionally assign queue items to a real staff user.
  const staff = await db.user.findFirst({
    where: { organizationId: org.id },
    select: { id: true, fullName: true },
  })
  if (staff) console.log('Assigned to:', staff.fullName, `(${staff.id})\n`)

  let created = 0
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]
    const serviceArea = pick(SERVICE_AREAS, i)
    const status = pick(STATUSES, i)

    // Stagger join times so wait-time calculations look realistic.
    const joinedQueueAt = new Date(Date.now() - randInt(2, 90) * 60000)
    const called = status === 'called' || status === 'in_service'
    const inService = status === 'in_service'

    await db.queueManagement.create({
      data: {
        organizationId: org.id,
        patientId: p.id,
        serviceArea,
        serviceType: pick(SERVICE_TYPES, i),
        queueNumber: queueNumber(serviceArea, i + 1),
        priority: pick(PRIORITIES, i),
        assignedToId: staff?.id ?? null,
        assignedRoom: `Room ${randInt(1, 12)}`,
        status,
        joinedQueueAt,
        calledAt: called ? new Date(joinedQueueAt.getTime() + 5 * 60000) : null,
        serviceStartedAt: inService ? new Date(joinedQueueAt.getTime() + 8 * 60000) : null,
        estimatedWaitMinutes: randInt(5, 45),
      },
    })
    created++
    console.log(`  ✅ ${queueNumber(serviceArea, i + 1)}  ${p.firstName} ${p.lastName}  [MRN ${p.mrn}]  ${serviceArea}/${status}`)
  }

  const total = await db.queueManagement.count({ where: { organizationId: org.id } })
  console.log(`\n🎉 Created ${created} queue entries. Total in org now: ${total}`)
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
