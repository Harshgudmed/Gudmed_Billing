import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const occupancies = await prisma.bedOccupancy.findMany({ include: { bed: true } })
  console.log('Occupancies:', occupancies)
  
  for (const occ of occupancies) {
    if (occ.bed && occ.bed.bedCategoryId) {
       console.log('Updating occ:', occ.id, 'with cat:', occ.bed.bedCategoryId)
       await prisma.bedOccupancy.update({ where: { id: occ.id }, data: { bedCategoryId: occ.bed.bedCategoryId } })
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
