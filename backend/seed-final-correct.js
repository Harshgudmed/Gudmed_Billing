import { db } from './src/config/db.js'

const doctorNames = {
  Cardiology: [
    'Dr. Rajesh Kumar', 'Dr. Priya Sharma', 'Dr. Amit Patel', 'Dr. Neha Verma',
    'Dr. Suresh Singh', 'Dr. Anjali Desai', 'Dr. Vikram Gupta', 'Dr. Pooja Iyer',
    'Dr. Arjun Reddy', 'Dr. Deepika Nair'
  ],
  'General Medicine': [
    'Dr. Rahul Verma', 'Dr. Sneha Gupta', 'Dr. Arun Kumar', 'Dr. Divya Sharma',
    'Dr. Sanjay Patel', 'Dr. Isha Mishra', 'Dr. Ravi Singh', 'Dr. Kavya Reddy',
    'Dr. Manish Joshi', 'Dr. Anita Rao'
  ],
  Pediatrics: [
    'Dr. Priya Menon', 'Dr. Rohan Kapoor', 'Dr. Swati Tiwari', 'Dr. Nikhil Saxena',
    'Dr. Meera Bhat', 'Dr. Ashok Sharma', 'Dr. Ritika Verma', 'Dr. Haroon Khan',
    'Dr. Sonali Das', 'Dr. Varun Malhotra'
  ],
  Orthopedics: [
    'Dr. Abhishek Singh', 'Dr. Priti Sharma', 'Dr. Sumit Gupta', 'Dr. Nisha Patel',
    'Dr. Rajiv Kumar', 'Dr. Seema Verma', 'Dr. Karan Sharma', 'Dr. Pooja Singh',
    'Dr. Aditya Reddy', 'Dr. Megha Desai'
  ],
  Neurology: [
    'Dr. Sandeep Kumar', 'Dr. Shruti Iyer', 'Dr. Rohit Sharma', 'Dr. Anjali Nair',
    'Dr. Vishal Patel', 'Dr. Rachna Verma', 'Dr. Gaurav Singh', 'Dr. Preeti Gupta',
    'Dr. Aryan Reddy', 'Dr. Isha Bhat'
  ],
  Ophthalmology: [
    'Dr. Prakash Desai', 'Dr. Ananya Sharma', 'Dr. Nitin Gupta', 'Dr. Divya Iyer',
    'Dr. Sanjiv Patel', 'Dr. Kavya Verma', 'Dr. Manmohan Singh', 'Dr. Priya Reddy',
    'Dr. Vikram Nair', 'Dr. Geeta Malhotra'
  ],
  ENT: [
    'Dr. Harish Kumar', 'Dr. Simran Sharma', 'Dr. Anil Patel', 'Dr. Nanda Gupta',
    'Dr. Rajesh Verma', 'Dr. Pooja Iyer', 'Dr. Sanjay Singh', 'Dr. Anita Desai',
    'Dr. Ajay Reddy', 'Dr. Savita Mishra'
  ],
  Psychiatry: [
    'Dr. Sameer Khan', 'Dr. Priya Nair', 'Dr. Arjun Sharma', 'Dr. Divya Patel',
    'Dr. Ravi Gupta', 'Dr. Isha Verma', 'Dr. Vikram Singh', 'Dr. Anjali Iyer',
    'Dr. Rohit Reddy', 'Dr. Kavya Desai'
  ],
  Dermatology: [
    'Dr. Nikhil Verma', 'Dr. Shruti Singh', 'Dr. Sanjay Patel', 'Dr. Meera Sharma',
    'Dr. Arun Gupta', 'Dr. Pooja Iyer', 'Dr. Vishal Nair', 'Dr. Priya Reddy',
    'Dr. Gaurav Malhotra', 'Dr. Anita Bhat'
  ],
  Oncology: [
    'Dr. Rajeev Sharma', 'Dr. Ananya Gupta', 'Dr. Suresh Patel', 'Dr. Nisha Verma',
    'Dr. Amit Singh', 'Dr. Isha Iyer', 'Dr. Vikram Reddy', 'Dr. Priya Desai',
    'Dr. Arjun Malhotra', 'Dr. Divya Nair'
  ]
}

