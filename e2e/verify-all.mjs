// One command that checks everything and changes nothing.
//
//   node e2e/verify-all.mjs                     # every module + every data check
//   node e2e/verify-all.mjs --quick             # data checks only, no browser (~1 min)
//   node e2e/verify-all.mjs --module billing    # one module
//   node e2e/verify-all.mjs --base https://…    # against a deployed environment
//
// WHY THIS EXISTS
// The pieces already existed — the browser walk, the orphan scan, the race probes —
// but running them meant remembering six commands and reading six logs. That is
// friction, and friction means it does not get run.
//
// IT NEVER FIXES ANYTHING. Every probe it calls either reads, or writes only to
// rows it creates and deletes in a `finally`. Nothing here repairs a defect, and
// nothing here should ever be taught to: a tool that quietly fixes what it finds
// stops being a way to find out what is wrong.
//
// Exit code is 1 when anything CRITICAL is found, so this can gate a deploy.
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
const has = (n) => argv.includes('--' + n)

const ROOT = path.resolve(import.meta.dirname, '..')
const BASE = arg('base', null)
const ONLY = arg('module', null)
const QUICK = has('quick')
const OUT = path.join(ROOT, 'e2e', 'audit-report')

const MODULES = ['appointments', 'pharmacy', 'queue', 'settings', 'billing', 'doctor-accountability',
                 'patients', 'laboratory', 'radiology', 'opd', 'inpatient', 'pre-triage',
                 'day-care', 'ambulance', 'insurance', 'death-certificates', 'dashboard']

// Data-level checks. Each one reads, or cleans up after itself; none repairs.
const PROBES = [
  { name: 'orphaned + cross-tenant rows', cmd: ['backend/scripts/check-orphans.mjs'] },
  { name: 'queue call-next race',         cmd: ['backend/scripts/queue-race.mjs'] },
  { name: 'commission settle honesty',    cmd: ['backend/scripts/settle-truth.mjs'] },
  { name: 'doctor accountability writes', cmd: ['backend/scripts/doctor-acct-probe.mjs'] },
  { name: 'pharmacy dispense vs stock',   cmd: ['backend/scripts/pharmacy-dispense-probe.mjs'] },
  { name: 'radiology report rules',       cmd: ['backend/scripts/radiology-probe.mjs'] },
  { name: 'money stored below a paisa',   cmd: ['--test', 'backend/src/lib/__tests__/moneyPrecision.test.js'] },
]

const run = (args, label) => new Promise((resolve) => {
  const started = Date.now()
  const p = spawn('node', args, { cwd: ROOT, shell: false })
  let out = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', (d) => { out += d })
  p.on('close', (code) => resolve({ label, code, out, secs: Math.round((Date.now() - started) / 1000) }))
})

const results = []
const line = (s = '') => console.log(s)

line(`\n  GudMed verification — ${BASE || 'localhost'} — ${QUICK ? 'data checks only' : 'data checks + browser walk'}`)
line(`  This run changes nothing. Anything it writes, it deletes.\n`)

// ── data checks ──────────────────────────────────────────────────────────────
line(`${'─'.repeat(74)}\n  DATA\n${'─'.repeat(74)}`)
for (const probe of PROBES) {
  const r = await run(probe.cmd, probe.name)
  // Probes report findings in their own words; a non-zero exit or a ✗ means trouble.
  const bad = (r.out.match(/✗/g) || []).length
  const good = (r.out.match(/✓/g) || []).length
  const status = r.code !== 0 || bad ? '✗ FINDINGS' : good ? '✓ clean' : '· ran'
  line(`  ${probe.name.padEnd(34)} ${status.padEnd(12)} ${String(r.secs).padStart(3)}s`)
  for (const l of r.out.split('\n').filter((l) => /✗/.test(l)).slice(0, 4)) line(`      ${l.trim().slice(0, 96)}`)
  results.push({ ...r, kind: 'data', findings: bad })
}

// ── browser walk ─────────────────────────────────────────────────────────────
if (!QUICK) {
  const list = ONLY ? [ONLY] : MODULES
  line(`\n${'─'.repeat(74)}\n  SCREENS — ${list.length} module(s)\n${'─'.repeat(74)}`)
  fs.mkdirSync(OUT, { recursive: true })
  for (const m of list) {
    const args = ['e2e/audit.mjs', '--deep', '--module', m, '--quiet', '--json', path.join(OUT, `${m}.json`)]
    if (BASE) args.push('--base', BASE)
    const r = await run(args, m)
    const crit = Number(r.out.match(/(\d+) critical/)?.[1] ?? 0)
    const cov = r.out.match(/found (\d+) · clicked (\d+).*NOT CLICKED (\d+)/)
    line(`  ${m.padEnd(24)} ${crit ? `✗ ${crit} critical` : '✓ none critical'}`.padEnd(48) +
         (cov ? `${cov[2]}/${cov[1]} clicked, ${cov[3]} missed` : '').padEnd(28) + `${String(r.secs).padStart(4)}s`)
    for (const l of r.out.split('\n').filter((l) => /CONTRACT:|HTTP [45]/.test(l)).slice(0, 3)) {
      line(`      ${l.trim().replace(/^\[[^\]]+\]\s*/, '').slice(0, 96)}`)
    }
    results.push({ ...r, kind: 'screen', findings: crit })
  }
}

// ── summary ──────────────────────────────────────────────────────────────────
const withFindings = results.filter((r) => r.findings > 0)
line(`\n${'─'.repeat(74)}`)
line(`  ${results.length} checks · ${withFindings.length} with findings · ${results.reduce((n, r) => n + r.secs, 0)}s total`)
if (withFindings.length) {
  line(`\n  needs attention:`)
  for (const r of withFindings) line(`    ${r.kind === 'data' ? '·' : '▸'} ${r.label}  (${r.findings})`)
}
line(`\n  Full per-call detail: e2e/audit-report/*.json`)
line(`  Written up in:        docs/modules/index.html\n`)

process.exit(withFindings.length ? 1 : 0)
