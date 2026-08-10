// One page per module, generated from docs/findings.json.
//
//   node docs/build-module-pages.mjs
//
// WHY THIS EXISTS
// The findings were written into whichever page happened to be open at the time.
// Patients and Laboratory ended up sharing one page; a later "every problem in one
// list" page mixed six modules together; Radiology's findings existed twice, in
// radiology.html and in other.html. Asked for the report module by module, the
// honest answer was that it was not, and could not be made so by editing — the same
// drift would return the next time something was found.
//
// So a finding now declares the ONE module it belongs to and the pages are built.
// A finding cannot land on two pages, and it cannot be forgotten on none.
//
// It reads findings.json and writes docs/modules/<module>.html. Pages it did not
// generate are left alone.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'docs', 'modules')
const { findings } = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'findings.json'), 'utf8'))

const TITLE = {
  patients: 'Patients', appointments: 'Appointments', 'pre-triage': 'Pre-Triage',
  queue: 'Queue', opd: 'OPD', pharmacy: 'Pharmacy', laboratory: 'Laboratory',
  radiology: 'Radiology', 'day-care': 'Day Care', ambulance: 'Ambulance',
  insurance: 'Insurance', 'death-certificates': 'Death Certificates',
  inpatient: 'Inpatient (IPD)', billing: 'Billing',
  'doctor-accountability': 'Doctor Accountability', settings: 'Settings',
  dashboard: 'Dashboard',
}
const RANK = { critical: 0, high: 1, medium: 2, low: 3 }
const CLASS = { critical: 'crit', high: 'crit', medium: 'warn', low: 'good' }

// The shared shell, in its own file. It used to be lifted out of whichever page was
// handy — and when that page was deleted as a duplicate, the generator died with
// ENOENT. A build step must not depend on a content page continuing to exist.
// Copying the CSS into each output keeps every page openable straight from disk,
// with no server and no relative stylesheet to break.
const SHELL = fs.readFileSync(path.join(OUT, '_shell.html'), 'utf8')

// ── the coverage numbers, if the module has been walked ──────────────────────
const LOGS = path.join(ROOT, 'e2e', 'audit-report', 'live')
function measured(mod) {
  const f = path.join(LOGS, `f-${mod}.log`)
  if (!fs.existsSync(f)) return null
  const t = fs.readFileSync(f, 'utf8')
  const reach = t.match(/reachable (\d+) · clicked (\d+) · (\d+)%/)
  if (!reach) return null
  return {
    reachable: +reach[1], clicked: +reach[2], pct: +reach[3],
    lh: t.match(/performance\s+(\d+)\s+·\s+accessibility\s+(\d+)/),
    load: t.match(/page load\s+(\d+)req\s+([\d.]+)KB\s+(\d+)ms/),
    notClicked: +(t.match(/NOT CLICKED (\d+)/)?.[1] ?? 0),
  }
}

function page(mod, list) {
  const open = list.filter((f) => !f.fixed && !f.ok)
  const fixed = list.filter((f) => f.fixed)
  const ok = list.filter((f) => f.ok)
  const m = measured(mod)
  const o = [SHELL.replace(/<title>[^<]*<\/title>/, `<title>GudMed — ${TITLE[mod] || mod}</title>`)]

  o.push('<div class="wrap">')
  o.push('<p class="meta" style="padding-top:2rem"><a href="index.html" style="color:inherit">← all modules</a></p>')
  o.push('<header class="top">')
  o.push(`  <h1>${TITLE[mod] || mod}</h1>`)
  o.push(`  <p class="sub">${open.length} open · ${fixed.length} fixed · ${ok.length} checked and correct.` +
    ` Every row says how it was proved.</p>`)
  o.push(`  <p class="meta">generated from docs/findings.json — this module's findings only</p>`)
  o.push('</header>')

  if (m) {
    o.push('<h2><span class="n">Measured</span>What the walk reached</h2>')
    o.push(`<pre>reachable ${m.reachable} · clicked ${m.clicked} · ${m.pct}% of what the walk was allowed to press`)
    if (m.notClicked) o.push(`NOT CLICKED ${m.notClicked}`)
    if (m.load) o.push(`page load  ${m.load[1]} requests · ${m.load[2]} KB · slowest ${m.load[3]} ms`)
    if (m.lh) o.push(`Lighthouse performance ${m.lh[1]} · accessibility ${m.lh[2]} (localhost — optimistic)`)
    o.push('</pre>')
  } else {
    o.push('<p class="note"><strong>Not yet walked in the current run.</strong> The findings below come from ' +
      'the controller, the schema or the API log — none of them needs a browser.</p>')
  }

  const section = (title, rows, note) => {
    if (!rows.length) return
    o.push(`<h2><span class="n">${title}</span>${rows.length} item${rows.length > 1 ? 's' : ''}</h2>`)
    if (note) o.push(`<p class="lede">${note}</p>`)
    for (const f of rows.sort((a, b) => RANK[a.severity] - RANK[b.severity])) {
      o.push(`<div class="item ${f.ok || f.fixed ? 'good' : CLASS[f.severity]}">`)
      o.push(`  <h4>${f.title} <span class="chip ${f.fixed || f.ok ? 'fixed' : 'open'}">${f.id} · ${f.fixed ? 'fixed' : f.ok ? 'correct' : f.severity}</span></h4>`)
      o.push(`  <p>${f.detail}</p>`)
      if (f.rule) o.push(`  <p class="note">${f.rule}</p>`)
      if (f.retraction) o.push(`  <p><strong>Correction to an earlier claim in this report:</strong> ${f.retraction}</p>`)
      o.push(`  <p class="tag">${f.proof}</p>`)
      o.push('</div>')
    }
  }

  section('Open', open)
  section('Fixed', fixed, 'Verified after the change, not just edited.')
  section('Checked and correct', ok,
    'A report that only lists failures cannot be told apart from one that only looked for them.')

  o.push('<p class="meta" style="margin-top:4rem"><a href="index.html" style="color:inherit">← all modules</a></p>')
  o.push('</div>')
  return o.join('\n')
}

