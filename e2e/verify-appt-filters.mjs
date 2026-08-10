// Two findings from the Appointments audit, checked properly before anyone fixes them.
//
// The audit reported "the date filter fires no request" and "search is not
// debounced". Both are the kind of finding that is easy to act on and wrong:
//
//   - the walk fills the date input with TODAY, and the filter already sits on
//     today, so nothing changed and nothing should have been fetched
//   - the walk's earlier version paused 1200 ms between characters, which defeats
//     any debounce; that was fixed, but the verdict was never re-checked
//
// So this types like a person and sets a date that is actually different, and
// counts the requests that result. A fix aimed at a measurement artefact costs
// more than the bug it imagines.
import { launch, login, BASE } from './helpers.js'

const { browser, page } = await launch({ headless: true })
const calls = []
page.on('requestfinished', (r) => {
  if (r.url().includes('/api/appointments?')) calls.push(r.url())
})

const since = () => { const n = calls.length; return () => calls.slice(n) }

try {
  await login(page, 'admin')
  await page.goto(`${BASE}/admin/appointments`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: /list/i }).first().click()
  await page.waitForTimeout(2000)

  // ── the date filter ────────────────────────────────────────────────────────
  const dateBox = page.locator('input[type="date"]').first()
  const before = await dateBox.inputValue()

  let mark = since()
  await dateBox.fill(before)                       // the same date the audit used
  await page.waitForTimeout(1800)
  const sameDay = mark()

  const other = '2026-08-01'
  mark = since()
  await dateBox.fill(other)
  await page.waitForTimeout(1800)
  const newDay = mark()

  console.log('\n  DATE FILTER')
  console.log(`    filter was already on   : ${before}`)
  console.log(`    re-selecting the same day → ${sameDay.length} request(s)   ${sameDay.length === 0 ? '(correct — nothing changed)' : ''}`)
  console.log(`    selecting ${other}       → ${newDay.length} request(s)`)
  for (const u of newDay) console.log(`      ${u.split('?')[1]}`)
  const carries = newDay.some((u) => u.includes(`date=${other}`))
  console.log(`    verdict: ${newDay.length && carries ? 'WORKS — the audit finding was my tool filling a date that was already set'
    : newDay.length ? 'fires, but the query string does not carry the chosen date — REAL BUG'
    : 'REAL BUG — changing the date fetches nothing'}`)

  // ── the search box ─────────────────────────────────────────────────────────
  const box = page.locator('input[placeholder*="Search"]').first()
  await box.fill('')
  await page.waitForTimeout(1800)

  mark = since()
  await box.click()
  await page.keyboard.type('ram', { delay: 60 })   // ~180 ms for three characters
  await page.waitForTimeout(2000)
  const typed = mark()

  console.log('\n  SEARCH DEBOUNCE')
  console.log(`    typed "ram" at 60ms/char → ${typed.length} request(s)`)
  for (const u of typed) console.log(`      ${u.split('?')[1]}`)
  console.log(`    verdict: ${typed.length <= 1 ? 'DEBOUNCED — one request for three characters'
    : `NOT DEBOUNCED — ${typed.length} requests for 3 characters`}`)

  // Typing slowly SHOULD produce one request per pause. That is not a bug; it is
  // what a debounce does. Measuring it distinguishes "no debounce" from "the
  // window is shorter than the user's typing".
  await box.fill('')
  await page.waitForTimeout(1800)
  mark = since()
  await box.click()
  for (const ch of 'ram') { await page.keyboard.type(ch); await page.waitForTimeout(700) }
  await page.waitForTimeout(1500)
  console.log(`    typed "ram" with 700ms gaps → ${mark().length} request(s)  (one per pause is correct)`)
} finally {
  await browser.close()
}
