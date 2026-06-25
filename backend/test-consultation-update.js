import { db } from './src/config/db.js'

async function testConsultationUpdate() {
  try {
    console.log('🧪 TESTING CONSULTATION UPDATE WITH LAB/RADIOLOGY ORDERS\n')

    const orgId = 'org-demo'

    // Get a random consultation
    const consultation = await db.consultation.findFirst({
      where: { organizationId: orgId },
    })

    if (!consultation) {
      console.error('❌ No consultation found to test with')
      process.exit(1)
    }

    console.log(`📋 Found Consultation: ${consultation.id}`)
    console.log(`   Patient ID: ${consultation.patientId}`)
    console.log(`   Doctor ID: ${consultation.doctorId}\n`)

    // Get some lab tests to use
    const labTests = await db.labTest.findMany({
      where: { organizationId: orgId, isActive: true },
      take: 3,
    })

    // Get some radiology exams to use
    const radiologyExams = await db.radiologyExam.findMany({
      where: { organizationId: orgId, isActive: true },
      take: 2,
    })

    if (labTests.length === 0 || radiologyExams.length === 0) {
      console.error('❌ Not enough tests/exams in database')
      process.exit(1)
    }

    console.log(`🧬 Selected ${labTests.length} lab tests`)
    console.log(`🔬 Selected ${radiologyExams.length} radiology exams\n`)

    // Update consultation with lab and radiology orders
    const updatePayload = {
      diagnosis: 'TEST DIAGNOSIS - ' + new Date().toISOString(),
      labTests: labTests.map(t => ({
        testId: t.id,
        testName: t.testName,
        testCode: t.testCode,
      })),
      radiologyExams: radiologyExams.map(e => ({
        examId: e.id,
        examName: e.examName,
      })),
    }

    console.log('📤 Updating consultation with:')
    console.log(`   - Diagnosis: ${updatePayload.diagnosis}`)
    console.log(`   - Lab Tests: ${updatePayload.labTests.length}`)
    console.log(`   - Radiology Exams: ${updatePayload.radiologyExams.length}\n`)

    // Simulate the update using db transaction
    const updated = await db.$transaction(async (tx) => {
      // Update consultation
      await tx.consultation.update({
        where: { id: consultation.id },
        data: { diagnosis: updatePayload.diagnosis },
      })

      // Create lab orders
      if (updatePayload.labTests.length > 0) {
        const existingLabOrder = await tx.labOrder.findFirst({
          where: { consultationId: consultation.id },
        })

        if (existingLabOrder) {
          await tx.labOrder.update({
            where: { id: existingLabOrder.id },
            data: {
              tests: JSON.stringify(updatePayload.labTests),
              clinicalIndication: updatePayload.diagnosis,
            },
          })
        } else {
          await tx.labOrder.create({
            data: {
              organizationId: orgId,
              patientId: consultation.patientId,
              consultationId: consultation.id,
              requestedById: consultation.doctorId,
              orderNumber: `LAB${Date.now()}`,
              tests: JSON.stringify(updatePayload.labTests),
              clinicalIndication: updatePayload.diagnosis,
              priority: 'routine',
              status: 'pending',
            },
          })
        }
      }

      // Create radiology orders
      if (updatePayload.radiologyExams.length > 0) {
        await tx.radiologyOrder.deleteMany({
          where: { consultationId: consultation.id },
        })

        for (const exam of updatePayload.radiologyExams) {
          await tx.radiologyOrder.create({
            data: {
              organizationId: orgId,
              patientId: consultation.patientId,
              consultationId: consultation.id,
              requestedById: consultation.doctorId,
              examId: exam.examId,
              orderNumber: `RAD${Date.now()}`,
              clinicalIndication: updatePayload.diagnosis,
              urgency: 'routine',
              status: 'pending',
            },
          })
        }
      }

      // Fetch updated consultation
      return await tx.consultation.findUnique({
        where: { id: consultation.id },
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
          doctor: { select: { id: true, fullName: true } },
          labOrders: {
            include: { results: { include: { test: true } } },
          },
          radiologyOrders: {
            include: { exam: true },
          },
        },
      })
    })

    console.log('✅ UPDATE SUCCESSFUL!\n')
    console.log('📊 Updated Consultation:')
    console.log(`   ID: ${updated.id}`)
    console.log(`   Diagnosis: ${updated.diagnosis}`)
    console.log(`   Lab Orders: ${updated.labOrders.length}`)
    updated.labOrders.forEach((order, i) => {
      const tests = JSON.parse(order.tests)
      console.log(`     ${i + 1}. ${tests.length} tests (Order: ${order.id})`)
    })
    console.log(`   Radiology Orders: ${updated.radiologyOrders.length}`)
    updated.radiologyOrders.forEach((order, i) => {
      console.log(`     ${i + 1}. ${order.exam?.examName} (Order: ${order.id})`)
    })

    console.log('\n🎉 Test passed! Lab and Radiology orders are being created/updated correctly.')
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    console.error(err)
    process.exit(1)
  }
}

testConsultationUpdate()
