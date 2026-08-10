// Every combination of Billing's four filters, against the real API.
//
//   node backend/scripts/billing-filter-matrix.mjs
//
// WHY THIS EXISTS
// One filter at a time is the easy case and it is not the case that breaks.
// CLAUDE.md rule 10 is explicit: filters that each work alone routinely contradict
// each other combined — one narrows in the database while another narrows in the
// browser, and the count in the header stops matching the rows in the table.
//
// Billing has four (search, status, type, date range) so there are 2^4 = 16
// combinations. This runs all of them and checks the three things a combination
// can get wrong:
//
//   1. does it answer at all, or 4xx/5xx?
//   2. is `meta.total` consistent with the rows returned?
//   3. does adding a filter ever INCREASE the count? Narrowing must never widen —
//      that means one filter replaced another instead of composing with it. This is
//      the exact failure mode `where.AND` exists to prevent in the type filter,
//      because `Object.assign` over `where` silently overwrote it once.
//
// It reads only. No invoice is created, changed or deleted.
import { db } from '../src/config/db.js'

const BASE = process.env.API_BASE || 'http://localhost:5000/api'

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@gudmed.in', password: process.env.E2E_PASSWORD || 'Gudmed@123' }),
})
if (!login.ok) { console.log(`  cannot log in (${login.status}) — is the API up?`); process.exit(1) }
const H = { authorization: `Bearer ${(await login.json()).token}` }

// One real value per filter, taken from the data rather than invented — a filter
// tested with a value that matches nothing passes for the wrong reason.
const anyInvoice = await db.invoice.findFirst({
  where: { organizationId: 'org-demo' },
  select: { invoiceNumber: true, invoiceDate: true, paymentStatus: true },
  orderBy: { invoiceDate: 'desc' },
})
if (!anyInvoice) { console.log('  no invoices to filter'); process.exit(0) }

const ymd = (d) => new Date(d).toISOString().slice(0, 10)
const DIMENSIONS = {
  search: anyInvoice.invoiceNumber.slice(0, 8),
  status: anyInvoice.paymentStatus === 'partially_paid' ? 'partial' : anyInvoice.paymentStatus,
  type: 'opd',
  date: { startDate: ymd(anyInvoice.invoiceDate), endDate: ymd(anyInvoice.invoiceDate) },
}

const ask = async (params) => {
  const q = new URLSearchParams({ resource: 'invoices', limit: '10', offset: '0', ...params })
  const t0 = Date.now()
  const res = await fetch(`${BASE}/billing?${q}`, { headers: H })
  const ms = Date.now() - t0
  let body = null
  try { body = await res.json() } catch {}
  return { status: res.status, ms, rows: body?.data?.length ?? 0, total: body?.meta?.total ?? null }
}

// All 16 subsets of the four dimensions.
const NAMES = ['search', 'status', 'type', 'date']
const combos = []
for (let bits = 0; bits < 16; bits++) {
  const on = NAMES.filter((_, i) => bits & (1 << i))
  const params = {}
  for (const n of on) {
    if (n === 'date') Object.assign(params, DIMENSIONS.date)
    else params[n] = DIMENSIONS[n]
  }
  combos.push({ on, params, bits })
}

console.log('\n  Billing filter matrix — all 16 combinations\n')
console.log(`  values in play: search="${DIMENSIONS.search}" status=${DIMENSIONS.status} ` +
  `type=${DIMENSIONS.type} date=${DIMENSIONS.date.startDate}\n`)
console.log('  FILTERS ON                      STATUS   ROWS   TOTAL   ms   VERDICT')
console.log('  ' + '─'.repeat(80))

const results = new Map()
let problems = 0

for (const c of combos) {
  const r = await ask(c.params)
  results.set(c.bits, r)

  const issues = []
  if (r.status >= 400) issues.push(`HTTP ${r.status}`)
  // A page holds at most 10, so rows > total is impossible; rows < total is
  // normal (later pages). rows > 0 with total 0 means the count and the list
  // disagree — the header would claim "no invoices" over a table full of them.
  if (r.total !== null && r.rows > r.total) issues.push(`${r.rows} rows but total says ${r.total}`)
  if (r.rows > 0 && r.total === 0) issues.push('rows returned but total is 0')

  // Narrowing must never widen. Compare against every subset one filter smaller.
  for (let i = 0; i < 4; i++) {
    if (!(c.bits & (1 << i))) continue
    const looser = results.get(c.bits & ~(1 << i))
    if (looser?.total != null && r.total != null && r.total > looser.total) {
      issues.push(`adding ${NAMES[i]} INCREASED the count ${looser.total} → ${r.total}`)
    }
  }

  if (issues.length) problems++
  const label = c.on.length ? c.on.join(' + ') : '(none — full list)'
  console.log(`  ${label.padEnd(32)} ${String(r.status).padEnd(7)} ${String(r.rows).padStart(4)} ` +
    `${String(r.total ?? '—').padStart(7)} ${String(r.ms).padStart(4)}   ${issues.length ? '✗ ' + issues.join('; ') : '✓'}`)
}

// ── the date filter must actually filter ─────────────────────────────────────
console.log('\n  DATE RANGE — does it narrow, and is it the hospital\'s day?\n')

const all = await ask({})
const oneDay = await ask(DIMENSIONS.date)
const longAgo = await ask({ startDate: '2000-01-01', endDate: '2000-01-02' })

const checks = [
  ['a single day returns fewer than everything', oneDay.total < all.total, `${oneDay.total} of ${all.total}`],
  ['a day with no invoices returns none', longAgo.total === 0, `${longAgo.total} rows for Jan 2000`],
  ['an empty range is not treated as "match nothing"',
    (await ask({ startDate: '', endDate: '' })).total === all.total,
    'blank startDate/endDate must return the full list, not zero'],
]
for (const [name, pass, detail] of checks) {
  if (!pass) problems++
  console.log(`  ${pass ? '✓' : '✗'} ${name.padEnd(50)} ${detail}`)
}

// The IST boundary: an invoice raised at 20:00 IST is 14:30 UTC the SAME day, but
// one raised at 00:30 IST is 19:00 UTC the day BEFORE. Filtering by a UTC-sliced
// string would put those in the wrong bucket.
const evening = await db.invoice.findFirst({
  where: { organizationId: 'org-demo' },
  select: { invoiceDate: true },
  orderBy: { invoiceDate: 'desc' },
})
if (evening) {
  const istDay = new Date(evening.invoiceDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const r = await ask({ startDate: istDay, endDate: istDay })
  const pass = r.total > 0
  if (!pass) problems++
  console.log(`  ${pass ? '✓' : '✗'} an invoice is found on its IST day, not its UTC day    ` +
    `${istDay} → ${r.total} row(s)`)
}

console.log(`\n  ${problems} problem(s) across 16 combinations + 4 date checks\n`)
await db.$disconnect()
process.exit(problems ? 1 : 0)
