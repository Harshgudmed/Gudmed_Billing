import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const hash = await bcrypt.hash('Gudmed@123', 10)
  const user = await prisma.user.upsert({
    where: { email: 'reception@gudmed.in' },
    update: { passwordHash: hash },
    create: {
      id: 'user-reception1',
      organizationId: 'org-demo',
      email: 'reception@gudmed.in',
      fullName: 'Reception Desk',
      passwordHash: hash,
      role: 'receptionist',
      isActive: true
    }
  })
  console.log('Created Receptionist:', user.email)
}

main().catch(console.error).finally(() => prisma.$disconnect())
