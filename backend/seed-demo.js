import { db } from './src/config/db.js'

async function seedDemo() {
  try {
    console.log('🌱 Seeding demo data...')

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
    console.log('✅ Organization:', org.name)

    // 2. Create doctors
    const doctors = []
    for (const docData of [
      { id: 'doc1', name: 'Dr. Rahul Verma', spec: 'Cardiology', fee: 1000 },
      { id: 'doc2', name: 'Dr. Priya Sharma', spec: 'General Medicine', fee: 800 },
      { id: 'doc3', name: 'Dr. Suresh Patel', spec: 'Pediatrics', fee: 600 },
    ]) {
      const doc = await db.user.upsert({
        where: { email: `${docData.id}@gudmed.in` },
        update: {},
        create: {
          id: docData.id,
          organizationId: 'org-demo',
          fullName: docData.name,
          email: `${docData.id}@gudmed.in`,
          role: 'doctor',
          specialization: docData.spec,
          consultationFee: docData.fee,
          isActive: true,
        },
      })
      doctors.push(doc)
      console.log(`✅ Doctor: ${doc.fullName} (₹${docData.fee})`)
    }

    // 3. Create commission configs
    for (const doc of doctors) {
      await db.doctorCommissionConfig.upsert({
        where: { doctorId: doc.id },
        update: {},
        create: {
          organizationId: 'org-demo',
          doctorId: doc.id,
          commissionType: 'percentage',
          commissionRate: 20,
          isActive: true,
        },
      })
      console.log(`✅ Commission config: ${doc.fullName} (20%)`)
    }

    // 4. Create fee slabs for first doctor
    const slabs = [
      { fromDays: 0, toDays: 3, feeAmount: 0, notes: 'Free follow-up' },
      { fromDays: 3, toDays: 15, feeAmount: 500, notes: 'Discounted follow-up' },
      { fromDays: 15, toDays: 30, feeAmount: 300, notes: 'Further discounted' },
    ]
    for (const slab of slabs) {
      await db.doctorFeeSlab.create({
        data: {
          organizationId: 'org-demo',
          doctorId: doctors[0].id,
          ...slab,
          isActive: true,
        },
      })
      console.log(`✅ Slab: ${slab.fromDays}-${slab.toDays} days = ₹${slab.feeAmount}`)
    }

    // 5. Create patients
    const patients = []
    for (let i = 1; i <= 3; i++) {
      const patient = await db.patient.create({
        data: {
          organizationId: 'org-demo',
          mrn: `MRN${String(i).padStart(5, '0')}`,
          firstName: `Patient`,
          lastName: `${i}`,
          dateOfBirth: new Date('1990-01-01'),
          gender: 'male',
          isActive: true,
        },
      })
      patients.push(patient)
      console.log(`✅ Patient: ${patient.firstName} ${patient.lastName}`)
    }

    // 6. Create billing service
    const service = await db.billingService.create({
      data: {
        organizationId: 'org-demo',
        serviceName: 'OPD Consultation',
        serviceCategory: 'consultation',
        unitPrice: 500,
        isActive: true,
      },
    })
    console.log(`✅ Billing Service: ${service.serviceName}`)

    console.log('\n🎉 Demo data seeded successfully!')
    console.log('\n📋 Demo Doctors:')
    doctors.forEach(d => console.log(`   - ${d.fullName} (₹${d.consultationFee})`))
    console.log('\n👥 Demo Patients:')
    patients.forEach(p => console.log(`   - ${p.firstName} ${p.lastName} (MRN: ${p.mrn})`))
    console.log('\n💡 Try this:')
    console.log('   1. Go to Doctor Accountability → Fee Structure')
    console.log('   2. Select Dr. Rahul Verma (slabs already set)')
    console.log('   3. Create appointment with Patient 1')
    console.log('   4. Check Commissions tab for auto-generated commission')

    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    process.exit(1)
  }
}

seedDemo()
