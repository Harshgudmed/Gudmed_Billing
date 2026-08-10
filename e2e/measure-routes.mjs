// What each route actually downloads and how long it takes to become usable.
//
//   node e2e/measure-routes.mjs before.json
//   git stash && node e2e/measure-routes.mjs after.json && git stash pop
//   node e2e/measure-routes.mjs --compare before.json after.json
//
// WHY THIS EXISTS
// "It feels faster" is not a result, and a build log showing a smaller chunk does
// not prove the browser stopped asking for the bigger one. This opens each route
// in a real browser and records what came down the wire, so a fix can be stated as
// a number with a before and an after rather than as a claim.
//
// It reads only. No row is created, changed or deleted.
import { writeFileSync, readFileSync } from 'node:fs'
import { launch, login, BASE } from './helpers.js'

const ROUTES = [
  ['queue', '/admin/queue'],
  ['laboratory', '/admin/laboratory'],
  ['radiology', '/admin/radiology'],
  ['settings', '/admin/settings'],
  ['billing', '/admin/billing'],
]

const kb = (n) => Math.round(n / 1024)

if (process.argv[2] === '--compare') {
  const a = JSON.parse(readFileSync(process.argv[3], 'utf8'))
  const b = JSON.parse(readFileSync(process.argv[4], 'utf8'))
  console.log('\n  ROUTE         JS BEFORE   JS AFTER    SAVED   FILES   READY BEFORE  READY AFTER')
  console.log('  ' + '─'.repeat(82))
  let sa = 0, sb = 0
  for (const [name] of ROUTES) {
    const x = a[name], y = b[name]
    if (!x || !y) continue
    sa += x.js; sb += y.js
    const pct = x.js ? Math.round((1 - y.js / x.js) * 100) : 0
    console.log(`  ${name.padEnd(12)} ${String(kb(x.js)).padStart(7)} KB ${String(kb(y.js)).padStart(8)} KB ` +
      `${String(pct).padStart(6)}%  ${String(x.files).padStart(3)}→${String(y.files).padEnd(3)} ` +
      `${String(x.ready).padStart(9)} ms ${String(y.ready).padStart(10)} ms`)
  }
  console.log('  ' + '─'.repeat(82))
  console.log(`  ${'TOTAL'.padEnd(12)} ${String(kb(sa)).padStart(7)} KB ${String(kb(sb)).padStart(8)} KB ` +
    `${String(sa ? Math.round((1 - sb / sa) * 100) : 0).padStart(6)}%\n`)
  process.exit(0)
}

const out = process.argv[2] || 'routes.json'
const { browser, page } = await launch({ headless: true })
await login(page, 'admin')

const result = {}
for (const [name, path] of ROUTES) {
  let js = 0, files = 0, xlsx = 0
  const onFinish = async (r) => {
    const u = r.url()
    if (!/\.(js|jsx|mjs)(\?|$)/.test(u) && !u.includes('/src/') && !u.includes('/@fs/')) return
    let b = 0
    try { b = Number((await r.sizes()).responseBodySize || 0) } catch {}
    js += b; files++
    if (/xlsx|sheetjs/i.test(u)) xlsx += b
  }
  page.on('requestfinished', onFinish)
  const t0 = Date.now()
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  const ready = Date.now() - t0
  await page.waitForTimeout(1200)
  page.off('requestfinished', onFinish)
  result[name] = { js, files, xlsx, ready }
  console.log(`  ${name.padEnd(12)} ${String(kb(js)).padStart(6)} KB  ${String(files).padStart(3)} files  ` +
    `${String(ready).padStart(5)} ms ready${xlsx ? `  · xlsx ${kb(xlsx)} KB` : ''}`)
}

writeFileSync(out, JSON.stringify(result, null, 2))
console.log(`\n  written to ${out}\n`)
await browser.close()
