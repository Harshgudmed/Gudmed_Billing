// The starting master data every hospital gets in Purchase: units of measure
// and a category tree. Without them the first screen a hospital opens is empty
// and nobody can add an item (an item needs a unit and a category).
//
// Created LAZILY — the first time a hospital opens Purchase — not when the
// hospital is created: there is no "new hospital" hook in this codebase, and
// hospitals that already exist in production must get them too. A separate
// one-off script would be one more thing to forget on every deploy.
//
// Only what is missing is ever added. A hospital that renames a category,
// retires a unit or builds its own tree keeps it: the seed never edits or
// re-creates a row the hospital already has.
//
// GST rates here only PREFILL a new item; every item's rate can be changed and
// should be confirmed with the hospital's CA.
import { db } from '../config/db.js'

// kind: count | pack | weight | length | volume | time
export const DEFAULT_UNITS = [
  { code: 'PCS', name: 'Piece', kind: 'count', allowsFraction: false },
  { code: 'BOX', name: 'Box', kind: 'pack', allowsFraction: false },
  { code: 'PACK', name: 'Pack', kind: 'pack', allowsFraction: false },
  { code: 'STRIP', name: 'Strip', kind: 'pack', allowsFraction: false },
  { code: 'BTL', name: 'Bottle', kind: 'pack', allowsFraction: false },
  { code: 'SET', name: 'Set', kind: 'count', allowsFraction: false },
  { code: 'PAIR', name: 'Pair', kind: 'count', allowsFraction: false },
  { code: 'ROLL', name: 'Roll', kind: 'pack', allowsFraction: false },
  { code: 'BAG', name: 'Bag', kind: 'pack', allowsFraction: false }, // cement
  { code: 'KG', name: 'Kilogram', kind: 'weight', allowsFraction: true },
  { code: 'G', name: 'Gram', kind: 'weight', allowsFraction: true },
  { code: 'TON', name: 'Tonne', kind: 'weight', allowsFraction: true }, // gravel
  { code: 'M', name: 'Metre', kind: 'length', allowsFraction: true }, // bed sheet fabric, cable
  { code: 'CFT', name: 'Cubic feet', kind: 'volume', allowsFraction: true }, // sand, gravel
  { code: 'L', name: 'Litre', kind: 'volume', allowsFraction: true },
  { code: 'ML', name: 'Millilitre', kind: 'volume', allowsFraction: true },
  { code: 'HR', name: 'Hour', kind: 'time', allowsFraction: true },
  { code: 'DAY', name: 'Day', kind: 'time', allowsFraction: true }, // manpower; half a day = 0.5
  { code: 'MONTH', name: 'Month', kind: 'time', allowsFraction: false }, // AMC, rent
  { code: 'YEAR', name: 'Year', kind: 'time', allowsFraction: false }, // software licence
]

// `code` is a category's permanent identity — the seed finds it by this, never
// by `name`, which the hospital may change. Codes are never shown and must
// never be edited once released; to retire a default, leave it here.
// A parent's purchaseType / expenseHead are defaults for the screen; the
// children are what items are filed under. defaultGstRate only PREFILLS a new
// item; null = no sensible single rate (cement is 28%, gravel 5%).
export const DEFAULT_CATEGORIES = [
  {
    code: 'MEDICAL', name: 'Medical', purchaseType: 'product', expenseHead: 'Medical Supplies', defaultGstRate: 12,
    children: [
      { code: 'MEDICINE', name: 'Medicine', purchaseType: 'product', expenseHead: 'Medicines', defaultGstRate: 12 },
      { code: 'MEDICAL_DEVICE', name: 'Medical device', purchaseType: 'product', expenseHead: 'Medical Equipment', defaultGstRate: 12 },
      { code: 'SURGICAL_CONSUMABLES', name: 'Surgical & consumables', purchaseType: 'product', expenseHead: 'Medical Consumables', defaultGstRate: 12 },
      { code: 'LAB_REAGENTS', name: 'Lab reagents', purchaseType: 'product', expenseHead: 'Lab Consumables', defaultGstRate: 12 },
    ],
  },
  {
    code: 'OFFICE_GENERAL', name: 'Office & General', purchaseType: 'product', expenseHead: 'Office Expenses', defaultGstRate: 18,
    children: [
      { code: 'FURNITURE', name: 'Furniture', purchaseType: 'product', expenseHead: 'Furniture (Asset)', defaultGstRate: 18 },
      { code: 'ELECTRONICS_APPLIANCES', name: 'Electronics & appliances', purchaseType: 'product', expenseHead: 'Equipment (Asset)', defaultGstRate: 18 },
      { code: 'IT_MOBILE', name: 'IT & mobile', purchaseType: 'product', expenseHead: 'IT Equipment (Asset)', defaultGstRate: 18 },
      { code: 'STATIONERY_PRINTING', name: 'Stationery & printing', purchaseType: 'product', expenseHead: 'Office Expenses', defaultGstRate: 18 },
    ],
  },
  {
    code: 'HOUSEKEEPING_LINEN', name: 'Housekeeping & Linen', purchaseType: 'product', expenseHead: 'Housekeeping', defaultGstRate: 18,
    children: [
      { code: 'LINEN', name: 'Linen', purchaseType: 'product', expenseHead: 'Linen', defaultGstRate: 5 },
      { code: 'CLEANING_SUPPLIES', name: 'Cleaning supplies', purchaseType: 'product', expenseHead: 'Housekeeping', defaultGstRate: 18 },
    ],
  },
  {
    code: 'MAINTENANCE_CIVIL', name: 'Maintenance & Civil', purchaseType: 'product', expenseHead: 'Repairs & Maintenance', defaultGstRate: 18,
    children: [
      { code: 'ELECTRICAL', name: 'Electrical', purchaseType: 'product', expenseHead: 'Repairs & Maintenance', defaultGstRate: 18 },
      { code: 'RAW_MATERIAL', name: 'Raw material', purchaseType: 'raw_material', expenseHead: 'Civil Works', defaultGstRate: null },
      // Added after the first release; hospitals made before get them on their
      // next visit, found by code like every default.
      { code: 'PLUMBING_CIVIL', name: 'Plumbing & civil', purchaseType: 'product', expenseHead: 'Repairs & Maintenance', defaultGstRate: 18 },
      { code: 'SAFETY_FIRE', name: 'Safety & fire', purchaseType: 'product', expenseHead: 'Safety & Fire', defaultGstRate: 18 },
    ],
  },
  {
    code: 'SERVICES', name: 'Services', purchaseType: 'service', expenseHead: 'Services', defaultGstRate: 18,
    children: [
      { code: 'AMC_REPAIRS', name: 'AMC & repairs', purchaseType: 'service', expenseHead: 'Repairs & Maintenance', defaultGstRate: 18 },
      { code: 'PROFESSIONAL_SERVICES', name: 'Professional services', purchaseType: 'service', expenseHead: 'Professional Fees', defaultGstRate: 18 },
    ],
  },
  { code: 'MANPOWER', name: 'Manpower', purchaseType: 'personnel', expenseHead: 'Manpower', defaultGstRate: 18, children: [] },
  { code: 'SOFTWARE_LICENCES', name: 'Software & Licences', purchaseType: 'licence', expenseHead: 'Software & Licences', defaultGstRate: 18, children: [] },
]

