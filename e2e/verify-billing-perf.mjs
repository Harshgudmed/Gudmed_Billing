// Three Billing findings, re-measured before anyone tries to fix them.
//
//   node e2e/verify-billing-perf.mjs
//
// WHY THIS EXISTS
// All three were recorded by a walk that ran BEFORE the app-shell memoisation
// landed in src/App.jsx, so the report may be describing a problem that is
// already gone. Fixing what is no longer broken is the second-most expensive
// thing after not fixing what is.
//
// So each is measured against the app as it stands today:
//
//   1. app shell repaint  — does App / Navigation / NavLink re-render when
//      something INSIDE Billing changes? The shell is not part of the module.
//   2. wasted refetch     — does an action refetch a query whose inputs did not
//      change? The signature of a useEffect dependency array wider than the
//      request it guards.
//   3. dead filter option — does every filter option put something in the query
//      string, or do some fire nothing at all? Firing nothing is correct for a
//      client-side filter and for a reset; it is also exactly what an unwired
//      control looks like, and only the code says which.
import { launch, login, BASE } from './helpers.js'
import { HOOK } from './profiler.mjs'

const { browser, page } = await launch({ headless: !process.argv.includes('--headed') })
await page.addInitScript(HOOK)

let calls = []
page.on('requestfinished', (r) => {
  const u = r.url()
  if (u.includes('/api/')) calls.push(u.split('/api')[1])
})

await login(page, 'admin')
await page.goto(`${BASE}/admin/billing`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/** Run one action; return what it cost. */
async function act(label, fn, wait = 1800) {
  calls = []
  await page.evaluate(() => window.__profileReset?.()).catch(() => {})
  await fn()
  await page.waitForTimeout(wait)
  const p = await page.evaluate(() => window.__profile?.() ?? null).catch(() => null)
  const shell = (p?.components ?? [])
    .filter((c) => /^(App|Navigation|NavLink|Shell)$/.test(c.name))
    .sort((a, b) => b.count - a.count)
  return { label, calls: [...calls], commits: p?.commits ?? 0, shell }
}

const DATE_MODES = /All Dates|Today|This Week|This Month|Specific Date|Custom Range/i
const dateSelect = () => page.locator('button[role="combobox"]').filter({ hasText: DATE_MODES }).first()
const statusSelect = () => page.locator('button[role="combobox"]').filter({ hasText: /^(All|Paid|Partial|Pending|Cancelled|Refunded)$/ }).first()
const typeSelect = () => page.locator('button[role="combobox"]').filter({ hasText: /All types|OPD|Pharmacy|Laboratory|Radiology|Procedure|Vaccine/ }).first()

const steps = []

steps.push(await act('status → Paid', async () => {
  await statusSelect().click()
  await page.getByRole('option', { name: 'Paid', exact: true }).click()
}))

steps.push(await act('type → OPD', async () => {
  await typeSelect().click()
  await page.getByRole('option', { name: 'OPD', exact: true }).click()
}))

steps.push(await act('date → Today', async () => {
  await dateSelect().click()
  await page.getByRole('option', { name: 'Today', exact: true }).click()
}))

steps.push(await act('type a search', async () => {
  await page.getByPlaceholder(/Search patient or invoice/i).first().click()
  await page.keyboard.type('INV', { delay: 60 })
}, 2200))

steps.push(await act('Clear all', async () => {
  const b = page.getByRole('button', { name: /Clear all/i })
  if (await b.count()) await b.click()
}))

// ── 1 + 2 ────────────────────────────────────────────────────────────────────
console.log('\n  ACTION              REQ  COMMITS   APP SHELL RE-RENDERS')
console.log('  ' + '─'.repeat(72))
let shellWorst = 0
for (const s of steps) {
  const shellText = s.shell.length
    ? s.shell.map((c) => `${c.name} ${c.count}×`).join(' · ')
    : 'none — the shell did not repaint'
  shellWorst = Math.max(shellWorst, ...s.shell.map((c) => c.count), 0)
  console.log(`  ${s.label.padEnd(20)} ${String(s.calls.length).padStart(3)} ${String(s.commits).padStart(8)}   ${shellText}`)
}

console.log('\n  WASTED REFETCHES — the same URL asked for twice in one action')
console.log('  ' + '─'.repeat(72))
let dupes = 0
for (const s of steps) {
  const seen = new Map()
  for (const c of s.calls) seen.set(c, (seen.get(c) ?? 0) + 1)
  const repeated = [...seen].filter(([, n]) => n > 1)
  for (const [url, n] of repeated) {
    dupes++
    console.log(`  ✗ ${s.label}: ${n}× ${url.slice(0, 60)}`)
  }
  // A filter change that refetches something with NO filter in it is the other
  // shape of the same problem — an effect firing on state it does not read.
  const unrelated = s.calls.filter((c) => !c.includes('resource=invoices') && !c.includes('resource=stats'))
  for (const u of unrelated) {
    dupes++
    console.log(`  ✗ ${s.label}: refetched something unrelated — ${u.slice(0, 60)}`)
  }
}
if (!dupes) console.log('  ✓ no action asked for the same thing twice, and none refetched anything unrelated')

// ── 3 ────────────────────────────────────────────────────────────────────────
console.log('\n  FILTER OPTIONS — does each one reach the query string?')
console.log('  ' + '─'.repeat(72))

const OPTIONS = [
  ['status', statusSelect, ['All', 'Paid', 'Partial', 'Pending', 'Cancelled', 'Refunded'], 'status='],
  ['type', typeSelect, ['All types', 'OPD', 'Pharmacy', 'Laboratory', 'Radiology'], 'type='],
]
let dead = 0
for (const [name, sel, opts, param] of OPTIONS) {
  for (const opt of opts) {
    const r = await act(`${name} → ${opt}`, async () => {
      await sel().click()
      await page.getByRole('option', { name: opt, exact: true }).click().catch(() => {})
    }, 1400)
    const isReset = /^All/.test(opt)
    const carried = r.calls.some((c) => c.includes(param))
    // A reset legitimately drops the parameter; every other option must carry it.
    const ok = r.calls.length > 0 && (isReset ? !carried : carried)
    if (!ok) dead++
    console.log(`  ${ok ? '✓' : '✗'} ${(name + ' → ' + opt).padEnd(26)} ${String(r.calls.length)} req` +
      `${carried ? `  ${param} sent` : isReset ? '  (reset — parameter correctly dropped)' : '  NO ' + param}`)
  }
}

console.log(`\n  worst app-shell re-render in one action: ${shellWorst}×`)
console.log(`  wasted/duplicate requests: ${dupes}`)
console.log(`  filter options that did not behave: ${dead}\n`)

await browser.close()
process.exit(shellWorst > 20 || dupes || dead ? 1 : 0)
