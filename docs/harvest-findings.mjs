// Turn what the run flagged into findings, without a person in the middle.
//
//   node docs/harvest-findings.mjs           # add every missing kind, all modules
//   node docs/harvest-findings.mjs queue     # one module
//
// WHY THIS EXISTS
// Findings reached the report by someone reading a log and writing down what they
// noticed. Queue alone flagged 729 events; ten were written up. Across six modules,
// missing-check.mjs found 24 kinds of problem that the run had detected and the
// report had never mentioned. That is not a reporting style, it is a leak — and it
// leaks worst on the modules with the most wrong with them, because those are the
// logs that are hardest to read to the end.
//
// So the transfer is mechanical now. Each KIND of flag becomes one finding per
// module, carrying the real count and the worst real example out of the log. Prose
// about what a finding MEANS still belongs to a person — that judgement is the part
// worth a human — but nothing measured can go unwritten.
//
// Findings already in findings.json are never overwritten: a hand-written entry with
// better reasoning wins over a generated one.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const LOGS = path.join(ROOT, 'e2e', 'audit-report', 'live')
const FILE = path.join(ROOT, 'docs', 'findings.json')
const only = process.argv[2]

const db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const have = new Set(db.findings.map((f) => f.id))

const num = (s, re) => { const m = String(s).match(re); return m ? +m[1].replace(/,/g, '') : 0 }

