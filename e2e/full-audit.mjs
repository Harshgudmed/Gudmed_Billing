// Whole-project universal audit: for every role, open every module and capture
// what a QA/DevTools pass would — network request/response + timing, console
// errors, uncaught exceptions, JS heap + DOM size, cookies/session, and a
// blank/crash check — into one report. No business logic needed; this is the
// "does every screen load, work, and perform" layer.
//
// Run:  node e2e/full-audit.mjs        (all roles)
//       ROLE=admin node e2e/full-audit.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.E2E_BASE || 'http://localhost:5173'
const PASSWORD = process.env.E2E_PASSWORD || 'Gudmed@123'
const OUT_DIR = path.join(__dirname, 'audit-report')
fs.mkdirSync(OUT_DIR, { recursive: true })

const ROLES = {
  admin:        { email: 'admin@gudmed.in' },
  doctor:       { email: 'priya@gudmed.in' },
  receptionist: { email: 'reception@gudmed.in' },
}

// Every module from App.jsx's route map.
const MODULES = [
  'dashboard', 'patients', 'appointments', 'pre-triage', 'queue', 'opd',
  'pharmacy', 'laboratory', 'radiology', 'day-care', 'ambulance', 'insurance',
  'death-certificates', 'inpatient', 'billing', 'doctor-accountability', 'settings',
]

// A request slower than this is flagged for review.
const SLOW_MS = 1500

async function login(page, role) {
  await page.goto(`${BASE}/${role}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 15000 })
  await page.fill('input[type="email"]', ROLES[role].email)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1000)
  return !page.url().includes('/login')
}

async function auditModule(context, page, role, mod) {
  const result = { role, module: mod, ok: false, loadMs: 0, apiCalls: 0, slowApis: [], failedApis: [], consoleErrors: [], pageErrors: [], heapMB: null, domNodes: null, blank: false, redirectedTo: null }

  // Fresh listeners per page-load window.
  const apis = []
  const onResponse = async (res) => {
    const url = res.url()
    if (!url.includes('/api/')) return
    const req = res.request()
    const timing = res.request().timing()
    const ms = timing ? Math.round(timing.responseEnd) : 0
    apis.push({ url: url.replace(BASE, '').replace('http://localhost:5000', ''), method: req.method(), status: res.status(), ms })
  }
  const onConsole = (m) => { if (m.type() === 'error' && !m.text().includes('401') && !m.text().includes('Failed to load resource')) result.consoleErrors.push(m.text().slice(0, 200)) }
  const onPageError = (e) => result.pageErrors.push(String(e).slice(0, 200))
  page.on('response', onResponse)
  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  try {
    const t0 = Date.now()
    await page.goto(`${BASE}/${role}/${mod}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1500) // let late API calls + render settle
    result.loadMs = Date.now() - t0
    result.redirectedTo = page.url().includes(`/${mod}`) ? null : page.url().replace(BASE, '')

    // Blank / crash check: is there meaningful visible text?
    const bodyText = (await page.evaluate(() => document.body.innerText || '')).trim()
    result.blank = bodyText.length < 20
    const crashed = /something went wrong|unexpected error|failed to render/i.test(bodyText)
    if (crashed) result.pageErrors.push('ERROR BOUNDARY: page crashed to error screen')

    // Performance snapshot.
    const perf = await page.evaluate(() => ({
      heap: performance.memory ? performance.memory.usedJSHeapSize : null,
      dom: document.getElementsByTagName('*').length,
    }))
    result.heapMB = perf.heap ? +(perf.heap / 1048576).toFixed(1) : null
    result.domNodes = perf.dom

    result.apiCalls = apis.length
    result.slowApis = apis.filter((a) => a.ms > SLOW_MS).map((a) => `${a.method} ${a.url} — ${a.ms}ms`)
    result.failedApis = apis.filter((a) => a.status >= 400).map((a) => `${a.method} ${a.url} — HTTP ${a.status}`)
    result.ok = !crashed && !result.blank && result.pageErrors.length === 0 && result.failedApis.length === 0

    await page.screenshot({ path: path.join(OUT_DIR, `${role}-${mod}.png`) }).catch(() => {})
  } catch (e) {
    result.pageErrors.push('LOAD FAILED: ' + e.message.split('\n')[0])
  } finally {
    page.off('response', onResponse)
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
  }
  return result
}

const onlyRole = process.env.ROLE
const rolesToRun = onlyRole ? [onlyRole] : Object.keys(ROLES)

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--js-flags=--expose-gc'] })
const allResults = []

for (const role of rolesToRun) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await context.newPage()
  const loggedIn = await login(page, role)
  if (!loggedIn) { console.log(`\n!! Could not log in as ${role} — skipping`); await context.close(); continue }

  // Read session/cookie once per role.
  const cookies = await context.cookies()
  const token = await page.evaluate(() => localStorage.getItem('token'))
  const sessionCookie = cookies.find((c) => /token|session|sid/i.test(c.name))
  console.log(`\n===== ROLE: ${role} =====`)
  console.log(`  session cookie: ${sessionCookie ? `${sessionCookie.name} (httpOnly=${sessionCookie.httpOnly}, secure=${sessionCookie.secure})` : 'none'} | localStorage token: ${token ? 'present' : 'none'}`)

  for (const mod of MODULES) {
    const r = await auditModule(context, page, role, mod)
    allResults.push(r)
    const flag = r.ok ? 'OK  ' : '⚠  '
    const bits = []
    if (r.blank) bits.push('BLANK')
    if (r.redirectedTo) bits.push(`redirected→${r.redirectedTo}`)
    if (r.pageErrors.length) bits.push(`${r.pageErrors.length} pageErr`)
    if (r.consoleErrors.length) bits.push(`${r.consoleErrors.length} consoleErr`)
    if (r.failedApis.length) bits.push(`${r.failedApis.length} failedAPI`)
    if (r.slowApis.length) bits.push(`${r.slowApis.length} slowAPI`)
    console.log(`  ${flag}${mod.padEnd(22)} ${r.loadMs}ms load, ${r.apiCalls} APIs, heap ${r.heapMB ?? '?'}MB, DOM ${r.domNodes ?? '?'}  ${bits.join(' · ')}`)
  }
  await context.close()
}

await browser.close()

// Persist full JSON + a human summary.
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(allResults, null, 2))

const problems = allResults.filter((r) => !r.ok)
console.log(`\n\n======== SUMMARY ========`)
console.log(`Total pages audited: ${allResults.length}`)
console.log(`Clean: ${allResults.length - problems.length} | With issues: ${problems.length}`)
if (problems.length) {
  console.log(`\n---- pages needing attention ----`)
  for (const p of problems) {
    console.log(`\n[${p.role} / ${p.module}]`)
    if (p.blank) console.log('   • BLANK / no content')
    for (const e of p.pageErrors) console.log('   • pageError: ' + e)
    for (const e of p.consoleErrors) console.log('   • consoleError: ' + e)
    for (const a of p.failedApis) console.log('   • failed API: ' + a)
    for (const a of p.slowApis) console.log('   • slow API: ' + a)
  }
}
// Global slowest APIs across everything.
const allApiFlat = allResults.flatMap((r) => r.slowApis)
console.log(`\nSlow APIs seen (>${SLOW_MS}ms): ${allApiFlat.length}`)
console.log(`\nReport saved: e2e/audit-report/report.json  (+ screenshots per page)`)
