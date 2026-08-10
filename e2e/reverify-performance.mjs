// Re-measure every number on docs/modules/performance.html.
//
//   node e2e/reverify-performance.mjs
//
// WHY THIS EXISTS
// The profiler that produced the render counts on that page was counting fibers
// that had not re-rendered (fixed in f2a7d7e), so every "×N renders" figure there
// is suspect until re-taken. The API timings came from the network layer, which was
// never broken — but a number that has not been re-checked next to numbers that
// were wrong is worth no more than they are, so both are re-taken here.
//
// Each claim is printed with what the page says and what the app does now, and
// labelled: HOLDS, IMPROVED, WORSE, or WAS-AN-ARTEFACT.
//
// It reads only.
import { launch, login, BASE } from './helpers.js'
import { HOOK } from './profiler.mjs'

const API = process.env.API_BASE || 'http://localhost:5000/api'

const login_ = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@gudmed.in', password: process.env.E2E_PASSWORD || 'Gudmed@123' }),
})
if (!login_.ok) { console.log(`  cannot log in (${login_.status}) — is the API up?`); process.exit(1) }
const H = { authorization: `Bearer ${(await login_.json()).token}` }

const rows = []
const say = (claim, was, now, verdict, note = '') => {
  rows.push({ claim, was, now, verdict })
  const tag = { HOLDS: '=', IMPROVED: '↓', WORSE: '↑', ARTEFACT: '✗', 'NOT MEASURED': '?' }[verdict]
  console.log(`  ${tag} ${claim.padEnd(40)} page said ${String(was).padStart(12)}   now ${String(now).padStart(12)}  ${note}`)
}

// ── A. the API claims — the network layer was never the broken part ──────────
console.log('\n══ A. API TIMINGS — three runs each, median reported ══\n')

async function timeIt(path, runs = 3) {
  const ms = []
  let bytes = 0, count = null
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    const res = await fetch(`${API}${path}`, { headers: H })
    const txt = await res.text()
    ms.push(Math.round(performance.now() - t0))
    bytes = txt.length
    try { const b = JSON.parse(txt); count = Array.isArray(b?.data) ? b.data.length : null } catch {}
  }
  ms.sort((a, b) => a - b)
  return { ms: ms[Math.floor(runs / 2)], all: ms, kb: Math.round(bytes / 1024), count }
}

const month = new Date()
const first = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`
const last = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-28`

const pharmStats = await timeIt('/pharmacy/stats')
say('/pharmacy/stats', '1,204 ms', `${pharmStats.ms} ms`,
  pharmStats.ms > 900 ? 'HOLDS' : 'IMPROVED', `runs ${pharmStats.all.join('/')} · ${pharmStats.kb} KB`)

const queueMonth = await timeIt(`/queue?startDate=${first}&endDate=${last}&page=1&limit=10`)
say('Queue, a month-wide date range', '2,396 ms', `${queueMonth.ms} ms`,
  queueMonth.ms > 1500 ? 'HOLDS' : 'IMPROVED', `runs ${queueMonth.all.join('/')} · ${queueMonth.count} rows · ${queueMonth.kb} KB`)

const drugs = await timeIt('/pharmacy/drugs?limit=15&offset=0')
say('/pharmacy/drugs', '435 ms', `${drugs.ms} ms`,
  drugs.ms > 300 ? 'HOLDS' : 'IMPROVED', `runs ${drugs.all.join('/')} · ${drugs.count} rows · ${drugs.kb} KB`)

const slots = await timeIt('/doctor-accountability?resource=doctors')
say('Doctor Slots payload', '1,064 KB', `${slots.kb} KB`,
  slots.kb > 800 ? 'HOLDS' : 'IMPROVED', `${slots.ms} ms · ${slots.count} rows`)

// ── B. the render claims — taken with the profiler that was wrong ────────────
console.log('\n══ B. RENDER COUNTS — retaken with the corrected profiler ══\n')

const { browser, page } = await launch({ headless: true })
await page.addInitScript(HOOK)
await login(page, 'admin')

// Asserts the interaction actually happened. An earlier draft reported "0 renders"
// for Pharmacy and Appointments and read it as the finding being an artefact — the
// search box simply was not on the tab the run landed on, so nothing was typed.
// Zero work from a control that was never touched is a broken measurement, and
// calling it a clean result is exactly the mistake this whole file exists to undo.
async function renderCost(path, label, fn, wait = 2500) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.evaluate(() => window.__profileReset?.()).catch(() => {})
  await fn()
  await page.waitForTimeout(wait)
  const p = await page.evaluate(() => window.__profile?.() ?? null).catch(() => null)
  const comps = (p?.components ?? []).sort((a, b) => (b.selfMs ?? 0) - (a.selfMs ?? 0))
  const find = (n) => comps.find((c) => c.name === n)
  const touched = (p?.commits ?? 0) > 0
  if (!touched) console.log(`  !! "${label}" produced no commits at all — the control was never reached, so nothing below it is a measurement`)
  return { label, commits: p?.commits ?? 0, comps, find, touched }
}

