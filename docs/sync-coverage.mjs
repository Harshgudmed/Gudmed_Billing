// Rewrite the coverage table in the report straight from the audit logs.
//
// WHY THIS EXISTS
// The table was being updated by hand after each module finished, so it was always
// a module or two behind whatever had actually run — and every time someone asked
// "is it in the report yet?", the honest answer was "not the last one". A number
// that has to be copied by hand is a number that will be stale.
//
// This reads e2e/audit-report/live/*.log and rewrites the table between the two
// markers below. Run it as often as you like; run it when the audit finishes; it
// cannot drift, because it never holds its own copy of anything.
//
//   node docs/sync-coverage.mjs
//   node docs/sync-coverage.mjs --watch     # every 30s while an audit runs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const LOGS = path.join(ROOT, 'e2e', 'audit-report', 'live')
const REPORT = path.join(ROOT, 'docs', 'gudmed-status.html')

const START = '<!-- coverage:start -->'
const END = '<!-- coverage:end -->'

function read() {
  if (!fs.existsSync(LOGS)) return []
  return fs.readdirSync(LOGS).filter((f) => f.endsWith('.log')).map((f) => {
    const text = fs.readFileSync(path.join(LOGS, f), 'utf8')
    const name = f.replace(/^f-/, '').replace('.log', '')
    const cov = text.match(/found (\d+) · clicked (\d+) · skipped-write (\d+) · skipped-destructive (\d+)(?: · skipped-external (\d+))?(?: · skipped-repeat (\d+))? · unreachable (\d+) · NOT CLICKED (\d+)/)
    const lh = text.match(/performance\s+(\d+)\s+·\s+accessibility\s+(\d+)\s+·\s+best-practices\s+(\d+)\s+·\s+seo\s+(\d+)/)
    const tbt = text.match(/TBT ([\d,]+) ms/)
    const load = text.match(/page load\s+(\d+)req\s+([\d.]+)KB\s+(\d+)ms/)
    const worst = [...text.matchAll(/^\s+[!~]\s+\d+\s+\w+\s+(\S+)\s+([\d.]+)KB\s+(\d+)ms/gm)]
      .sort((a, b) => Number(b[2]) - Number(a[2]))[0]
    // The controls it never clicked, by name — the part a single ratio hides.
    const missed = text.match(/NOT CLICKED: (.+)/)?.[1]?.split(' · ').slice(0, 6) ?? []
    return { name, done: text.includes('── coverage ──'), cov, lh, tbt, load, worst, missed }
  }).filter((m) => m.cov).sort((a, b) => a.name.localeCompare(b.name))
}

function table(mods) {
  const cell = (v) => `<td class="num">${v}</td>`
  const rows = mods.map((m) => {
    const [found, clicked, sw, sd, unreach, missed] = m.cov.slice(1).map(Number)
    const pct = Math.round((clicked / found) * 100)
    const colour = pct < 30 ? 'var(--crit)' : pct < 60 ? 'var(--warn)' : 'var(--good)'
    return `  <tr><td><strong>${m.name}</strong></td>${cell(found)}` +
      `<td class="num" style="color:${colour}"><strong>${clicked}</strong> <span class="tag">${pct}%</span></td>` +
      cell(sw + sd) + cell(unreach) +
      `<td class="num" style="color:var(--crit)">${missed}</td>` +
      cell(m.lh ? m.lh[1] : '—') + cell(m.lh ? m.lh[2] : '—') +
      cell(m.tbt ? `${m.tbt[1]} ms` : '—') +
      cell(m.load ? `${m.load[2]} KB` : '—') +
      cell(m.worst ? `${m.worst[3]} ms` : '—') + '</tr>'
  })

  const totals = mods.reduce((a, m) => {
    const [f, c] = m.cov.slice(1).map(Number)
    return { found: a.found + f, clicked: a.clicked + c }
  }, { found: 0, clicked: 0 })

  const notes = mods.filter((m) => m.missed.length).map((m) =>
    `  <p class="note"><strong>${m.name}</strong> did not click: ${m.missed.map((x) => x.trim()).join(' · ')}${m.missed.length >= 6 ? ' …' : ''}</p>`)

  return [
    START,
    `<p class="lede">Regenerated straight from <code>e2e/audit-report/live/*.log</code> by`,
    `<code>node docs/sync-coverage.mjs</code> — nothing here is copied by hand, so it cannot be`,
    `a module behind. Last written ${new Date().toLocaleString('en-GB')}.</p>`,
    '<div class="scroll"><table>',
    '  <tr><th>Module</th><th class="num">controls</th><th class="num">clicked</th><th class="num">skipped</th>' +
    '<th class="num">unreachable</th><th class="num">MISSED</th><th class="num">perf</th><th class="num">a11y</th>' +
    '<th class="num">TBT</th><th class="num">page load</th><th class="num">slowest call</th></tr>',
    ...rows,
    `  <tr><td><strong>total</strong></td><td class="num"><strong>${totals.found}</strong></td>` +
    `<td class="num"><strong>${totals.clicked}</strong> <span class="tag">${Math.round(totals.clicked / totals.found * 100)}%</span></td>` +
    '<td class="num" colspan="9"></td></tr>',
    '</table></div>',
    `<p class="note">${mods.length} of 17 modules re-measured. <strong>Not one reaches full coverage.</strong>`,
    `The gap is write buttons — skipped by design because no fixture exists for them — and controls the`,
    `harness loses hold of when the page re-renders underneath it. Both are named rather than rounded away.</p>`,
    ...notes,
    END,
  ].join('\n')
}


