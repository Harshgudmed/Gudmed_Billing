// The three DevTools panels the audit never opened.
//
//   node e2e/devtools-extra.mjs                 # every module
//   node e2e/devtools-extra.mjs queue           # one
//   node e2e/devtools-extra.mjs --slow3g        # also measure on a throttled link
//
// WHY THIS EXISTS
// The walk covers Network, Performance, Lighthouse, Console and Elements. Three
// panels were never opened, and each hides a different kind of problem that none of
// the others can see:
//
//   Coverage    — how much JavaScript and CSS is downloaded and never executed.
//                 Queue imports the whole Billing module at the top of the file, so
//                 every user who opens Queue pays for Billing. That cost is
//                 invisible in the network tab (it is one bundle) and invisible in
//                 the profiler (it never renders). Only Coverage shows it.
//   Memory      — whether the heap comes back down. Queue re-renders 1,009 elements
//                 in one action; nothing so far can say whether those are collected
//                 or accumulate over a shift at a counter that is never reloaded.
//   Application — what the app leaves on the machine. A token in localStorage is
//                 readable by any script on the page; a cookie without HttpOnly is
//                 the same problem wearing a different hat.
//
// It reads only. It navigates, measures, and reports.
import { launch, login, BASE } from './helpers.js'

const args = process.argv.slice(2)
const only = args.find((a) => !a.startsWith('--'))
const SLOW3G = args.includes('--slow3g')

const MODULES = [
  { key: 'dashboard', path: '' }, { key: 'patients', path: 'patients' },
  { key: 'appointments', path: 'appointments' }, { key: 'queue', path: 'queue' },
  { key: 'laboratory', path: 'laboratory' }, { key: 'billing', path: 'billing' },
  { key: 'pharmacy', path: 'pharmacy' }, { key: 'settings', path: 'settings' },
]

const kb = (n) => (n / 1024).toFixed(0)

/** Total bytes covered by a set of possibly-overlapping [start, end) ranges. */
function mergedLength(ranges) {
  if (!ranges.length) return 0
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0])
  let total = 0, [s, e] = sorted[0]
  for (const [ns, ne] of sorted.slice(1)) {
    if (ns <= e) e = Math.max(e, ne)
    else { total += e - s; s = ns; e = ne }
  }
  return total + (e - s)
}
const pct = (used, total) => (total ? Math.round((used / total) * 100) : 0)

const { browser, page } = await launch({ headless: true })
const cdp = await page.context().newCDPSession(page)
await login(page, 'admin')

// ── Application: measured once, it is the same for every module ──────────────
console.log('\n  ══ APPLICATION — what the app leaves on the machine ══\n')

const storage = await page.evaluate(() => {
  const out = { local: [], session: [], totalBytes: 0 }
  for (const k of Object.keys(localStorage)) {
    const v = localStorage.getItem(k) ?? ''
    out.local.push({ key: k, bytes: v.length, looksLikeToken: /^ey[A-Za-z0-9_-]{10,}\./.test(v) })
    out.totalBytes += v.length
  }
  for (const k of Object.keys(sessionStorage)) out.session.push({ key: k, bytes: (sessionStorage.getItem(k) ?? '').length })
  return out
})

console.log(`  localStorage: ${storage.local.length} key(s), ${kb(storage.totalBytes)} KB`)
for (const k of storage.local.sort((a, b) => b.bytes - a.bytes).slice(0, 8)) {
  console.log(`      ${k.key.padEnd(34)} ${String(kb(k.bytes)).padStart(5)} KB` +
    (k.looksLikeToken ? '   ← looks like a JWT: any script on the page can read this' : ''))
}
if (storage.session.length) console.log(`  sessionStorage: ${storage.session.length} key(s)`)

const cookies = await page.context().cookies()
console.log(`\n  cookies: ${cookies.length}`)
for (const c of cookies) {
  const flags = [c.httpOnly ? 'HttpOnly' : '✗ no HttpOnly', c.secure ? 'Secure' : '✗ no Secure', `SameSite=${c.sameSite}`]
  console.log(`      ${c.name.padEnd(24)} ${flags.join(' · ')}`)
}
if (!cookies.length) console.log('      none — the session lives in localStorage instead')

const sw = await page.evaluate(async () => {
  if (!navigator.serviceWorker) return 'not supported'
  const regs = await navigator.serviceWorker.getRegistrations()
  return regs.length ? regs.map((r) => r.scope).join(', ') : 'none registered'
})
console.log(`\n  service worker: ${sw}`)

