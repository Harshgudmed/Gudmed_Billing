// What the run found that the report has NOT written down.
//
//   node docs/missing-check.mjs                 # every walked module
//   node docs/missing-check.mjs queue           # one module
//
// WHY THIS EXISTS
// Findings were being carried from the log to findings.json by reading the log and
// noticing things. That works for the first five and fails quietly after that: Queue
// alone produced 729 flagged events, and the ones written up were the ones that
// happened to be looked at. "Nothing is missing" cannot be a claim made by the
// person doing the copying — it has to be checked by something that reads both.
//
// So this reads the run log, groups its flags into the kinds of problem they are,
// and prints each kind with a count, an example, and whether findings.json already
// says something about that module and that kind. It never writes; it tells you what
// still needs writing.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const LOGS = path.join(ROOT, 'e2e', 'audit-report', 'live')
const only = process.argv[2]

const { findings } = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'findings.json'), 'utf8'))

// Each flag the harness emits, reduced to the KIND of problem it is. The report
// needs one finding per kind per module, not one per occurrence — 234 NavLink
// re-renders are one problem, not 234.
const KINDS = [
  { key: 'app-shell-rerender', harvest: 'SHELL', re: /(NavLink|Navigation|App) re-rendered/, what: 'the app shell repaints for things inside a module' },
  { key: 'wasted-refetch', harvest: 'REFETCH', re: /refetched with nothing changed/, what: 'a query refetched with nothing changed — a useEffect dependency' },
  { key: 'duplicate-call', harvest: 'DUPE', re: /same URL 2× in one action/, what: 'two components fetching the same thing in one action' },
  { key: 'identical-body', harvest: 'IDENTICAL', re: /identical bod/, what: 'two different URLs returning byte-identical bodies — a cache bypassed' },
  { key: 'slow-call', harvest: 'SLOW', re: /ms locally — seconds on Render/, what: 'a call slow enough to be seconds on Render' },
  { key: 'big-payload', harvest: 'BIG', re: /KB response/, what: 'a response over 100 KB' },
  { key: 'rule5-limit', harvest: 'RULE5', re: /limit=\d+ is a cap/, what: 'limit= used as a cap, not pagination (rule 5)' },
  { key: 'http-error', harvest: 'HTTPERR', re: /HTTP [45]\d\d/, what: 'a 4xx or 5xx' },
  { key: 'console-error', harvest: 'CONSOLEERR', re: /console error/, what: 'a console error' },
  { key: 'no-handler', harvest: 'NOHANDLER', re: /looks clickable but has no handler/, what: 'a cursor-pointer element with no onClick' },
  { key: 'filter-dead', harvest: 'DEADFILTER', re: /fired no request/, what: 'a filter that fired no request' },
  { key: 'filter-no-query', harvest: 'FILTERNOQUERY', re: /without putting anything in the query string/, what: 'a filter that refetched but sent no query' },
  { key: 'filters-fighting', harvest: 'FIGHTING', re: /filters are fighting each other|still claims/, what: 'filters contradicting each other, or a count that disagrees with the rows' },
  { key: 'not-debounced', harvest: 'NODEBOUNCE', re: /not debounced/, what: 'a search box firing per keystroke' },
  { key: 'no-accessible-name', harvest: 'NONAME', re: /no accessible name/, what: 'a control a screen reader cannot use' },
  { key: 'left-module', harvest: 'LEFTMODULE', re: /navigated out of the module/, what: 'a control that leaves its own module' },
  { key: 'date-no-query', harvest: 'DATENOQUERY', re: /no date= in the query string/, what: 'a date filter that sent no date' },
]

const files = fs.readdirSync(LOGS).filter((f) => f.endsWith('.log') && (!only || f.includes(only)))
let gaps = 0

for (const file of files) {
  const text = fs.readFileSync(path.join(LOGS, file), 'utf8')
  if (!text.includes('── coverage ──')) continue
  const mod = file.replace(/^f-/, '').replace('.log', '')
  const mine = findings.filter((f) => f.module === mod)
  const written = mine.map((f) => `${f.title} ${f.detail} ${f.proof}`.toLowerCase()).join(' | ')

  const body = text.slice(text.indexOf('SUMMARY'))
  const rows = []
  for (const k of KINDS) {
    const hits = body.split('\n').filter((l) => k.re.test(l))
    if (!hits.length) continue
    // A kind counts as written up if the module's findings mention its subject.
    // Match on the kind recorded ON the finding, not on words guessed out of its
    // prose. The guess produced false alarms — Laboratory's 100 KB finding existed
    // and was reported missing because its text happened not to contain the word
    // "payload". A checker that cries wolf is worse than no checker: it trains you
    // to skim its output, which is the habit it was written to break.
    const covered = mine.some((f) => f.kind === k.harvest)
    rows.push({ ...k, n: hits.length, eg: hits[0].trim().slice(0, 96), covered })
    if (!covered) gaps++
  }

  const cov = text.match(/reachable (\d+) · clicked (\d+) · (\d+)%/)
  const miss = text.match(/NOT CLICKED (\d+)/)
  console.log(`\n  ${mod.toUpperCase()}  —  ${mine.length} findings written` +
    (cov ? ` · walked ${cov[3]}%` : '') + (miss && +miss[1] ? ` · ${miss[1]} controls NOT CLICKED` : ''))
  console.log('  ' + '─'.repeat(86))
  for (const r of rows.sort((a, b) => b.n - a.n)) {
    console.log(`  ${r.covered ? '✓' : '✗ MISSING'.padEnd(9)} ${String(r.n).padStart(4)}×  ${r.what}`)
    if (!r.covered) console.log(`            e.g. ${r.eg}`)
  }
  if (!rows.length) console.log('    nothing flagged')
}

console.log(`\n  ${gaps} kind(s) of problem found by the run and not yet written into findings.json\n`)
process.exit(gaps ? 1 : 0)
