// The standing audit. Point it at any environment and it drives the whole app
// through a real browser, reporting what DevTools would show you by hand.
//
//   node e2e/audit.mjs                                  # every module, page load
//   node e2e/audit.mjs --deep                           # every module, every control
//   node e2e/audit.mjs --module appointments --deep     # one module, every control
//   node e2e/audit.mjs --deep --write                   # also exercise write buttons,
//                                                       #   on throwaway rows it creates
//   node e2e/audit.mjs --base https://gudmed-hms.vercel.app --deep
//   node e2e/audit.mjs --role doctor                    # audit as another role
//   node e2e/audit.mjs --json out.json                  # machine-readable, to diff runs
//
// WHY THIS FILE EXISTS
// The same checks were being hand-written as throwaway scripts every time a screen
// was questioned — network sizes one day, duplicate calls the next, re-render counts
// the day after. They are the same checks every time, so they live here once.
//
// WHY IT NO LONGER LISTS CONTROLS BY HAND
// It used to drive each module from a table of button and tab names. That table was
// always shorter than the module and went stale silently: the Appointments entry was
// a search placeholder and four tab names, while the module has five tabs, nine
// icon-only buttons, five filters and five dialogs. The audit reported "done" having
// touched a sixth of it, and nothing failed to say so.
//
// So a module is now three fields — a key, a URL and a name — and everything else is
// discovered from the live DOM on every run (see discover.mjs). Adding a module is a
// row with no knowledge in it; adding a button to a module needs no change at all.
//
// THE COVERAGE LEDGER IS THE POINT
// Every control found goes into a ledger and ends as clicked, skipped or NOT CLICKED.
// The run prints the ones it did not click, by name. A report that claims everything
// passed without naming what it left out is the failure mode this replaces.
//
// It reports and does not write, unless --write is passed — and then only against
// rows the fixture created and deletes again.
import { launch, login, BASE as DEFAULT_BASE } from './helpers.js'
import { discover, flatten, readOptions } from './discover.mjs'
import { watch, judge, totalKb, slowest } from './netwatch.mjs'
import { HOOK, judgeProfile } from './profiler.mjs'
import fs from 'node:fs'
import path from 'node:path'

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt }
const has = (name) => argv.includes('--' + name)

const BASE = arg('base', DEFAULT_BASE).replace(/\/$/, '')
const ROLE = arg('role', 'admin')
const ONLY = arg('module', null)
const DEEP = has('deep')
const WRITE = has('write')
const LIGHTHOUSE = has('lighthouse')
const JSON_OUT = arg('json', null)
// Print every API call, not just the per-action totals. On by default in a deep
// run — the request/response detail IS the audit; the totals are just the index.
const CALLS = !has('quiet')

// A module is a URL and a name. Nothing about its contents belongs here — that is
// what the discovery pass is for, and what keeps this honest across 14 modules.
const MODULES = [
  { key: 'dashboard', path: '', name: 'Dashboard' },
  { key: 'patients', path: 'patients', name: 'Patients' },
  { key: 'appointments', path: 'appointments', name: 'Appointments', fixture: 'appointmentLifecycle' },
  { key: 'pre-triage', path: 'pre-triage', name: 'Pre-Triage' },
  { key: 'queue', path: 'queue', name: 'Queue' },
  { key: 'opd', path: 'opd', name: 'OPD' },
  { key: 'pharmacy', path: 'pharmacy', name: 'Pharmacy' },
  { key: 'laboratory', path: 'laboratory', name: 'Laboratory' },
  { key: 'radiology', path: 'radiology', name: 'Radiology' },
  { key: 'day-care', path: 'day-care', name: 'Day Care' },
  { key: 'ambulance', path: 'ambulance', name: 'Ambulance' },
  { key: 'insurance', path: 'insurance', name: 'Insurance' },
  { key: 'death-certificates', path: 'death-certificates', name: 'Death Certs' },
  { key: 'inpatient', path: 'inpatient', name: 'Inpatient' },
  { key: 'billing', path: 'billing', name: 'Billing' },
  { key: 'doctor-accountability', path: 'doctor-accountability', name: 'Doctor Acct' },
  { key: 'settings', path: 'settings', name: 'Settings' },
]

// Never clicked unless --write, and never at all if it would touch a row the audit
// did not create. Matched against the control's discovered name.
const DESTRUCTIVE = /delete|remove|discard|clear all|sign out|logout|deactivate|void|refund/i

// An icon-only button's name is its lucide class, which never contains the word
// "deactivate" — so the text patterns below could not see it. In Settings the walk
// clicked `circle-x` (deactivate this user) and then `circle-check-big`
// (reactivate), and only the second click undid the first. Nobody was left locked
// out, by luck rather than by design; against production a doctor would have been
// deactivated mid-clinic. An icon that changes state is a write no matter what it
// is called.
const WRITE_ICONS = /^(circle-x|circle-check|circle-check-big|check-circle|square-pen|pencil|pen|trash|trash2|power|ban|user-x|user-check|user-minus|user-plus|toggle-left|toggle-right|send|upload|save|play|square)/i
// Anything that changes a row. A control missing from this list is worse than a
// control skipped by it: it lands in "NOT CLICKED", which reads as an oversight
// rather than a deliberate choice. Queue's `Call in`, `Alert next` and `Undo alert`
// were reported that way — the three actions the module exists to perform, filed as
// forgotten.
const WRITES = /cancel|approve|collect|dispense|submit|save|create|confirm|check.?in|start|complete|no.?show|reschedule|send reminder|register|pay|settle|call in|call next|alert|undo|issue|verify|process|admit|discharge|refund|adjust/i