// Hospitals already checked in this server process. Saves a database round
// trip on every Purchase request; safe to lose on restart, and safe across
// several servers, because the work below is idempotent anyway.
const ensured = new Set()

/**
 * Make sure `organizationId` has the default units and categories.
 * Call it before reading units or categories; it returns immediately after the
 * first time.
 */
export async function ensurePurchaseDefaults(organizationId, client = db) {
  if (!organizationId || ensured.has(organizationId)) return

  await client.$transaction(async (tx) => {
    // Two people opening Purchase at the same moment would both find "no
    // categories" and both create the tree. The unique index cannot stop the
    // duplicate top-level rows (Postgres treats NULL parents as all different),
    // so the two requests take turns on a lock named after the hospital. It is
    // released automatically when this transaction ends.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'purchase-defaults:' + organizationId}))`

    // Units are matched by code, which never changes (isSystem), so adding the
    // missing ones is always safe — a renamed or retired unit keeps its code
    // and is skipped.
    await tx.unit.createMany({
      data: DEFAULT_UNITS.map((u) => ({ ...u, organizationId, isSystem: true })),
      skipDuplicates: true,
    })

    // Categories are matched by their permanent code, one by one, and only the
    // missing ones are created. So a default added in a later release reaches
    // hospitals that already have the rest, and one the hospital renamed,
    // retired or moved under another parent is found by its code and left
    // exactly as the hospital has it. (Matching by name, and planting the tree
    // only into a hospital with none, missed both — proven.)
    const existing = await tx.itemCategory.findMany({
      where: { organizationId, systemCode: { not: null } },
      select: { id: true, systemCode: true },
    })
    const idByCode = new Map(existing.map((c) => [c.systemCode, c.id]))
    const plant = async (def, parentId, sortOrder) => {
      // The hospital may already have made a category of this name in this
      // place itself (e.g. its own "Utilities" before we shipped one). Adopt
      // it — give it the code, change nothing else — rather than create a
      // twin: a same-name sibling would also break the (parent, name) unique
      // index and fail the whole seed, locking the hospital out of Purchase.
      const own = await tx.itemCategory.findFirst({
        where: { organizationId, parentId, systemCode: null, name: { equals: def.name, mode: 'insensitive' } },
        select: { id: true },
      })
      if (own) {
        await tx.itemCategory.update({ where: { id: own.id }, data: { systemCode: def.code, isSystem: true } })
        return own
      }
      return tx.itemCategory.create({
        data: {
          organizationId, parentId, systemCode: def.code, isSystem: true, name: def.name,
          purchaseType: def.purchaseType, expenseHead: def.expenseHead,
          defaultGstRate: def.defaultGstRate, sortOrder,
        },
      })
    }
    for (const [i, top] of DEFAULT_CATEGORIES.entries()) {
      if (!idByCode.has(top.code)) idByCode.set(top.code, (await plant(top, null, i)).id)
      for (const [j, child] of top.children.entries()) {
        if (!idByCode.has(child.code)) idByCode.set(child.code, (await plant(child, idByCode.get(top.code), j)).id)
      }
    }
  })

  ensured.add(organizationId)
}

/** Test hook: forget which hospitals were checked in this process. */
export function _resetPurchaseDefaultsCache() {
  ensured.clear()
}
