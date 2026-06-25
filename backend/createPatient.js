import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const patient = await prisma.patient.create({
    data: {
      organizationId: 'org-demo',
      mrn: `MRN${Math.floor(Math.random() * 900000) + 100000}`,
      firstName: 'Demo',
      lastName: 'Patient',
      phonePrimary: '919845370254',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'male',
      isActive: true,
    }
  })
  console.log('Created Patient:', patient)
}

main().catch(console.error).finally(() => prisma.$disconnect())