// A control with no discoverable name at all — no text, no aria-label, no title, no
// lucide class — so discovery fell back to its position in the DOM
// ("div0>div2>button1"). Both filters above match on the name, so both are blind to
// it, and clicking one is clicking something whose purpose is unknown.
//
// This is not theoretical. Settings → Modules renders each module's on/off switch as
// exactly such a control. The walk clicked all fifteen, each one PATCHing
// /settings with modulesEnabled: {…: false}, and turned off fifteen modules of a
// live system — after which twelve routes silently redirected to the Dashboard and
// the audit measured the Dashboard under twelve different module names. The damage
// took one command to undo and the wrong numbers took far longer to notice.
//
// An unnamed control is also unusable by a screen reader, so every one of these is a
// finding in its own right — reported, never pressed.
const UNNAMED = /^unlabelled|>[a-z]+\d/i

// A phone number, an email address or another site. Clicking one hands the browser
// to the OS dialler or navigates off the app entirely, so it can never be part of a
// module's coverage — and counting it as "missed" is a lie about the walk. Nine of
// Patients' fourteen uncovered controls were `tel:` links to patients' own phone
// numbers, which made a 48% module look worse than it is.
const LEAVES_APP = /^(tel:|mailto:|https?:\/\/)|^\+?\d[\d\s-]{6,}$/i

/**
 * What a control's final state should be if the walk never presses it.
 *
 * The two sweeps used to mark everything "NOT CLICKED" outright, which meant a
 * category the walk deliberately does not visit — links — was reported as an
 * oversight. Nine of Patients' fourteen were `tel:` links to patients' own phone
 * numbers: never clickable by an audit, and never a gap in one.
 */
function classify(c) {
  if (LEAVES_APP.test(c.href || c.name)) return ['skipped-external', 'leaves the application — a dialler, mail client or another site']
  if (DESTRUCTIVE.test(c.name)) return ['skipped-destructive', '']
  if (UNNAMED.test(c.name)) return ['skipped-write', 'no accessible name — purpose unknown, so not pressed']
  if (WRITES.test(c.name) && !WRITE) return ['skipped-write', '']
  if (c.icon && WRITE_ICONS.test(c.icon) && !WRITE) return ['skipped-write', `icon "${c.icon}" changes state`]
  return ['NOT CLICKED', '']
}

// Every category walk stops on its own the moment no unhandled control is left —
// the number below is only a runaway guard, not a budget. It used to be a budget
// (60 buttons, 40 icons, 12 cards, 15 rows) and that quietly capped the walk:
// Laboratory found 246 controls and 121 of the 481 never-clicked controls across
// the whole app were simply the walk stopping early. A cap that hides controls is
// the same mistake as rule 5's limit=1000 — it looks like a result and is a
// truncation. Raise it only if a module legitimately exceeds it; do not lower it
// to make a run finish faster.
const FULL = 500

// How many of a REPEATED control to click. Buttons, icons, tabs and filters are
// each different and all of them get walked — that is what FULL is for. Rows,
// cards and per-row checkboxes are the same control rendered once per record, and
// clicking the four-hundredth appointment card proves nothing the fifteenth did
// not. Appointments has ~492 of them; at 1.2 s each that is ten minutes of the
// walk spent learning nothing, and from outside it looks exactly like a hang.
//
// The first version of this file capped everything, which hid 121 genuinely
// distinct controls. Removing the cap entirely was the opposite mistake. The line
// is not "how many" — it is "is this control distinct, or is it row number N".
const PER_RECORD = 15

/**
 * How many options of one filter to try.
 *
 * A status filter's options are each a different code path — pending, completed and
 * cancelled hit different branches, so all of them are worth clicking. A doctor or
 * department filter's options are DATA: three hundred entries that all run the same
 * query with a different id. Walking those proves nothing after the third, and on
 * Appointments the walk spent 94 clicks on one dropdown, every line reading
 * "All Doctors → Dr.".
 *
 * There is no attribute that says which kind a filter is, but the count does: an
 * enum is small and a data-backed picker is not. Above the threshold, sample.
 */
const ENUM_MAX = 10      // at or below this, every option is walked
const DATA_SAMPLE = 3    // above it, this many — enough to prove the filter is wired

// A calendar day cell. The Monthly view renders one <Button> per day of the month
// and its accessible name is the day plus that day's count — "7", "7 42". They are
// discovered as ordinary buttons, so an unlimited button walk clicked all
// thirty-one, firing thirty-one /appointments?date= requests to learn one thing:
// that picking a day filters by that day. Five days prove it, and they should be
// spread — first, last and a few between — because the bug that hides in a date
// filter is at a boundary, not in the middle.
const DAY_CELL = /^\d{1,2}(\s|$)/
const DAY_SAMPLE = 5

// Where the walk is supposed to be. A card or a row can navigate — Inpatient's
// dashboard cards jump to Appointments — and once that happens every later click
// is measured on the wrong screen and filed under the wrong module's name. With no
// budget to stop it the walk then clicked several hundred appointment cards and
// crashed the page. Anything that leaves the module is a finding to record, not a
// place to keep walking.
let homeUrl = ''
let leftHome = []

