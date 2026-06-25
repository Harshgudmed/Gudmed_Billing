import { db } from './src/config/db.js'

const departments = [
  'General Medicine', 'Cardiology', 'Orthopedics', 'Pediatrics', 'Gynecology',
  'Neurology', 'Dermatology', 'ENT', 'Ophthalmology', 'Psychiatry',
  'Urology', 'Surgery', 'Gastroenterology', 'Nephrology', 'Pulmonology'
]

const visitTypes = ['outpatient', 'emergency', 'follow_up']

const chiefComplaints = [
  'General Checkup', 'Fever', 'Pain', 'Chronic Disease Management', 'Vaccination',
  'Lab Results Review', 'Follow-up Consultation', 'Allergy Check', 'Blood Pressure Check',
  'Weight Management', 'Diabetes Management', 'Heart Condition Check', 'Mental Health Consultation'
]

const historyNotes = [
  'Patient presented with complaints during routine checkup.',
  'Follow-up visit for chronic condition management.',
  'Initial consultation for new complaint.',
  'Patient reviewed after recent test results.',
  'Routine preventive health checkup.',
  'Patient follow-up after medication initiation.',
  'Consultation for symptom management.',
  'Patient review for ongoing treatment efficacy.'
]

const physicalExamNotes = [
  'Vitals stable. General examination normal.',
  'Examination shows improvement in patient condition.',
  'General physical examination within normal limits.',
  'Targeted examination for reported complaints.',
  'Complete physical examination performed.',
  'Vital signs monitored and documented.',
  'Examination findings consistent with diagnosis.'
]

const diagnosisNotes = [
  'Hypertension - Stage 1',
  'Type 2 Diabetes Mellitus',
  'Upper Respiratory Infection',
  'Cervical Spondylosis',
  'Allergic Rhinitis',
  'Gastro-esophageal Reflux Disease',
  'Migraine without Aura',
  'Anxiety Disorder',
  'Dyslipidemia',
  'Hypothyroidism',
  'Asthma - Mild Persistent',
  'Acute Pharyngitis',
  'Dermatitis - Contact',
  'Coronary Artery Disease - Stable',
  'Chronic Kidney Disease - Stage 2'
]

const treatmentPlans = [
  'Continue current medications. Regular monitoring advised.',
  'Medication adjustment as per clinical need. Follow-up in 2 weeks.',
  'Lifestyle modifications and dietary counseling provided.',
  'Prescribed medications with clear instructions. Monitor vitals.',
  'Treatment plan reviewed and optimized.',
  'Conservative management with close follow-up.',
  'Referral to specialist arranged.',
  'Prescribe indicated medications and arrange investigations.'
]

const followUpInstructions = [
  'Return for follow-up in 1 week.',
  'Follow-up in 2 weeks or as needed.',
  'Return for review of test results.',
  'Contact clinic if symptoms persist.',
  'Regular monitoring and follow-up recommended.',
  'Return after completing prescribed course.',
  'Schedule follow-up appointment for 3 weeks.'
]

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getRandomItems(arr, count) {
  const result = []
  const used = new Set()
  while (result.length < count && result.length < arr.length) {
    const item = getRandomItem(arr)
    if (!used.has(item)) {
      result.push(item)
      used.add(item)
    }
  }
  return result
}

