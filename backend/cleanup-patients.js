import { db } from './src/config/db.js'

async function cleanupPatients() {
  try {
    console.log('🧹 CLEANING UP ALL PATIENT DATA...\n')

    // Delete ALL records without organization filter
    const results = await Promise.all([
      db.deathCertificate.deleteMany({}),
      db.appointment.deleteMany({}),
      db.prescription.deleteMany({}),
      db.labOrder.deleteMany({}),
      db.radiologyOrder.deleteMany({}),
      db.consultation.deleteMany({}),
      db.preTriage.deleteMany({}),
      db.triageAssessment.deleteMany({}),
      db.patient.deleteMany({}),
    ])

    console.log('✅ Deleted Records:')
    console.log(`   - Death Certificates: ${results[0].count}`)
    console.log(`   - Appointments: ${results[1].count}`)
    console.log(`   - Prescriptions: ${results[2].count}`)
    console.log(`   - Lab Orders: ${results[3].count}`)
    console.log(`   - Radiology Orders: ${results[4].count}`)
    console.log(`   - Consultations: ${results[5].count}`)
    console.log(`   - Pre-Triages: ${results[6].count}`)
    console.log(`   - Triage Assessments: ${results[7].count}`)
    console.log(`   - Patients: ${results[8].count}`)

    console.log('\n✅ Patient database cleaned! Ready for fresh seed.\n')
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
}

cleanupPatients()
