// A disabled module still mounts, still fetches, and only then disappears.
//
// Twelve of the sixteen modules are switched off in Settings → Modules. The route
// for a disabled module does not exist, so React Router sends it to the dashboard.
// That part is correct.
//
// What is not correct is the order. `modulesEnabled` starts as {} while the org
// settings are still in flight, so on the first render EVERY module is allowed:
// the page mounts, runs its effects, fires its API calls — and only when settings
// arrive does it vanish. The user sees a flash of a module they are not meant to
// have, and the server does the work of serving it.
//
// It also quietly invalidated this session's coverage numbers: the audit was
// walking pages that were being unmounted underneath it, which is why Pharmacy
// reported 24 of 96 controls clicked and Queue 19 of 111.
import { launch, login, BASE } from './helpers.js'

const { browser, page } = await launch({ headless: true })
const calls = []
page.on('requestfinished', (r) => { if (r.url().includes('/api/')) calls.push(r.url().split('/api')[1].split('?')[0]) })

try {
  await login(page, 'admin')
  for (const m of ['pharmacy', 'queue', 'laboratory']) {
    calls.length = 0
    await page.goto(`${BASE}/admin/${m}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const url = page.url().replace(BASE, '')
    const own = calls.filter((c) => c.includes(m.slice(0, 6)))
    console.log(`\n  /admin/${m}`)
    console.log(`    ended on        : ${url}`)
    console.log(`    API calls fired : ${calls.length}`)
    console.log(`    ${m}'s own calls : ${own.length}${own.length ? ` → ${[...new Set(own)].join(', ')}` : ''}`)
    console.log(own.length && !url.includes(m)
      ? `    ✗ the module fetched its data and THEN was redirected away`
      : url.includes(m) ? `    ✓ stayed` : `    ✓ redirected without fetching`)
  }
} finally { await browser.close() }