// ── Coverage + Memory, per module ────────────────────────────────────────────
console.log('\n\n  ══ COVERAGE — how much of what is downloaded is actually used ══\n')
console.log('  MODULE          JS LOADED   JS USED   WASTED   CSS LOADED  CSS USED  WASTED')
console.log('  ' + '─'.repeat(82))

const rows = []
for (const m of MODULES.filter((x) => !only || x.key === only)) {
  await page.coverage.startJSCoverage({ resetOnNavigation: false })
  await page.coverage.startCSSCoverage({ resetOnNavigation: false })

  await page.goto(`${BASE}/admin/${m.path}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)

  const js = await page.coverage.stopJSCoverage()
  const css = await page.coverage.stopCSSCoverage()

  // Only OUR code — a node_modules chunk being half-used is normal and not
  // actionable; a module's own file being half-used is the finding.
  const mine = js.filter((e) => !/node_modules|\.vite\/deps/.test(e.url))
  let jsTotal = 0, jsUsed = 0
  for (const e of mine) {
    jsTotal += e.source?.length ?? 0
    // V8 reports NESTED ranges — a function's range contains its blocks' ranges —
    // so adding them up counts the same bytes several times. The first version did
    // exactly that and reported "used" larger than "loaded", which is impossible
    // and was the giveaway. Merge the intervals, then measure.
    const covered = []
    for (const f of e.functions ?? []) for (const r of f.ranges ?? []) if (r.count > 0) covered.push([r.startOffset, r.endOffset])
    jsUsed += mergedLength(covered)
  }
  let cssTotal = 0, cssUsed = 0
  for (const e of css) {
    cssTotal += e.text?.length ?? 0
    cssUsed += mergedLength((e.ranges ?? []).map((r) => [r.start, r.end]))
  }

  const row = {
    module: m.key,
    jsTotal, jsUsed, jsWaste: pct(jsTotal - jsUsed, jsTotal),
    cssTotal, cssUsed, cssWaste: pct(cssTotal - cssUsed, cssTotal),
  }

  // ── Memory: does the heap come back down after the page is left? ───────────
  const heapAfterLoad = (await cdp.send('Runtime.getHeapUsage')).usedSize
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(800)
  await cdp.send('HeapProfiler.collectGarbage')
  await page.waitForTimeout(400)
  const heapAfterLeave = (await cdp.send('Runtime.getHeapUsage')).usedSize
  row.heapOnPage = heapAfterLoad
  row.heapAfterLeave = heapAfterLeave
  row.retained = heapAfterLeave - (rows.at(-1)?.heapAfterLeave ?? heapAfterLeave)

  rows.push(row)
  console.log(`  ${m.key.padEnd(15)} ${String(kb(jsTotal)).padStart(7)} KB ${String(kb(jsUsed)).padStart(8)} KB ` +
    `${String(row.jsWaste + '%').padStart(7)}   ${String(kb(cssTotal)).padStart(7)} KB ${String(kb(cssUsed)).padStart(8)} KB ${String(row.cssWaste + '%').padStart(6)}`)
}

console.log('\n\n  ══ MEMORY — heap after loading the module, and after leaving it ══\n')
console.log('  MODULE          ON PAGE   AFTER LEAVING + GC   NOT RECLAIMED')
console.log('  ' + '─'.repeat(64))
for (const r of rows) {
  console.log(`  ${r.module.padEnd(15)} ${String(kb(r.heapOnPage)).padStart(6)} KB ` +
    `${String(kb(r.heapAfterLeave)).padStart(14)} KB ${String(r.retained > 0 ? '+' + kb(r.retained) + ' KB' : '—').padStart(15)}`)
}
console.log('\n  A heap that only grows across modules is the signal. One reading is noise —' +
  '\n  what matters is whether "after leaving" keeps climbing down the column.')

// ── Slow 3G, optionally ──────────────────────────────────────────────────────
if (SLOW3G) {
  console.log('\n\n  ══ SLOW 3G — the honest test ══\n')
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8,
  })
  console.log('  MODULE          LOAD TIME')
  console.log('  ' + '─'.repeat(34))
  for (const m of MODULES.filter((x) => !only || x.key === only)) {
    const t0 = Date.now()
    await page.goto(`${BASE}/admin/${m.path}`, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {})
    console.log(`  ${m.key.padEnd(15)} ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  }
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
}

console.log('')
await browser.close()