/** Return to the module if the last click navigated away. Records where it went. */
async function stayHome(label) {
  if (!homeUrl) return false
  const now = page.url()
  if (now.startsWith(homeUrl)) return false
  leftHome.push({ from: label, to: now.replace(BASE, '') })
  await page.goto(homeUrl, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(600)
  return true
}

const ms = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0)
const short = (u) => String(u).replace(/^https?:\/\/[^/]+\/api\//, '').slice(0, 54)

const { browser, page } = await launch({ headless: !has('headed') })
await page.addInitScript(HOOK)
const net = watch(page)

const report = { base: BASE, role: ROLE, deep: DEEP, write: WRITE, at: new Date().toISOString(), modules: [], issues: [] }
const issue = (sev, mod, text) => report.issues.push({ sev, mod, text })

// Carried across every action in a module, so "refetched with nothing changed" can
// be detected — that check is invisible if you only look at one action at a time.
let seenCalls = new Map()

/** Run one action; return everything it caused. */
async function act(label, fn, { wait = 1400, mod = '', navigation = false } = {}) {
  net.reset()
  page._errors.length = 0
  await page.evaluate(() => window.__profileReset?.()).catch(() => {})

  let note = ''
  try { note = (await fn()) || 'ok' } catch (e) { note = 'FAIL: ' + e.message.split('\n')[0].slice(0, 36) }
  await page.waitForTimeout(wait)

  const profile = await page.evaluate(() => window.__profile?.() ?? null).catch(() => null)
  const errs = page._errors.filter((e) => !/401/.test(e))
  const calls = net.take()

  for (const i of judge(calls, { action: label, seen: seenCalls })) issue(i.sev, mod, `${label}: ${i.why} — ${short(i.what)}`)
  for (const i of judgeProfile(profile, { action: label, isNavigation: navigation })) issue(i.sev, mod, `${label}: ${i.why}`)
  if (errs.length) issue('critical', mod, `${label}: console error — ${errs[0].slice(0, 70)}`)

  const top = profile?.components?.[0]
  console.log(
    `  ${label.slice(0, 34).padEnd(35)} ${String(calls.length).padStart(3)}req ` +
    `${(totalKb(calls).toFixed(1) + 'KB').padStart(9)} ${(ms(slowest(calls)) + 'ms').padStart(7)} ` +
    `${String(profile?.commits ?? 0).padStart(3)}r ${errs.length ? '✗' : '·'}  ${note}`,
  )
  // Every API call, one line each — this is the Network tab, printed. Without it
  // the report says "3 requests, 900 KB" and you still have to open DevTools to
  // learn which call it was.
  if (CALLS) {
    for (const c of calls) {
      const flag = c.status === 'FAILED' || Number(c.status) >= 400 ? '✗' : c.kb > 100 ? '!' : c.ms > 200 ? '~' : ' '
      console.log(
        `      ${flag} ${String(c.status).padEnd(6)} ${c.method.padEnd(6)} ${c.path.replace('/api', '').padEnd(28).slice(0, 28)} ` +
        `${(c.kb.toFixed(1) + 'KB').padStart(9)} ${(ms(c.ms) + 'ms').padStart(7)} ${c.rows != null ? String(c.rows).padStart(5) + ' rows' : '          '}` +
        `${c.query ? '  ?' + c.query.slice(0, 60) : ''}`,
      )
      if (c.payload) console.log(`               → sent: ${c.payload.slice(0, 90)}`)
    }
  }
  if (top && top.ms > 20) console.log(`      slowest render: ${top.name} ${top.ms}ms ×${top.count}`)
  if (errs.length) console.log(`      ✗ ${errs[0].slice(0, 96)}`)

  return { label, calls, profile, errs, note, kb: totalKb(calls) }
}

// ── the coverage ledger ──────────────────────────────────────────────────────
// Keyed by kind:name rather than by the data-audit-id, because ids are reassigned
// every time the DOM changes and a click almost always changes the DOM.
function makeLedger() {
  const seen = new Map()
  return {
    note(control, state, why = '') {
      const key = `${control.kind}:${control.name}`
      const prev = seen.get(key)
      // A control's state may only improve. Without this the final sweep — which
      // marks anything not clicked as NOT CLICKED — quietly overwrote every
      // deliberate `skipped-write` and `skipped-destructive`, so the report showed
      // 75 missed controls and zero skips when most had in fact been skipped on
      // purpose. A coverage number that cannot distinguish "we chose not to" from
      // "we forgot" is worth nothing.
      const RANK = { 'NOT CLICKED': 0, unreachable: 1, 'skipped-repeat': 2, 'skipped-write': 2, 'skipped-destructive': 2, 'skipped-external': 2, clicked: 3 }
      if (prev && (RANK[prev.state] ?? 0) >= (RANK[state] ?? 0)) return
      seen.set(key, { ...control, state, why })
    },
    has(control) { return seen.get(`${control.kind}:${control.name}`)?.state === 'clicked' },
    all() { return [...seen.values()] },
    counts() {
      const c = { clicked: 0, 'skipped-write': 0, 'skipped-destructive': 0, 'skipped-external': 0, 'skipped-repeat': 0, unreachable: 0, 'NOT CLICKED': 0 }
      for (const v of seen.values()) c[v.state] = (c[v.state] || 0) + 1
      return c
    },
  }
}

/** Click a control found in a fresh discovery, by its stable-per-discovery id. */
async function clickId(id, { wait = 900, name = null, kind = null } = {}) {
  let el = page.locator(`[data-audit-id="${id}"]`)

  // The tag is an attribute on a DOM node, and this app re-renders hard enough
  // that React replaces the node between discovery and the click — taking the
  // attribute with it. Queue lost sixteen of seventeen icon buttons that way and
  // reported them "unreachable", which read as a broken app rather than a harness
  // that could not hold on. Re-discover and find the control again by name.
  if (!(await el.count()) && name) {
    const again = await discover(page)
    const all = flatten(again)
    // Prefer the same kind, but accept the same name under a different one. A
    // patient row is discovered BOTH as a clickableCard and as a tableRow — the
    // same DOM element seen two ways — and requiring the kind to match meant all
    // ten of Patients' cards came back "gone from the DOM" and were reported as
    // unreachable. The element was there the whole time, under its other name.
    const found = all.find((c) => c.name === name && c.kind === kind) || all.find((c) => c.name === name)
    if (found) el = page.locator(`[data-audit-id="${found.id}"]`)
  }
  if (!(await el.count())) return 'gone from the DOM'
  if (!(await el.isEnabled().catch(() => true))) return 'disabled (correct)'
  try {
    await el.click({ timeout: 4000 })
  } catch {
    // A control behind an overlay or scrolled out of view is still reachable —
    // it just cannot be clicked the way a person would.
    await el.click({ timeout: 4000, force: true }).catch(() => {})
  }
  await page.waitForTimeout(wait)
  return 'ok'
}

async function closeAnyDialog() {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('[role="dialog"]').count())) return
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
  }
}

