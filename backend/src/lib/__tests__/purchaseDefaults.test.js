// The Purchase starting data (units + category tree) is created lazily and must
// be safe to run any number of times, from any number of requests at once, and
// must never undo what a hospital changed.
//
// Real-database tests on disposable organizations (same pattern as
// documentNumbers.test.js): the lock and the unique indexes live in Postgres,
// so a mock would prove nothing.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../../config/db.js'
import {
  ensurePurchaseDefaults, _resetPurchaseDefaultsCache, DEFAULT_UNITS, DEFAULT_CATEGORIES,
} from '../purchaseDefaults.js'

const TREE_SIZE = DEFAULT_CATEGORIES.reduce((n, c) => n + 1 + c.children.length, 0)
let orgA, orgB

before(async () => {
  const stamp = Date.now()
  orgA = await db.organization.create({ data: { name: 'Test Org A — purchaseDefaults.test.js', slug: `test-purchase-a-${stamp}` } })
  orgB = await db.organization.create({ data: { name: 'Test Org B — purchaseDefaults.test.js', slug: `test-purchase-b-${stamp}` } })
})

after(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } })
})

test('a new hospital gets every default unit and the whole category tree', async () => {
  _resetPurchaseDefaultsCache()
  await ensurePurchaseDefaults(orgA.id)
  assert.equal(await db.unit.count({ where: { organizationId: orgA.id } }), DEFAULT_UNITS.length)
  assert.equal(await db.itemCategory.count({ where: { organizationId: orgA.id } }), TREE_SIZE)
  const linen = await db.itemCategory.findFirst({ where: { organizationId: orgA.id, name: 'Linen' }, include: { parent: true } })
  assert.equal(linen.parent.name, 'Housekeeping & Linen')
  assert.equal(linen.defaultGstRate, 5)
  const raw = await db.itemCategory.findFirst({ where: { organizationId: orgA.id, name: 'Raw material' } })
  assert.equal(raw.purchaseType, 'raw_material')
  assert.equal(raw.defaultGstRate, null, 'no single GST rate fits cement and gravel')
  assert.equal(linen.systemCode, 'LINEN')
  assert.equal(linen.isSystem, true)
})

/** A throwaway hospital for one test, deleted afterwards whatever happens. */
async function withOrg(label, fn) {
  const org = await db.organization.create({ data: { name: `Test Org ${label} — purchaseDefaults.test.js`, slug: `test-purchase-${label}-${Date.now()}` } })
  try { await fn(org) } finally { await db.organization.delete({ where: { id: org.id } }) }
}

test('a hospital that already has one category still gets every missing default', async () => {
  await withOrg('partial', async (org) => {
    // The hospital made its own "Medical" before Purchase was ever opened.
    const own = await db.itemCategory.create({ data: { organizationId: org.id, name: 'Medical', purchaseType: 'product', expenseHead: 'Mine' } })
    _resetPurchaseDefaultsCache()
    await ensurePurchaseDefaults(org.id)
    assert.equal(await db.itemCategory.count({ where: { organizationId: org.id } }), TREE_SIZE, 'the rest of the tree was planted')
    const medical = await db.itemCategory.findMany({ where: { organizationId: org.id, parentId: null, name: 'Medical' } })
    assert.equal(medical.length, 1, 'no second "Medical" beside the hospital\'s own')
    assert.equal(medical[0].id, own.id, 'the hospital\'s own row was adopted…')
    assert.equal(medical[0].expenseHead, 'Mine', '…and left as the hospital set it')
    assert.equal(medical[0].systemCode, 'MEDICAL')
  })
})

test('a default added in a later release reaches a hospital that has the rest', async () => {
  await withOrg('later', async (org) => {
    _resetPurchaseDefaultsCache()
    await ensurePurchaseDefaults(org.id)
    DEFAULT_CATEGORIES.push({ code: 'UTILITIES', name: 'Utilities', purchaseType: 'service', expenseHead: 'Utilities', defaultGstRate: 18, children: [] })
    try {
      _resetPurchaseDefaultsCache()
      await ensurePurchaseDefaults(org.id)
      assert.equal(await db.itemCategory.count({ where: { organizationId: org.id, systemCode: 'UTILITIES' } }), 1)
      assert.equal(await db.itemCategory.count({ where: { organizationId: org.id } }), TREE_SIZE + 1)
    } finally {
      DEFAULT_CATEGORIES.pop()
    }
  })
})

test('a retired default stays retired and is not re-created', async () => {
  await withOrg('retired', async (org) => {
    _resetPurchaseDefaultsCache()
    await ensurePurchaseDefaults(org.id)
    await db.itemCategory.updateMany({ where: { organizationId: org.id, systemCode: 'MANPOWER' }, data: { isActive: false } })
    _resetPurchaseDefaultsCache()
    await ensurePurchaseDefaults(org.id)
    const rows = await db.itemCategory.findMany({ where: { organizationId: org.id, name: 'Manpower' } })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].isActive, false)
  })
})