// ── write ────────────────────────────────────────────────────────────────────
const byModule = {}
for (const f of findings) (byModule[f.module] ??= []).push(f)

for (const [mod, list] of Object.entries(byModule)) {
  fs.writeFileSync(path.join(OUT, `${mod}.html`), page(mod, list))
  const open = list.filter((f) => !f.fixed && !f.ok).length
  const m = measured(mod)
  console.log(`  ${(TITLE[mod] || mod).padEnd(24)} ${String(list.length).padStart(2)} findings · ${open} open` +
    (m ? ` · walked ${m.pct}%` : ' · not walked yet'))
}
// ── the index, generated too ─────────────────────────────────────────────────
// Written by hand it drifted: it linked a page holding two modules, a page holding
// six, and a page whose findings also lived somewhere else. Generated, it can only
// list what exists.
const ALL = Object.entries(byModule).map(([mod, list]) => {
  const open = list.filter((f) => !f.fixed && !f.ok)
  const crit = open.filter((f) => f.severity === 'critical').length
  return { mod, list, open: open.length, crit, m: measured(mod) }
}).sort((a, b) => b.crit - a.crit || b.open - a.open)

const totals = {
  findings: findings.length,
  open: ALL.reduce((n, x) => n + x.open, 0),
  crit: ALL.reduce((n, x) => n + x.crit, 0),
  fixed: findings.filter((f) => f.fixed).length,
  walked: ALL.filter((x) => x.m).length,
}

const idx = [SHELL.replace(/<title>[^<]*<\/title>/, '<title>GudMed — findings by module</title>')]
idx.push('<div class="wrap">')
idx.push('<header class="top">')
idx.push('  <h1>GudMed HMS — findings, module by module</h1>')
idx.push('  <p class="sub">One page per module. A finding belongs to exactly one of them, so nothing is ' +
  'listed twice and nothing falls between two pages.</p>')
idx.push(`  <p class="meta" style="color:var(--crit)">${totals.open} open · ${totals.crit} critical · ` +
  `${totals.fixed} fixed · ${totals.walked} of 17 modules walked in the current run</p>`)
idx.push('</header>')
idx.push('<div class="scores">')
idx.push(`  <div class="score crit"><b>${totals.crit}</b><span>critical</span></div>`)
idx.push(`  <div class="score warn"><b>${totals.open}</b><span>open</span></div>`)
idx.push(`  <div class="score good"><b>${totals.fixed}</b><span>fixed &amp; verified</span></div>`)
idx.push(`  <div class="score idle"><b>${totals.findings}</b><span>recorded</span></div>`)
idx.push('</div>')
idx.push('<p class="lede"><strong>None of it is live.</strong> The fixes marked verified are verified on ' +
  'one laptop.</p>')

for (const x of ALL) {
  const cls = x.crit ? 'crit' : x.open ? 'warn' : 'good'
  const walked = x.m ? ` · walked ${x.m.pct}%` : ' · not walked yet'
  idx.push(`  <a class="item ${cls}" href="${x.mod}.html" style="display:block;text-decoration:none;color:inherit">`)
  idx.push(`    <h4>${TITLE[x.mod] || x.mod}</h4>`)
  idx.push(`    <p><strong>${x.open} open</strong>${x.crit ? ` · ${x.crit} critical` : ''}` +
    `${x.list.length - x.open ? ` · ${x.list.length - x.open} fixed or correct` : ''}${walked}</p>`)
  idx.push('  </a>')
}

const NOT_LISTED = Object.keys(TITLE).filter((k) => !byModule[k])
if (NOT_LISTED.length) {
  idx.push('<h2><span class="n">No findings recorded</span>' + NOT_LISTED.length + ' modules</h2>')
  idx.push('<p>' + NOT_LISTED.map((k) => TITLE[k]).join(' · ') + '</p>')
  idx.push('<p class="note">Not a clean bill of health — nothing has been written down for them yet.</p>')
}

idx.push('<h2><span class="n">Cross-module</span>Pages that are not about one module</h2>')
idx.push('<p><a href="today.html" style="color:inherit">9 August — what the day found, and the nine mistakes this work made</a><br>' +
  '<a href="coverage.html" style="color:inherit">Coverage by control type</a><br>' +
  '<a href="performance.html" style="color:inherit">Performance</a><br>' +
  '<a href="the-tool.html" style="color:inherit">The audit tool</a></p>')
idx.push('<p class="tag">generated by <code>node docs/build-module-pages.mjs</code> from docs/findings.json</p>')
idx.push('</div>')
fs.writeFileSync(path.join(OUT, 'index.html'), idx.join('\n'))

console.log(`\n  ${Object.keys(byModule).length} module page(s) + index written from ${findings.length} findings`)
console.log(`  ${totals.crit} critical · ${totals.open} open · ${totals.fixed} fixed`)
