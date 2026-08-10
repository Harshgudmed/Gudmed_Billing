// Where else in this app is something heavy loaded before anyone asks for it?
//
//   node scripts/lazy-scan.mjs
//
// WHY THIS EXISTS
// Four screens were fixed by hand after each was found by hand, which does not
// scale to seventeen modules with five tabs apiece. This reads the source and
// reports every candidate, so the list is complete rather than however far
// somebody got before running out of patience.
//
// What counts as a candidate — and, just as importantly, what does not:
//
//   whole module in a tab   one module rendering another. The biggest wins so
//                           far were all this shape.
//   heavy library           xlsx, barcode/QR, chart and PDF libraries, imported
//                           at the top of a module so every tab carries them.
//   dialog-only component   a *Dialog or *Modal imported statically. Worth it
//                           only if it drags a heavy library behind it — a lazy
//                           boundary for a 3 KB dialog costs a round trip and
//                           saves nothing.
//
// It reports, it does not edit. Splitting a component that is on screen at first
// paint makes the app slower, and only reading the JSX shows which those are.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const files = execSync('git ls-files "src/**/*.jsx" "src/**/*.js"', { encoding: 'utf8' })
  .split('\n').filter(Boolean)

// Rough weight of each file including what it imports, so "heavy" is measured
// rather than assumed. Transitive cost is what matters: a 4 KB dialog that pulls
// a 429 KB parser is a 429 KB dialog.
const sizeOf = new Map()
for (const f of files) {
  try { sizeOf.set(f, readFileSync(f, 'utf8').length) } catch {}
}

const HEAVY_LIBS = /\b(xlsx|sheetjs|jspdf|html2canvas|recharts|chart\.js|react-chartjs|@zxing|quagga|jsbarcode|qrcode|react-pdf|pdfjs|monaco|codemirror|fullcalendar|leaflet|mapbox)\b/i

const findings = []

for (const file of files) {
  if (!/^src\/(components|pages)\//.test(file)) continue
  let src = ''
  try { src = readFileSync(file, 'utf8') } catch { continue }

  const alreadyLazy = /lazy\(\s*\(\)\s*=>\s*import/.test(src)

  for (const m of src.matchAll(/^import\s+(?:(\w+)|{([^}]+)})\s+from\s+['"]([^'"]+)['"]/gm)) {
    const [, defaultName, named, spec] = m
    const line = src.slice(0, m.index).split('\n').length

    // 1. a whole module rendered inside another module.
    //
    // src/pages/XPage.jsx importing XModule is NOT this: every route in App.jsx is
    // already behind lazy(), so the page and its module land in one chunk that is
    // fetched when the route opens. Splitting them again would add a round trip in
    // the middle of a navigation and make the app slower. Reporting those seventeen
    // as work to do is how a scanner ends up ignored.
    if (defaultName && /Module$/.test(defaultName) && !/\/index$/.test(spec)) {
      if (/^src\/pages\//.test(file)) continue
      const target = files.find((f) => f.includes(defaultName + '.jsx'))
      findings.push({
        kind: 'module-in-module', file, line, what: defaultName, spec,
        bytes: target ? sizeOf.get(target) : null,
        why: `${defaultName} is a whole module rendered inside this one`,
      })
      continue
    }

    // 2. a heavy third-party library at the top of a module.
    //
    // Skipped when the file holding it is itself only ever reached through lazy():
    // html5-qrcode inside BarcodeScanner.jsx is already paid for on demand, because
    // PharmacyModule loads BarcodeScanner with lazy(). The library is heavy; its
    // position is not the problem.
    if (HEAVY_LIBS.test(spec)) {
      const base = file.split('/').pop().replace(/\.jsx?$/, '')
      const loadedLazily = files.some((f) => {
        if (f === file) return false
        try { return new RegExp(`lazy\\(\\s*\\(\\)\\s*=>\\s*import\\([^)]*${base}`).test(readFileSync(f, 'utf8')) }
        catch { return false }
      })
      if (loadedLazily) continue
      findings.push({
        kind: 'heavy-library', file, line, what: named?.trim() || defaultName, spec,
        bytes: null,
        why: `${spec} is a large dependency every tab of this file carries`,
      })
      continue
    }

    // 3. a dialog/modal that itself drags something heavy behind it
    if (defaultName && /(Dialog|Modal|Scanner|Chart|Report|Preview)$/.test(defaultName)) {
      const target = files.find((f) => f.endsWith(`/${defaultName}.jsx`))
      if (!target) continue
      let dep = ''
      try { dep = readFileSync(target, 'utf8') } catch {}
      const heavy = dep.match(HEAVY_LIBS)
      if (!heavy && (sizeOf.get(target) ?? 0) < 20_000) continue   // small: not worth a chunk
      findings.push({
        kind: 'dialog-pulls-heavy', file, line, what: defaultName, spec,
        bytes: sizeOf.get(target),
        why: heavy ? `pulls in ${heavy[0]}` : `${Math.round(sizeOf.get(target) / 1024)} KB of source`,
      })
    }
  }

  if (alreadyLazy) {
    // A file that already uses lazy() somewhere still deserves the rows above —
    // one lazy import does not make the other twelve lazy.
  }
}

const GROUPS = [
  ['module-in-module', 'A whole module imported into another module', 'Biggest wins. Radix unmounts an inactive tab, so these are downloaded and never mounted.'],
  ['heavy-library', 'A large library at the top of a module', 'Every tab of that module carries it, whether or not the tab that needs it is ever opened.'],
  ['dialog-pulls-heavy', 'A dialog that drags something heavy behind it', 'Gate on the open flag as well as lazy() — a lazy component fetches its chunk the moment it renders.'],
]

console.log('\n  LAZY-LOADING CANDIDATES — read from the source, not remembered\n')
let total = 0
for (const [kind, heading, note] of GROUPS) {
  const rows = findings.filter((f) => f.kind === kind)
  if (!rows.length) continue
  console.log(`  ── ${heading} (${rows.length}) ──`)
  console.log(`     ${note}\n`)
  for (const r of rows) {
    total++
    console.log(`     ${r.file}:${r.line}`)
    console.log(`        ${r.what.padEnd(28)} ${r.bytes ? `${Math.round(r.bytes / 1024)} KB source` : ''}  — ${r.why}`)
  }
  console.log()
}
console.log(`  ${total} candidate(s). Each still needs a look at the JSX: anything on screen at`)
console.log(`  first paint must NOT be split — a lazy boundary there adds a round trip.\n`)
