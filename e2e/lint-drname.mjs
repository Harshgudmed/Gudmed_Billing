// Guards the "doctors are shown as Dr. X" rule across the whole frontend.
//
//   node e2e/lint-drname.mjs        # exits 1 if any doctor name renders bare
//
// Why this exists: the rule was applied by hand, screen by screen, and screens
// kept getting missed (Settings → Users, Doctor Accountability → Doctors, the
// doctor pickers). A name is stored either as "atul" or as "Dr. Aanya" depending
// on whether it was seeded or typed in, so nothing but drName() at render makes
// the two look the same. A grep is cheaper than finding the next one by eye.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(process.cwd(), 'src')

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) { if (!/node_modules|\.git|dist/.test(p)) walk(p, out) }
    else if (/\.jsx?$/.test(f.name)) out.push(p)
  }
  return out
}

// JSX expressions that render something named like a doctor.
const PATTERNS = [
  /\{\s*([\w?.[\]]*[Dd]octor[\w?.[\]]*\.fullName[^}]*)\}/g,
  /\{\s*([\w?.[\]]*\.doctorName[^}]*)\}/g,
  /\{\s*(attendingDoctorName[^}]*)\}/g,
  /\{\s*([\w?.[\]]*requestingDoctor[^}]*)\}/g,
  // `label:` / `<SelectItem>` doctor pickers, and doctor tables using a short var.
  /label:\s*(d(?:oc)?\.fullName)/g,
  /<SelectItem[^>]*>\{\s*(d(?:oc)?\.fullName)\s*\}/g,
  /<TableCell[^>]*>\{\s*(d(?:oc)?\.fullName)\s*\}/g,
]

// Not a rendered NAME: initials, avatar letters, split/map helpers, or already wrapped.
const ALLOWED = /drName|docName|initials|charAt|\.\[0\]|\?\.\[0\]|\.split\(|\.map\(/

const findings = []
for (const file of walk(ROOT)) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const re of PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line))) {
        if (ALLOWED.test(m[1])) continue
        findings.push(`${path.relative(process.cwd(), file)}:${i + 1}\n    ${line.trim().slice(0, 120)}`)
      }
    }
  })
}

if (findings.length) {
  console.error(`❌ ${findings.length} doctor name(s) render WITHOUT drName():\n`)
  for (const f of findings) console.error('  ' + f)
  console.error('\nWrap with drName() from @/lib/utils — it is idempotent, so a name')
  console.error('already stored as "Dr. Aanya" will not become "Dr. Dr. Aanya".')
  process.exit(1)
}
console.log('✅ every doctor-name render goes through drName()')