// One entry per kind of problem. `build` gets every matching log line for that
// module and returns the finding — so the count and the example are the run's, not
// a guess.
const KINDS = [
  {
    key: 'SHELL', re: /(NavLink|Navigation|App) re-rendered/, sev: 'medium',
    build: (hits) => {
      const worst = hits.map((l) => ({ l, n: num(l, /re-rendered (\d+)×/) })).sort((a, b) => b.n - a.n)[0]
      return {
        title: `The app shell repaints for things that happen inside the module`,
        detail: `${hits.length} actions caused <code>App</code>, <code>Navigation</code> or <code>NavLink</code> to re-render. ` +
          `The worst is <strong>${worst.n}×</strong> in a single action. The sidebar is not part of this module and has no reason ` +
          `to repaint when a table pages or a filter changes — this is one memoisation gap in <code>src/App.jsx</code>, ` +
          `and every module pays for it.`,
        proof: `measured: ${worst.l.replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
      }
    },
  },
  {
    key: 'REFETCH', re: /refetched with nothing changed/, sev: 'medium',
    build: (hits) => ({
      title: 'Queries refetch when nothing about them has changed',
      detail: `${hits.length} action${hits.length > 1 ? 's' : ''} refetched data that no user input had touched — the signature of a ` +
        `<code>useEffect</code> whose dependency array is wider than what the query actually depends on. Each one is a round trip ` +
        `the user waits for and a payload nobody asked for.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
  {
    key: 'DUPE', re: /same URL 2× in one action/, sev: 'medium',
    build: (hits) => ({
      title: 'The same URL is fetched twice in one action',
      detail: `${hits.length} action${hits.length > 1 ? 's' : ''} issued the identical request twice — two components asking for the ` +
        `same thing independently. It should be lifted into one hook and shared.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
  {
    key: 'DEADFILTER', re: /fired no request/, sev: 'low',
    build: (hits) => ({
      title: 'Some filter options fire no request at all',
      detail: `${hits.length} filter selection${hits.length > 1 ? 's' : ''} caused no network call. That is correct for a client-side ` +
        `filter and for a reset that changes nothing — but it is also exactly what an unwired filter looks like, and the two cannot ` +
        `be told apart from outside. Each needs a look at the code to decide which it is.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
  {
    key: 'SLOW', re: /ms locally — seconds on Render/, sev: 'high',
    build: (hits) => {
      const worst = hits.map((l) => ({ l, n: num(l, /(\d[\d,]*) ms locally/) })).sort((a, b) => b.n - a.n)[0]
      return {
        title: `Slow calls — the worst is ${worst.n.toLocaleString()} ms on localhost`,
        detail: `${hits.length} call${hits.length > 1 ? 's' : ''} took long enough locally to become seconds on Render, where there is ` +
          `real network latency and a cold connection. Localhost has neither, so these numbers are a floor, not the user's experience.`,
        proof: `measured: ${worst.l.replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
      }
    },
  },
  {
    key: 'BIG', re: /KB response/, sev: 'high',
    build: (hits) => {
      const worst = hits.map((l) => ({ l, n: num(l, /(\d[\d,]*) KB response/) })).sort((a, b) => b.n - a.n)[0]
      return {
        title: `Responses over 100 KB — the largest is ${worst.n.toLocaleString()} KB`,
        detail: `${hits.length} response${hits.length > 1 ? 's' : ''} crossed 100 KB. Ask what the screen actually reads: a picker that ` +
          `needs seven fields should not receive twenty-five.`,
        proof: `measured: ${worst.l.replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
      }
    },
  },
  {
    key: 'RULE5', re: /limit=\d+ is a cap/, sev: 'high',
    build: (hits) => ({
      title: 'limit= is being used as a cap, not as pagination',
      detail: `${hits.length} request${hits.length > 1 ? 's' : ''} carried a three-or-more-digit <code>limit=</code>. Rows past it vanish ` +
        `silently — the screen looks complete and is not. This is CLAUDE.md rule 5, and the reason 99.99% of patients were once ` +
        `unfindable when raising a death certificate.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
  {
    key: 'NONAME', re: /no accessible name/, sev: 'medium',
    build: (hits) => ({
      title: 'Controls with no accessible name',
      detail: `${hits.length} control${hits.length > 1 ? 's' : ''} have no text, no <code>aria-label</code>, no <code>title</code> and no ` +
        `icon class — nameable only by their position in the DOM. A screen reader cannot use them, and neither can any tool. ` +
        `In Settings, controls exactly like these turned out to be the module on/off switches.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
  {
    key: 'NOHANDLER', re: /looks clickable but has no handler/, sev: 'medium',
    build: (hits) => ({
      title: 'Elements that look clickable and do nothing',
      detail: `${hits.length} element${hits.length > 1 ? 's' : ''} carry <code>cursor-pointer</code> with no click handler. The pointer ` +
        `changes, the user clicks, nothing happens — a lie the interface tells.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
  {
    key: 'NODEBOUNCE', re: /not debounced/, sev: 'medium',
    build: (hits) => ({
      title: 'The search box fires per keystroke',
      detail: `Typing at human speed produced one request per character. <code>src/lib/useDebounce.js</code> already exists and solves this.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
  {
    key: 'FILTERNOQUERY', re: /without putting anything in the query string/, sev: 'high',
    build: (hits) => ({
      title: 'A filter refetches but sends no filter in the query',
      detail: `${hits.length} filter change${hits.length > 1 ? 's' : ''} triggered a request whose query string carried nothing about the ` +
        `filter. The list refetches and comes back unfiltered — the user sees the control move and the data not.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
  {
    key: 'CONSOLEERR', re: /console error/, sev: 'high',
    build: (hits) => ({
      title: 'The browser console logs errors during normal use',
      detail: `${hits.length} action${hits.length > 1 ? 's' : ''} put an error in the console while walking controls a user would walk. ` +
        `A console error is not cosmetic — it is JavaScript that stopped running, and whatever came after it did not happen.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
  {
    key: 'HTTPERR', re: /HTTP [45]\d\d/, sev: 'critical',
    build: (hits) => ({
      title: 'The screen returns HTTP errors during normal use',
      detail: `${hits.length} request${hits.length > 1 ? 's' : ''} failed with a 4xx or 5xx while walking controls a user would walk.`,
      proof: `measured: ${hits[0].replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 110)}`,
    }),
  },
]

let added = 0
for (const file of fs.readdirSync(LOGS).filter((f) => f.endsWith('.log') && (!only || f.includes(only)))) {
  const text = fs.readFileSync(path.join(LOGS, file), 'utf8')
  if (!text.includes('── coverage ──')) continue
  const mod = file.replace(/^f-/, '').replace('.log', '')
  const body = text.slice(text.indexOf('SUMMARY')).split('\n')

  for (const k of KINDS) {
    const hits = body.filter((l) => k.re.test(l))
    if (!hits.length) continue
    const id = `${mod.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)}-${k.key}`
    if (have.has(id)) continue
    const f = k.build(hits)
    db.findings.push({ module: mod, id, kind: k.key, severity: k.sev, ...f, generated: true })
    have.add(id)
    added++
    console.log(`  + ${mod.padEnd(22)} ${k.key.padEnd(14)} ${hits.length}× — ${f.title.slice(0, 58)}`)
  }
}

fs.writeFileSync(FILE, JSON.stringify(db, null, 2) + '\n')
console.log(`\n  ${added} finding(s) harvested · findings.json now holds ${db.findings.length}`)
