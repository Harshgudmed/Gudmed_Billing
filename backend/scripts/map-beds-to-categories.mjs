// One-time: assign each existing bed a BedCategory inferred from its ward type.
// Idempotent — safe to re-run. node scripts/map-beds-to-categories.mjs
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const ORG = process.env.ORGANIZATION_ID || 'org-demo'

// ward.type (lowercased) → bed category code
const WARD_TYPE_TO_CAT = {
  general: 'GEN', 'semi-private': 'SEMI', private: 'PVT', deluxe: 'DLX', suite: 'SUITE', vip: 'VIP',
  icu: 'ICU', hdu: 'HDU', nicu: 'NICU', picu: 'PICU', isolation: 'ISO', 'burn unit': 'BURNS',
  pediatric: 'GEN', maternity: 'GEN', emergency: 'GEN',
}

async function main() {
  const cats = await db.bedCategory.findMany({ where: { organizationId: ORG } })
  const catByCode = Object.fromEntries(cats.map((c) => [c.code, c.id]))
  const wards = await db.ward.findMany({ where: { organizationId: ORG }, include: { beds: true } })

  let updated = 0
  for (const w of wards) {
    const code = WARD_TYPE_TO_CAT[(w.type || '').trim().toLowerCase()] || 'GEN'
    const catId = catByCode[code]
    if (!catId) continue
    const res = await db.bed.updateMany({
      where: { wardId: w.id, organizationId: ORG },
      data: { bedCategoryId: catId },
    })
    updated += res.count
    console.log(`  ${w.name} (${w.type}) → ${code} : ${res.count} beds`)
  }
  console.log(`Done. ${updated} beds categorized.`)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
