// Idempotent seed for the enterprise IPD tariff engine.
// Creates: bed categories, a default CASH tariff plan, per-category service rules,
// and a starter charge master. Re-running updates in place (no duplicates).
//
//   node scripts/seed-ipd-tariff.mjs
//
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const ORG = process.env.ORGANIZATION_ID || 'org-demo'

// ── Bed categories (rank = escalation order; rate = fallback bed/day) ──────────
const CATEGORIES = [
  { code: 'GEN',    name: 'General Ward',     rank: 1,  defaultBedDayRate: 1000,  isCritical: false },
  { code: 'SEMI',   name: 'Semi-Private',     rank: 2,  defaultBedDayRate: 2000,  isCritical: false },
  { code: 'PVT',    name: 'Private Room',     rank: 3,  defaultBedDayRate: 3500,  isCritical: false },
  { code: 'DLX',    name: 'Deluxe Room',      rank: 4,  defaultBedDayRate: 5000,  isCritical: false },
  { code: 'SUITE',  name: 'Suite Room',       rank: 5,  defaultBedDayRate: 8000,  isCritical: false },
  { code: 'VIP',    name: 'VIP Room',         rank: 6,  defaultBedDayRate: 12000, isCritical: false },
  { code: 'HDU',    name: 'HDU',              rank: 7,  defaultBedDayRate: 6000,  isCritical: true  },
  { code: 'ICU',    name: 'ICU',              rank: 8,  defaultBedDayRate: 10000, isCritical: true  },
  { code: 'NICU',   name: 'NICU',             rank: 9,  defaultBedDayRate: 9000,  isCritical: true  },
  { code: 'PICU',   name: 'PICU',             rank: 10, defaultBedDayRate: 9000,  isCritical: true  },
  { code: 'ISO',    name: 'Isolation Room',   rank: 11, defaultBedDayRate: 4000,  isCritical: false },
  { code: 'BURNS',  name: 'Burns Unit',       rank: 12, defaultBedDayRate: 8000,  isCritical: true  },
]

// ── Per-category service multiplier (PERCENT). 0 = base price (General).
//    These are SEED DEFAULTS — fully editable later via TariffRule rows. ────────
const CATEGORY_UPLIFT = {
  GEN: 0, SEMI: 10, PVT: 20, DLX: 30, SUITE: 40, VIP: 50,
  HDU: 25, ICU: 35, NICU: 35, PICU: 35, ISO: 15, BURNS: 30,
}

// Service groups that inherit the room uplift (bed-day is priced separately by category rate)
const UPLIFTED_GROUPS = ['NURSING', 'DOCTOR_VISIT', 'PROCEDURE', 'LAB', 'RADIOLOGY', 'PHARMACY', 'CONSUMABLE']

// ── Starter charge master ─────────────────────────────────────────────────────
const CHARGES = [
  { code: 'BED-DAY',       name: 'Bed Charges (per day)',     serviceGroup: 'BED',          uom: 'per-day',  basePrice: 1000 },
  { code: 'NURS-DAY',      name: 'Nursing Charges (per day)', serviceGroup: 'NURSING',      uom: 'per-day',  basePrice: 500 },
  { code: 'DR-VISIT',      name: 'Doctor Visit',              serviceGroup: 'DOCTOR_VISIT', uom: 'per-visit', basePrice: 600 },
  { code: 'PROC-DRESS',    name: 'Dressing / Minor Procedure', serviceGroup: 'PROCEDURE',   uom: 'per-unit', basePrice: 300 },
  { code: 'CONS-GLOVES',   name: 'Consumables Kit',           serviceGroup: 'CONSUMABLE',   uom: 'per-unit', basePrice: 150 },
]

async function main() {
  console.log('Seeding IPD tariff engine for org:', ORG)

  // 1) Bed categories
  const catByCode = {}
  for (const c of CATEGORIES) {
    const row = await db.bedCategory.upsert({
      where: { organizationId_code: { organizationId: ORG, code: c.code } },
      update: { name: c.name, rank: c.rank, defaultBedDayRate: c.defaultBedDayRate, isCritical: c.isCritical, isActive: true },
      create: { organizationId: ORG, ...c, isActive: true },
    })
    catByCode[c.code] = row
  }
  console.log(`  ✓ ${CATEGORIES.length} bed categories`)

  // 2) Default CASH tariff plan
  let plan = await db.tariffPlan.findFirst({ where: { organizationId: ORG, payerType: 'CASH', isDefault: true } })
  if (!plan) {
    plan = await db.tariffPlan.create({
      data: { organizationId: ORG, name: 'Cash (Default)', payerType: 'CASH', isDefault: true, isActive: true },
    })
  }
  console.log('  ✓ default CASH plan:', plan.name)

  // 3) Charge master
  for (const ch of CHARGES) {
    await db.chargeMaster.upsert({
      where: { organizationId_code: { organizationId: ORG, code: ch.code } },
      update: { name: ch.name, serviceGroup: ch.serviceGroup, uom: ch.uom, basePrice: ch.basePrice, isActive: true },
      create: { organizationId: ORG, ...ch, isActive: true },
    })
  }
  console.log(`  ✓ ${CHARGES.length} charge-master items`)

  // 4) Tariff rules: for each category, a PERCENT uplift on uplifted service groups,
  //    plus an ABSOLUTE_OVERRIDE for the bed-day at the category's rate.
  //    Wipe existing rules for this plan first so re-seeding stays clean.
  await db.tariffRule.deleteMany({ where: { organizationId: ORG, planId: plan.id } })
  let ruleCount = 0
  for (const c of CATEGORIES) {
    const cat = catByCode[c.code]
    const uplift = CATEGORY_UPLIFT[c.code] ?? 0

    // Bed-day priced at the category's default rate (absolute override)
    await db.tariffRule.create({
      data: {
        organizationId: ORG, planId: plan.id, bedCategoryId: cat.id,
        serviceGroup: 'BED', adjustmentType: 'ABSOLUTE_OVERRIDE', adjustmentValue: c.defaultBedDayRate,
      },
    })
    ruleCount++

    // Service-group uplift (one rule per group keeps it explicit + editable)
    for (const group of UPLIFTED_GROUPS) {
      await db.tariffRule.create({
        data: {
          organizationId: ORG, planId: plan.id, bedCategoryId: cat.id,
          serviceGroup: group, adjustmentType: 'PERCENT', adjustmentValue: uplift,
        },
      })
      ruleCount++
    }
  }
  console.log(`  ✓ ${ruleCount} tariff rules`)

  console.log('Done.')
}

main()
  .catch((e) => { console.error('SEED FAILED:', e); process.exit(1) })
  .finally(() => db.$disconnect())
