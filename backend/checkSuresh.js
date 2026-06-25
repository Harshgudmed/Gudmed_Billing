import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
const prisma = new PrismaClient()

async function main() {
  const suresh = await prisma.user.findUnique({ where: { email: 'suresh@gudmed.in' } })
  console.log('Suresh:', suresh)
  if (suresh && suresh.passwordHash) {
     const ok = await bcrypt.compare('Gudmed@123', suresh.passwordHash)
     console.log('Password Match:', ok)
  }
}

main().finally(() => prisma.$disconnect())
