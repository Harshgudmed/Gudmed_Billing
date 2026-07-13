import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('Fetching all pharmacy drugs...')
  const drugs = await db.pharmacyDrug.findMany({
    select: { id: true, organizationId: true }
  })
  console.log(`Found ${drugs.length} drugs in the database. Updating in bulk...`)

  // 1. Bulk update all drugs to have 1000 in stock
  console.log('Bulk updating PharmacyDrug stock...')
  await db.pharmacyDrug.updateMany({
    data: { quantityInStock: 1000 }
  })

  // 2. Prepare batches to insert
  console.log('Preparing new batches for all drugs...')
  const expiry = new Date()
  expiry.setFullYear(expiry.getFullYear() + 2)

  // We will blindly create 1 new batch for every single drug in chunks
  // This is much faster than checking sequentially if they already have one
  const chunkSize = 10000
  let batchesInserted = 0

  for (let i = 0; i < drugs.length; i += chunkSize) {
    const chunk = drugs.slice(i, i + chunkSize)
    
    const batchData = chunk.map(d => ({
      organizationId: d.organizationId,
      drugId: d.id,
      batchNumber: `B-AUTO-${Math.floor(Math.random() * 10000)}`,
      expiryDate: expiry,
      quantityReceived: 1000,
      quantityRemaining: 1000,
    }))

    await db.pharmacyBatch.createMany({
      data: batchData,
      skipDuplicates: true // Just in case
    })
    
    batchesInserted += chunk.length
    console.log(`Inserted ${batchesInserted} / ${drugs.length} batches...`)
  }

  console.log(`✅ Success: Updated ${drugs.length} drugs and inserted ${batchesInserted} batches with 1000 stock each.`)
}

main()
  .catch((e) => {
    console.error('❌ Error updating stock:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