async function seedFinal() {
  try {
    console.log('🌱 Seeding FINAL configuration...\n')

    // 1. Organization
    const org = await db.organization.upsert({
      where: { id: 'org-demo' },
      update: {},
      create: {
        id: 'org-demo',
        name: 'GudMed Hospital',
        slug: 'gudmed',
        primaryColor: '#2E4168',
      },
    })
    console.log('✅ Organization: GudMed Hospital\n')

    // 2. Create 10 Departments
    const departments = [
      { name: 'Cardiology', code: 'CARD' },
      { name: 'General Medicine', code: 'GM' },
      { name: 'Pediatrics', code: 'PED' },
      { name: 'Orthopedics', code: 'ORTHO' },
      { name: 'Neurology', code: 'NEURO' },
      { name: 'Ophthalmology', code: 'OPHTHO' },
      { name: 'ENT', code: 'ENT' },
      { name: 'Psychiatry', code: 'PSY' },
      { name: 'Dermatology', code: 'DERM' },
      { name: 'Oncology', code: 'ONC' },
    ]

    const deptMap = {}
    for (const dept of departments) {
      const d = await db.department.upsert({
        where: { id: `dept-${dept.code}` },
        update: {},
        create: {
          id: `dept-${dept.code}`,
          organizationId: 'org-demo',
          name: dept.name,
          code: dept.code,
        },
      }).catch(() => null)

      if (d) {
        deptMap[dept.name] = d.id
        console.log(`✅ ${dept.name}`)
      }
    }
    console.log('')

    // 3. Create 100 Doctors with VARYING commission rates
    const commissionRates = [50, 10, 15, 20, 30]
    const doctors = []
    let doctorCount = 0

    for (const dept of departments) {
      const deptNames = doctorNames[dept.name] || []

      for (let i = 0; i < 10; i++) {
        doctorCount++
        const doctorName = deptNames[i] || `Dr. ${dept.name} ${i + 1}`
        const commissionRate = commissionRates[i % commissionRates.length]

        const doctor = await db.user.upsert({
          where: { id: `doc-${String(doctorCount).padStart(3, '0')}` },
          update: {
            fullName: doctorName,
            specialization: dept.name,
            consultationFee: 500,
          },
          create: {
            id: `doc-${String(doctorCount).padStart(3, '0')}`,
            organizationId: 'org-demo',
            fullName: doctorName,
            email: `doc${doctorCount}@gudmed.in`,
            role: 'doctor',
            departmentId: deptMap[dept.name],
            specialization: dept.name,
            consultationFee: 500,
            isActive: true,
          },
        })
        doctors.push({ ...doctor, commissionRate })
      }
      console.log(`✅ ${dept.name} (10 doctors)`)
    }
    console.log(`\n✅ Total: 100 doctors created\n`)

    // 4. Setup Commission Config for ALL 100 doctors with VARYING rates
    console.log('💰 Setting up commission configs (VARYING rates)...')
    const commissionRateMap = {
      0: 50,  // 50%
      1: 10,  // 10%
      2: 15,  // 15%
      3: 20,  // 20%
      4: 30,  // 30%
    }

    let configCount = 0
    for (let i = 0; i < doctors.length; i++) {
      const doctor = doctors[i]
      const rate = commissionRates[i % commissionRates.length]

      await db.doctorCommissionConfig.upsert({
        where: { doctorId: doctor.id },
        update: { commissionRate: rate },
        create: {
          organizationId: 'org-demo',
          doctorId: doctor.id,
          commissionType: 'percentage',
          commissionRate: rate,
          isActive: true,
        },
      }).catch(() => null)
      configCount++
    }
    console.log(`✅ Commission configs: ${configCount} (rates: 50%, 10%, 15%, 20%, 30%)\n`)

    // 5. Create OPD Services with VARYING charges
    console.log('🏥 Creating OPD services with VARYING charges...')
    const opdCharges = [100, 200, 300, 500, 1500]
    const services = []

    for (const charge of opdCharges) {
      const service = await db.billingService.upsert({
        where: { id: `opd-${charge}` },
        update: {},
        create: {
          id: `opd-${charge}`,
          organizationId: 'org-demo',
          serviceName: `OPD Consultation - ₹${charge}`,
          serviceCategory: 'consultation',
          unitPrice: charge,
          isActive: true,
        },
      }).catch(() => null)

      if (service) {
        services.push(service)
        console.log(`✅ OPD Service: ₹${charge}`)
      }
    }
    console.log(`\n✅ Created ${services.length} OPD services\n`)

    // 6. Create 20 Patients
    console.log('👥 Creating 20 test patients...')
    const patientFirstNames = ['Ramesh', 'Priya', 'Amit', 'Divya', 'Rajesh']
    const patientLastNames = ['Singh', 'Sharma', 'Patel', 'Verma', 'Gupta']

    const patients = []
    for (let i = 1; i <= 20; i++) {
      const firstName = patientFirstNames[(i - 1) % patientFirstNames.length]
      const lastName = patientLastNames[(i - 1) % patientLastNames.length]

      const patient = await db.patient.upsert({
        where: { mrn: `MRN${String(i).padStart(6, '0')}` },
        update: {},
        create: {
          organizationId: 'org-demo',
          mrn: `MRN${String(i).padStart(6, '0')}`,
          firstName: firstName,
          lastName: lastName,
          dateOfBirth: new Date('1985-01-01'),
          gender: i % 2 === 0 ? 'male' : 'female',
          isActive: true,
        },
      }).catch(() => null)

      if (patient) patients.push(patient)
    }
    console.log(`✅ Created ${patients.length} test patients\n`)

    // 7. Create Test Appointments (ONLY for 10 sample doctors)
    console.log('📅 Creating test appointments for sample doctors...')
    const sampleDoctors = doctors.slice(0, 10)
    let appointmentCount = 0
    let commissionCount = 0

    for (let i = 0; i < 20; i++) {
      const doctor = sampleDoctors[i % sampleDoctors.length]
      const patient = patients[i % patients.length]
      const opdService = services[i % services.length]
      const appointmentDate = new Date()
      appointmentDate.setDate(appointmentDate.getDate() - (i % 5))

      // Create appointment
      const appointment = await db.appointment.create({
        data: {
          organizationId: 'org-demo',
          patientId: patient.id,
          doctorId: doctor.id,
          appointmentDate,
          appointmentTime: '10:00',
          appointmentType: 'new_patient',
          status: 'completed',
          consultationFee: opdService.unitPrice,
          },
      }).catch(() => null)

      if (appointment) {
        // Create invoice with unique number
        const invoiceNum = `INV${Date.now()}${String(i).padStart(3, '0')}`
        const invoice = await db.invoice.create({
          data: {
            organizationId: 'org-demo',
            patientId: patient.id,
            invoiceNumber: invoiceNum,
            items: JSON.stringify([{
              type: 'consultation',
              description: `${doctor.fullName} - Consultation`,
              quantity: 1,
              unitPrice: opdService.unitPrice,
              discount: 0,
              tax: 0,
              total: opdService.unitPrice,
            }]),
            subtotal: opdService.unitPrice,
            totalAmount: opdService.unitPrice,
            status: 'sent',
            paymentStatus: 'unpaid',
          },
        })

        // AUTO-CREATE COMMISSION (only when appointment is created)
        const commissionConfig = await db.doctorCommissionConfig.findUnique({
          where: { doctorId: doctor.id },
        })

        if (commissionConfig && commissionConfig.isActive) {
          const commissionAmount = (opdService.unitPrice * commissionConfig.commissionRate) / 100

          await db.doctorCommission.create({
            data: {
              organizationId: 'org-demo',
              doctorId: doctor.id,
              invoiceId: invoice.id,
              invoiceAmount: opdService.unitPrice,
              commissionRate: commissionConfig.commissionRate,
              commissionType: commissionConfig.commissionType,
              commissionAmount,
              status: 'pending',
            },
          }).catch(() => null)
          commissionCount++
        }
        appointmentCount++
      }
    }
    console.log(`✅ Appointments created: ${appointmentCount}`)
    console.log(`✅ Commissions auto-generated: ${commissionCount}\n`)

    // 8. Statistics
    console.log('\n' + '='.repeat(70))
    console.log('📊 FINAL CONFIGURATION SUMMARY')
    console.log('='.repeat(70) + '\n')

    console.log('🏥 Organization: GudMed Hospital')
    console.log('🏢 Departments: 10')
    console.log('👨‍⚕️  Doctors: 100 (10 per department)')
    console.log('💰 Commission Rates: 50%, 10%, 15%, 20%, 30% (distributed)')
    console.log('🏥 OPD Services: 5 (₹100, ₹200, ₹300, ₹500, ₹1500)')
    console.log('👥 Test Patients: 20')
    console.log('📅 Test Appointments: 20 (for 10 sample doctors)')
    console.log(`💳 Commissions Auto-Generated: ${commissionCount}\n`)

    console.log('✨ SAMPLE DATA:')
    console.log(`   Doctor 1: ${sampleDoctors[0]?.fullName} (${sampleDoctors[0]?.commissionRate}% commission)`)
    console.log(`   Doctor 2: ${sampleDoctors[1]?.fullName} (${sampleDoctors[1]?.commissionRate}% commission)`)
    console.log(`   Doctor 10: ${sampleDoctors[9]?.fullName} (${sampleDoctors[9]?.commissionRate}% commission)\n`)

    console.log('🎉 READY TO TEST!\n')
    console.log('✅ How the system works:')
    console.log('   1. Patient selects department → sees doctors')
    console.log('   2. Patient selects doctor → sees OPD charges')
    console.log('   3. Patient books appointment')
    console.log('   4. ✨ COMMISSION AUTO-GENERATES based on:')
    console.log('      • Doctor\'s commission rate (50%, 10%, 15%, 20%, 30%)')
    console.log('      • OPD charge selected (₹100, ₹200, ₹300, ₹500, ₹1500)')
    console.log('   5. Admin settles commission in Settlement tab\n')

    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
}

seedFinal()
