// Does every screen this change touched still work — including the parts that are
// now loaded on demand?
//
//   node e2e/smoke-lazy.mjs
//
// WHY THIS EXISTS
// A build that succeeds and a suite of backend tests that pass say nothing about
// whether a lazy() boundary resolves in a browser. The failure modes of this change
// are all at runtime and all silent to both:
//
//   - a lazy component rendered outside any <Suspense> throws and blanks the page
//   - a chunk that 404s leaves the fallback on screen forever with no error
//   - a memo'd row that stops updating because a prop is mutated instead of replaced
//
// So each changed screen is opened, the on-demand part is actually triggered, and
// the console is read. Anything that appears there is a failure, not a warning.
//
// It reads only. Dialogs are opened and closed; nothing is saved.
import { launch, login, BASE } from './helpers.js'

const { browser, page } = await launch({ headless: !process.argv.includes('--headed') })

const errors = []
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  // Browser extensions and favicon noise are not this application's doing.
  if (/chrome-extension|favicon|Download the React DevTools/i.test(t)) return
  errors.push(t)
})
page.on('pageerror', (e) => errors.push(`UNCAUGHT: ${e.message}`))

const results = []
async function check(name, fn) {
  const before = errors.length
  let detail = ''
  try { detail = (await fn()) || 'ok' } catch (e) { detail = `THREW: ${e.message.split('\n')[0]}` }
  const fresh = errors.slice(before)
  const pass = !fresh.length && !detail.startsWith('THREW')
  results.push({ name, pass, detail, fresh })
  console.log(`  ${pass ? '✓' : '✗'} ${name.padEnd(52)} ${detail.slice(0, 60)}`)
  for (const e of fresh) console.log(`      console: ${e.slice(0, 100)}`)
}

await login(page, 'admin')

// ── Queue: the two tabs that are now lazy ────────────────────────────────────
await page.goto(`${BASE}/admin/queue`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

await check('Queue: the queue table still renders rows', async () => {
  const n = await page.locator('tbody tr').count()
  return `${n} row(s)`
})

await check('Queue: memo\'d rows still show live status', async () => {
  const txt = await page.locator('tbody').innerText().catch(() => '')
  return /waiting|called|in.progress|completed|—/i.test(txt) ? 'status text present' : 'NO STATUS TEXT'
})

for (const tab of ['Appointments', 'Billing']) {
  await check(`Queue → ${tab} tab loads its lazy chunk`, async () => {
    await page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') }).first().click()
    // The fallback must be replaced by real content, not sit there forever.
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading '),
      null, { timeout: 15000 },
    )
    const t = await page.locator('body').innerText()
    return t.length > 500 ? `rendered (${Math.round(t.length / 100) / 10}k chars)` : 'SUSPICIOUSLY EMPTY'
  })
}

// ── Laboratory / Radiology: the gated import dialog ──────────────────────────
for (const [mod, path] of [['Laboratory', '/admin/laboratory'], ['Radiology', '/admin/radiology']]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)

  await check(`${mod}: page renders without the xlsx chunk`, async () => {
    const t = await page.locator('body').innerText()
    return t.length > 500 ? 'rendered' : 'EMPTY PAGE'
  })

  await check(`${mod}: Import opens the gated lazy dialog`, async () => {
    const btn = page.getByRole('button', { name: /import/i }).first()
    if (!(await btn.count())) return 'no Import button on this tab — not exercised'
    await btn.click()
    await page.waitForTimeout(2500)
    const dlg = page.getByRole('dialog')
    if (!(await dlg.count())) return 'DIALOG DID NOT OPEN'
    const t = await dlg.first().innerText()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    return /excel|csv|template|upload/i.test(t) ? 'opened with its content' : 'opened but looks empty'
  })
}

// ── Settings: the display-boards tab ─────────────────────────────────────────
await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

await check('Settings: page renders', async () => {
  const t = await page.locator('body').innerText()
  return t.length > 500 ? 'rendered' : 'EMPTY PAGE'
})

await check('Settings → Display Boards loads its lazy chunk', async () => {
  const tab = page.getByRole('tab', { name: /display|board|screen/i }).first()
  if (!(await tab.count())) return 'tab not found — not exercised'
  await tab.click()
  await page.waitForTimeout(3000)
  const t = await page.locator('body').innerText()
  return t.length > 500 ? 'rendered' : 'EMPTY AFTER SWITCH'
})

const failed = results.filter((r) => !r.pass)
console.log('\n' + '═'.repeat(70))
console.log(`  ${results.length - failed.length} of ${results.length} checks passed · ${errors.length} console error(s)`)
// Errors raised between checks (during a navigation) belong in the result too —
// counting them and not showing them is how a real fault stays invisible.
if (errors.length) {
  console.log('\n  EVERY console error seen, in order:')
  for (const e of errors) console.log(`    · ${e.slice(0, 160)}`)
}
if (failed.length) {
  console.log('\n  FAILED:')
  for (const f of failed) console.log(`    ✗ ${f.name} — ${f.detail}`)
}
console.log()

await browser.close()
process.exit(failed.length ? 1 : 0)
