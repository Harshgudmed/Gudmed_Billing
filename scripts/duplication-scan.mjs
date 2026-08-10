// Find code that exists in more than one place, and prove it with line numbers.
//
//   node scripts/duplication-scan.mjs                 # every duplicate ≥ 8 lines
//   node scripts/duplication-scan.mjs --min 15        # only the big ones
//   node scripts/duplication-scan.mjs --json out.json
//
// WHY THIS EXISTS
// CLAUDE.md rule 2 says the same logic must live in one place, and rule 9 says a
// thing needed by two modules belongs in a shared lib. Both were being enforced by
// memory, which is why the lab report HTML ended up written twice — 156 lines in
// LaboratoryModule.jsx and 162 in printLabReport.js — and why age, patient-name and
// date-range logic each drifted apart across modules before anyone noticed.
//
// Reading a diff cannot catch this: the second copy is added in a different file, in
// a different week, by someone who did not know the first existed. Only a scan over
// the whole tree can. So this is the check that turns "search before you write" from
// a request into something a machine verifies.
//
// HOW IT WORKS
// Every line is normalised — comments and blank lines dropped, whitespace collapsed,
// string literals reduced to a placeholder — so that two copies which differ only in
// a label or an indent still match. Sliding windows of N normalised lines are hashed,
// and any hash appearing in two or more places is a duplicate. Reporting the ORIGINAL
// line numbers is what makes it actionable: the output is a place to go and look.
//
// It reads. It never edits.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
const MIN = Number(arg('min', 8))
const JSON_OUT = arg('json', null)

const SKIP = /node_modules|\.git|dist|build|coverage|audit-report|\.next|prisma\/migrations|package-lock/
const EXT = /\.(js|jsx|mjs|ts|tsx)$/

// Shipped code only, unless --all is passed. Test files, e2e probes and one-off
// scripts repeat their setup on purpose — six tests opening the same Prisma client
// is six independent tests, not a duplication problem, and letting them into the
// output buries the findings that matter under scaffolding.
const SHIPPED = /^(src|backend\/src)\//
const NOISE = /__tests__|\.test\.|\.spec\./
const ONLY_SHIPPED = !argv.includes('--all')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (SKIP.test(p.replace(/\\/g, '/'))) continue
    if (e.isDirectory()) walk(p, out)
    else if (EXT.test(e.name)) out.push(p)
  }
  return out
}

// Normalise a line to what it MEANS, not how it is spelled. Two copies of the same
// block that differ only in a toast message or a variable's indent are still the
// same duplicated decision, and must match here or the scan finds nothing.
function normalise(line) {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, 'S')  // any string literal → S
    .replace(/\s+/g, ' ')
    .trim()
}

// A window made only of punctuation or closing braces matches everywhere and means
// nothing. Requiring some real identifiers is what keeps the output worth reading.
const meaningful = (lines) => lines.join('').replace(/[^A-Za-z]/g, '').length >= lines.length * 6

// An import block repeated across ten files is not duplicated logic — it is ten
// files importing the same things, which is correct. Left in, it was the top three
// findings and pushed the real ones off the page.
const mostlyImports = (lines) => lines.filter((l) => /^(import|export|const \w+ = require)\b/.test(l)).length > lines.length / 2

const files = walk(ROOT).filter((f) => {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  if (NOISE.test(rel)) return false
  return ONLY_SHIPPED ? SHIPPED.test(rel) : true
})
const index = new Map()   // hash → [{ file, startLine, endLine }]

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8').split('\n')
  const norm = raw.map(normalise)
  // Keep the mapping back to real line numbers: blank and comment lines vanish from
  // the window but the report has to point at the file as a human sees it.
  const kept = []
  for (let i = 0; i < norm.length; i++) if (norm[i].length > 2) kept.push({ text: norm[i], line: i + 1 })

  for (let i = 0; i + MIN <= kept.length; i++) {
    const win = kept.slice(i, i + MIN)
    const texts = win.map((w) => w.text)
    if (!meaningful(texts) || mostlyImports(texts)) continue
    const key = win.map((w) => w.text).join('\n')
    if (!index.has(key)) index.set(key, [])
    index.get(key).push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), from: win[0].line, to: win[win.length - 1].line })
  }
}

