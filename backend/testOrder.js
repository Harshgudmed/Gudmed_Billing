import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const order = await prisma.clinicalOrder.findFirst({ orderBy: { createdAt: 'desc' } })
  console.log('LATEST ORDER:', order)
  const charge = await prisma.ipdCharge.findFirst({ where: { sourceModule: order.orderType, sourceRef: order.id } })
  console.log('CHARGE:', charge)
}

main().catch(console.error).finally(() => prisma.$disconnect())
