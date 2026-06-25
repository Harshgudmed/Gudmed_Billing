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

async function seedWithRealNames() {
  try {
    console.log('🌱 Seeding 100 doctors with REAL NAMES...\n')

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
      const d = await db.department.create({
        data: {
          organizationId: 'org-demo',
          name: dept.name,
          code: dept.code,
        },
      }).catch(() => null)

      if (d) {
        deptMap[dept.name] = d.id
        console.log(`✅ Department: ${dept.name}`)
      }
    }
    console.log('')

    // 3. Create 100 Doctors with REAL NAMES
    const doctors = []
    const specializations = ['Senior Consultant', 'Consultant', 'Senior Doctor', 'Doctor']
    let doctorCount = 0

    for (const dept of departments) {
      const deptNames = doctorNames[dept.name] || []

      for (let i = 0; i < 10; i++) {
        doctorCount++
        const doctorName = deptNames[i] || `Dr. ${dept.name} ${i + 1}`

        const email = `doc${doctorCount}@gudmed.in`
        const doctor = await db.user.upsert({
          where: { id: `doc-${String(doctorCount).padStart(3, '0')}` },
          update: {
            fullName: doctorName,
            specialization: dept.name,
            consultationFee: 500 + (i * 100),
          },
          create: {
            id: `doc-${String(doctorCount).padStart(3, '0')}`,
            organizationId: 'org-demo',
            fullName: doctorName,
            email: email,
            role: 'doctor',
            departmentId: deptMap[dept.name],
            specialization: dept.name,
            consultationFee: 500 + (i * 100),
            isActive: true,
          },
        })
        doctors.push(doctor)
      }
      console.log(`✅ Created 10 doctors for ${dept.name}`)
    }
    console.log(`\n✅ Total doctors created: ${doctors.length}\n`)

    // 4. Create Commission Configs
    console.log('⚙️  Creating commission configs...')
    let configCount = 0
    for (const doctor of doctors) {
      await db.doctorCommissionConfig.create({
        data: {
          organizationId: 'org-demo',
          doctorId: doctor.id,
          commissionType: 'percentage',
          commissionRate: 20,
          isActive: true,
        },
      }).catch(() => null)
      configCount++
    }
    console.log(`✅ Commission configs created: ${configCount} (20% for all)\n`)

    // 5. Create Fee Slabs for first 30 doctors
    console.log('📊 Creating fee slabs for sample doctors...')
    const slabs = [
      { fromDays: 0, toDays: 3, feeAmount: 0, notes: 'Free follow-up' },
      { fromDays: 3, toDays: 15, feeAmount: 300, notes: 'Discounted' },
      { fromDays: 15, toDays: 30, feeAmount: 200, notes: 'Further discounted' },
    ]

    let slabCount = 0
    for (let i = 0; i < Math.min(30, doctors.length); i++) {
      for (const slab of slabs) {
        await db.doctorFeeSlab.create({
          data: {
            organizationId: 'org-demo',
            doctorId: doctors[i].id,
            ...slab,
            isActive: true,
          },
        }).catch(() => null)
        slabCount++
      }
    }
    console.log(`✅ Fee slabs created: ${slabCount} for first 30 doctors\n`)

    // 6. Create Patients
    console.log('👥 Creating 50 patients...')
    const patientFirstNames = ['Ramesh', 'Priya', 'Amit', 'Divya', 'Rajesh', 'Neha', 'Arun', 'Isha', 'Sanjay', 'Anjali']
    const patientLastNames = ['Singh', 'Sharma', 'Patel', 'Verma', 'Gupta', 'Kumar', 'Iyer', 'Nair', 'Reddy', 'Desai']

    const patients = []
    for (let i = 1; i <= 50; i++) {
      const firstName = patientFirstNames[(i - 1) % patientFirstNames.length]
      const lastName = patientLastNames[(i - 1) % patientLastNames.length]

      const patient = await db.patient.create({
        data: {
          organizationId: 'org-demo',
          mrn: `MRN${String(i).padStart(6, '0')}`,
          firstName: firstName,
          lastName: lastName,
          dateOfBirth: new Date('1985-01-01'),
          gender: i % 2 === 0 ? 'male' : 'female',
          isActive: true,
        },
      })
      patients.push(patient)
    }
    console.log(`✅ Created ${patients.length} patients\n`)

    // 7. Create Billing Service
    const service = await db.billingService.create({
      data: {
        organizationId: 'org-demo',
        serviceName: 'OPD Consultation',
        serviceCategory: 'consultation',
        unitPrice: 500,
        isActive: true,
      },
    }).catch(() => null)
    console.log(`✅ Billing Service created\n`)

    // 8. Create Test Appointments with Auto-Generated Commissions
    console.log('📅 Creating test appointments to generate commissions...')
    const appointmentCount = 50
    let commissionCount = 0

    for (let i = 0; i < appointmentCount; i++) {
      const doctor = doctors[i % doctors.length]
      const patient = patients[i % patients.length]
      const appointmentDate = new Date()
      appointmentDate.setDate(appointmentDate.getDate() - (i % 10))

      const appointment = await db.appointment.create({
        data: {
          organizationId: 'org-demo',
          patientId: patient.id,
          doctorId: doctor.id,
          appointmentDate,
          appointmentTime: '10:00',
          appointmentType: i % 3 === 0 ? 'follow_up' : 'new_patient',
          status: 'completed',
          consultationFee: doctor.consultationFee,
          },
      })

      const invoice = await db.invoice.create({
        data: {
          organizationId: 'org-demo',
          patientId: patient.id,
          invoiceNumber: `INV${String(i + 1).padStart(5, '0')}`,
          items: JSON.stringify([{
            type: 'consultation',
            description: `${doctor.fullName} - ${doctor.specialization}`,
            quantity: 1,
            unitPrice: doctor.consultationFee,
            discount: 0,
            tax: 0,
            total: doctor.consultationFee,
          }]),
          subtotal: doctor.consultationFee,
          totalAmount: doctor.consultationFee,
          status: 'sent',
          paymentStatus: 'unpaid',
        },
      })

      const commissionConfig = await db.doctorCommissionConfig.findUnique({
        where: { doctorId: doctor.id },
      })

      if (commissionConfig && commissionConfig.isActive) {
        const commissionAmount = (doctor.consultationFee * commissionConfig.commissionRate) / 100
        await db.doctorCommission.create({
          data: {
            organizationId: 'org-demo',
            doctorId: doctor.id,
            invoiceId: invoice.id,
            invoiceAmount: doctor.consultationFee,
            commissionRate: commissionConfig.commissionRate,
            commissionType: commissionConfig.commissionType,
            commissionAmount,
            status: 'pending',
          },
        })
        commissionCount++
      }
    }
    console.log(`✅ Created ${appointmentCount} appointments`)
    console.log(`✅ Generated ${commissionCount} commissions (auto)\n`)

    // 9. Statistics
    console.log('\n' + '='.repeat(70))
    console.log('📊 COMPLETE DEMO DATA SUMMARY')
    console.log('='.repeat(70) + '\n')

    const stats = await db.$transaction(async (tx) => {
      const doctorCount = await tx.user.count({ where: { organizationId: 'org-demo', role: 'doctor' } })
      const deptCount = await tx.department.count({ where: { organizationId: 'org-demo' } })
      const patientCount = await tx.patient.count({ where: { organizationId: 'org-demo' } })
      const appointmentCount = await tx.appointment.count({ where: { organizationId: 'org-demo' } })
      const commissionData = await tx.doctorCommission.aggregate({
        where: { organizationId: 'org-demo' },
        _sum: { commissionAmount: true },
        _count: true,
      })

      return { doctorCount, deptCount, patientCount, appointmentCount, commissionData }
    })

    console.log(`🏥 Organization: GudMed Hospital`)
    console.log(`🏢 Departments: ${stats.deptCount}`)
    console.log(`👨‍⚕️  Doctors: ${stats.doctorCount} (10 per department)`)
    console.log(`👥 Patients: ${stats.patientCount}`)
    console.log(`📅 Appointments: ${stats.appointmentCount}`)
    console.log(`💰 Commissions: ${stats.commissionData._count}`)
    console.log(`📊 Total Commission Amount: ₹${(stats.commissionData._sum.commissionAmount || 0).toFixed(2)}`)
    console.log('\n' + '='.repeat(70) + '\n')

    console.log('✨ SAMPLE DOCTOR NAMES:')
    console.log(`   - ${doctors[0].fullName} (Cardiology)`)
    console.log(`   - ${doctors[10].fullName} (General Medicine)`)
    console.log(`   - ${doctors[20].fullName} (Pediatrics)`)
    console.log(`   - ${doctors[30].fullName} (Orthopedics)\n`)

    console.log('🎉 COMPLETE DEMO SETUP READY!\n')
    console.log('✅ Test the system:')
    console.log('   1. Open http://localhost:5174')
    console.log('   2. Doctor Accountability → Commissions (see auto-generated)')
    console.log('   3. Settlement tab (settle the pending commissions)')
    console.log('   4. Reports tab (view statistics)\n')

    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    console.error(err)
    process.exit(1)
  }
}

seedWithRealNames()
