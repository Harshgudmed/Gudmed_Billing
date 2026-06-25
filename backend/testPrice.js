import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const lab = await prisma.labTest.findUnique({ where: { id: 'labtest-cat-0480' } })
  console.log('LAB TEST 0480:', lab)
}

main().catch(console.error).finally(() => prisma.$disconnect())
