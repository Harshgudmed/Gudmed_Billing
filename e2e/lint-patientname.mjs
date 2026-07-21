// Guards the "a patient's whole name, from one builder" rule — across BOTH
// layers, because it takes both to render a name correctly.
//
//   node e2e/lint-patientname.mjs        # exits 1 if either layer regresses
//
// Why this exists: "Harsh Mohan Bansal" printed as "Harsh Bansal" on his own
// bills. The formatting was copy-pasted ~110 times as `first + last`, which
// cannot include a middle name, AND ~30 Prisma selects never asked for the
// middleName column, so even a correct formatter had nothing to render. Fixing
// one call site fixes one screen, which is how it kept coming back.
//
// Two rules, one per layer:
//
//   1. BACKEND  — a `patient: { select: ... }` that lists name columns by hand
//                 instead of spreading PATIENT_NAME_SELECT. This is the half
//                 that fails SILENTLY: a missing column is `undefined`, and
//                 undefined joins to nothing. No error, just a shorter name.
//   2. FRONTEND — building a display name inline instead of calling
//                 getFullName() from @/lib/patient.
//
// A grep is cheaper than finding the next one by eye — see lint-drname.mjs,
// which exists for exactly the same reason.
import fs from 'node:fs'
import path from 'node:path'

const CWD = process.cwd()
const FRONTEND = path.join(CWD, 'src')
const BACKEND = path.join(CWD, 'backend', 'src')

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) { if (!/node_modules|\.git|dist/.test(p)) walk(p, out) }
    else if (/\.jsx?$/.test(f.name)) out.push(p)
  }
  return out
}

const rel = (f) => path.relative(CWD, f).replace(/\\/g, '/')

// ── Rule 1: backend selects must not hand-list the name columns ──────────────
// The single source of truth defines them; everyone else spreads it.
const SOURCE_OF_TRUTH = 'backend/src/lib/patientName.js'

const backendFindings = []
for (const file of walk(BACKEND)) {
  if (rel(file) === SOURCE_OF_TRUTH) continue
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!/\bfirstName:\s*true\b/.test(line)) return
    backendFindings.push(`${rel(file)}:${i + 1}\n    ${line.trim().slice(0, 110)}`)
  })
}

// ── Rule 2: frontend must not build a name inline ────────────────────────────
const V = String.raw`[\w$]+(?:\??\.[\w$]+)*`
const FRONTEND_PATTERNS = [
  // `${x.firstName} ${x.lastName}` / with || '' fallbacks
  new RegExp(String.raw`\$\{${V}\??\.firstName[^}]*\}\s*\$\{${V}\??\.lastName`, 'g'),
  // JSX: {x.firstName} {x.lastName}
  new RegExp(String.raw`\{${V}\??\.firstName\}\s*\{${V}\??\.lastName\}`, 'g'),
  // [x.firstName, x.lastName].join(...) / .filter(Boolean).join(...)
  new RegExp(String.raw`\[${V}\??\.firstName,\s*${V}\??\.(?:middleName|lastName)`, 'g'),
  // x.firstName + ' ' + x.lastName
  new RegExp(String.raw`${V}\??\.firstName\s*(?:\|\|[^+]*)?\)?\s*\+\s*['"] ['"]\s*\+`, 'g'),
]

// Not a rendered full NAME: avatar initials, search/sort keys built from a
// single field, the shared builder itself, and schema/field-name strings.
const ALLOWED = /getFullName|patientDisplayName|\.\[0\]|\?\.\[0\]|charAt|initials/

const frontendFindings = []
for (const file of walk(FRONTEND)) {
  if (rel(file) === 'src/lib/patient.js') continue
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return
    for (const re of FRONTEND_PATTERNS) {
      re.lastIndex = 0
      if (!re.test(line)) continue
      if (ALLOWED.test(line)) continue
      frontendFindings.push(`${rel(file)}:${i + 1}\n    ${line.trim().slice(0, 110)}`)
      break
    }
  })
}

let failed = false

if (backendFindings.length) {
  failed = true
  console.error(`❌ ${backendFindings.length} Prisma select(s) list patient name columns by hand:\n`)
  for (const f of backendFindings) console.error('  ' + f)
  console.error('\nSpread PATIENT_NAME_SELECT from src/lib/patientName.js instead:')
  console.error("  patient: { select: { ...PATIENT_NAME_SELECT, phonePrimary: true } }")
  console.error('A hand-written list is how middleName went missing: the column is')
  console.error('simply absent from the row, so the name silently comes out short.\n')
}

if (frontendFindings.length) {
  failed = true
  console.error(`❌ ${frontendFindings.length} place(s) build a patient name inline:\n`)
  for (const f of frontendFindings) console.error('  ' + f)
  console.error("\nUse getFullName(patient) from @/lib/patient — `first + last` drops")
  console.error('the middle name, and `${first} ${middle || ""} ${last}` leaves a')
  console.error('double space for patients who have none.\n')
}

if (failed) process.exit(1)
console.log('✅ patient names: one builder (getFullName / patientFullName), one select (PATIENT_NAME_SELECT)')
