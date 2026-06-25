import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const plan = await prisma.tariffPlan.findFirst()
  console.log('PLAN:', plan)
}

main().catch(console.error).finally(() => prisma.$disconnect())