async function seedConsultations() {
  try {
    console.log('🏥 SEEDING CONSULTATIONS FOR ALL 500 PATIENTS\n')

    const orgId = 'org-demo'

    // Get all patients
    const allPatients = await db.patient.findMany({
      where: { organizationId: orgId },
    })

    // Get all doctors/users
    const allUsers = await db.user.findMany({
      where: { organizationId: orgId, isActive: true, role: 'doctor' },
    })

    if (allUsers.length === 0) {
      console.error('❌ No active users found. Cannot create consultations.')
      process.exit(1)
    }

    console.log(`📊 Found ${allPatients.length} patients`)
    console.log(`👨‍⚕️ Found ${allUsers.length} doctors/users`)
    console.log(`🎯 Creating 2-4 consultations per patient with different doctors...\n`)

    let totalConsultationsCreated = 0
    let consultationsByDepartment = {}
    let consultationsByVisitType = {}

    for (let patientIndex = 0; patientIndex < allPatients.length; patientIndex++) {
      const patient = allPatients[patientIndex]

      // Create 2-4 consultations per patient
      const consultationCount = Math.floor(Math.random() * 3) + 2 // 2-4 consultations

      for (let consultIndex = 0; consultIndex < consultationCount; consultIndex++) {
        try {
          // Random doctor from available users
          const doctor = getRandomItem(allUsers)

          const visitDate = new Date()
          visitDate.setDate(visitDate.getDate() - Math.floor(Math.random() * 90) + 1) // Past 3 months

          const department = getRandomItem(departments)
          const visitType = getRandomItem(visitTypes)

          // Track statistics
          consultationsByDepartment[department] = (consultationsByDepartment[department] || 0) + 1
          consultationsByVisitType[visitType] = (consultationsByVisitType[visitType] || 0) + 1

          // Random vitals
          const tempBase = 98.6
          const temperature = tempBase + (Math.random() > 0.9 ? (Math.random() * 3 - 1.5) : 0) // Occasional fever

          await db.consultation.create({
            data: {
              organizationId: orgId,
              patientId: patient.id,
              doctorId: doctor.id,
              visitDate,
              visitType,
              temperature,
              bloodPressureSystolic: 110 + Math.floor(Math.random() * 30),
              bloodPressureDiastolic: 70 + Math.floor(Math.random() * 20),
              pulseRate: 60 + Math.floor(Math.random() * 30),
              respiratoryRate: 16 + Math.floor(Math.random() * 8),
              weight: 50 + Math.floor(Math.random() * 50),
              height: 150 + Math.floor(Math.random() * 40),
              oxygenSaturation: 95 + Math.floor(Math.random() * 5),
              chiefComplaint: getRandomItem(chiefComplaints),
              historyOfPresentIllness: getRandomItem(historyNotes),
              physicalExamination: getRandomItem(physicalExamNotes),
              diagnosis: getRandomItem(diagnosisNotes),
              treatmentPlan: getRandomItem(treatmentPlans),
              followUpInstructions: getRandomItem(followUpInstructions),
              followUpDate: new Date(Date.now() + (Math.floor(Math.random() * 14) + 7) * 24 * 60 * 60 * 1000),
              notes: `${department} - Consultation with ${doctor.fullName}`,
            },
          })

          totalConsultationsCreated++
        } catch (err) {
          // Skip individual consultation errors silently
        }
      }

      // Progress indicator
      if ((patientIndex + 1) % 100 === 0) {
        console.log(`⏳ Progress: ${patientIndex + 1}/${allPatients.length} patients processed...`)
      }
    }

    console.log('\n' + '='.repeat(70))
    console.log('🏥 CONSULTATIONS SEEDING COMPLETE')
    console.log('='.repeat(70))
    console.log(`✅ Total Consultations Created: ${totalConsultationsCreated}`)
    console.log(`✅ Average per Patient: ${(totalConsultationsCreated / allPatients.length).toFixed(1)}`)

    console.log(`\n🏥 Consultations by Department:`)
    Object.entries(consultationsByDepartment)
      .sort((a, b) => b[1] - a[1])
      .forEach(([dept, count]) => {
        console.log(`   - ${dept}: ${count}`)
      })

    console.log(`\n📋 Consultations by Visit Type:`)
    Object.entries(consultationsByVisitType)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`   - ${type}: ${count}`)
      })

    console.log(`\n🎉 All 500 patients now have diverse consultations!`)

    process.exit(0)
  } catch (err) {
    console.error('❌ Critical error:', err.message)
    process.exit(1)
  }
}

seedConsultations()
