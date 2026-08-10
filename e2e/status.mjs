// Where is the audit right now?
//
// The runs are long — a deep walk plus Lighthouse is five to fifteen minutes per
// module, and seventeen modules is hours. That is a long time to be told "it is
// running" and have to believe it. This reads the logs and says what is actually
// happening, so the answer does not depend on trusting anyone.
//
//   node e2e/status.mjs          # once
//   node e2e/status.mjs --watch  # refresh every 10s
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.join(import.meta.dirname, 'audit-report', 'live')
const watch = process.argv.includes('--watch')

function show() {
  if (watch) process.stdout.write('\x1Bc')
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.log')) : []
  if (!files.length) return console.log('\n  no audit logs yet\n')

  console.log(`\n  ${new Date().toLocaleTimeString()}\n`)
  for (const f of files.sort()) {
    const p = path.join(DIR, f)
    const text = fs.readFileSync(p, 'utf8')
    const lines = text.split('\n')
    const mod = f.replace(/^[fc]-/, '').replace('.log', '')
    const done = text.includes('── coverage ──')
    const age = Math.round((Date.now() - fs.statSync(p).mtimeMs) / 1000)
    const live = !done && age < 60

    // the last thing it actually did
    const last = [...lines].reverse().find((l) => /^\s{2}\S.*\d+req/.test(l))?.trim().slice(0, 46) || ''
    // `clicked / found` is the wrong ratio to lead with. Appointments found 507
    // controls, of which 374 are the same card rendered once per appointment and 41
    // are write buttons the audit must not press — so "91/507" reads as 18% when the
    // walk in fact reached 91 of the 92 controls it was allowed to touch. Lead with
    // reachable, and keep `found` beside it so nothing looks hidden.
    const reach = text.match(/reachable (\d+) · clicked (\d+) · (\d+)%/)
    const cov = text.match(/found (\d+) · clicked (\d+).*NOT CLICKED (\d+)/)
    const lh = text.match(/performance\s+(\d+).*accessibility\s+(\d+)/)

    const summary = done && reach
      ? `${reach[2]}/${reach[1]} reachable · ${reach[3]}%` +
        (cov ? ` · ${cov[1]} found, ${cov[3]} missed` : '')
      : done && cov ? `${cov[2]}/${cov[1]} clicked · ${cov[3]} missed`
      : live ? `running — ${last}`
      : `stalled ${age}s`

    console.log(`  ${done ? '✓' : live ? '▸' : '·'} ${mod.padEnd(22)}` + summary.padEnd(52) +
      (lh ? `LH ${lh[1]}/${lh[2]}` : ''))
  }
  const done = files.filter((f) => fs.readFileSync(path.join(DIR, f), 'utf8').includes('── coverage ──')).length
  // Against the seventeen modules that exist, not against however many logs happen
  // to be on disk. "1 of 2 finished" read like the run was nearly over when it had
  // barely started — the denominator was the files created so far, which grows as
  // the run goes and can never say how much is left.
  const TOTAL = 17
  const queued = TOTAL - files.length
  console.log(`\n  ${done} of ${TOTAL} finished` +
    (queued > 0 ? `  ·  ${files.length - done} running  ·  ${queued} not started yet` : '') + '\n')
}

show()
if (watch) setInterval(show, 10000)
