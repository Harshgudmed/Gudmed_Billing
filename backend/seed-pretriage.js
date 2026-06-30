// Seed Pre-Triage screenings using patients that ALREADY EXIST in the database.
// Each screening is linked (patientId) to a real patient and copies that
// patient's demographics — mirroring how preTriageController.create() works.
//
// Run:  node seed-pretriage.js
import { db } from './src/config/db.js'

const HOW_MANY = 12 // number of screenings to create

const COMPLAINTS = [
  { chief: 'Fever and body ache for 3 days', history: 'No known comorbidities. Took paracetamol with mild relief.' },
  { chief: 'Chest discomfort on exertion',   history: 'Known hypertensive, on amlodipine. No prior cardiac event.' },
  { chief: 'Severe headache since morning',   history: 'Recurrent migraine. Photophobia present.' },
  { chief: 'Cough with sputum, breathlessness', history: 'Smoker, 10 pack-years. Worse over last week.' },
  { chief: 'Abdominal pain, right lower quadrant', history: 'Pain started 12 hours ago. Associated nausea.' },
  { chief: 'Dizziness and weakness',          history: 'Diabetic on metformin. Skipped breakfast today.' },
  { chief: 'Injury to left ankle after fall', history: 'Swelling and difficulty bearing weight.' },
  { chief: 'High-grade fever with chills',    history: 'Travel history to endemic area 1 week ago.' },
]

const ROUTES = ['adult_triage', 'mch_triage', 'psychiatric_triage']

function rand(min, max) { return Math.round((Math.random() * (max - min) + min) * 10) / 10 }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

// Same screening-number scheme as the controller, but with an index suffix so a
// batch insert can never collide on the @unique screeningNumber.
function screeningNumber(i) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const seq = String(i).padStart(4, '0')
  return `SCR${date}${seq}`
}

async function main() {
  console.log('Seeding Pre-Triage screenings (linked to existing patients)...\n')

  // 1. Resolve the org the same way the rest of the demo data uses.
  const org = await db.organization.findFirst({ select: { id: true, name: true } })
  if (!org) throw new Error('No organization found — seed the org first.')
  console.log('Organization:', org.name, `(${org.id})`)

  // 2. Pull real, already-existing patients from THIS org. We only ever link to
  //    patients that exist — never invent new ones.
  const patients = await db.patient.findMany({
    where: { organizationId: org.id },
    take: HOW_MANY,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, mrn: true, firstName: true, lastName: true,
      dateOfBirth: true, gender: true, phonePrimary: true,
    },
  })
  if (patients.length === 0) throw new Error('No patients found in DB for this org.')
  console.log(`Found ${patients.length} existing patients to screen.\n`)

  // 3. Optional: attribute the screening to a real staff user if one exists.
  const screener = await db.user.findFirst({
    where: { organizationId: org.id },
    select: { id: true, fullName: true },
  })
  if (screener) console.log('Screened by:', screener.fullName, `(${screener.id})\n`)

  let created = 0
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]
    const c = COMPLAINTS[i % COMPLAINTS.length]

    const age = p.dateOfBirth
      ? Math.floor((Date.now() - new Date(p.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : null

    // Roughly a third are already routed onward; the rest are still screening.
    const routed = i % 3 === 0
    const weight = rand(45, 95)
    const height = rand(150, 185)
    const bmi = Math.round((weight / ((height / 100) ** 2)) * 10) / 10

    await db.preTriage.create({
      data: {
        organizationId: org.id,
        screeningNumber: screeningNumber(i + 1),

        // Demographics copied from the real patient (controller does the same).
        patientId: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        age,
        gender: p.gender,
        phone: p.phonePrimary,

        // Screening assessment
        chiefComplaint: c.chief,
        briefHistory: c.history,

        // Vitals
        temperature: rand(97, 103),
        bloodPressureSystolic: randInt(100, 160),
        bloodPressureDiastolic: randInt(60, 100),
        pulseRate: randInt(60, 110),
        respiratoryRate: randInt(12, 24),
        spo2: rand(92, 100),
        weight,
        height,
        bmi,
        fbs: rand(80, 140),
        ppbs: rand(110, 200),

        // Routing + status
        routedTo: routed ? ROUTES[i % ROUTES.length] : null,
        status: routed ? 'routed' : 'screening',
        screenedById: screener?.id ?? null,
        routedById: routed ? (screener?.id ?? null) : null,
        routedAt: routed ? new Date() : null,
      },
    })
    created++
    console.log(`  ✅ ${screeningNumber(i + 1)}  ${p.firstName} ${p.lastName}  [MRN ${p.mrn}]  → ${routed ? 'routed' : 'screening'}`)
  }

  const total = await db.preTriage.count({ where: { organizationId: org.id } })
  console.log(`\n🎉 Created ${created} pre-triage screenings. Total in org now: ${total}`)
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
