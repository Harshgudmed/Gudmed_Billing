// Seed Ambulance trips using patients that ALREADY EXIST in the database.
// Mirrors how ambulanceController.create() builds a trip (tripNumber AM0001…).
//
// Run:  node seed-ambulance.js
import { db } from './src/config/db.js'

const HOW_MANY = 10

const TYPES = ['BLS', 'ALS', 'ICU', 'NEONATAL', 'PTV', 'MORTUARY']
const STATUSES = ['completed', 'completed', 'enroute', 'scheduled', 'cancelled']
const FROMS = ['Sector 14', 'Cyber Hub', 'MG Road', 'Sohna Road', 'DLF Phase 3', 'Railway Station', 'Airport']
const DRIVERS = ['Ramesh Yadav', 'Suresh Kumar', 'Mahesh Singh', 'Dinesh Gupta']

function pick(arr, i) { return arr[i % arr.length] }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

async function main() {
  console.log('Seeding Ambulance trips (linked to existing patients)...\n')
  const org = await db.organization.findFirst({ select: { id: true, name: true } })
  if (!org) throw new Error('No organization found.')
  console.log('Organization:', org.name, `(${org.id})`)

  const patients = await db.patient.findMany({
    where: { organizationId: org.id },
    take: HOW_MANY,
    orderBy: { createdAt: 'desc' },
    select: { id: true, mrn: true, firstName: true, lastName: true, phonePrimary: true },
  })
  if (patients.length === 0) throw new Error('No patients found.')
  console.log(`Found ${patients.length} existing patients.\n`)

  let seq = await db.ambulanceTrip.count({ where: { organizationId: org.id } })
  let created = 0
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]
    seq += 1
    const distanceKm = randInt(3, 45)
    const status = pick(STATUSES, i)
    await db.ambulanceTrip.create({
      data: {
        organizationId: org.id,
        patientId: p.id,
        tripNumber: `AM${String(seq).padStart(4, '0')}`,
        ambulanceType: pick(TYPES, i),
        fromLocation: pick(FROMS, i),
        toLocation: 'Hospital',
        distanceKm,
        charge: distanceKm * randInt(25, 60),
        status,
        tripDate: new Date(Date.now() - randInt(0, 5) * 24 * 60 * 60 * 1000),
        driverName: pick(DRIVERS, i),
        vehicleNumber: `HR26${String.fromCharCode(65 + (i % 26))}${randInt(1000, 9999)}`,
        contactPhone: p.phonePrimary,
        notes: status === 'cancelled' ? 'Trip cancelled by caller.' : null,
      },
    })
    created++
    console.log(`  ✅ AM${String(seq).padStart(4, '0')}  ${p.firstName} ${p.lastName}  [MRN ${p.mrn}]  ${pick(TYPES, i)} — ${status}`)
  }
  const total = await db.ambulanceTrip.count({ where: { organizationId: org.id } })
  console.log(`\n🎉 Created ${created} ambulance trips. Total in org now: ${total}`)
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
