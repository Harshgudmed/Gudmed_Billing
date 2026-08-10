// Prove the HTML says what the runs found. Exactly, not by guessing words.
//
//   node docs/verify-report.mjs
//
// WHY THIS EXISTS
// Two earlier attempts at this check matched on words picked out of a finding's
// prose — "payload", "wasted", "duplicate" — and both reported findings missing that
// were plainly there, because the sentence happened to use different words. A
// checker that cries wolf is worse than none: it teaches you to skim its output,
// which is the habit it exists to break.
//
// So this compares identifiers, which cannot drift:
//   1. every KIND of problem in a module's run log has a finding in findings.json
//   2. every finding in findings.json appears, by id, in that module's HTML page
//   3. the page's coverage figure matches the log's
//
// Exit code is the number of mismatches, so it can gate a commit.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const LOGS = path.join(ROOT, 'e2e', 'audit-report', 'live')
const PAGES = path.join(ROOT, 'docs', 'modules')
const { findings } = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'findings.json'), 'utf8'))

// Same table the harvester uses. If a kind appears here it must reach the report.
const KINDS = {
  SHELL: /(NavLink|Navigation|App) re-rendered/,
  REFETCH: /refetched with nothing changed/,
  DUPE: /same URL 2× in one action/,
  IDENTICAL: /identical bod/,
  SLOW: /ms locally — seconds on Render/,
  BIG: /KB response/,
  RULE5: /limit=\d+ is a cap/,
  HTTPERR: /HTTP [45]\d\d/,
  CONSOLEERR: /console error/,
  NOHANDLER: /looks clickable but has no handler/,
  DEADFILTER: /fired no request/,
  FILTERNOQUERY: /without putting anything in the query string/,
  NODEBOUNCE: /not debounced/,
  NONAME: /no accessible name/,
  LEFTMODULE: /navigated out of the module/,
}

let problems = 0
const rows = []

for (const file of fs.readdirSync(LOGS).filter((f) => f.endsWith('.log'))) {
  const text = fs.readFileSync(path.join(LOGS, file), 'utf8')
  if (!text.includes('── coverage ──')) continue
  const mod = file.replace(/^f-/, '').replace('.log', '')
  const mine = findings.filter((f) => f.module === mod)
  const pagePath = path.join(PAGES, `${mod}.html`)
  const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : null

  const issues = []

  // 1. every kind in the log has a finding
  const body = text.slice(text.indexOf('SUMMARY'))
  const kindsInLog = Object.entries(KINDS).filter(([, re]) => body.split('\n').some((l) => re.test(l))).map(([k]) => k)
  const kindsWritten = new Set(mine.map((f) => f.kind).filter(Boolean))
  for (const k of kindsInLog) if (!kindsWritten.has(k)) issues.push(`log has ${k}, findings.json does not`)

  // 2. every finding reaches the page, checked by id
  if (!page) issues.push('no HTML page for this module')
  else for (const f of mine) if (!page.includes(f.id)) issues.push(`finding ${f.id} is not on the page`)

  // 3. the page's coverage matches the log's
  const logPct = text.match(/reachable \d+ · clicked \d+ · (\d+)%/)?.[1]
  const pagePct = page?.match(/clicked \d+ · (\d+)% of what the walk/)?.[1]
  if (logPct && pagePct && logPct !== pagePct) issues.push(`page says ${pagePct}%, log says ${logPct}%`)
  if (logPct && page && !pagePct) issues.push('page carries no coverage figure')

  problems += issues.length
  rows.push({ mod, findings: mine.length, kinds: kindsInLog.length, pct: logPct, issues })
}

console.log('')
for (const r of rows.sort((a, b) => b.issues.length - a.issues.length)) {
  const ok = r.issues.length === 0
  console.log(`  ${ok ? '✓' : '✗'} ${r.mod.padEnd(20)} ${String(r.findings).padStart(3)} findings · ` +
    `${String(r.kinds).padStart(2)} kinds in log · walked ${r.pct ?? '—'}%` +
    (ok ? '  — page matches' : ''))
  for (const i of r.issues) console.log(`      ✗ ${i}`)
}
console.log(`\n  ${rows.length} walked module(s) · ${problems} mismatch(es) between what was found and what the report says\n`)
process.exit(problems ? 1 : 0)
