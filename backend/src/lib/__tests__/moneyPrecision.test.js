// Standing check: no money column may hold a value that is not a whole paisa.
//
// WHY THIS EXISTS
// Every money column in this schema is Postgres `double precision` (Prisma
// `Float`). Binary floating point cannot represent 0.1, so ₹0.10 + ₹0.20 is
// ₹0.30000000000000004 and a long column of them drifts. Today nothing has
// drifted — but only because `round2()` happens to be called on the write paths
// that matter. `round2` is imported in 10 backend files while 39 touch money, so
// the protection is a habit, not a guarantee.
//
// Converting all 68 money columns to Decimal is the real fix and is a large,
// separate migration. Until then this test is the tripwire: it fails the first
// time a value with more than two decimals reaches the database, naming the
// exact table and column, instead of the drift being found in a patient's bill
// months later.
//
// It is a data check, not a unit test — it inspects whatever is in the database
// it is pointed at. Run it against staging/production copies too.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '..', '..', '..')
try {
  for (const line of fs.readFileSync(path.join(backendRoot, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* no .env — skips below */ }

const HAS_DB = !!process.env.DATABASE_URL
const require = createRequire(path.join(backendRoot, 'package.json'))

// Columns whose name says "money". Measurements (weight, spo2, temperature,
// distanceKm) are legitimately fractional and are excluded — a patient really
// can weigh 62.375 kg.
const MONEY_NAME = /(amount|price|fee|total|tax|discount|paid|balance|cost|mrp|charge|commission|subtotal|copay)/i
const NOT_MONEY = /(percentage|percent|markup)/i

let db
before(async () => {
  if (!HAS_DB) return
  const { PrismaClient } = require('@prisma/client')
  db = new PrismaClient()
})
after(async () => { if (db) await db.$disconnect() })

test('no money column stores a fraction of a paisa',
  { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  // Read the money columns out of the live catalogue rather than a hand-kept
  // list — a column added next month is covered without editing this test.
  const columns = await db.$queryRawUnsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'double precision'
    ORDER BY table_name, column_name
  `)
  const money = columns.filter(
    (c) => MONEY_NAME.test(c.column_name) && !NOT_MONEY.test(c.column_name),
  )
  assert.ok(money.length > 0, 'found no money columns — has the schema moved?')

  const drifted = []
  for (const { table_name: table, column_name: column } of money) {
    const [row] = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table}"
       WHERE "${column}" IS NOT NULL AND "${column}" <> round("${column}"::numeric, 2)`,
    )
    if (row.n > 0) drifted.push(`${table}.${column}: ${row.n} row(s)`)
  }

  assert.deepEqual(
    drifted, [],
    `money stored below one paisa — some write path is missing round2():\n  ${drifted.join('\n  ')}`,
  )
})

test('an invoice total equals subtotal minus discount plus tax',
  { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  // The ledger is recomputed server-side by recalcInvoice. If Float drift ever
  // does bite, it shows up here first: the stored total stops matching its parts
  // by a paisa, and the bill handed to the patient no longer adds up.
  const off = await db.$queryRawUnsafe(`
    SELECT "invoiceNumber",
           "totalAmount"::float8 AS stored,
           ("subtotal" - "discountAmount" + "taxAmount")::float8 AS computed
    FROM "Invoice"
    WHERE abs("totalAmount" - ("subtotal" - "discountAmount" + "taxAmount")) > 0.005
    LIMIT 10
  `)
  assert.deepEqual(off, [], `invoice totals do not equal their own parts: ${JSON.stringify(off)}`)
})

test('a recorded balance equals total minus what was paid',
  { skip: !HAS_DB && 'DATABASE_URL not set' }, async () => {
  const off = await db.$queryRawUnsafe(`
    SELECT "invoiceNumber", "balanceDue"::float8 AS stored,
           ("totalAmount" - "amountPaid")::float8 AS computed
    FROM "Invoice"
    WHERE "balanceDue" IS NOT NULL
      AND abs("balanceDue" - ("totalAmount" - "amountPaid")) > 0.005
    LIMIT 10
  `)
  assert.deepEqual(off, [], `stored balance disagrees with total - paid: ${JSON.stringify(off)}`)
})
