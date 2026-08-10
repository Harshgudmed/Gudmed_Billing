// Give every finished module its own section in the report, without being asked.
//
// WHY THIS EXISTS
// Each module's write-up was being done by hand after its run finished, so the
// report was always missing whichever module had completed most recently — and the
// gap was found by the reader, not the writer, every single time. A report that
// depends on someone remembering to write it is a report that will be incomplete
// exactly when it matters.
//
// This reads e2e/audit-report/live/*.log and writes a section per module: the
// numbers, the coverage broken down by control type, the heaviest and slowest
// calls, what re-rendered, what was never clicked and why. Prose about what a
// finding MEANS still has to be written by a person — that judgement is the part
// worth a human — but nothing measured is ever missing again.
//
//   node docs/sync-modules.mjs
//
// Sections it has generated are marked, so hand-written analysis added underneath
// is never overwritten.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const LOGS = path.join(ROOT, 'e2e', 'audit-report', 'live')
const REPORT = path.join(ROOT, 'docs', 'gudmed-status.html')

const TITLE = {
  patients: 'Patients', appointments: 'Appointments', 'pre-triage': 'Pre-Triage',
  queue: 'Queue', opd: 'OPD', pharmacy: 'Pharmacy', laboratory: 'Laboratory',
  radiology: 'Radiology', 'day-care': 'Day Care', ambulance: 'Ambulance',
  insurance: 'Insurance', 'death-certificates': 'Death Certificates',
  inpatient: 'Inpatient (IPD)', billing: 'Billing',
  'doctor-accountability': 'Doctor Accountability', settings: 'Settings',
  dashboard: 'Dashboard',
}

// Controls the harness should never have counted as missed. A tel: link opens the
// phone app; an external href leaves the application entirely. Calling those
// "missed" put nine of Patients' twenty-eight uncovered controls down to a
// mislabelling rather than to anything about the app.
const NOT_OURS = /^\+?\d[\d\s-]{6,}$|^https?:|^mailto:|^tel:/

function parse(file) {
  const text = fs.readFileSync(file, 'utf8')
  if (!text.includes('── coverage ──')) return null
  const name = path.basename(file).replace(/^f-/, '').replace('.log', '')

  const cov = text.match(/found (\d+) · clicked (\d+) · skipped-write (\d+) · skipped-destructive (\d+)(?: · skipped-external (\d+))?(?: · skipped-repeat (\d+))? · unreachable (\d+) · NOT CLICKED (\d+)/)
  if (!cov) return null

  const byKind = [...text.matchAll(/^\s{4}(\w+)\s+(\d+)\/(\d+)\s+clicked(.*)$/gm)]
    .map((m) => ({ kind: m[1], clicked: +m[2], found: +m[3], rest: m[4].trim() }))

  const calls = [...text.matchAll(/^\s+([!~✗ ])\s+(\S+)\s+(\w+)\s+(\S+)\s+([\d.]+)KB\s+(\d+)ms\s*(\d+)?/gm)]
    .map((m) => ({ flag: m[1].trim(), status: m[2], method: m[3], path: m[4], kb: +m[5], ms: +m[6], rows: m[7] ? +m[7] : null }))

  const missed = (text.match(/NOT CLICKED:\n([\s\S]*?)\n\s{4}\w/) || [])[1]
  const missedRows = missed
    ? [...missed.matchAll(/^\s{6}(.{1,46}?)\s{2,}(\w+)\s+(.*)$/gm)].map((m) => ({ name: m[1].trim(), kind: m[2], why: m[3].trim() }))
    : []

  return {
    name,
    title: TITLE[name] || name,
    // Positions, not names, so they move whenever the run adds a ledger state —
    // skipped-external and skipped-repeat were both added after this was written and
    // silently shifted `unreachable` and `missed` by two. Read them off the end.
    found: +cov[1], clicked: +cov[2],
    skipped: +cov[3] + +cov[4] + (+cov[5] || 0) + (+cov[6] || 0),
    unreachable: +cov[7], missed: +cov[8],
    byKind, missedRows,
    load: text.match(/page load\s+(\d+)req\s+([\d.]+)KB\s+(\d+)ms\s+(\d+)r\s+(\S)/),
    lh: text.match(/performance\s+(\d+)\s+·\s+accessibility\s+(\d+)\s+·\s+best-practices\s+(\d+)\s+·\s+seo\s+(\d+)/),
    vitals: text.match(/LCP ([\d.]+ s) · FCP ([\d.]+ s) · TBT ([\d,]+ ms) · CLS ([\d.]+)/),
    heaviest: calls.filter((c) => c.kb > 50).sort((a, b) => b.kb - a.kb).slice(0, 5),
    slowest: calls.filter((c) => c.ms > 150).sort((a, b) => b.ms - a.ms).slice(0, 5),
    renders: [...text.matchAll(/(\w+) re-rendered (\d+)× \(([\d.]+) ms\)/g)]
      .reduce((acc, m) => { const k = m[1]; acc[k] = Math.max(acc[k] || 0, +m[2]); return acc }, {}),
    errors: (text.match(/console error/g) || []).length,
    contract: (text.match(/CONTRACT:/g) || []).length,
  }
}

