// Seed Death Certificates using patients that ALREADY EXIST in the database.
// Mirrors deathCertificateController.create() (certificateNumber DC-00001…,
// demographics snapshotted from the patient, certifier linked only if present).
//
// Run:  node seed-death-certificates.js
import { db } from './src/config/db.js'

const HOW_MANY = 6

const PLACES = ['inpatient', 'emergency', 'doa', 'home', 'other']
const MANNERS = ['natural', 'natural', 'natural', 'accident', 'pending']
const IMMEDIATE = [
  'Cardiorespiratory arrest', 'Septic shock', 'Acute myocardial infarction',
  'Respiratory failure', 'Multi-organ dysfunction syndrome', 'Intracranial haemorrhage',
]
const ANTECEDENT = [
  'Coronary artery disease', 'Community-acquired pneumonia', 'Type 2 diabetes mellitus',
  'Chronic kidney disease', 'COPD', 'Hypertension',
]

function pick(arr, i) { return arr[i % arr.length] }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

function ageFromDob(dob) {
  if (!dob) return { y: randInt(45, 85), m: 0, d: 0 }
  const ms = Date.now() - new Date(dob).getTime()
  const y = Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000))
  return { y, m: 0, d: 0 }
}

async function main() {
  console.log('Seeding Death Certificates (linked to existing patients)...\n')
  const org = await db.organization.findFirst({ select: { id: true, name: true } })
  if (!org) throw new Error('No organization found.')
  console.log('Organization:', org.name, `(${org.id})`)

  const patients = await db.patient.findMany({
    where: { organizationId: org.id },
    take: HOW_MANY,
    orderBy: { createdAt: 'desc' },
    select: { id: true, mrn: true, firstName: true, lastName: true, gender: true, dateOfBirth: true, occupation: true, maritalStatus: true },
  })
  if (patients.length === 0) throw new Error('No patients found.')
  console.log(`Found ${patients.length} existing patients.\n`)

  const certifier = await db.user.findFirst({
    where: { organizationId: org.id, role: 'doctor' },
    select: { id: true, fullName: true },
  })
  if (certifier) console.log('Certified by:', certifier.fullName, `(${certifier.id})\n`)

  let seq = await db.deathCertificate.count({ where: { organizationId: org.id } })
  let created = 0
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]
    seq += 1
    const age = ageFromDob(p.dateOfBirth)
    const dateOfDeath = new Date(Date.now() - randInt(1, 60) * 24 * 60 * 60 * 1000)

    await db.deathCertificate.create({
      data: {
        organizationId: org.id,
        certificateNumber: `DC-${String(seq).padStart(5, '0')}`,
        patientId: p.id,
        dateOfDeath,
        timeOfDeath: `${String(randInt(0, 23)).padStart(2, '0')}:${pick(['00', '15', '30', '45'], i)}`,
        placeOfDeath: pick(PLACES, i),
        ageAtDeathYears: age.y,
        sex: p.gender || 'unknown',
        maritalStatus: p.maritalStatus || null,
        occupation: p.occupation || null,
        immediateCause: pick(IMMEDIATE, i),
        antecedentCauseB: pick(ANTECEDENT, i),
        otherConditions: i % 2 === 0 ? 'Type 2 diabetes mellitus' : null,
        mannerOfDeath: pick(MANNERS, i),
        autopsyPerformed: i % 3 === 0,
        certifiedById: certifier?.id ?? null,
        certifierQualification: certifier ? 'MD' : null,
        certificationDate: new Date(),
      },
    })
    created++
    console.log(`  ✅ DC-${String(seq).padStart(5, '0')}  ${p.firstName} ${p.lastName} [MRN ${p.mrn}]  ${pick(PLACES, i)} / ${pick(MANNERS, i)}`)
  }

  const total = await db.deathCertificate.count({ where: { organizationId: org.id } })
  console.log(`\n🎉 Created ${created} death certificates. Total in org now: ${total}`)
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