/**
 * A dialog is a screen, so it gets the same walk the page gets.
 *
 * WHY THIS EXISTS
 * This used to record a dialog's controls and click none of them — only its tabs.
 * Across seventeen modules that was 291 of the 481 controls never clicked, sixty
 * per cent of the whole gap, and it was invisible because "inside dialog" read
 * like a deliberate skip rather than a hole. CLAUDE.md rule 10 step 8 has always
 * said a dialog gets steps 2-7 too; the harness simply did not.
 *
 * Discovery already scopes itself to an open dialog, so `discover(page)` here
 * returns the dialog's own controls and nothing behind it.
 */
async function walkDialog(ledger, mod, allowWrite, depth = 0) {
  const steps = []
  const opened = await discover(page)
  if (!opened?.dialogOpen) return steps
  console.log(`      ${'  '.repeat(depth)}↳ dialog "${opened.dialogOpen.title}": ${opened.total} controls`)

  // Tabs first: they reveal fields the other categories cannot see yet. Then the
  // read-only controls, then buttons last — a button is the thing most likely to
  // close the dialog and end the walk early.
  for (const category of ['tabs', 'comboboxes', 'checkboxes', 'clickableCards', 'iconButtons', 'buttons']) {
    const attempted = new Set()
    for (let n = 0; n < 60; n++) {
      if (!(await page.locator('[role="dialog"]').count())) return steps // it closed under us
      const found = await discover(page)
      if (!found?.dialogOpen) return steps
      const pending = (found[category] || []).find((c) => !ledger.has(c) && !attempted.has(c.name))
      if (!pending) break
      attempted.add(pending.name)

      if (UNNAMED.test(pending.name)) {
        ledger.note(pending, 'skipped-write', 'inside dialog · no accessible name — purpose unknown, so not pressed')
        issue('important', mod, `dialog control has no accessible name — "${pending.name}" (${pending.kind})`)
        continue
      }
      if (DESTRUCTIVE.test(pending.name)) { ledger.note(pending, 'skipped-destructive', 'inside dialog'); continue }
      if (WRITES.test(pending.name) && !allowWrite) { ledger.note(pending, 'skipped-write', 'inside dialog'); continue }
      if (pending.icon && WRITE_ICONS.test(pending.icon) && !allowWrite) {
        ledger.note(pending, 'skipped-write', `inside dialog · icon "${pending.icon}" changes state`)
        continue
      }
      if (pending.disabled) { ledger.note(pending, 'clicked', 'disabled — correct at this boundary'); continue }

      const s = await act(`  dialog ${category}: ${pending.name}`, () => clickId(pending.id, { wait: 600, name: pending.name, kind: pending.kind }), { mod })
      steps.push(s)
      ledger.note(pending, s.note.startsWith('FAIL') || s.note === 'gone from the DOM' ? 'unreachable' : 'clicked', 'inside dialog')

      // A dialog can open a dialog — a picker on top of a form. Two deep is where
      // this app stops; the guard is here so a cycle cannot run forever.
      if (depth < 2 && (await page.locator('[role="dialog"]').count()) > 1) {
        steps.push(...await walkDialog(ledger, mod, allowWrite, depth + 1))
      }
    }
  }
  // Text inputs are not clicked — typing into a form field is a write. Record them
  // honestly rather than leaving them to the final sweep, which would call them missed.
  for (const c of flatten(await discover(page))) {
    if (c.kind === 'textInput' || c.kind === 'searchInput') ledger.note(c, 'skipped-write', 'inside dialog — typing into a form is a write')
  }
  return steps
}

/**
 * Walk one category of controls to exhaustion. Re-discovers before each click,
 * because clicking changes the page and every previously captured id goes stale.
 */
