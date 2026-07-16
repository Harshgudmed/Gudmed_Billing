// Generic "show me this screen" CLI — no new script per check.
//
//   node e2e/shot.js <module> [--role=admin] [--tab=Rooms] [--name=out] [--full] [--wait=2000]
//
// Examples:
//   node e2e/shot.js settings --tab=Rooms
//   node e2e/shot.js doctor-accountability --tab="Doctor's Timetable"
//   node e2e/shot.js queue --role=receptionist --full
//   node e2e/shot.js "" --name=admin-home
import { launch, login, gotoModule, clickByName, shot } from './helpers.js'

function arg(flag, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}

const modulePath = (process.argv[2] || '').startsWith('--') ? '' : (process.argv[2] || '')
const role = arg('role', 'admin')
const tab = arg('tab')
const wait = Number(arg('wait', '2000'))
const name = arg('name', [modulePath || 'home', tab].filter(Boolean).join('-').replace(/[^\w-]+/g, '-').toLowerCase())
const full = process.argv.includes('--full')

const { browser, page } = await launch()
try {
  await login(page, role)
  await gotoModule(page, role, modulePath)
  if (tab) {
    const ok = await clickByName(page, tab)
    if (!ok) console.warn(`! tab/button "${tab}" not found — screenshotting the page as-is`)
  }
  await page.waitForTimeout(wait)
  console.log('saved:', await shot(page, name, { fullPage: full }))
  if (page._errors.length) {
    console.log('\nconsole errors:')
    for (const e of page._errors.slice(0, 10)) console.log('  -', e)
  } else {
    console.log('no console errors')
  }
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