test('the hospital\'s own same-name category under a default parent is adopted, not a crash', async () => {
  await withOrg('samename', async (org) => {
    _resetPurchaseDefaultsCache()
    await ensurePurchaseDefaults(org.id)
    // As if LINEN had not shipped yet and the hospital made its own "Linen"
    // under the default parent — a twin would break the (parent, name) index.
    const parent = await db.itemCategory.findFirst({ where: { organizationId: org.id, systemCode: 'HOUSEKEEPING_LINEN' } })
    await db.itemCategory.deleteMany({ where: { organizationId: org.id, systemCode: 'LINEN' } })
    const own = await db.itemCategory.create({ data: { organizationId: org.id, parentId: parent.id, name: 'linen', purchaseType: 'product', expenseHead: 'Linen' } })
    _resetPurchaseDefaultsCache()
    await ensurePurchaseDefaults(org.id)
    const rows = await db.itemCategory.findMany({ where: { organizationId: org.id, parentId: parent.id, name: { equals: 'Linen', mode: 'insensitive' } } })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, own.id)
    assert.equal(rows[0].systemCode, 'LINEN')
    assert.equal(rows[0].name, 'linen', 'the hospital\'s spelling is kept')
  })
})

test('running it again adds nothing', async () => {
  _resetPurchaseDefaultsCache()
  await ensurePurchaseDefaults(orgA.id)
  assert.equal(await db.unit.count({ where: { organizationId: orgA.id } }), DEFAULT_UNITS.length)
  assert.equal(await db.itemCategory.count({ where: { organizationId: orgA.id } }), TREE_SIZE)
})

test('five requests at the same moment still plant ONE tree', async () => {
  _resetPurchaseDefaultsCache()
  await Promise.all(Array.from({ length: 5 }, () => ensurePurchaseDefaults(orgB.id)))
  assert.equal(await db.unit.count({ where: { organizationId: orgB.id } }), DEFAULT_UNITS.length)
  assert.equal(await db.itemCategory.count({ where: { organizationId: orgB.id } }), TREE_SIZE)
  assert.equal(await db.itemCategory.count({ where: { organizationId: orgB.id, parentId: null, name: 'Medical' } }), 1)
})

// The case the lock exists for. When the units are NOT there yet, inserting
// them happens to make simultaneous requests queue on the unique index, so the
// test above passes even without the lock. With the units already present
// nothing queues them: without the lock this made two "Medical" (proven).
test('units already present, five at once: still ONE tree (needs the lock)', async () => {
  const org = await db.organization.create({ data: { name: 'Test Org C — purchaseDefaults.test.js', slug: `test-purchase-c-${Date.now()}` } })
  try {
    await db.unit.createMany({ data: DEFAULT_UNITS.map((u) => ({ ...u, organizationId: org.id, isSystem: true })) })
    _resetPurchaseDefaultsCache()
    await Promise.all(Array.from({ length: 5 }, () => ensurePurchaseDefaults(org.id)))
    assert.equal(await db.itemCategory.count({ where: { organizationId: org.id, parentId: null, name: 'Medical' } }), 1)
    assert.equal(await db.itemCategory.count({ where: { organizationId: org.id } }), TREE_SIZE)
  } finally {
    await db.organization.delete({ where: { id: org.id } })
  }
})

test("a hospital's own changes are never undone", async () => {
  await db.itemCategory.updateMany({ where: { organizationId: orgA.id, name: 'Linen' }, data: { name: 'Bed Linen' } })
  await db.unit.updateMany({ where: { organizationId: orgA.id, code: 'TON' }, data: { isActive: false, name: 'Metric ton' } })
  _resetPurchaseDefaultsCache()
  await ensurePurchaseDefaults(orgA.id)
  assert.equal(await db.itemCategory.count({ where: { organizationId: orgA.id, name: 'Linen' } }), 0, 'renamed category is not re-created')
  const ton = await db.unit.findFirst({ where: { organizationId: orgA.id, code: 'TON' } })
  assert.equal(ton.isActive, false)
  assert.equal(ton.name, 'Metric ton')
})

test('one hospital never receives another hospital\'s rows', async () => {
  const ids = (await db.itemCategory.findMany({ where: { organizationId: orgB.id }, select: { parentId: true } })).map((c) => c.parentId).filter(Boolean)
  const foreign = await db.itemCategory.count({ where: { id: { in: ids }, organizationId: { not: orgB.id } } })
  assert.equal(foreign, 0)
})