async function walkCategory(category, ledger, mod, { label, wait = 900, limit = 40, allowWrite = false } = {}) {
  const steps = []
  // One attempt per control per category walk. Without this a control that cannot
  // be clicked is re-picked every iteration — one unreachable button burned all 30
  // attempts while 31 calendar-day buttons beside it were never touched once.
  const attempted = new Set()
  let dayCells = 0
  for (let n = 0; n < limit; n++) {
    // A dialog left open from the previous click makes discovery dialog-scoped, so
    // every control on the page behind it comes back "gone from the DOM". Inpatient
    // reported 16 of its 18 icon buttons unreachable that way — the app was fine,
    // the walk was looking at an overlay.
    if (await page.locator('[role="dialog"]').count()) await closeAnyDialog()
    const found = await discover(page)
    const pending = (found?.[category] || []).find((c) => !ledger.has(c) && !attempted.has(c.name))
    if (!pending) break
    attempted.add(pending.name)

    if (LEAVES_APP.test(pending.href || pending.name)) {
      ledger.note(pending, 'skipped-external', 'leaves the application — a phone dialler, mail client or another site')
      continue
    }
    // A calendar month is 31 buttons that differ only by which day they select.
    if (DAY_CELL.test(pending.name)) {
      if (dayCells >= DAY_SAMPLE) {
        ledger.note(pending, 'skipped-repeat', `calendar day — ${DAY_SAMPLE} of the month's days were walked`)
        continue
      }
      dayCells++
    }
    if (UNNAMED.test(pending.name)) {
      ledger.note(pending, 'skipped-write', 'no accessible name — purpose unknown, so not pressed (and unusable by a screen reader)')
      issue('important', mod, `control has no accessible name — "${pending.name}" (${pending.kind}); a screen reader cannot use it and the audit will not press it`)
      continue
    }
    if (DESTRUCTIVE.test(pending.name)) { ledger.note(pending, 'skipped-destructive'); continue }
    if (WRITES.test(pending.name) && !allowWrite) { ledger.note(pending, 'skipped-write'); continue }
    // The icon check is separate because an icon-only control's name is a lucide
    // class — it can never match the word patterns above, however many are added.
    if (pending.icon && WRITE_ICONS.test(pending.icon) && !allowWrite) {
      ledger.note(pending, 'skipped-write', `icon "${pending.icon}" changes state`)
      continue
    }
    if (pending.disabled) { ledger.note(pending, 'clicked', 'disabled — correct at this boundary'); continue }

    const s = await act(`${label}: ${pending.name}`, () => clickId(pending.id, { wait, name: pending.name, kind: pending.kind }), { mod })
    steps.push(s)
    const wentAway = await stayHome(`${label}: ${pending.name}`)
    ledger.note(pending, s.note.startsWith('FAIL') || s.note === 'gone from the DOM' ? 'unreachable' : 'clicked',
      wentAway ? `${s.note} — navigated away, walk returned` : s.note)
    if (wentAway) continue   // the page behind us is new; re-discover rather than trust the old ids

    // A click that opened a dialog is its own surface — walk it, then close it, or
    // every later click lands on the overlay and silently does nothing.
    if (await page.locator('[role="dialog"]').count()) {
      steps.push(...await walkDialog(ledger, mod, allowWrite))
      await closeAnyDialog()
    }
  }

  // Anything of this category still unhandled was cut by the per-record cap, not
  // forgotten. Say so, with the count — "row 16 of 492" is a deliberate stop, and
  // filing it as NOT CLICKED would put 477 phantom gaps in the coverage ledger.
  const left = ((await discover(page))?.[category] || []).filter((c) => !ledger.has(c) && !attempted.has(c.name))
  for (const c of left) ledger.note(c, 'skipped-repeat', `one of ${left.length + attempted.size} identical ${label}s — ${limit} walked`)

  return steps
}

console.log(`\n  GudMed audit · ${BASE} · role=${ROLE} · ${DEEP ? 'DEEP' : 'page load only'}${WRITE ? ' · WRITE (throwaway rows)' : ''}`)
await login(page, ROLE)

