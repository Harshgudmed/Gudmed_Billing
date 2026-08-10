// Queue's three worst performance findings, re-measured before and after a fix.
//
//   node e2e/verify-queue-perf.mjs            # measure
//   node e2e/verify-queue-perf.mjs --headed   # watch it
//
// WHY THIS EXISTS
// The report ranks these as the three worst numbers in the application, and the
// first draft of the fix assumed all three shared one cause — the static import of
// BillingModule at QueueModule.jsx:14. Reading Radix's Tabs showed that is wrong:
// TabsContent unmounts an inactive tab, so Billing is downloaded but never mounted
// while the queue is on screen. The bundle finding is real; the render finding
// needs its own cause, and guessing at it would put a wrong fix in the repo.
//
// So this measures each one separately and names the component responsible:
//
//   1. render  — which component re-renders, how many instances, for how long
//   2. query   — how long a month-wide date range takes for ten rows
//   3. bundle  — how many JS bytes the Queue route pulls, and how many are Billing
//
// It reads only. No queue entry, appointment or invoice is created or changed.
import { launch, login, BASE } from './helpers.js'
import { HOOK } from './profiler.mjs'

const { browser, page } = await launch({ headless: !process.argv.includes('--headed') })
await page.addInitScript(HOOK)

const js = []
let api = []
page.on('requestfinished', async (r) => {
  const u = r.url()
  let bytes = 0
  try { bytes = Number((await r.sizes()).responseBodySize || 0) } catch {}
  if (/\.(js|jsx|mjs)(\?|$)/.test(u) || u.includes('/@fs/') || u.includes('/src/')) js.push({ u, bytes })
  if (u.includes('/api/')) {
    let rows = null
    try { const b = await (await r.response())?.json(); rows = Array.isArray(b?.data) ? b.data.length : null } catch {}
    api.push({ path: u.split('/api')[1], ms: Math.round(r.timing()?.responseEnd ?? 0), bytes, rows })
  }
})

async function act(label, fn, wait = 2500) {
  api = []
  await page.evaluate(() => window.__profileReset?.()).catch(() => {})
  const t0 = Date.now()
  await fn()
  await page.waitForTimeout(wait)
  const p = await page.evaluate(() => window.__profile?.() ?? null).catch(() => null)
  const comps = (p?.components ?? []).sort((a, b) => (b.selfMs ?? 0) - (a.selfMs ?? 0))
  return { label, wall: Date.now() - t0 - wait, calls: [...api], commits: p?.commits ?? 0, comps }
}

