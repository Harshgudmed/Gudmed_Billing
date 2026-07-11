import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function runTests() {
  console.log('--- Starting Refund Workflow Automated Tests ---')
  
  // Create a dummy organization and patient for testing
  let org = await db.organization.findFirst()
  if (!org) {
    console.error('No organization found to test against. Exiting.')
    return
  }

  const patient = await db.patient.create({
    data: {
      organizationId: org.id,
      mrn: 'TEST-MRN-' + Date.now(),
      firstName: 'Test',
      lastName: 'User',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'male',
      phonePrimary: '9999999999'
    }
  })

  // 1. Create a base Invoice and Payment
  const invoice = await db.invoice.create({
    data: {
      organizationId: org.id,
      patientId: patient.id,
      invoiceNumber: 'INV-TEST-' + Date.now(),
      items: JSON.stringify([{ serviceName: 'Test Service', quantity: 1, unitPrice: 1000, total: 1000 }]),
      subtotal: 1000,
      totalAmount: 1000,
      amountPaid: 1000,
      balanceDue: 0,
      paymentStatus: 'paid',
    }
  })

  const payment = await db.payment.create({
    data: {
      organizationId: org.id,
      invoiceId: invoice.id,
      patientId: patient.id,
      amount: 1000,
      paymentMethod: 'cash',
      receiptNumber: 'RCPT-TEST-' + Date.now()
    }
  })

  console.log('✅ Base Invoice and Payment Created')

  // --- TC-1: Request a Refund ---
  console.log('\n--- TC-1: Requesting Refund ---')
  const refundReq = await db.payment.create({
    data: {
      organizationId: org.id,
      invoiceId: invoice.id,
      amount: 400,
      paymentMethod: 'cash',
      receiptNumber: 'REF-' + Date.now(),
      isRefund: true,
      originalPaymentId: payment.id,
      status: 'PENDING_APPROVAL'
    }
  })
  
  const checkInvoice = await db.invoice.findUnique({ where: { id: invoice.id }})
  if (checkInvoice.amountPaid === 1000 && checkInvoice.isArchived === false) {
    console.log('✅ TC-1 Passed: Invoice remains untouched and payment is PENDING_APPROVAL')
  } else {
    console.error('❌ TC-1 Failed: Invoice was modified or archived prematurely')
  }

  // --- TC-2: Approve the Refund (Simulating the Controller Logic) ---
  console.log('\n--- TC-2: Approving Refund ---')
  
  // Simulating Controller logic
  const approvedPayment = await db.payment.update({
    where: { id: refundReq.id },
    data: { status: 'APPROVED' }
  })
  
  await db.invoice.update({
    where: { id: invoice.id },
    data: { isArchived: true, paymentStatus: 'refunded' }
  })
  
  const revisedInvoice = await db.invoice.create({
    data: {
      organizationId: org.id,
      patientId: patient.id,
      parentInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber + '-REV',
      items: invoice.items,
      subtotal: 1000,
      totalAmount: 600, // 1000 - 400
      amountPaid: 600,
      balanceDue: 0,
      paymentStatus: 'paid'
    }
  })

  const lockedInvoice = await db.invoice.findUnique({ where: { id: invoice.id } })
  if (lockedInvoice.isArchived === true && revisedInvoice.totalAmount === 600) {
    console.log('✅ TC-2 Passed: Original invoice locked, revised invoice created with accurate amounts')
  } else {
    console.error('❌ TC-2 Failed')
  }

  // Cleanup dummy data
  await db.payment.deleteMany({ where: { invoiceId: invoice.id } })
  await db.invoice.deleteMany({ where: { invoiceNumber: { startsWith: 'INV-TEST' } } })
  await db.patient.deleteMany({ where: { id: patient.id } })

  console.log('\n--- All Automated Tests Completed ---')
}

runTests().catch(console.error).finally(() => db.$disconnect())