for (const m of MODULES) {
  if (ONLY && m.key !== ONLY) continue
  console.log(`\n${'═'.repeat(88)}\n  ${m.name.toUpperCase()}\n${'═'.repeat(88)}`)
  console.log('  ACTION                                REQ      SIZE SLOWEST RNDR ERR  NOTE')

  seenCalls = new Map()
  const ledger = makeLedger()
  const steps = []
  homeUrl = `${BASE}/${ROLE}/${m.path}`
  leftHome = []

  steps.push(await act('page load', async () => {
    await page.goto(homeUrl, { waitUntil: 'networkidle' })
    return 'ok'
  }, { wait: 2400, mod: m.name, navigation: true }))

  const found = await discover(page)
  if (!found) { issue('critical', m.name, 'page rendered nothing'); continue }
  const inv = {
    buttons: found.buttons.length, iconOnly: found.iconButtons.length,
    filters: found.comboboxes.length, tabs: found.tabs.length,
    dates: found.dateInputs.length, searches: found.searchInputs.length,
    cards: found.clickableCards.length, rows: found.tableRows.length,
    total: found.total,
  }
  console.log(`      discovered: ${inv.total} controls · ${inv.buttons} buttons (${inv.iconOnly} icon-only) · ` +
              `${inv.filters} filters · ${inv.dates} dates · ${inv.tabs} tabs · ${inv.cards} cards · ${inv.rows} rows`)

  // Everything found enters the ledger immediately, so even a shallow run reports
  // what exists and what it did not touch. A run that finds 84 controls and reports
  // a coverage of zero is worse than useless — it reads as "nothing to check".
  for (const c of flatten(found)) ledger.note(c, ...classify(c))

  // A card with cursor-pointer and no handler tells the user it is clickable and
  // then does nothing. That is a UI bug you cannot see in a screenshot.
  for (const c of found.clickableCards.filter((x) => !x.hasHandler)) {
    issue('note', m.name, `looks clickable but has no handler: "${c.text || c.name}"`)
  }

  if (DEEP) {
    // Tabs are re-discovered every round rather than listed once up front. Inpatient
    // shows NO tabs on page load and five once a card has been clicked; a list
    // captured at the start therefore walked zero of them and the final sweep filed
    // all five as NOT CLICKED — five whole screens reported as missed controls.
    const visitedTabs = new Set()
    for (let round = 0; round < 14; round++) {
      const fresh = await discover(page)
      const nextTab = (fresh?.tabs || []).find((t) => !visitedTabs.has(t.name))
      if (round > 0 && !nextTab) break
      if (nextTab) {
        visitedTabs.add(nextTab.name)
        console.log(`\n  ── tab: ${nextTab.name} ──`)
        const s = await act(`tab: ${nextTab.name}`, () => clickId(nextTab.id, { wait: 1600, name: nextTab.name, kind: nextTab.kind }), { mod: m.name })
        steps.push(s)
        ledger.note(nextTab, 'clicked', s.note)
      }

      // 1. Cards. Clicking one usually opens a dialog, which walkCategory handles.
      steps.push(...await walkCategory('clickableCards', ledger, m.name, { label: 'card', wait: 1200, limit: PER_RECORD }))

      // 2. Search — typed as a human types. The old walk waited 1200 ms between
      //    characters, which defeats every debounce and made every module look
      //    like it fired per keystroke. Type the burst, then measure once.
      const afterCards = await discover(page)
      for (const box of afterCards.searchInputs) {
        const s = await act(`search: type "ram"`, async () => {
          await page.click(`[data-audit-id="${box.id}"]`)
          await page.keyboard.type('ram', { delay: 60 })
          return 'ok'
        }, { wait: 1600, mod: m.name })
        steps.push(s)
        if (s.calls.length > 1) {
          issue('important', m.name, `search fired ${s.calls.length} requests for 3 characters typed at 60ms — not debounced`)
        }
        ledger.note(box, 'clicked', `${s.calls.length} req`)
        steps.push(await act('search: clear', async () => {
          await page.fill(`[data-audit-id="${box.id}"]`, '')
          return 'ok'
        }, { mod: m.name }))
      }

      // 3. Every filter, every option, including the "All" reset.
      //
      // Address filters by POSITION, never by name. A Radix trigger shows its
      // current value as its text, so choosing "Dermatology" renames the control
      // from "All Departments" to "Dermatology" — a name lookup then misses and
      // silently falls through to the first combobox on the page. That is how a
      // run reports "department filter fired no request": it was clicking Status
      // eight times.
      const rx = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')
      const pickAt = async (index, opt) => {
        const fresh = await discover(page)
        const c = fresh.comboboxes[index]
        if (!c) return 'filter gone'
        await page.click(`[data-audit-id="${c.id}"]`)
        await page.waitForTimeout(350)
        const o = page.getByRole('option', { name: rx(opt) }).first()
        if (!(await o.count())) { await page.keyboard.press('Escape'); return 'option gone' }
        await o.click()
        return 'ok'
      }

      const afterSearch = await discover(page)
      const filterPlan = []
      for (let fi = 0; fi < afterSearch.comboboxes.length; fi++) {
        const combo = afterSearch.comboboxes[fi]
        const options = await readOptions(page, combo.id)
        if (!options.length) { ledger.note(combo, 'unreachable', 'no options appeared'); continue }
        const isData = options.length > ENUM_MAX
        const toTry = isData ? options.slice(0, DATA_SAMPLE) : options
        console.log(`      filter ${fi} "${combo.name}" → ${options.length} options` +
          (isData ? ` (data-backed — sampling ${toTry.length})` : ''))
        filterPlan.push({ index: fi, name: combo.name, options })

        for (const opt of toTry) {
          const s = await act(`filter[${fi}] ${combo.name} → ${opt}`, () => pickAt(fi, opt), { mod: m.name })
          steps.push(s)
          if (s.calls.length === 0) {
            issue('note', m.name, `filter "${combo.name} → ${opt}" fired no request — client-side, or the filter is not wired`)
          } else if (!s.calls.some((c) => c.query)) {
            issue('important', m.name, `filter "${combo.name} → ${opt}" refetched without putting anything in the query string`)
          }
        }
        // Leave it on its "All" reset so the next filter is measured cleanly.
        const reset = options.find((o) => /^all\b/i.test(o))
        if (reset) await pickAt(fi, reset)
        ledger.note(combo, 'clicked', `${options.length} options`)
      }

      // 3b. Filters COMBINED. One filter at a time is the easy case and it is not
      //     the case that breaks: two filters that each work alone routinely
      //     contradict each other, because one narrows server-side and the other
      //     narrows what is already on screen. The header count then stops
      //     matching the rows in the table, and nobody notices until a doctor does.
      if (filterPlan.length >= 2) {
        const real = (f) => f.options.find((o) => !/^all\b/i.test(o))
        const combo2 = filterPlan.filter(real).slice(0, 3)
        if (combo2.length >= 2) {
          const applied = []
          for (const f of combo2) {
            const opt = real(f)
            applied.push(`${f.name}=${opt}`)
            const s = await act(`combine: ${applied.join(' + ')}`, () => pickAt(f.index, opt), { mod: m.name, wait: 1600 })
            steps.push(s)
          }
          const shown = await page.evaluate(() => ({
            rows: document.querySelectorAll('tbody tr').length,
            // "Page 1 of 4", "23 appointments" — whatever count the header claims.
            claims: [...document.querySelectorAll('*')]
              .map((e) => e.childElementCount === 0 ? e.textContent?.trim() : null)
              .filter((t) => t && /^\s*(page \d+ of \d+|\d+\s+(appointments?|results?|records?|patients?))\s*$/i.test(t))
              .slice(0, 3),
          }))
          console.log(`      combined → ${shown.rows} rows on screen · header says: ${shown.claims.join(' / ') || '(no count shown)'}`)
          if (shown.rows === 0 && !shown.claims.some((c) => /\b0\b/.test(c))) {
            issue('important', m.name, `combined filters (${applied.join(' + ')}) show 0 rows but the header still claims "${shown.claims[0] || 'a count'}"`)
          }
          // Now unwind one at a time — the row count must not shrink as a filter
          // is REMOVED.
          let last = shown.rows
          for (const f of [...combo2].reverse()) {
            const reset = f.options.find((o) => /^all\b/i.test(o))
            if (!reset) continue
            const s = await act(`un-combine: ${f.name} → ${reset}`, () => pickAt(f.index, reset), { mod: m.name, wait: 1600 })
            steps.push(s)
            const now = await page.evaluate(() => document.querySelectorAll('tbody tr').length)
            if (now < last) issue('important', m.name, `removing filter "${f.name}" REDUCED the rows shown (${last} → ${now}) — filters are fighting each other`)
            last = now
          }
        }
      }

      // 4. Date filters. The old walk had no date handling at all, which is how a
      //    whole class of filter went unaudited on Patients.
      const afterFilters = await discover(page)
      for (const d of afterFilters.dateInputs) {
        if (ledger.has(d)) continue
        const s = await act(`date: ${d.name} → today`, async () => {
          const today = new Date().toISOString().slice(0, 10)
          await page.fill(`[data-audit-id="${d.id}"]`, today)
          return 'ok'
        }, { wait: 1600, mod: m.name })
        steps.push(s)
        const carried = s.calls.some((c) => /[?&]date/.test(c.url))
        if (s.calls.length && !carried) issue('important', m.name, `date filter fired a request but no date= in the query string`)
        if (!s.calls.length) issue('note', m.name, `date filter "${d.name}" fired no request`)
        ledger.note(d, 'clicked', carried ? 'date= in query' : `${s.calls.length} req`)
      }

      // 5. Pagination at both ends.
      for (const nav of ['Next', 'Previous']) {
        const fresh = await discover(page)
        const b = fresh.buttons.find((x) => new RegExp(`^${nav}$`, 'i').test(x.name))
        if (!b) continue
        const s = await act(`page: ${nav}`, () => clickId(b.id, { wait: 1200 }), { mod: m.name })
        steps.push(s)
        ledger.note(b, 'clicked', s.note)
      }

      // 6-7. Every remaining button, then every icon-only button. Icon-only last
      //      and by its own category, because these are the ones that get missed.
      // 60, not 30: the Monthly calendar alone renders one button per day of the
      // month, and a limit that stops at 30 leaves the last week of every month
      // unclicked while reporting a tidy-looking number.
      steps.push(...await walkCategory('buttons', ledger, m.name, { label: 'button', limit: FULL, allowWrite: WRITE }))
      steps.push(...await walkCategory('iconButtons', ledger, m.name, { label: 'icon', limit: FULL, allowWrite: WRITE }))

      // Table rows and checkboxes were discovered, counted against the total, and
      // then never walked — so Queue reported 22 of 114 with 25 rows and 16
      // checkboxes sitting untouched in the denominator. Neither is a write:
      // clicking a row opens or expands it, and a checkbox only selects. Leaving
      // them out made the coverage figure look far worse than the walk actually
      // was, and hid whatever those rows do.
      steps.push(...await walkCategory('tableRows', ledger, m.name, { label: 'row', limit: PER_RECORD, wait: 1000 }))
      steps.push(...await walkCategory('checkboxes', ledger, m.name, { label: 'checkbox', limit: PER_RECORD, wait: 700 }))

      await closeAnyDialog()
    }

    // Anything discovered anywhere and never resolved.
    const finalSweep = await discover(page)
    for (const c of flatten(finalSweep)) if (!ledger.has(c)) ledger.note(c, ...classify(c))
  }

  const counts = ledger.counts()
  const missed = ledger.all().filter((c) => c.state === 'NOT CLICKED')
  // A name without a reason is half a finding. "Save Invoice — write, no fixture"
  // is actionable; "Save Invoice" alone reads as an oversight and gets argued about.
  // The catch-all used to read "ran out of budget", which stopped being true when
  // the budgets were removed — and a wrong reason is worse than none, because it
  // sends the reader to fix the harness instead of looking at the control. If a
  // control reaches here now it is genuinely unexplained, and saying so is the
  // honest answer.
  const reasonFor = (c) => c.why ? c.why
    : c.disabled ? 'disabled at this point in the flow'
    : 'appeared only after the walk had left that screen — no reason recorded'
  const skippedW = ledger.all().filter((c) => c.state === 'skipped-write')
  const skippedD = ledger.all().filter((c) => c.state === 'skipped-destructive')

  // Which controls take the user out of the module. Worth reporting on its own:
  // a card on a ward dashboard that jumps to Appointments is either a deliberate
  // shortcut nobody documented, or a link pointing at the wrong screen.
  if (leftHome.length) {
    console.log(`\n  ── left the module (${leftHome.length}) ──`)
    for (const l of leftHome.slice(0, 12)) console.log(`      ${l.from.slice(0, 46).padEnd(48)} → ${l.to}`)
    issue('note', m.name, `${leftHome.length} control(s) navigated out of the module: ${leftHome.slice(0, 4).map((l) => l.from).join(', ')}`)
  }

  console.log(`\n  ── coverage ──`)
  // Reachable = everything the walk could legitimately press. A tel: link and a
  // Delete button are not failures of coverage, so a percentage that includes them
  // can never reach 100 however complete the walk is — and an unreachable ceiling
  // is the kind of number people stop believing.
  const reachable = ledger.all().length - counts['skipped-external'] - counts['skipped-destructive'] - counts['skipped-write'] - counts['skipped-repeat']
  const pct = reachable > 0 ? Math.round((counts.clicked / reachable) * 100) : 100
  console.log(`  found ${ledger.all().length} · clicked ${counts.clicked} · skipped-write ${counts['skipped-write']} · ` +
              `skipped-destructive ${counts['skipped-destructive']} · skipped-external ${counts['skipped-external']} · ` +
              `skipped-repeat ${counts['skipped-repeat']} · ` +
              `unreachable ${counts.unreachable} · NOT CLICKED ${counts['NOT CLICKED']}`)
  console.log(`  reachable ${reachable} · clicked ${counts.clicked} · ${pct}% of what the walk was allowed to press`)
  const byKind = ledger.all().reduce((acc, c) => {
    const k = acc[c.kind] ??= { found: 0, clicked: 0, skipped: 0, unreachable: 0, missed: 0 }
    k.found++
    if (c.state === 'clicked') k.clicked++
    else if (c.state === 'unreachable') k.unreachable++
    else if (String(c.state).startsWith('skipped')) k.skipped++
    else k.missed++
    return acc
  }, {})
  console.log('  by control type:')
  for (const [kind, k] of Object.entries(byKind).sort((a, b) => b[1].found - a[1].found)) {
    console.log(`    ${kind.padEnd(16)} ${String(k.clicked).padStart(3)}/${String(k.found).padEnd(4)} clicked` +
      `${k.skipped ? ` · ${k.skipped} skipped` : ''}${k.unreachable ? ` · ${k.unreachable} unreachable` : ''}` +
      `${k.missed ? ` · ${k.missed} MISSED` : ''}`)
  }
  for (const [title, list] of [['NOT CLICKED', missed], ['skipped (write)', skippedW], ['skipped (destructive)', skippedD]]) {
    if (!list.length) continue
    console.log(`    ${title}:`)
    for (const c of list.slice(0, 12)) {
      console.log(`      ${String(c.name).slice(0, 44).padEnd(46)} ${c.kind.padEnd(14)} ${title === 'NOT CLICKED' ? reasonFor(c) : c.why || ''}`)
    }
    if (list.length > 12) console.log(`      … and ${list.length - 12} more`)
  }
  if (missed.length) issue('note', m.name, `${missed.length} controls never clicked: ${missed.map((c) => c.name).slice(0, 8).join(', ')}`)

  report.modules.push({
    name: m.name, key: m.key,
    requests: steps.reduce((s, x) => s + x.calls.length, 0),
    kb: +steps.reduce((s, x) => s + x.kb, 0).toFixed(1),
    commits: steps[0]?.profile?.commits ?? 0,
    errors: steps.reduce((s, x) => s + x.errs.length, 0),
    inventory: inv,
    coverage: { ...counts, total: ledger.all().length },
    notClicked: missed.map((c) => ({ name: c.name, kind: c.kind, why: reasonFor(c) })),
    skippedWrite: skippedW.map((c) => c.name),
    // Coverage broken down by KIND of control, because "62 of 125" hides which
    // 63 were missed. A run where every button was clicked and every filter was
    // not is a different run from the reverse, and the summary line cannot tell
    // them apart.
    byKind: ledger.all().reduce((acc, c) => {
      const k = acc[c.kind] ??= { found: 0, clicked: 0, skipped: 0, unreachable: 0, missed: 0 }
      k.found++
      if (c.state === 'clicked') k.clicked++
      else if (c.state === 'unreachable') k.unreachable++
      else if (String(c.state).startsWith('skipped')) k.skipped++
      else k.missed++
      return acc
    }, {}),
    steps: steps.map((s) => ({
      label: s.label, req: s.calls.length, kb: +s.kb.toFixed(1), slowest: ms(slowest(s.calls)),
      renders: s.profile?.commits ?? 0, errs: s.errs.length, note: s.note,
      // The full Network tab for this action, so a run can be re-read months later
      // without re-running it.
      calls: s.calls.map((c) => ({
        method: c.method, path: c.path, query: c.query, status: c.status,
        kb: +c.kb.toFixed(1), ms: ms(c.ms), rows: c.rows, payload: c.payload,
      })),
      renderedComponents: (s.profile?.components || []).slice(0, 10),
    })),
    heaviest: steps.flatMap((s) => s.calls).sort((a, b) => b.kb - a.kb).slice(0, 8).map((c) => ({ url: short(c.url), kb: +c.kb.toFixed(1), ms: ms(c.ms), status: c.status })),
  })

  // Write-path coverage runs against rows the fixture creates and then deletes, so
  // the buttons the walk had to skip are still proven to work.
  if (WRITE && m.fixture) {
    try {
      const { run } = await import(`./fixtures/${m.fixture}.mjs`)
      const res = await run({ page, act, discover, BASE, ROLE, mod: m.name, issue })
      report.modules.at(-1).writeFixture = res
    } catch (e) {
      console.log(`  fixture failed: ${e.message.split('\n')[0]}`)
      issue('critical', m.name, `write fixture failed: ${e.message.split('\n')[0].slice(0, 80)}`)
    }
  }
}

