import { db } from './src/config/db.js'

const departments = [
  'General Medicine', 'Cardiology', 'Orthopedics', 'Pediatrics', 'Gynecology',
  'Neurology', 'Dermatology', 'ENT', 'Ophthalmology', 'Psychiatry',
  'Urology', 'Surgery', 'Gastroenterology', 'Nephrology', 'Pulmonology'
]

const doctorNames = [
  'Dr. Rajesh Sharma', 'Dr. Amit Singh', 'Dr. Vikram Patel', 'Dr. Suresh Gupta', 'Dr. Arun Reddy',
  'Dr. Priya Menon', 'Dr. Neha Verma', 'Dr. Pooja Iyer', 'Dr. Divya Nair', 'Dr. Anjali Singh',
  'Dr. Shreya Patel', 'Dr. Riya Gupta', 'Dr. Meera Sharma', 'Dr. Ananya Reddy', 'Dr. Kavya Rao',
  'Dr. Harish Kumar', 'Dr. Pradeep Singh', 'Dr. Ravi Patel', 'Dr. Sandeep Gupta', 'Dr. Praveen Nair'
]

const appointmentTimes = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30']
const appointmentTypes = ['new_patient', 'follow_up', 'emergency']
const chiefComplaints = [
  'General Checkup', 'Fever', 'Pain', 'Chronic Disease Management', 'Vaccination',
  'Lab Results Review', 'Follow-up Consultation', 'Allergy Check', 'Blood Pressure Check',
  'Weight Management', 'Diabetes Management', 'Heart Condition Check', 'Mental Health Consultation'
]

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

async function addMultipleAppointments() {
  try {
    console.log('📅 ADDING MULTIPLE APPOINTMENTS TO EXISTING PATIENTS\n')

    const orgId = 'org-demo'

    // Get all doctors
    const doctors = await db.user.findMany({
      where: { organizationId: orgId, isActive: true, role: 'doctor' }
    })

    if (!doctors || doctors.length === 0) {
      console.error('❌ No active doctors found')
      process.exit(1)
    }

    // Get all patients
    const allPatients = await db.patient.findMany({
      where: { organizationId: orgId },
    })

    console.log(`📊 Found ${allPatients.length} patients`)
    console.log(`🎯 Adding 3-5 appointments per patient...\n`)

    let totalAppointmentsCreated = 0
    let appointmentsByDoctor = {}
    let appointmentsByDepartment = {}

    for (let patientIndex = 0; patientIndex < allPatients.length; patientIndex++) {
      const patient = allPatients[patientIndex]

      // Create 3-5 random appointments per patient
      const appointmentCount = Math.floor(Math.random() * 3) + 3 // 3-5 appointments

      for (let apptIndex = 0; apptIndex < appointmentCount; apptIndex++) {
        try {
          const appointmentDate = new Date()
          appointmentDate.setDate(appointmentDate.getDate() + Math.floor(Math.random() * 60) + 1) // Next 2 months

          const appointmentTime = getRandomItem(appointmentTimes)
          const department = getRandomItem(departments)
          const appointmentType = getRandomItem(appointmentTypes)
          const priority = Math.random() > 0.85 ? 'urgent' : 'normal'
          const status = Math.random() > 0.3 ? 'scheduled' : (Math.random() > 0.5 ? 'completed' : 'cancelled')

          // Track doctors and departments
          appointmentsByDoctor[appointmentType] = (appointmentsByDoctor[appointmentType] || 0) + 1
          appointmentsByDepartment[department] = (appointmentsByDepartment[department] || 0) + 1

          await db.appointment.create({
            data: {
              organizationId: orgId,
              patientId: patient.id,
              doctorId: getRandomItem(doctors).id,
              appointmentDate,
              appointmentTime,
              appointmentType,
              priority,
              status,
              chiefComplaint: getRandomItem(chiefComplaints),
              notes: `${department} - ${appointmentType === 'new_patient' ? 'New Consultation' : appointmentType === 'follow_up' ? 'Follow-up Visit' : 'Emergency Visit'}`,
              consultationFee: getRandomItem([500, 800, 1000, 1500, 2000]),
              },
          })

          totalAppointmentsCreated++
        } catch (err) {
          // Skip individual appointment errors
        }
      }

      // Progress indicator
      if ((patientIndex + 1) % 100 === 0) {
        console.log(`⏳ Progress: ${patientIndex + 1}/${allPatients.length} patients processed...`)
      }
    }

    console.log('\n' + '='.repeat(70))
    console.log('📅 MULTIPLE APPOINTMENTS SEEDING COMPLETE')
    console.log('='.repeat(70))
    console.log(`✅ Total New Appointments Created: ${totalAppointmentsCreated}`)
    console.log(`✅ Average per Patient: ${(totalAppointmentsCreated / allPatients.length).toFixed(1)}`)
    console.log(`\n📊 Appointments by Type:`)
    Object.entries(appointmentsByDoctor).forEach(([type, count]) => {
      console.log(`   - ${type}: ${count}`)
    })
    console.log(`\n🏥 Appointments by Department (Top 5):`)
    Object.entries(appointmentsByDepartment)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([dept, count]) => {
        console.log(`   - ${dept}: ${count}`)
      })
    console.log(`\n🎉 All patients now have multiple diverse appointments!`)

    process.exit(0)
  } catch (err) {
    console.error('❌ Critical error:', err.message)
    process.exit(1)
  }
}

addMultipleAppointments()