await login(page, 'admin')
await page.goto(`${BASE}/admin/queue`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// ── 3. bundle ────────────────────────────────────────────────────────────────
// Measured on the dev server, where every module is a separate file, so a file
// named after Billing arriving on the Queue route proves the static import even
// though the byte totals are not what a production user downloads.
const kb = (n) => (n / 1024).toFixed(0)
const totalJs = js.reduce((a, f) => a + f.bytes, 0)
const billingJs = js.filter((f) => /billing/i.test(f.u))
const apptJs = js.filter((f) => /appointment/i.test(f.u))

console.log('\n══ 3. BUNDLE — what the Queue route downloads ══\n')
console.log(`  total JS on the Queue route : ${kb(totalJs).padStart(6)} KB across ${js.length} files`)
console.log(`  of that, Billing files      : ${kb(billingJs.reduce((a, f) => a + f.bytes, 0)).padStart(6)} KB across ${billingJs.length} files`)
console.log(`  of that, Appointments files : ${kb(apptJs.reduce((a, f) => a + f.bytes, 0)).padStart(6)} KB across ${apptJs.length} files`)
console.log(`\n  ${billingJs.length || apptJs.length ? '✗ CONFIRMED' : '✓ clean'} — a receptionist watching the queue ` +
  `${billingJs.length || apptJs.length ? 'downloads modules they never open' : 'downloads only the queue'}`)

// ── 1. render ────────────────────────────────────────────────────────────────
console.log('\n══ 1. RENDER — which component, how many instances, how long ══\n')

const steps = []
steps.push(await act('type in the queue search', async () => {
  const s = page.getByPlaceholder(/search/i).first()
  if (await s.count()) { await s.click(); await page.keyboard.type('ram', { delay: 60 }) }
}, 2500))

steps.push(await act('change the status filter', async () => {
  const c = page.locator('button[role="combobox"]').first()
  if (await c.count()) {
    await c.click()
    const o = page.getByRole('option').nth(1)
    if (await o.count()) await o.click()
  }
}))

steps.push(await act('click a queue row', async () => {
  const r = page.locator('tbody tr').first()
  if (await r.count()) await r.click()
}))

steps.push(await act('switch to the Appointments tab', async () => {
  const t = page.getByRole('tab', { name: /Appointments/i }).first()
  if (await t.count()) await t.click()
}, 3500))

console.log('  ACTION                          COMMITS  WORST COMPONENT')
console.log('  ' + '─'.repeat(74))
let worstMs = 0, worstWhat = ''
for (const s of steps) {
  const top = s.comps[0]
  if (top && (top.selfMs ?? 0) > worstMs) { worstMs = top.selfMs; worstWhat = `${top.name} ×${top.count} in "${s.label}"` }
  console.log(`  ${s.label.padEnd(32)} ${String(s.commits).padStart(6)}  ` +
    (top ? `${top.name} ×${top.count} — ${Math.round(top.selfMs)} ms self (${Math.round(top.ms)} ms subtree)` : "nothing re-rendered"))
  for (const c of s.comps.slice(1, 4)) console.log(`  ${"".padEnd(32)}         ${c.name} ×${c.count} — ${Math.round(c.selfMs ?? 0)} ms self`)
}
console.log(`\n  worst: ${worstWhat || 'none'} — ${Math.round(worstMs)} ms`)

// The app shell is not part of this module and has no reason to repaint.
const shell = steps.flatMap((s) => s.comps.filter((c) => /^(App|Navigation|NavLink|Shell)$/.test(c.name)))
console.log(`  app shell re-renders: ${shell.length ? shell.map((c) => `${c.name} ×${c.count}`).join(' · ') : 'none'}`)

// ── 2. query ─────────────────────────────────────────────────────────────────
console.log('\n══ 2. QUERY — a month-wide date range for ten rows ══\n')

await page.getByRole('tab', { name: /^Queue$/i }).first().click().catch(() => {})
await page.waitForTimeout(1500)

const ranges = await act('date filter → This Month', async () => {
  const d = page.locator('button[role="combobox"]')
    .filter({ hasText: /All Dates|Today|This Week|This Month|Custom/i }).first()
  if (await d.count()) {
    await d.click()
    const o = page.getByRole('option', { name: /This Month/i }).first()
    if (await o.count()) await o.click()
  }
}, 6000)

for (const c of ranges.calls) {
  console.log(`  ${String(c.ms).padStart(6)} ms  ${(c.rows ?? '—').toString().padStart(4)} rows  ` +
    `${kb(c.bytes).padStart(5)} KB  ${c.path.slice(0, 60)}`)
}
const slowest = ranges.calls.sort((a, b) => b.ms - a.ms)[0]
console.log(`\n  ${slowest ? (slowest.ms > 1000 ? '✗ CONFIRMED' : '✓') : '?'} slowest: ` +
  `${slowest ? `${slowest.ms} ms for ${slowest.rows ?? '?'} rows and ${kb(slowest.bytes)} KB` : 'no request fired'}`)
if (slowest && slowest.ms > 1000 && slowest.bytes < 50_000) {
  console.log('    A tiny answer that takes this long is a query problem, not a payload one —')
  console.log('    the date range is being scanned rather than read from an index.')
}

console.log()
await browser.close()