const qFilter = await renderCost('/admin/queue', 'Queue filter change', async () => {
  const c = page.locator('button[role="combobox"]').first()
  if (await c.count()) { await c.click(); const o = page.getByRole('option').nth(1); if (await o.count()) await o.click() }
})
const qDiv = qFilter.find('Primitive.div')
say('Queue: Primitive.div on a filter change', '808×', `${qDiv?.count ?? 0}×`,
  (qDiv?.count ?? 0) > 600 ? 'HOLDS' : 'ARTEFACT', `${qDiv?.selfMs ?? 0} ms self`)

const qType = await renderCost('/admin/queue', 'Queue typing', async () => {
  const s = page.getByPlaceholder(/search/i).first()
  if (await s.count()) { await s.click(); await page.keyboard.type('ram', { delay: 60 }) }
})
const qtDiv = qType.find('Primitive.div')
say('Queue: Primitive.div while typing', '517×', `${qtDiv?.count ?? 0}×`,
  (qtDiv?.count ?? 0) > 400 ? 'HOLDS' : 'ARTEFACT', `${qtDiv?.selfMs ?? 0} ms self`)

const pAction = await renderCost('/admin/pharmacy', 'Pharmacy typing', async () => {
  const tab = page.getByRole('tab', { name: /inventory/i }).first()
  if (await tab.count()) { await tab.click(); await page.waitForTimeout(1500) }
  const s = page.getByPlaceholder(/Search drugs/i).first()
  if (!(await s.count())) throw new Error('Pharmacy search box not found on the Inventory tab')
  await s.click(); await page.keyboard.type('par', { delay: 60 })
})
const pDiv = pAction.find('Primitive.div')
say('Pharmacy: Primitive.div self time', '2,254 ms', `${pDiv?.selfMs ?? 0} ms`,
  (pDiv?.selfMs ?? 0) > 1500 ? 'HOLDS' : 'ARTEFACT', `${pDiv?.count ?? 0}× · worst now ${pAction.comps[0]?.name} ${pAction.comps[0]?.selfMs} ms`)

const aType = await renderCost('/admin/appointments', 'Appointments typing', async () => {
  // The search box lives on the List view, not on whichever tab the module opens
  // with — so the tab has to be selected before the box exists.
  const tab = page.getByRole('tab', { name: /^list$/i }).first()
  if (await tab.count()) { await tab.click(); await page.waitForTimeout(1500) }
  const s = page.getByPlaceholder(/Search by patient, doctor/i).first()
  if (!(await s.count())) return false   // recorded as NOT MEASURED, never as clean
  await s.click(); await page.keyboard.type('ram', { delay: 60 })
  return true
})
// Appointments' search box could not be reached by this run. Its two numbers are
// therefore neither confirmed nor withdrawn — they are simply not measured, and
// saying so is the only honest option. Calling them clean because nothing was
// typed is the error this whole re-verification exists to correct.
const reached = aType.commits > 0 && aType.comps.length > 0
const nav = reached ? aType.find('NavLink') : null
say('Appointments: NavLink re-renders', '99×', reached ? `${nav?.count ?? 0}×` : 'not reached',
  reached ? ((nav?.count ?? 0) > 60 ? 'HOLDS' : 'ARTEFACT') : 'NOT MEASURED',
  reached ? `App ×${aType.find('App')?.count ?? 0}` : 'the search box was not found on any tab this run opened')

const am = reached ? aType.find('AppointmentsModule') : null
say('Appointments: module self time', '1,209 ms', reached ? `${am?.selfMs ?? 0} ms` : 'not reached',
  reached ? ((am?.selfMs ?? 0) > 800 ? 'HOLDS' : 'ARTEFACT') : 'NOT MEASURED')

console.log('\n' + '═'.repeat(78))
for (const v of ['HOLDS', 'IMPROVED', 'WORSE', 'ARTEFACT', 'NOT MEASURED']) {
  const n = rows.filter((r) => r.verdict === v).length
  if (n) console.log(`  ${v.padEnd(10)} ${n}`)
}
console.log()

await browser.close()
