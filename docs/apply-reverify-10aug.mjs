// Re-verification of every number on the performance page, 10 August.
//
//   node docs/apply-reverify-10aug.mjs && node docs/build-module-pages.mjs
//
// WHY THIS EXISTS
// The owner asked, fairly, why the report was giving him false values. It was, in
// two distinct ways, and both are recorded here rather than quietly corrected:
//
//   the render counts were wrong          the profiler counted fibers that had not
//                                         re-rendered (fixed in f2a7d7e)
//   the API timings were taken cold       a first hit against a cold connection
//                                         pool was written down as the steady state
//
// The second is the subtler failure and the one worth remembering. 2,396 ms was
// really observed — it just was not what the endpoint costs. Re-run three times,
// the same query is 78 / 163 / 3,501 ms: the median is 163 and the outlier is a
// cold connection, so a single sample could honestly report either. Every timing
// in this report from now on is a median of three, with the spread printed beside
// it, because one sample of a bimodal thing is not a measurement.
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = new URL('./findings.json', import.meta.url)
const doc = JSON.parse(readFileSync(PATH, 'utf8'))

const NEW = [
  {
    module: 'queue',
    id: 'PERF-REVERIFY',
    severity: 'high',
    ok: true,
    kind: 'tooling',
    title: 'Re-verified — 9 numbers from the performance page, re-taken from scratch',
    detail:
      'Every figure on <code>docs/modules/performance.html</code> was re-measured against the running ' +
      'app on 10 August (<code>e2e/reverify-performance.mjs</code>). Four improved, three were artefacts ' +
      'of the profiler bug, and two could not be reached and are recorded as unmeasured rather than ' +
      'as passing.<br><br>' +
      '<strong>API timings — all four far lower than the page claims</strong><br>' +
      '<code>/pharmacy/stats</code> 1,204 ms → <strong>226 ms</strong> (runs 211/226/228)<br>' +
      'Queue, a month-wide range 2,396 ms → <strong>163 ms</strong> (runs 78/163/<strong>3,501</strong>)<br>' +
      '<code>/pharmacy/drugs</code> 435 ms → <strong>58 ms</strong> (runs 57/58/60)<br>' +
      'Doctor Slots payload 1,064 KB → <strong>552 KB</strong>, 1,128 rows (a real fix, commit f0751ee)<br><br>' +
      '<strong>Why they were high:</strong> taken as single samples against a cold connection pool. The ' +
      'Queue spread above is the proof — the same query in the same minute returned in 78 ms and in ' +
      '3,501 ms. The original number was observed; it was not the steady state, and the page presented ' +
      'it as one. Timings here are now medians of three with the spread shown.<br><br>' +
      '<strong>Render counts — three were the measuring tool</strong><br>' +
      'Queue, <code>Primitive.div</code> on a filter change: 808× → <strong>196×</strong>, 5.9 ms self<br>' +
      'Queue, <code>Primitive.div</code> while typing: 517× → <strong>341×</strong>, 8 ms self<br>' +
      'Pharmacy, <code>Primitive.div</code>: 2,254 ms → <strong>6.5 ms</strong> (worst is now ' +
      '<code>PharmacyModule</code> at 100 ms, which is a real and separate thing to look at)<br><br>' +
      '<strong>Not measured — stated as such, not as clean</strong><br>' +
      'Appointments\' two numbers (NavLink ×99, module 1,209 ms) could not be re-taken: the search box ' +
      'was not on any tab the run opened, so nothing was typed. Zero renders from a control nobody ' +
      'touched is a broken test, and reading it as a pass is the exact error this entry exists to correct.',
    proof:
      'e2e/reverify-performance.mjs, 10 August — 4 improved, 3 artefacts, 2 not measured. ' +
      'Each API figure is the median of three runs with the full spread recorded.',
  },
  {
    module: 'pharmacy',
    id: 'PHARM-XLSX',
    severity: 'medium',
    fixed: true,
    kind: 'bundle',
    rule: 10,
    title: 'FIXED — Pharmacy loaded the spreadsheet parser for every shift',
    detail:
      '<code>ImportMedicinesDialog</code> pulls in SheetJS and was imported statically, so every ' +
      'pharmacist paid for it on page load to run an import that happens when a new price list ' +
      'arrives. Now <code>lazy()</code> and gated on <code>showImport</code>, matching Laboratory and ' +
      'Radiology.<br><br>' +
      'Found by <code>scripts/lazy-scan.mjs</code>, which reads the source and reports every candidate ' +
      'rather than however far somebody got by hand. After its own false positives were removed — ' +
      'seventeen <code>src/pages/*Page.jsx</code> files importing their own module, all already behind ' +
      '<code>lazy()</code> in App.jsx, and one library already inside a lazy component — this was the ' +
      'only real candidate left in the application.',
    proof:
      'measured 10 August — Pharmacy page load carries 0 KB of xlsx; ImportMedicinesDialog is its own ' +
      '6.97 KB chunk; clicking Import still opens the dialog with no console error',
  },
]

for (const f of NEW) {
  const at = doc.findings.findIndex((x) => x.id === f.id)
  if (at >= 0) doc.findings[at] = f
  else doc.findings.push(f)
}

// Point the four superseded rows at the re-verification instead of leaving them
// reading as current. They are not withdrawn — they were really observed — but a
// reader arriving at "2,396 ms" needs the next sentence, not a later page.
const SUPERSEDED = [
  [/A month date-range takes 3.8 seconds/i, 'Queue, month range: re-measured as a median of 163 ms (runs 78/163/3,501). The original was a single cold-pool sample.'],
  [/pharmacy\/stats/i, 'Re-measured 226 ms (runs 211/226/228).'],
  [/Doctor Accountability|doctor-accountability/i, 'Payload re-measured at 552 KB / 1,128 rows.'],
]
let linked = 0
for (const f of doc.findings) {
  if (f.id === 'PERF-REVERIFY') continue
  for (const [re, note] of SUPERSEDED) {
    if (!re.test(f.title || '')) continue
    if (/Re-measured|re-measured as a median/.test(f.detail || '')) continue
    f.detail = (f.detail || '') + `<br><br><strong>Re-verified 10 August.</strong> ${note} See PERF-REVERIFY.`
    linked++
    break
  }
}

writeFileSync(PATH, JSON.stringify(doc, null, 2) + '\n')
console.log(`  findings.json: ${doc.findings.length}`)
console.log(`  superseded rows linked to the re-verification: ${linked}`)
for (const f of NEW) console.log(`  ${f.id.padEnd(15)} ${f.title.slice(0, 60)}`)
