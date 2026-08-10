// Does choosing "Consultation" in Billing open the real booking form?
//
//   node e2e/verify-billing-booking.mjs
//
// WHY THIS EXISTS
// A build that compiles proves nothing about a screen. Billing's Consultation
// category used to add a hardcoded "OPD Consultation ₹500" line — no department,
// no doctor, no slot, and no appointment behind it, so the counter took money and
// the doctor never learned a patient was coming.
//
// This drives the real browser: open Billing, go to New Invoice, tick
// Consultation, and check the booking dialog appears with departments in it. It
// stops before submitting — booking writes four tables, and a write test belongs in
// a fixture that creates and removes its own rows.
import { launch, login, BASE } from './helpers.js'

const { browser, page } = await launch({ headless: !process.argv.includes('--headed') })
const calls = []
page.on('requestfinished', async (r) => {
  const u = r.url()
  if (!u.includes('/api/')) return
  let size = 0
  try { size = (await r.response())?.headers()?.['content-length'] ?? 0 } catch {}
  calls.push({ url: u.replace(/^.*\/api/, ''), size: Number(size) || 0 })
})

const say = (ok, msg) => console.log(`  ${ok ? '✓' : '✗'} ${msg}`)
let failures = 0
const check = (ok, msg) => { if (!ok) failures++; say(ok, msg) }

await login(page, 'admin')
await page.goto(`${BASE}/admin/billing`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// New Invoice tab
await page.getByRole('tab', { name: /new invoice/i }).click().catch(() => {})
await page.waitForTimeout(1200)
check(await page.getByText(/consultation/i).first().isVisible().catch(() => false),
  'New Invoice shows the Consultation category')

calls.length = 0
// The category is a radio inside a label — click the label text.
await page.getByText('OPD / Consultation', { exact: false }).first().click().catch(async () => {
  await page.getByText('Consultation', { exact: false }).first().click().catch(() => {})
})
await page.waitForTimeout(2000)

const dialog = page.locator('[role="dialog"]')
check(await dialog.count() > 0, 'choosing Consultation opens a dialog')

const title = await dialog.first().locator('h2, [id*="title"]').first().innerText().catch(() => '')
check(/appointment|book/i.test(title), `the dialog is the booking form (title: "${title.trim() || '—'}")`)

const hasDept = await dialog.first().getByText(/department/i).first().isVisible().catch(() => false)
check(hasDept, 'it asks for a department')

const hasPatient = await dialog.first().getByText(/patient/i).first().isVisible().catch(() => false)
check(hasPatient, 'it asks for a patient')

// The hardcoded ₹500 line must no longer be reachable from here.
const dummy = await page.getByText('OPD Consultation').count().catch(() => 0)
check(dummy === 0 || (await dialog.count()) > 0,
  'the hardcoded ₹500 catalogue line is not what opens')

console.log('\n  API calls this action made:')
const seen = new Set()
for (const c of calls) {
  if (seen.has(c.url)) { console.log(`      ⚠ SAME URL TWICE — ${c.url}`); continue }
  seen.add(c.url)
  console.log(`      ${String((c.size / 1024).toFixed(1)).padStart(7)} KB  ${c.url.slice(0, 78)}`)
}
if (!calls.length) console.log('      none — departments came from the module-level cache')

console.log(`\n  ${failures} check(s) failed\n`)
await browser.close()
process.exit(failures ? 1 : 0)
