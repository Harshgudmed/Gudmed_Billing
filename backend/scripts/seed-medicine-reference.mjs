// Seed the MedicineReference table from the open-source Indian medicine dataset
// (~215k rows). Uses raw SQL inserts so it works even when the Prisma client
// hasn't been regenerated yet (the dev server can keep running).
//
// Run: node scripts/seed-medicine-reference.mjs
// Re-running is safe — it truncates and reloads.

import { db } from '../src/config/db.js'

const DATASET_URL =
  process.env.MEDICINE_DATASET_URL ||
  'https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/main/DATA/indian_medicine_data.csv'

// Quote-aware CSV tokenizer (handles embedded commas/quotes/newlines).
function* parseCSV(text) {
  let field = '', row = [], i = 0, inQ = false
  while (i < text.length) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQ = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQ = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); yield row; row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field.length || row.length) { row.push(field); yield row }
}

const cleanNum = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

async function main() {
  console.log('Downloading dataset…', DATASET_URL)
  const res = await fetch(DATASET_URL)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const text = await res.text()
  console.log(`Downloaded ${(text.length / 1e6).toFixed(1)} MB`)

  console.log('Clearing existing reference rows…')
  await db.$executeRawUnsafe('TRUNCATE TABLE "MedicineReference"')

  const COLS = '(id,name,"nameLower",price,manufacturer,type,"packSize",composition,"isDiscontinued")'
  const BATCH = 1000
  let batch = []
  let total = 0, skipped = 0, header = true

  const flush = async () => {
    if (!batch.length) return
    const placeholders = []
    const params = []
    batch.forEach((r, idx) => {
      const b = idx * 9
      placeholders.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`)
      params.push(...r)
    })
    await db.$executeRawUnsafe(`INSERT INTO "MedicineReference" ${COLS} VALUES ${placeholders.join(',')}`, ...params)
    total += batch.length
    batch = []
    if (total % 20000 === 0) console.log(`  inserted ${total}…`)
  }

  for (const cols of parseCSV(text)) {
    if (header) { header = false; continue } // skip header row
    if (cols.length < 9) { skipped++; continue }
    const [id, name, price, isDisc, manufacturer, type, packSize, comp1, comp2] = cols
    const nm = (name || '').trim()
    if (!nm) { skipped++; continue }
    const composition = [comp1, comp2].map((c) => (c || '').trim()).filter(Boolean).join(' + ') || null
    batch.push([
      `medref-${id}`,
      nm,
      nm.toLowerCase(),
      cleanNum(price),
      (manufacturer || '').trim() || null,
      (type || '').trim() || null,
      (packSize || '').trim() || null,
      composition,
      String(isDisc).trim().toUpperCase() === 'TRUE',
    ])
    if (batch.length >= BATCH) await flush()
  }
  await flush()

  const count = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS c FROM "MedicineReference"')
  console.log(`\n✅ Seeded ${total} medicines (${skipped} skipped). Table now has ${count[0].c} rows.`)
}

main().catch((e) => { console.error('SEED FAILED:', e); process.exitCode = 1 }).finally(() => db.$disconnect())
