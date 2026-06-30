// Seed Day-Care cases using patients that ALREADY EXIST in the database.
// Mirrors how dayCareController.create() builds a case (caseNumber DC0001…,
// doctor snapshot, fee/payment, status).
//
// Run:  node seed-daycare.js
import { db } from './src/config/db.js'

const HOW_MANY = 10 // number of day-care cases to create

const PROCEDURES = [
  'Cataract Surgery (Phaco)', 'Upper GI Endoscopy', 'Colonoscopy',
  'Dialysis Session', 'Chemotherapy Cycle', 'Minor Wound Debridement',
  'Dental Extraction', 'IV Infusion Therapy', 'Skin Lesion Excision',
  'Joint Injection',
]
const STATUSES = ['admitted', 'in_procedure', 'observation', 'discharged', 'discharged']
const PAYMENTS = ['pending', 'partial', 'paid', 'paid']

function pick(arr, i) { return arr[i % arr.length] }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

async function main() {
  console.log('Seeding Day-Care cases (linked to existing patients)...\n')

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
  console.log(`Found ${patients.length} existing patients.\n`)

  // Use a real doctor for the snapshot if one exists.
  const doctor = await db.user.findFirst({
    where: { organizationId: org.id, role: 'doctor' },
    select: { id: true, fullName: true },
  })
  if (doctor) console.log('Treating doctor:', doctor.fullName, `(${doctor.id})\n`)

  // Continue the per-org caseNumber sequence (DC0001, DC0002, …).
  let seq = await db.dayCareCase.count({ where: { organizationId: org.id } })

  let created = 0
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]
    seq += 1
    const status = pick(STATUSES, i)
    const fee = randInt(1500, 25000)
    const paymentStatus = pick(PAYMENTS, i)
    const amountPaid = paymentStatus === 'paid' ? fee : paymentStatus === 'partial' ? Math.round(fee / 2) : 0
    const discharged = status === 'discharged'

    await db.dayCareCase.create({
      data: {
        organizationId: org.id,
        caseNumber: `DC${String(seq).padStart(4, '0')}`,
        patientId: p.id,
        doctorId: doctor?.id ?? null,
        doctorName: doctor?.fullName ?? null,
        procedure: pick(PROCEDURES, i),
        admissionDate: new Date(Date.now() - randInt(0, 6) * 24 * 60 * 60 * 1000),
        dischargeTime: discharged ? `${randInt(13, 19)}:${pick(['00', '15', '30', '45'], i)}` : null,
        fee,
        paymentStatus,
        amountPaid,
        status,
        notes: discharged ? 'Recovered well, advised follow-up in 1 week.' : null,
      },
    })
    created++
    console.log(`  ✅ DC${String(seq).padStart(4, '0')}  ${p.firstName} ${p.lastName}  [MRN ${p.mrn}]  ${pick(PROCEDURES, i)} — ${status}/${paymentStatus}`)
  }

  const total = await db.dayCareCase.count({ where: { organizationId: org.id } })
  console.log(`\n🎉 Created ${created} day-care cases. Total in org now: ${total}`)
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
