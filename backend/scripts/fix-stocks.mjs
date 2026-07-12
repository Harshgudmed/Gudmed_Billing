import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('Fetching all pharmacy drugs...')
  const drugs = await db.pharmacyDrug.findMany()
  console.log(`Found ${drugs.length} drugs.`)

  let updatedDrugs = 0
  let updatedBatches = 0

  for (const drug of drugs) {
    // 1. Give every drug 1000 quantityInStock
    await db.pharmacyDrug.update({
      where: { id: drug.id },
      data: { quantityInStock: 1000 }
    })
    updatedDrugs++

    // 2. Find if it has batches
    const batches = await db.pharmacyBatch.findMany({
      where: { drugId: drug.id }
    })

    if (batches.length === 0) {
      // Create a default batch with 1000 stock expiring far in the future
      const expiry = new Date()
      expiry.setFullYear(expiry.getFullYear() + 2)
      
      await db.pharmacyBatch.create({
        data: {
          organizationId: drug.organizationId,
          drugId: drug.id,
          batchNumber: `B-AUTO-${Math.floor(Math.random() * 10000)}`,
          expiryDate: expiry,
          quantityReceived: 1000,
          quantityRemaining: 1000,
        }
      })
      updatedBatches++
    } else {
      // Update the first batch to have 1000 remaining
      // (This ensures stockService can find a valid batch when deducting stock)
      await db.pharmacyBatch.update({
        where: { id: batches[0].id },
        data: { quantityRemaining: 1000 }
      })
      updatedBatches++
    }
  }

  console.log(`✅ Success: Updated ${updatedDrugs} drugs and ensured ${updatedBatches} batches have 1000 stock each.`)
}

main()
  .catch((e) => {
    console.error('❌ Error updating stock:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
