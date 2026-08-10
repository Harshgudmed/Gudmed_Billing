// Does every module's URL actually land on that module?
//
// The audit walked Day Care, Pre-Triage and Inpatient and reported identical
// numbers for all three — 16 controls, 8 cards, and a GET /dashboard. Identical
// results for three different modules is not a coincidence; it is the same page
// three times. This checks where each route really ends up.
import { launch, login, BASE } from './helpers.js'

const MODULES = ['patients','appointments','pre-triage','queue','opd','pharmacy','laboratory',
                 'radiology','day-care','ambulance','insurance','death-certificates','inpatient',
                 'billing','doctor-accountability','settings']

const { browser, page } = await launch({ headless: true })
try {
  await login(page, 'admin')
  let wrong = 0
  for (const m of MODULES) {
    await page.goto(`${BASE}/admin/${m}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const url = page.url().replace(BASE, '')
    const h1 = (await page.locator('h1').first().innerText().catch(() => '(none)')).split('\n')[0]
    const landed = url.includes(m)
    if (!landed) wrong++
    console.log(`  ${landed ? '✓' : '✗'} /admin/${m.padEnd(22)} → ${url.padEnd(28)} "${h1.slice(0, 32)}"`)
  }
  console.log(`\n  ${MODULES.length - wrong}/${MODULES.length} routes land where they should${wrong ? ` — ${wrong} do NOT` : ''}\n`)
} finally { await browser.close() }
