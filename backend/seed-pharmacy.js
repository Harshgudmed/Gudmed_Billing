#!/usr/bin/env node
/**
 * Seed the client's medicine list into the PharmacyDrug catalog (LOCAL DB),
 * then push with `node upload-to-prod.js`.
 * Per requirement: NO brand name — drugName uses the Salt (generic) + strength.
 * Idempotent: deterministic ids (med-NNN).
 */
import { db } from './src/config/db.js'
import { MEDICINES } from './pharmacy-data.js'

const ORG = 'org-demo'
const pad = (n, l = 3) => String(n).padStart(l, '0')

const RX_CATEGORIES = /immunosuppress|antibiotic|anti-viral|antiviral|hepatitis|rheumatoid|steroid|corticosteroid|insulin|diabet|anti epileptic|erythropoietin|transplant|chemotherapy|anti fungal|bleeding|cardiovascular/i

async function main() {
  console.log(`Seeding ${MEDICINES.length} medicines into PharmacyDrug catalog...`)
  let ok = 0, fail = 0
  for (let i = 0; i < MEDICINES.length; i++) {
    const [generic, strength, form, category, cost, mrp, company] = MEDICINES[i]
    const name = `${generic}${strength ? ' ' + strength : ''}`.trim()
    const id = `med-${pad(i + 1)}`
    // realistic stock; some low for restock-alert realism
    const stock = Math.random() < 0.2 ? Math.floor(Math.random() * 18) : 50 + Math.floor(Math.random() * 450)
    const data = {
      organizationId: ORG,
      drugName: name,
      genericName: generic,
      brandName: null,                       // ← no brand, per requirement
      drugCategory: category || null,
      dosageForm: form || null,
      strength: strength || null,
      quantityInStock: stock,
      unitOfMeasure: form || null,
      reorderLevel: 20,
      costPrice: cost || 0,
      sellingPrice: mrp || 0,
      requiresPrescription: RX_CATEGORIES.test(category || ''),
      supplierName: company || null,
      isActive: true,
      updatedAt: new Date(),
    }
    try {
      await db.pharmacyDrug.upsert({ where: { id }, update: data, create: { id, ...data } })
      ok++
    } catch (e) {
      fail++
      if (fail <= 3) console.log(`  ${id}: ${e.message.slice(0, 90)}`)
    }
  }
  console.log(`✅ Medicines: ${ok} seeded${fail ? `, ${fail} failed` : ''}`)
  const total = await db.pharmacyDrug.count({ where: { organizationId: ORG } })
  console.log(`   Total pharmacy drugs now: ${total}`)
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) }).finally(() => db.$disconnect())
