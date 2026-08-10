// Does Billing's date filter reach the server, and does Clear all undo everything?
//
//   node e2e/verify-billing-datefilter.mjs
//   node e2e/verify-billing-datefilter.mjs --headed
//
// WHY THIS EXISTS
// The filter matrix proves the API filters correctly. It says nothing about
// whether the SCREEN sends what it should — a control can move, look filtered,
// and never put anything in the query string. That combination is the worst one,
// because the user believes the list is narrowed when it is not.
//
// So this drives the real browser and reads every request the page makes.
import { launch, login, BASE } from './helpers.js'

const { browser, page } = await launch({ headless: !process.argv.includes('--headed') })

let calls = []
page.on('requestfinished', (r) => {
  const u = r.url()
  if (u.includes('/api/billing') && u.includes('resource=invoices')) calls.push(u.split('/api')[1])
})

let failures = 0
const check = (ok, msg, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${msg}${detail ? `  — ${detail}` : ''}`)
}

await login(page, 'admin')
await page.goto(`${BASE}/admin/billing`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// Located by the labels it can hold, not by "All Dates" alone — once a mode is
// chosen the trigger shows THAT mode, and a locator pinned to the initial text
// stops matching the moment the filter is used.
const DATE_MODES = /All Dates|Today|This Week|This Month|Specific Date|Custom Range/i
const dateSelect = () => page.locator('button[role="combobox"]').filter({ hasText: DATE_MODES }).first()
check(await dateSelect().count() > 0, 'the Dashboard & Invoices tab shows a date filter')

// ── Today ────────────────────────────────────────────────────────────────────
calls = []
await dateSelect().click()
await page.getByRole('option', { name: 'Today', exact: true }).click()
await page.waitForTimeout(1800)

const today = new Date().toLocaleDateString('en-CA')
const withDate = calls.filter((c) => c.includes('startDate='))
check(withDate.length > 0, 'choosing Today fires a request', `${calls.length} call(s)`)
check(withDate.some((c) => c.includes(`startDate=${today}`)),
  'the query string carries today\'s date', withDate[0]?.slice(0, 90) || '(none)')

// ── Custom Range: a half-filled range must NOT be sent ───────────────────────
calls = []
await dateSelect().click()
await page.getByRole('option', { name: /Custom Range/i }).click()
await page.waitForTimeout(1200)
const beforeTyping = calls.filter((c) => c.includes('startDate=')).length

const dateInputs = page.locator('input[type="date"]')
await dateInputs.first().fill('2026-08-01')
await page.waitForTimeout(1500)
const afterStartOnly = calls.filter((c) => c.includes('startDate=2026-08-01')).length
check(afterStartOnly === 0,
  'a half-filled custom range is not sent to the server',
  afterStartOnly ? `${afterStartOnly} request(s) fired with only a start date` : 'nothing sent until both dates exist')

calls = []
await dateInputs.nth(1).fill('2026-08-31')
await page.waitForTimeout(1800)
check(calls.some((c) => c.includes('startDate=2026-08-01') && c.includes('endDate=2026-08-31')),
  'the complete range IS sent once both dates are chosen', calls[0]?.slice(0, 90) || '(none)')

// ── combined with another filter ─────────────────────────────────────────────
calls = []
const statusSelect = page.locator('button[role="combobox"]').filter({ hasText: /^All$/ }).first()
if (await statusSelect.count()) {
  await statusSelect.click()
  await page.getByRole('option', { name: 'Paid', exact: true }).click()
  await page.waitForTimeout(1800)
  check(calls.some((c) => c.includes('status=paid') && c.includes('startDate=')),
    'status and date compose — both reach the query string at once',
    calls[0]?.slice(0, 100) || '(none)')
}

// ── Clear all ────────────────────────────────────────────────────────────────
calls = []
const clearAll = page.getByRole('button', { name: /Clear all/i })
check(await clearAll.count() > 0, 'a "Clear all" button appears once filters are active')

if (await clearAll.count()) {
  await clearAll.click()
  await page.waitForTimeout(1800)
  const last = calls[calls.length - 1] || ''
  check(!last.includes('startDate=') && !last.includes('status=') && !last.includes('search='),
    'Clear all removes every filter from the request, not just the date',
    last.slice(0, 100) || '(no request)')
  check(await page.getByRole('button', { name: /Clear all/i }).count() === 0,
    'the Clear all button hides itself once nothing is filtered')
}

console.log(`\n  ${failures} check(s) failed\n`)
await browser.close()
process.exit(failures ? 1 : 0)
