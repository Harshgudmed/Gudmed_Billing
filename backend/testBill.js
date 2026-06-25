import { PrismaClient } from '@prisma/client'
import { computeRunningBill } from './src/inpatient/tariffService.js'

const prisma = new PrismaClient()

async function main() {
  const patient = await prisma.patient.findFirst({ where: { firstName: { contains: 'Ajay' }, lastName: { contains: 'Singh' } } })
  console.log('Patient:', patient.firstName, patient.lastName)

  const adm = await prisma.admission.findFirst({ where: { patientId: patient.id }, orderBy: { admissionDate: 'desc' } })
  console.log('Admission:', adm.id)

  const bill = await computeRunningBill('org-demo', adm.id)
  console.log('Bill:', JSON.stringify(bill, null, 2))
}

main().catch(console.error).finally(() => prisma.$disconnect())