const num = (v) => `<td class="num">${v}</td>`

function section(m, n) {
  const pct = Math.round((m.clicked / m.found) * 100)
  const colour = pct < 30 ? 'var(--crit)' : pct < 60 ? 'var(--warn)' : 'var(--good)'
  const mislabelled = m.missedRows.filter((r) => NOT_OURS.test(r.name))
  const out = []

  out.push(`<!-- auto:${m.name}:start -->`)
  out.push(`<h2><span class="n">Module</span>${m.title} — measured</h2>`)
  out.push(`<pre>controls found   ${m.found}`)
  out.push(`clicked          ${m.clicked}  (${pct}%)`)
  out.push(`skipped          ${m.skipped}   — write and destructive buttons, by design`)
  out.push(`unreachable      ${m.unreachable}   — the page re-rendered before the click landed`)
  out.push(`NOT CLICKED      ${m.missed}`)
  if (m.load) out.push(`\npage load        ${m.load[1]} requests · ${m.load[2]} KB · slowest ${m.load[3]} ms · ${m.load[4]} commits · ${m.load[5] === '✗' ? 'CONSOLE ERRORS' : 'no console errors'}`)
  if (m.lh) out.push(`Lighthouse       performance ${m.lh[1]} · accessibility ${m.lh[2]} · best-practices ${m.lh[3]} · seo ${m.lh[4]}`)
  if (m.vitals) out.push(`web vitals       LCP ${m.vitals[1]} · FCP ${m.vitals[2]} · TBT ${m.vitals[3]} · CLS ${m.vitals[4]}`)
  out.push(`contract issues  ${m.contract}`)
  out.push('</pre>')

  if (m.byKind.length) {
    out.push('<h3>Coverage by control type</h3>')
    out.push('<div class="scroll"><table>')
    out.push('  <tr><th>Control type</th><th class="num">clicked</th><th class="num">found</th><th>The rest</th></tr>')
    for (const k of m.byKind) {
      const p = Math.round((k.clicked / k.found) * 100)
      const c = p === 100 ? 'var(--good)' : p < 30 ? 'var(--crit)' : 'var(--warn)'
      out.push(`  <tr><td>${k.kind}</td><td class="num" style="color:${c}"><strong>${k.clicked}</strong></td>${num(k.found)}<td>${k.rest || '—'}</td></tr>`)
    }
    out.push('</table></div>')
  }

  if (m.heaviest.length || m.slowest.length) {
    out.push('<h3>The calls worth looking at</h3>')
    out.push('<div class="scroll"><table>')
    out.push('  <tr><th>Call</th><th class="num">KB</th><th class="num">ms</th><th class="num">rows</th><th>Reading</th></tr>')
    const seen = new Set()
    for (const c of [...m.heaviest, ...m.slowest]) {
      if (seen.has(c.path + c.kb)) continue
      seen.add(c.path + c.kb)
      const verdict = c.kb > 100 && c.ms < 150 ? 'large payload — narrow the select'
        : c.ms > 200 && c.kb < 20 ? 'small answer, long wait — a query problem, not a payload one'
        : c.kb > 100 ? 'large and slow'
        : 'slow for its size'
      out.push(`  <tr><td><code>${c.path}</code></td>${num(c.kb.toFixed(1))}${num(c.ms)}${num(c.rows ?? '—')}<td>${verdict}</td></tr>`)
    }
    out.push('</table></div>')
  }

  const shell = Object.entries(m.renders).filter(([k]) => /^(App|Nav|Navigation|Shell|Layout|Routes)/.test(k))
  if (shell.length) {
    out.push('<h3>What re-rendered that should not have</h3>')
    out.push('<pre>' + shell.sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, v]) => `${k.padEnd(22)} up to ${v}× in a single action`).join('\n') + '</pre>')
    out.push('<p class="note">The app shell repainting because something inside a module changed is a memoisation gap, and the same one in every module.</p>')
  }

  if (m.missedRows.length) {
    out.push('<h3>Never clicked, and why</h3>')
    out.push('<div class="scroll"><table>')
    out.push('  <tr><th>Control</th><th>Type</th><th>Reason</th></tr>')
    for (const r of m.missedRows.slice(0, 20)) {
      const ours = !NOT_OURS.test(r.name)
      out.push(`  <tr><td><code>${r.name}</code></td><td>${r.kind}</td><td${ours ? '' : ' style="color:var(--idle)"'}>${ours ? r.why : 'leaves the application — the harness should not count this'}</td></tr>`)
    }
    out.push('</table></div>')
    if (mislabelled.length) {
      out.push(`<p class="note"><strong>${mislabelled.length} of the ${m.missed} uncovered controls are phone or external links</strong> — clicking one leaves the app. They are a mislabelling in the harness, not a gap in the walk.</p>`)
    }
  }

  out.push(`<p class="tag">generated by <code>node docs/sync-modules.mjs</code> from e2e/audit-report/live/f-${m.name}.log — re-run it and this section follows</p>`)
  out.push(`<!-- auto:${m.name}:end -->`)
  return out.join('\n')
}

