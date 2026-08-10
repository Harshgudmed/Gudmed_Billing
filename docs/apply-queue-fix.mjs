// Fold the 10 August Queue performance work into findings.json.
//
//   node docs/apply-queue-fix.mjs && node docs/build-module-pages.mjs
//
// WHY THIS EXISTS
// Two things happened in the same session and both belong in the report:
//
//   1. Three findings were fixed, with before/after numbers.
//   2. A whole CLASS of finding turned out to be an artefact of the measuring tool.
//      e2e/profiler.mjs counted every fiber carrying a non-zero actualDuration, and
//      React leaves that value on a fiber after its last render — so components that
//      bailed out were counted again on every commit. That inflated the render
//      counts in EVERY module and produced the application's worst single number,
//      "1,009 elements for 6.7 seconds", which does not exist.
//
// The retractions matter more than the fixes. A report that quietly drops its wrong
// rows is indistinguishable from one that was never wrong, and the reader has no way
// to tell which they are holding. So the rows stay, struck through, with the reason.
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = new URL('./findings.json', import.meta.url)
const doc = JSON.parse(readFileSync(PATH, 'utf8'))

const PROFILER_NOTE =
  '<br><br><strong>Retracted 10 August — measuring error.</strong> This count came from ' +
  '<code>e2e/profiler.mjs</code>, which counted every fiber whose <code>actualDuration</code> was ' +
  'above zero. React leaves that value on a fiber after its last render, so a component that ' +
  'bailed out of a commit still carried the cost of whenever it did render, and the walk counted ' +
  'it again on every commit. The tool now compares <code>actualStartTime</code> against the end of ' +
  'the previous commit and reports self time with children subtracted. Re-measured on Queue — the ' +
  'module with the largest number here — three keystrokes produce <strong>App ×16 and Navigation ×16</strong>, ' +
  'and no NavLink renders at all: the memoisation in <code>src/App.jsx</code> (commit 15c804d) is working. ' +
  'The shell does still re-render once per commit, which is worth its own look, but it is not the ' +
  'hundreds this row claimed.'

let retracted = 0

// Every "app shell repaints ×N" row across all 17 modules came from the same walk.
for (const f of doc.findings) {
  if (!/The app shell repaints for things that happen inside/i.test(f.title || '')) continue
  if (f.retraction) continue
  f.retraction = 'profiler counted fibers that did not re-render'
  f.severity = 'low'
  f.detail = (f.detail || '') + PROFILER_NOTE
  f.title = `PARTLY WITHDRAWN — ${f.title}`
  retracted++
}

const worst = doc.findings.find((f) => /1,009 elements for 6.7 seconds/.test(f.title || ''))
if (worst && !worst.retraction) {
  worst.retraction = 'the number was the measuring tool, not the application'
  worst.severity = 'low'
  worst.ok = true
  worst.title = 'WITHDRAWN — "one action re-renders 1,009 elements for 6.7 seconds"'
  worst.detail =
    'This was reported as the worst single render in the application. It was the worst single ' +
    'measurement error instead.' + PROFILER_NOTE +
    '<br><br>Re-measured on the same action — typing three characters into the queue search — the ' +
    'heaviest component was <code>SelectItem</code> at <strong>44&nbsp;ms of self time</strong>, not 6,742. ' +
    'The real defect underneath it was genuine and is recorded as QUEUE-ROWMEMO below: every row ' +
    'rebuilt its five-option priority <code>&lt;Select&gt;</code> on each keystroke.'
  worst.proof = 'retracted 10 August after fixing e2e/profiler.mjs; re-measured worst self time 44 ms'
  retracted++
}

