import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const priya = await prisma.user.findUnique({ where: { email: 'priya@gudmed.in' } })
  console.log('Priya exists:', !!priya, 'Password Hash:', !!priya?.passwordHash)
}

main().finally(() => prisma.$disconnect())
 