if (LIGHTHOUSE) {
  try {
    const { runLighthouse } = await import('./lighthouse.mjs')
    report.lighthouse = await runLighthouse({ page, BASE, ROLE, module: ONLY || 'appointments' })
  } catch (e) {
    console.log(`\n  lighthouse skipped: ${e.message.split('\n')[0]}`)
  }
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(88)}\n  SUMMARY\n${'═'.repeat(88)}`)
console.log('  MODULE          REQ      SIZE  RENDERS  ERRORS   FOUND  CLICKED  MISSED')
for (const r of report.modules) {
  console.log(`  ${r.name.padEnd(14)} ${String(r.requests).padStart(4)}  ${(r.kb.toFixed(1) + 'KB').padStart(9)}  ` +
    `${String(r.commits).padStart(7)}  ${String(r.errors).padStart(6)}  ${String(r.coverage.total).padStart(6)}  ` +
    `${String(r.coverage.clicked).padStart(7)}  ${String(r.coverage['NOT CLICKED']).padStart(6)}`)
}

const bySev = (s) => report.issues.filter((i) => i.sev === s)
console.log(`\n  ${bySev('critical').length} critical · ${bySev('important').length} important · ${bySev('note').length} notes`)
for (const s of ['critical', 'important', 'note']) {
  const list = bySev(s)
  if (!list.length) continue
  console.log(`\n  ── ${s.toUpperCase()} (${list.length}) ──`)
  // Collapse repeats: the same finding on ten filter changes is one finding.
  const uniq = new Map()
  for (const i of list) {
    const key = `${i.mod}|${i.text.replace(/^[^:]+:\s*/, '').slice(0, 70)}`
    uniq.set(key, (uniq.get(key) || 0) + 1)
  }
  for (const [key, n] of [...uniq].slice(0, 40)) {
    const [mod, text] = key.split('|')
    console.log(`     [${mod}] ${text}${n > 1 ? `  (×${n})` : ''}`)
  }
}

if (JSON_OUT) {
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2))
  console.log(`\n  JSON: ${JSON_OUT}`)
}
await browser.close()
process.exit(bySev('critical').length ? 1 : 0)