const NEW = [
  {
    module: 'queue',
    id: 'QUEUE-LAZY',
    severity: 'high',
    fixed: true,
    kind: 'bundle',
    rule: 10,
    title: 'FIXED — Queue downloaded Billing and Appointments for a receptionist who opened neither',
    detail:
      '<code>QueueModule.jsx</code> imported <code>BillingModule</code> and <code>AppointmentsModule</code> ' +
      'statically to render them in two of its tabs. Radix unmounts an inactive <code>TabsContent</code>, so ' +
      'neither ever mounted — the bytes were downloaded and parsed for nothing, on the one screen a ' +
      'hospital leaves open all day.<br><br>' +
      'Both are now behind <code>lazy()</code> with a named <code>&lt;Suspense&gt;</code> fallback, so the tab ' +
      'says "Loading Billing…" rather than nothing while the chunk arrives.',
    proof:
      'measured 10 August, e2e/measure-routes.mjs — Queue route JS 2,080 KB → 184 KB (91% less), ' +
      '126 → 80 files; Billing 833 KB → 0, Appointments 690 KB → 0. Verified in a browser by ' +
      'e2e/smoke-lazy.mjs: both tabs still load and render.',
  },
  {
    module: 'queue',
    id: 'QUEUE-ROWMEMO',
    severity: 'medium',
    fixed: true,
    kind: 'render',
    title: 'FIXED — every queue row rebuilt a five-option Select on each keystroke',
    detail:
      'Each <code>QueueRow</code> carries its own priority <code>&lt;Select&gt;</code>. The row was not memoised ' +
      'and the module\'s three row handlers were rebuilt on every render, so typing one character into ' +
      'the queue search — which the rows do not read — re-rendered all ten rows and all fifty options.<br><br>' +
      '<code>QueueRow</code> is now <code>memo</code>\'d and <code>callNext</code>, <code>setStatus</code> and ' +
      '<code>changePriority</code> are <code>useCallback</code>\'d. The second half is what makes the first half ' +
      'work: <code>memo</code> compares props by reference, so a handler rebuilt each render would have ' +
      'defeated it silently while looking like it had been fixed.',
    proof:
      'measured 10 August — typing "ram": SelectItem renders 722 → 356 (51% fewer), ' +
      'QueueRow renders 97 → 47 (52% fewer)',
  },
  {
    module: 'laboratory',
    id: 'LAB-XLSX',
    severity: 'high',
    fixed: true,
    kind: 'bundle',
    rule: 10,
    title: 'FIXED — the 429 KB spreadsheet parser loaded for everyone who opened Laboratory',
    detail:
      '<code>BulkImportDialog</code> pulls in <code>xlsx</code>, the heaviest dependency in the application, ' +
      'and it exists so an administrator can occasionally import a catalogue. It was imported statically ' +
      'by both Laboratory and Radiology, so every visitor paid for it on page load.<br><br>' +
      'It is now <code>lazy()</code> <em>and gated on <code>showImport</code></em>. The gate is the part that ' +
      'matters: a lazy component fetches its chunk the moment it renders, and this dialog was rendered ' +
      'on every page with <code>open={false}</code> — so <code>lazy()</code> alone would have changed nothing ' +
      'while appearing to fix it.',
    proof:
      'measured 10 August — Laboratory route JS 1,519 KB → 1,203 KB, of which xlsx 850 KB → 0 KB. ' +
      'Verified the dialog still opens with its content in both modules (e2e/smoke-lazy.mjs).',
  },
  {
    module: 'settings',
    id: 'SET-BOARDS',
    severity: 'medium',
    fixed: true,
    kind: 'bundle',
    rule: 10,
    title: 'FIXED — the display-board manager loaded for anyone opening Settings',
    detail:
      '<code>DisplayBoardsModule</code> is a module in its own right sitting in one Settings tab, and it ' +
      'was imported statically — so it was downloaded by everyone who opened Settings to change a phone ' +
      'number. Now <code>lazy()</code> behind a <code>&lt;Suspense&gt;</code>.',
    proof:
      'measured 10 August — Settings route JS 807 KB → 495 KB (39% less); ' +
      'DisplayBoardsModule is now its own 24.02 KB chunk. Tab verified to still load.',
  },
  {
    module: 'queue',
    id: 'QUEUE-TOOLFIX',
    severity: 'low',
    ok: true,
    kind: 'tooling',
    title: 'The profiler was counting components that had not re-rendered',
    detail:
      'Recorded as a finding against the tooling, because it is the reason a number in this report ' +
      'was wrong and every render count in it was inflated. <code>e2e/profiler.mjs</code> counted any ' +
      'fiber with <code>actualDuration &gt; 0</code>; React leaves that value in place after a render, so ' +
      'untouched components were counted on every commit. It now filters on <code>actualStartTime</code> ' +
      'against the previous commit and reports <code>selfMs</code> with children subtracted — without ' +
      'that second part a router wrapping a slow module is reported as the slow thing.',
    proof:
      'e2e/profiler.mjs, 10 August. Same action before and after the tool fix: ' +
      'NavLink ×306 → 0, worst self time 6,742 ms → 44 ms.',
  },
]

for (const f of NEW) {
  const at = doc.findings.findIndex((x) => x.id === f.id)
  if (at >= 0) doc.findings[at] = f
  else doc.findings.push(f)
}

writeFileSync(PATH, JSON.stringify(doc, null, 2) + '\n')
console.log(`  findings.json: ${doc.findings.length}`)
console.log(`  retracted as measuring error: ${retracted}`)
for (const f of NEW) console.log(`  ${f.id.padEnd(15)} ${f.fixed ? 'FIXED' : 'NOTED'}  ${f.title.slice(0, 62)}`)
