import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const orgId = 'org-demo'
  
  const existing = await prisma.tariffPlan.findFirst({ where: { organizationId: orgId } })
  if (!existing) {
    console.log('Creating default CASH tariff plan...')
    await prisma.tariffPlan.create({
      data: {
        id: 'plan-default-cash',
        organizationId: orgId,
        name: 'Standard Cash Plan',
        payerType: 'CASH',
        isDefault: true,
        isActive: true,
      }
    })
    console.log('Done.')
  } else {
    console.log('Plan already exists.')
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
