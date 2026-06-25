import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const hash = await bcrypt.hash('Gudmed@123', 10)
  const patient = await prisma.patient.updateMany({
    where: { phonePrimary: '919845370254' },
    data: { passwordHash: hash }
  })
  console.log(`Updated ${patient.count} patient(s) with password 'Gudmed@123'`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
