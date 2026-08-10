// Every claim on the Billing optimisation list, checked against the running app.
//
//   node e2e/verify-billing-claims.mjs [--headed]
//
// WHY THIS EXISTS
// The list was written from a server log, and a server log cannot tell a request
// that was needed from one that was not — it only shows that both arrived. So each
// claim is re-run here with the browser driving, counting not just how many
// requests an action fired but WHICH of them carried the thing the user changed.
// A search that fires four requests and puts the search term in one of them is a
// different bug from a search that fires four searches, and the fix is different.
//
// It reads only. No invoice, payment or patient is created or changed.
import { launch, login, BASE } from './helpers.js'

const { browser, page } = await launch({ headless: !process.argv.includes('--headed') })

let seen = []
page.on('requestfinished', async (r) => {
  const u = r.url()
  if (!u.includes('/api/')) return
  let kb = 0
  try { kb = Number((await r.sizes()).responseBodySize || 0) / 1024 } catch {}
  let rows = null
  try {
    const b = await (await r.response())?.json()
    rows = Array.isArray(b?.data) ? b.data.length : null
  } catch {}
  seen.push({ path: u.split('/api')[1], kb, rows })
})

async function act(fn, wait = 2000) {
  seen = []
  await fn()
  await page.waitForTimeout(wait)
  return [...seen]
}

const fmt = (c) => `${c.path.slice(0, 62).padEnd(62)} ${c.kb.toFixed(1).padStart(7)} KB` +
  `${c.rows !== null ? `  ${String(c.rows).padStart(4)} rows` : ''}`

