import { db } from './src/config/db.js'

async function seedPharmacyInventory() {
  try {
    console.log('💊 PHARMACY INVENTORY SEEDING STARTED\n')

    const orgId = 'org-demo'
    const drugs = await db.pharmacyDrug.findMany({
      where: { organizationId: orgId, isActive: true }
    })

    console.log(`📊 Total drugs to update: ${drugs.length}\n`)

    let updatedCount = 0
    for (let i = 0; i < drugs.length; i++) {
      const drug = drugs[i]
      // Add random quantity between 50 and 500
      const randomQuantity = Math.floor(Math.random() * 450) + 50
      const sellingPrice = drug.sellingPrice || 100

      await db.pharmacyDrug.update({
        where: { id: drug.id },
        data: {
          quantityInStock: randomQuantity
        }
      })

      updatedCount++
      if (updatedCount % 10 === 0) {
        console.log(`⏳ Progress: ${updatedCount}/${drugs.length} drugs updated...`)
      }
    }

    // Get total stock value
    const updatedDrugs = await db.pharmacyDrug.findMany({
      where: { organizationId: orgId, isActive: true }
    })

    const totalStockValue = updatedDrugs.reduce((sum, drug) => {
      return sum + ((drug.quantityInStock || 0) * (drug.sellingPrice || 0))
    }, 0)

    console.log('\n' + '='.repeat(70))
    console.log('💊 PHARMACY INVENTORY SEEDING COMPLETE')
    console.log('='.repeat(70))
    console.log(`✅ Drugs Updated: ${updatedCount}`)
    console.log(`✅ Total Stock Value: ₹${totalStockValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
    console.log(`✅ Average Stock per Drug: ${(totalStockValue / updatedCount).toFixed(2)}`)

    const lowStockDrugs = updatedDrugs.filter(d => (d.quantityInStock || 0) <= 50)
    console.log(`⚠️  Low Stock Drugs (≤50): ${lowStockDrugs.length}`)

    console.log(`\n🎉 Pharmacy inventory populated successfully!`)
    process.exit(0)
  } catch (err) {
    console.error('❌ Critical error:', err.message)
    process.exit(1)
  }
}

seedPharmacyInventory()