// ── write ────────────────────────────────────────────────────────────────────
const mods = fs.existsSync(LOGS)
  ? fs.readdirSync(LOGS).filter((f) => f.endsWith('.log')).map((f) => parse(path.join(LOGS, f))).filter(Boolean)
  : []

if (!mods.length) {
  console.log('  no finished module logs yet')
} else {
  let html = fs.readFileSync(REPORT, 'utf8')
  const anchor = '<h2><span class="n">Section'
  for (const [i, m] of mods.entries()) {
    const block = section(m, i)
    const start = `<!-- auto:${m.name}:start -->`
    const end = `<!-- auto:${m.name}:end -->`
    if (html.includes(start) && html.includes(end)) {
      html = html.slice(0, html.indexOf(start)) + block + html.slice(html.indexOf(end) + end.length)
    } else {
      // Append before the closing wrapper so ordering stays stable run to run.
      const at = html.lastIndexOf('</div>')
      html = html.slice(0, at) + '\n\n' + block + '\n\n' + html.slice(at)
    }
  }
  fs.writeFileSync(REPORT, html)
  console.log(`  ${mods.length} module section(s) written`)
  for (const m of mods) {
    console.log(`    ${m.title.padEnd(22)} ${m.clicked}/${m.found} (${Math.round(m.clicked / m.found * 100)}%)` +
      `${m.lh ? ` · LH ${m.lh[1]}/${m.lh[2]}` : ''}${m.contract ? ` · ${m.contract} contract` : ''}`)
  }
}
