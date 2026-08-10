// Split the single status page into one page per module.
//
// WHY
// gudmed-status.html grew to 120 KB and fifteen sections. That is fine to read
// straight through once and painful to work from: fixing Pharmacy means scrolling
// past Appointments, and two people cannot take two modules without colliding.
//
// The split is mechanical — every section is lifted verbatim out of the source
// file, so nothing is re-typed and nothing can drift between the two. The shared
// <style> block is reused by every page, and an index links them together with the
// counts pulled from the sections themselves.
//
//   node docs/split-report.mjs
//
// Re-run it after editing gudmed-status.html and the per-module pages follow.
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.join(import.meta.dirname, 'gudmed-status.html')
const OUT = path.join(import.meta.dirname, 'modules')
const html = fs.readFileSync(SRC, 'utf8')

// Everything from <style> to </style>, reused verbatim so the pages cannot
// diverge in appearance.
const style = html.match(/<style>[\s\S]*?<\/style>/)[0]

// Split on the section headings, keeping each heading with its body.
const parts = html.split(/(?=<h2><span class="n">Section \d+<\/span>)/)
const sections = parts
  .filter((p) => p.startsWith('<h2><span class="n">Section'))
  .map((body) => {
    const num = body.match(/Section (\d+)/)[1]
    const title = body.match(/<\/span>([^<]+)<\/h2>/)?.[1]?.trim() ?? `Section ${num}`
    // Drop the trailing </div> that closed the wrapper on the last section.
    return { num, title, body: body.replace(/<\/div>\s*$/, '').trimEnd() }
  })

// Which sections belong on which page. Anything not listed lands on the overview,
// so a new section is never silently lost.
const PAGES = [
  { file: 'appointments.html',          match: /^Appointments/,            icon: '📅' },
  { file: 'pharmacy.html',              match: /^Pharmacy/,                icon: '💊' },
  { file: 'queue.html',                 match: /^Queue/,                   icon: '🎫' },
  { file: 'settings.html',              match: /^Settings/,                icon: '⚙️' },
  { file: 'doctor-accountability.html', match: /^Doctor Accountability/,   icon: '🩺' },
  { file: 'billing.html',               match: /^Billing/,                 icon: '🧾' },
  { file: 'radiology.html',             match: /^Radiology/,               icon: '🩻' },
  { file: 'patients-laboratory.html',   match: /^Patients and Laboratory/, icon: '🧪' },
  { file: 'coverage.html',              match: /^Coverage by control type/, icon: '📐' },
  { file: 'performance.html',           match: /^Performance/,             icon: '⚡' },
  { file: 'backlog.html',               match: /^(Open backlog|What to do next|Module audit progress)/, icon: '📋' },
  { file: 'history.html',               match: /^(Fixed earlier|Also fixed today|Found today)/, icon: '📖' },
  { file: 'the-tool.html',              match: /^The audit tool/,          icon: '🔧' },
]

const countFindings = (body) => ({
  open: (body.match(/chip open/g) || []).length,
  fixed: (body.match(/chip fixed/g) || []).length,
  withdrawn: (body.match(/chip wait/g) || []).length,
})

const page = (title, bodies, backLink = true) => `<meta charset="utf-8">
<title>GudMed — ${title}</title>
${style}
<div class="wrap">
${backLink ? '<p class="meta" style="padding-top:2rem"><a href="index.html" style="color:inherit">← all modules</a></p>' : ''}
${bodies.join('\n\n')}
${backLink ? '<p class="meta" style="margin-top:4rem"><a href="index.html" style="color:inherit">← all modules</a></p>' : ''}
</div>
`

fs.mkdirSync(OUT, { recursive: true })

const written = []
const claimed = new Set()

for (const p of PAGES) {
  const mine = sections.filter((s) => p.match.test(s.title))
  if (!mine.length) continue
  mine.forEach((s) => claimed.add(s.num))
  const totals = mine.reduce((acc, s) => {
    const c = countFindings(s.body)
    return { open: acc.open + c.open, fixed: acc.fixed + c.fixed, withdrawn: acc.withdrawn + c.withdrawn }
  }, { open: 0, fixed: 0, withdrawn: 0 })
  const title = mine[0].title.split('—')[0].trim()
  fs.writeFileSync(path.join(OUT, p.file), page(title, mine.map((s) => s.body)))
  written.push({ ...p, title, ...totals, sections: mine.length })
}

// Anything not claimed by a page — so a new section shows up rather than vanishing.
const orphans = sections.filter((s) => !claimed.has(s.num))
if (orphans.length) {
  fs.writeFileSync(path.join(OUT, 'other.html'), page('Other sections', orphans.map((s) => s.body)))
  written.push({ file: 'other.html', icon: '📄', title: 'Other', open: 0, fixed: 0, withdrawn: 0, sections: orphans.length })
}

// ── the index ────────────────────────────────────────────────────────────────
const totalOpen = written.reduce((n, w) => n + w.open, 0)
const totalFixed = written.reduce((n, w) => n + w.fixed, 0)

const cards = written.map((w) => `  <a class="item ${w.open > 10 ? 'crit' : w.open ? 'warn' : 'good'}" href="${w.file}" style="display:block;text-decoration:none;color:inherit">
    <h4>${w.icon} ${w.title}</h4>
    <p>${w.open ? `<strong>${w.open} open</strong>` : 'nothing open'}${w.fixed ? ` · ${w.fixed} fixed` : ''}${w.withdrawn ? ` · ${w.withdrawn} withdrawn` : ''}</p>
  </a>`).join('\n')

fs.writeFileSync(path.join(OUT, 'index.html'), `<meta charset="utf-8">
<title>GudMed HMS — findings by module</title>
${style}
<div class="wrap">
<header class="top">
  <h1>GudMed HMS — findings, module by module</h1>
  <p class="sub">One page per module. Every number was measured on localhost against the running
  app; nothing here is estimated.</p>
  <p class="meta" style="color:var(--crit)">Compiled 9 August 2026 · ${totalOpen} open · ${totalFixed} fixed · browser-derived numbers are being re-measured (15 of 19 modules were disabled during the first pass)</p>
</header>

<p class="lede"><strong>None of it is live.</strong> Twenty-two commits and ninety changed files sit
on one laptop. Everything marked fixed is fixed locally.</p>

${cards}

<h2 style="border-top:1px solid var(--rule)"><span class="n">Not audited</span>Nine modules have never been opened</h2>
<p>Radiology · OPD · IPD · Pre-Triage · Day Care · Ambulance · Insurance · Death Certificates ·
Dashboard.</p>
<p class="note">The full single-page version remains at
<a href="../gudmed-status.html" style="color:inherit">gudmed-status.html</a> — same content, one
scroll. Regenerate these pages with <code>node docs/split-report.mjs</code> after editing it.</p>
</div>
`)

console.log(`\n  ${written.length + 1} pages written to docs/modules/\n`)
for (const w of written) {
  console.log(`    ${w.file.padEnd(30)} ${String(w.open).padStart(3)} open  ${String(w.fixed).padStart(2)} fixed  ${w.sections} section(s)`)
}
console.log(`    index.html`)
console.log(`\n  sections split: ${sections.length}  ·  unclaimed: ${orphans.length}\n`)
