import { db } from './src/config/db.js'

async function seedComplete() {
  try {
    console.log('🌱 Seeding 100 doctors with complete commission system...\n')

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
      })
      deptMap[dept.code] = d.id
      console.log(`✅ Department: ${dept.name}`)
    }
    console.log('')

    // 3. Create 100 Doctors (10 per department)
    const doctors = []
    const specializations = ['Senior Consultant', 'Consultant', 'Senior Doctor', 'Doctor']
    let doctorCount = 0

    for (const dept of departments) {
      for (let i = 1; i <= 10; i++) {
        doctorCount++
        const doctor = await db.user.create({
          data: {
            id: `doc-${String(doctorCount).padStart(3, '0')}`,
            organizationId: 'org-demo',
            fullName: `Dr. ${dept.code}-${i}`,
            email: `doctor${doctorCount}@gudmed.in`,
            role: 'doctor',
            departmentId: deptMap[dept.code],
            specialization: specializations[i % 4],
            consultationFee: 500 + (i * 100),
            isActive: true,
          },
        })
        doctors.push(doctor)
      }
      console.log(`✅ Created 10 doctors for ${dept.name}`)
    }
    console.log(`\n✅ Total doctors created: ${doctors.length}\n`)

    // 4. Create Commission Configs for all doctors
    console.log('⚙️  Creating commission configs...')
    for (const doctor of doctors) {
      await db.doctorCommissionConfig.create({
        data: {
          organizationId: 'org-demo',
          doctorId: doctor.id,
          commissionType: 'percentage',
          commissionRate: 20,
          isActive: true,
        },
      })
    }
    console.log(`✅ Commission configs created (20% for all)\n`)

    // 5. Create Fee Slabs for first 20 doctors
    console.log('📊 Creating fee slabs for sample doctors...')
    const slabs = [
      { fromDays: 0, toDays: 3, feeAmount: 0, notes: 'Free follow-up' },
      { fromDays: 3, toDays: 15, feeAmount: 300, notes: 'Discounted' },
      { fromDays: 15, toDays: 30, feeAmount: 200, notes: 'Further discounted' },
    ]

    for (let i = 0; i < Math.min(20, doctors.length); i++) {
      for (const slab of slabs) {
        await db.doctorFeeSlab.create({
          data: {
            organizationId: 'org-demo',
            doctorId: doctors[i].id,
            ...slab,
            isActive: true,
          },
        })
      }
    }
    console.log(`✅ Fee slabs created for first 20 doctors\n`)

    // 6. Create Patients
    console.log('👥 Creating 50 patients...')
    const patients = []
    for (let i = 1; i <= 50; i++) {
      const patient = await db.patient.create({
        data: {
          organizationId: 'org-demo',
          mrn: `MRN${String(i).padStart(6, '0')}`,
          firstName: `Patient`,
          lastName: `${i}`,
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
    })
    console.log(`✅ Billing Service: ${service.serviceName}\n`)

    // 8. Create Test Appointments with Auto-Generated Commissions
    console.log('📅 Creating test appointments to generate commissions...')
    const appointmentCount = 30
    let commissionCount = 0

    for (let i = 0; i < appointmentCount; i++) {
      const doctor = doctors[i % doctors.length]
      const patient = patients[i % patients.length]
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
          consultationFee: doctor.consultationFee,
          },
      })

      // Create invoice
      const invoice = await db.invoice.create({
        data: {
          organizationId: 'org-demo',
          patientId: patient.id,
          invoiceNumber: `INV${String(i + 1).padStart(5, '0')}`,
          items: JSON.stringify([{
            type: 'consultation',
            description: `${doctor.fullName} - Consultation`,
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

      // Create commission (auto-generated)
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
    console.log('\n' + '='.repeat(60))
    console.log('📊 DEMO DATA SUMMARY')
    console.log('='.repeat(60) + '\n')

    const stats = await db.$transaction(async (tx) => {
      const doctorCount = await tx.user.count({ where: { organizationId: 'org-demo', role: 'doctor' } })
      const patientCount = await tx.patient.count({ where: { organizationId: 'org-demo' } })
      const appointmentCount = await tx.appointment.count({ where: { organizationId: 'org-demo' } })
      const invoiceCount = await tx.invoice.count({ where: { organizationId: 'org-demo' } })
      const commissionCount = await tx.doctorCommission.count({ where: { organizationId: 'org-demo' } })
      const pendingCommission = await tx.doctorCommission.aggregate({
        where: { organizationId: 'org-demo', status: 'pending' },
        _sum: { commissionAmount: true },
      })

      return { doctorCount, patientCount, appointmentCount, invoiceCount, commissionCount, pendingCommission }
    })

    console.log(`🏥 Organization: GudMed Hospital`)
    console.log(`👨‍⚕️  Doctors: ${stats.doctorCount}`)
    console.log(`👥 Patients: ${stats.patientCount}`)
    console.log(`📅 Appointments: ${stats.appointmentCount}`)
    console.log(`📄 Invoices: ${stats.invoiceCount}`)
    console.log(`💰 Commissions Generated: ${stats.commissionCount}`)
    console.log(`📊 Pending Commission Amount: ₹${(stats.pendingCommission._sum.commissionAmount || 0).toFixed(2)}`)
    console.log('\n' + '='.repeat(60) + '\n')

    console.log('🎉 COMPLETE DEMO SETUP READY!\n')
    console.log('✅ Test Instructions:')
    console.log('   1. Open http://localhost:5173')
    console.log('   2. Go to Doctor Accountability → Commissions')
    console.log('   3. See auto-generated commissions (pending)')
    console.log('   4. Go to Settlement tab')
    console.log('   5. Settle commissions to mark as paid')
    console.log('   6. Check Reports tab for statistics\n')

    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
}

seedComplete()