// Keep only hashes seen in more than one PLACE, and prefer the longest run: a
// 30-line duplicate also produces 23 overlapping 8-line ones, and reporting all of
// them buries the finding it is trying to surface.
const dupes = [...index.entries()]
  .filter(([, at]) => at.length > 1)
  .map(([key, at]) => ({ lines: key.split('\n').length, at, key }))
  .sort((a, b) => b.lines - a.lines || b.at.length - a.at.length)

// Claim the lines each reported duplicate occupies. A 30-line block also produces
// 21 overlapping 10-line windows; reporting all 22 makes one finding look like
// twenty-two and hides everything below it. Longest first, so the fullest version
// of a block is the one that gets reported.
const claimed = new Map()   // file → [[from, to], …]
const overlaps = (file, from, to) => (claimed.get(file) || []).some(([f, t]) => from <= t && to >= f)
const kept = []
for (const d of dupes) {
  if (d.at.every((a) => overlaps(a.file, a.from, a.to))) continue
  for (const a of d.at) {
    if (!claimed.has(a.file)) claimed.set(a.file, [])
    claimed.get(a.file).push([a.from, a.to])
  }
  // Two windows at the same offset in the same file are the sliding window walking
  // over itself, not two separate copies.
  d.at = d.at.filter((a, i, arr) => arr.findIndex((b) => b.file === a.file && Math.abs(b.from - a.from) < MIN) === i)
  if (d.at.length > 1) kept.push(d)
}

// ── report ───────────────────────────────────────────────────────────────────
const crossFile = kept.filter((d) => new Set(d.at.map((a) => a.file)).size > 1)
const sameFile = kept.filter((d) => new Set(d.at.map((a) => a.file)).size === 1)

console.log(`\n  Duplication scan · ${files.length} files · windows of ${MIN}+ normalised lines\n`)
console.log(`  ${crossFile.length} duplicated across DIFFERENT files  ← these are the shared-lib candidates`)
console.log(`  ${sameFile.length} repeated within a single file       ← these are extract-a-function candidates\n`)

const show = (list, title, n) => {
  if (!list.length) return
  console.log(`  ── ${title} ──`)
  for (const d of list.slice(0, n)) {
    console.log(`\n  ${d.lines} lines, in ${d.at.length} places:`)
    for (const a of d.at) console.log(`      ${a.file}:${a.from}-${a.to}`)
    console.log(`      first line: ${d.key.split('\n')[0].slice(0, 92)}`)
  }
  console.log('')
}

show(crossFile, 'ACROSS FILES — a shared lib belongs here (CLAUDE.md rule 9)', 25)
show(sameFile, 'WITHIN ONE FILE — extract a function (CLAUDE.md rule 2)', 15)

// Which file pairs repeat each other most. This is the number that says where to
// start: two modules sharing forty lines is one extraction, not forty decisions.
const pairs = new Map()
for (const d of crossFile) {
  const fs_ = [...new Set(d.at.map((a) => a.file))].sort()
  for (let i = 0; i < fs_.length; i++) {
    for (let j = i + 1; j < fs_.length; j++) {
      const k = `${fs_[i]}  ⟷  ${fs_[j]}`
      pairs.set(k, (pairs.get(k) || 0) + d.lines)
    }
  }
}
const ranked = [...pairs.entries()].sort((a, b) => b[1] - a[1])
if (ranked.length) {
  console.log('  ── WHERE TO START — file pairs by duplicated lines ──\n')
  for (const [k, v] of ranked.slice(0, 20)) console.log(`    ${String(v).padStart(4)} lines   ${k}`)
  console.log('')
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ min: MIN, files: files.length, crossFile, sameFile, pairs: ranked }, null, 2))
  console.log(`  JSON: ${JSON_OUT}\n`)
}
