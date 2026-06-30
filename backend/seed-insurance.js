// Seed Insurance/TPA cases (+ claims) using patients that ALREADY EXIST in the DB.
// Mirrors how insuranceController builds a case (and per-case claims CLM0001…).
//
// Run:  node seed-insurance.js
import { db } from './src/config/db.js'

const HOW_MANY = 8

const INSURERS = [
  { payerType: 'INSURANCE', insurerName: 'Star Health', tpaName: null },
  { payerType: 'TPA', insurerName: 'HDFC Ergo', tpaName: 'Medi Assist' },
  { payerType: 'INSURANCE', insurerName: 'ICICI Lombard', tpaName: null },
  { payerType: 'TPA', insurerName: 'Niva Bupa', tpaName: 'Paramount TPA' },
  { payerType: 'INSURANCE', insurerName: 'Care Health', tpaName: null },
  { payerType: 'TPA', insurerName: 'New India Assurance', tpaName: 'Vidal Health' },
]
const CLAIM_STATUSES = ['pending', 'submitted', 'approved', 'settled', 'rejected']
const DIAGNOSES = ['Acute appendicitis', 'Pneumonia', 'Fracture - tibia', 'Cataract', 'Cardiac evaluation', 'Renal calculi']

function pick(arr, i) { return arr[i % arr.length] }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

async function main() {
  console.log('Seeding Insurance/TPA cases + claims (linked to existing patients)...\n')
  const org = await db.organization.findFirst({ select: { id: true, name: true } })
  if (!org) throw new Error('No organization found.')
  console.log('Organization:', org.name, `(${org.id})`)

  const patients = await db.patient.findMany({
    where: { organizationId: org.id },
    take: HOW_MANY,
    orderBy: { createdAt: 'desc' },
    select: { id: true, mrn: true, firstName: true, lastName: true },
  })
  if (patients.length === 0) throw new Error('No patients found.')
  console.log(`Found ${patients.length} existing patients.\n`)

  let claimSeq = await db.insuranceClaim.count({ where: { organizationId: org.id } })
  let cases = 0, claims = 0

  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]
    const ins = pick(INSURERS, i)
    const coverageLimit = pick([100000, 200000, 300000, 500000], i)

    const insuranceCase = await db.insuranceCase.create({
      data: {
        organizationId: org.id,
        patientId: p.id,
        payerType: ins.payerType,
        insurerName: ins.insurerName,
        tpaName: ins.tpaName,
        policyNumber: `POL${randInt(100000, 999999)}`,
        coverageLimit,
        status: 'Active',
        validFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        validTo: new Date(Date.now() + 275 * 24 * 60 * 60 * 1000),
      },
    })
    cases++

    // 1–2 claims per case
    const nClaims = randInt(1, 2)
    for (let c = 0; c < nClaims; c++) {
      claimSeq += 1
      const claimStatus = pick(CLAIM_STATUSES, i + c)
      const claimAmount = randInt(15000, Math.min(coverageLimit, 250000))
      const decided = ['approved', 'settled', 'rejected'].includes(claimStatus)
      await db.insuranceClaim.create({
        data: {
          organizationId: org.id,
          caseId: insuranceCase.id,
          claimNumber: `CLM${String(claimSeq).padStart(4, '0')}`,
          claimAmount,
          approvedAmount: claimStatus === 'rejected' ? 0 : decided ? Math.round(claimAmount * 0.9) : null,
          status: claimStatus,
          diagnosis: pick(DIAGNOSES, i + c),
          submittedAt: claimStatus === 'pending' ? null : new Date(Date.now() - randInt(1, 30) * 24 * 60 * 60 * 1000),
          settledAt: claimStatus === 'settled' ? new Date() : null,
        },
      })
      claims++
    }
    console.log(`  ✅ ${ins.payerType} ${ins.insurerName}  ${p.firstName} ${p.lastName} [MRN ${p.mrn}]  cover ₹${coverageLimit} — ${nClaims} claim(s)`)
  }

  const totalCases = await db.insuranceCase.count({ where: { organizationId: org.id } })
  const totalClaims = await db.insuranceClaim.count({ where: { organizationId: org.id } })
  console.log(`\n🎉 Created ${cases} cases + ${claims} claims. Totals — cases: ${totalCases}, claims: ${totalClaims}`)
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
