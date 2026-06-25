import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({ select: { role: true, email: true, fullName: true } })
  console.log(users)
}

main().finally(() => prisma.$disconnect())