// ── each module's numbers, inside that module's own section ──────────────────
// A single shared table is convenient to scan and wrong to work from: someone
// opening pharmacy.html should see Pharmacy's coverage there, not be sent to a
// combined page to find their row. So the same data is also written into each
// module's own section, between markers named after the module.
const SECTION_FOR = {
  appointments: 'Appointments —', pharmacy: 'Pharmacy —', queue: 'Queue —',
  settings: 'Settings —', billing: 'Billing —', radiology: 'Radiology —',
  'doctor-accountability': 'Doctor Accountability —',
}

function perModule(html, mods) {
  for (const m of mods) {
    const heading = SECTION_FOR[m.name]
    if (!heading) continue
    const start = `<!-- cov:${m.name}:start -->`
    const end = `<!-- cov:${m.name}:end -->`
    const [found, clicked, sw, sd, unreach, missed] = m.cov.slice(1).map(Number)
    const pct = Math.round((clicked / found) * 100)

    const lines = [
      `controls found     ${found}`,
      `clicked            ${clicked}  (${pct}%)`,
      `skipped on purpose ${sw + sd}   — write and destructive buttons`,
      `unreachable        ${unreach}   — the page re-rendered before the click landed`,
      `NOT CLICKED        ${missed}`,
    ]
    if (m.load) lines.push('', `page load          ${m.load[1]} requests · ${m.load[2]} KB · ${m.load[3]} ms`)
    if (m.worst) lines.push(`slowest call       ${m.worst[3]} ms · ${m.worst[2]} KB · ${m.worst[1]}`)
    if (m.lh) lines.push(`Lighthouse         performance ${m.lh[1]} · accessibility ${m.lh[2]} · best-practices ${m.lh[3]}`)
    if (m.tbt) lines.push(`TBT                ${m.tbt[1]} ms`)

    const block = [
      start,
      '<h3>Measured coverage</h3>',
      '<pre>' + lines.join('\n') + '</pre>',
      m.missed.length
        ? `<p class="note"><strong>Never clicked:</strong> ${m.missed.map((x) => x.trim()).join(' · ')}${m.missed.length >= 6 ? ' …' : ''}</p>`
        : '',
      `<p class="note">Re-measured ${new Date().toLocaleString('en-GB')} with every module enabled, by <code>node docs/sync-coverage.mjs</code>.</p>`,
      end,
    ].join('\n')

    if (html.includes(start) && html.includes(end)) {
      html = html.slice(0, html.indexOf(start)) + block + html.slice(html.indexOf(end) + end.length)
    } else {
      const i = html.indexOf(heading)
      if (i < 0) continue
      const close = html.indexOf('</h2>', i) + 5
      html = html.slice(0, close) + '\n\n' + block + '\n' + html.slice(close)
    }
  }
  return html
}

function sync() {
  const mods = read()
  if (!mods.length) return console.log('  no finished audits yet')
  let html = fs.readFileSync(REPORT, 'utf8')
  const block = table(mods)

  if (html.includes(START) && html.includes(END)) {
    html = html.slice(0, html.indexOf(START)) + block + html.slice(html.indexOf(END) + END.length)
  } else {
    // First run: put it just above the identical-numbers explanation.
    const anchor = '<h3>Three modules produced identical numbers'
    const i = html.indexOf(anchor)
    if (i < 0) return console.log('  anchor not found — report structure changed')
    html = html.slice(0, i) + block + '\n\n' + html.slice(i)
  }
  html = perModule(html, mods)
  fs.writeFileSync(REPORT, html)
  console.log(`  coverage table rewritten — ${mods.length} module(s)`)
  for (const m of mods) {
    const [f, c] = m.cov.slice(1).map(Number)
    console.log(`    ${m.name.padEnd(22)} ${String(c).padStart(4)}/${String(f).padEnd(5)} ${Math.round(c / f * 100)}%`)
  }
}

sync()
if (process.argv.includes('--watch')) setInterval(sync, 30000)