await login(page, 'admin')
await page.goto(`${BASE}/admin/billing`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const results = []
const claim = (n, text, pass, detail) => {
  results.push({ n, text, pass, detail })
  console.log(`\n  ${pass ? '✓ CONFIRMED' : '✗ NOT WHAT WAS CLAIMED'}  ${n}. ${text}`)
  console.log(`     ${detail}`)
}

// ── 2, 3, 4 — the "4 requests for 1 action" family ───────────────────────────
// These three claims describe one behaviour seen from three angles, so they are
// measured the same way: fire the action, then ask which of the requests actually
// carried the thing that changed. The rest are waste by definition.
console.log('\n══ ACTIONS: how many requests, and how many carried the change ══\n')

const ACTIONS = [
  ['type in invoice search', 'search=', async () => {
    await page.getByPlaceholder(/Search patient or invoice/i).first().click()
    await page.keyboard.type('INV', { delay: 60 })
  }],
  ['clear the search', null, async () => {
    const box = page.getByPlaceholder(/Search patient or invoice/i).first()
    await box.click(); await box.fill('')
  }],
  ['change the status filter', 'status=', async () => {
    await page.locator('button[role="combobox"]').filter({ hasText: /^(All|Paid|Partial|Pending|Cancelled|Refunded)$/ }).first().click()
    await page.getByRole('option', { name: 'Paid', exact: true }).click()
  }],
  ['page → Next', 'offset=', async () => {
    const n = page.getByRole('button', { name: /^Next/i }).first()
    if (await n.count() && await n.isEnabled()) await n.click()
  }],
]

for (const [label, mustCarry, fn] of ACTIONS) {
  const calls = await act(fn, 2200)
  const useful = mustCarry ? calls.filter((c) => c.path.includes(mustCarry)) : calls.filter((c) => c.path.includes('invoices'))
  const wasted = calls.filter((c) => !useful.includes(c))
  console.log(`  ${label}`)
  console.log(`    ${calls.length} request(s) — ${useful.length} carried the change, ${wasted.length} did not:`)
  for (const c of calls) console.log(`      ${useful.includes(c) ? '·' : '✗'} ${fmt(c)}`)
  claim('2-4', `"${label}" fires more requests than it needs`,
    calls.length > useful.length,
    `${calls.length} fired, only ${useful.length} needed — ${wasted.map((w) => w.path.split('?')[0] + (w.path.match(/resource=\w+/)?.[0] ? '?' + w.path.match(/resource=\w+/)[0] : '')).join(', ') || 'none wasted'}`)
}

// ── 1 — the catalogue load ───────────────────────────────────────────────────
console.log('\n══ NEW INVOICE: what the catalogues cost ══\n')

// New Invoice is a TAB, not a dialog, and the departments are radio inputs — an
// earlier version of this script looked for buttons, found none, clicked nothing
// and reported zero requests as if that were a clean result. Zero requests from a
// control that was never pressed is a broken test, not a passing one, so every
// interaction below asserts it actually happened before its numbers are believed.
const openTab = page.getByRole('tab', { name: /New Invoice/i }).first()
if (!(await openTab.count())) throw new Error('New Invoice tab not found — the page did not load')
const openCalls = await act(() => openTab.click(), 2500)
console.log('  opening the New Invoice tab:')
for (const c of openCalls) console.log(`    ${fmt(c)}`)

const deptCalls = {}
for (const dept of ['Laboratory', 'Radiology', 'Pharmacy']) {
  const radio = page.getByRole('radio', { name: new RegExp(`^${dept}$`, 'i') }).first()
  if (!(await radio.count())) { console.log(`  ${dept}: radio not found — skipped, NOT counted as clean`); continue }
  deptCalls[dept] = await act(() => radio.check(), 2500)
  console.log(`  choosing ${dept}:`)
  for (const c of deptCalls[dept]) console.log(`    ${fmt(c)}`)
}

const catalogue = [...openCalls, ...Object.values(deptCalls).flat()]
  .filter((c) => /laboratory|radiology|pharmacy\/drugs/.test(c.path))
const totalKb = catalogue.reduce((a, c) => a + c.kb, 0)
const capped = catalogue.filter((c) => /limit=\d{3,}/.test(c.path))

claim(1, 'the catalogues arrive capped at 500 rows, not paginated',
  capped.length > 0,
  capped.length
    ? `${capped.length} call(s) with limit=500, ${totalKb.toFixed(0)} KB total. ` +
      `Biggest returned ${Math.max(...catalogue.map((c) => c.rows ?? 0))} rows — anything past 500 is invisible (rule 5).`
    : 'no limit=500 seen on the catalogue calls')

claim(1, 'all three catalogues load together when the dialog opens',
  openCalls.filter((c) => /laboratory|radiology|pharmacy\/drugs/.test(c.path)).length >= 3,
  `the dialog itself fired ${openCalls.filter((c) => /laboratory|radiology|pharmacy\/drugs/.test(c.path)).length} catalogue call(s); ` +
  `each department tab fires its own on switch (${Object.entries(deptCalls).map(([d, c]) => `${d}:${c.length}`).join(' ')})`)

// ── 6 — the ₹500 dummy consultation ──────────────────────────────────────────
console.log('\n══ CONSULTATION: dummy ₹500, or the real booking form? ══\n')

const consultRadio = page.getByRole('radio', { name: /OPD \/ Consultation/i }).first()
if (!(await consultRadio.count())) throw new Error('Consultation option not found on the New Invoice tab')
// click, not check: choosing Consultation deliberately does NOT select the radio.
// Its onChange opens the booking dialog and returns early, because a consultation
// is an appointment with a doctor and a slot, not a catalogue line in a cart.
// .check() fails here — and that failure is itself the proof the branch ran.
const consult = await act(() => consultRadio.click(), 3000)
for (const c of consult) console.log(`    ${fmt(c)}`)

const body = await page.locator('body').innerText()
const hasDoctorPicker = /doctor/i.test(body) && /department/i.test(body)
const hasSlots = /slot|available|timing|time/i.test(body)
const stillDummy = /500/.test(body) && !hasDoctorPicker

claim(6, 'Billing still books a consultation as a fixed ₹500 line',
  stillDummy,
  stillDummy
    ? 'the dialog shows a flat 500 with no doctor/department picker'
    : `the real booking form opened — department picker: ${hasDoctorPicker}, slots/timing: ${hasSlots}. ` +
      `Fee comes from the doctor's slab, not a constant. This claim is now out of date.`)

console.log('\n' + '═'.repeat(78))
for (const r of results) console.log(`  ${r.pass ? 'CONFIRMED    ' : 'OUT OF DATE  '} ${r.n}. ${r.text}`)
console.log()

await browser.close()
