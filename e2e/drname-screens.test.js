// Verifies the "doctors show as Dr. X" rule ON THE ACTUAL RENDERED SCREENS,
// not just in the source (that's what e2e/lint-drname.mjs does).
//
//   node e2e/drname-screens.test.js
//
// Method: two real doctors are stored WITHOUT a title ("atul", "dhruv") while
// seeded ones are stored WITH one ("Dr. Aanya ..."). Those two are the canaries
// — if any screen renders a line that is exactly "atul"/"dhruv", that screen
// bypassed drName(). Emails ("atul@gudmed.in") sit on their own line and are
// legitimately bare, so an exact whole-line match is what we test.
import { launch, login, gotoModule, clickByName, shot, BASE } from './helpers.js'

const CANARIES = ['atul', 'dhruv']
const results = []
const rec = (screen, pass, detail = '') => {
  results.push({ screen, pass })
  console.log(`${pass ? '✅' : '❌'} ${screen}${detail ? `\n      ${detail}` : ''}`)
}

/** A line that IS exactly a canary name = a doctor name rendered without its title. */
function bareNames(bodyText) {
  const lines = bodyText.split('\n').map((l) => l.trim())
  return CANARIES.filter((n) => lines.includes(n))
}

/** Did this screen actually show the canary at all? Otherwise the check is vacuous. */
function sawCanary(bodyText) {
  return CANARIES.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(bodyText))
}

const { browser, page } = await launch()
try {
  await login(page, 'admin')

  // Each entry must DRIVE the UI to where doctor names actually render (open the
  // dropdown, expand the row, drill into the department). Merely loading the
  // page passes vacuously — the canary never appears, nothing is proven.
  const screens = [
    {
      name: 'Settings → Users',
      go: async () => { await gotoModule(page, 'admin', 'settings'); await clickByName(page, 'Users') },
    },
    {
      name: 'Settings → Rooms → Cover/Override doctor picker',
      go: async () => {
        await gotoModule(page, 'admin', 'settings')
        await clickByName(page, 'Rooms')
        await page.waitForTimeout(1200)
        await page.locator('table tbody tr').first().click()      // expand a room
        await page.waitForTimeout(800)
        await page.getByRole('button', { name: /Cover \/ Override/i }).first().click()
        await page.waitForTimeout(800)
        await page.locator('[role="combobox"], button:has-text("Select")').first().click() // open picker
        await page.waitForTimeout(900)
      },
    },
    {
      name: 'Doctor Accountability → Doctors',
      go: async () => { await gotoModule(page, 'admin', 'doctor-accountability') },
    },
    {
      name: "Doctor Accountability → Timetable → Cardiology doctors",
      go: async () => {
        await gotoModule(page, 'admin', 'doctor-accountability')
        await clickByName(page, "Doctor's Timetable")
        await page.waitForTimeout(1200)
        await page.getByText('Cardiology', { exact: false }).first().click()  // atul + dhruv are Cardiology
        await page.waitForTimeout(1400)
      },
    },
    {
      name: 'Day Care → New patient → doctor dropdown',
      go: async () => {
        await gotoModule(page, 'admin', 'day-care')
        await page.waitForTimeout(1000)
        await page.getByRole('button', { name: /New Day Care Patient/i }).first().click()
        await page.waitForTimeout(900)
        const combo = page.locator('[role="combobox"]')
        for (let i = 0; i < await combo.count(); i++) {
          await combo.nth(i).click(); await page.waitForTimeout(600)
          if (sawCanary(await page.locator('body').innerText())) break
          await page.keyboard.press('Escape'); await page.waitForTimeout(300)
        }
      },
    },
  ]

  for (const s of screens) {
    try {
      await s.go()
      await page.waitForTimeout(1200)
      const body = await page.locator('body').innerText()
      const bare = bareNames(body)
      const seen = sawCanary(body)
      // Not showing the canary is NOT a pass — it means the rule was never tested.
      rec(s.name, seen && bare.length === 0,
        bare.length ? `BARE (no "Dr."): ${bare.join(', ')}`
          : seen ? 'canary doctor shown, correctly titled' : 'INCONCLUSIVE — canary never rendered, rule not exercised')
      if (bare.length || !seen) await shot(page, `drname-${s.name.replace(/\W+/g, '-').toLowerCase().slice(0, 50)}`)
    } catch (e) {
      rec(s.name, false, `ERROR: ${e.message}`)
    }
  }

  // Display board room detail — drill to a real room with patients.
  try {
    const floors = (await (await page.request.get(`${BASE}/api/display/floors`)).json()).data || []
    let roomId = null
    outer: for (const f of floors) {
      const rooms = (await (await page.request.get(`${BASE}/api/rooms?floorId=${f.id}`)).json()).data || []
      for (const r of rooms) {
        const q = (await (await page.request.get(`${BASE}/api/display/queue?roomId=${r.id}`)).json()).data
        if ((q?.waitingGroups || []).some((g) => g.patients.length > 0)) { roomId = r.id; break outer }
      }
    }
    if (roomId) {
      await page.goto(`${BASE}/display/room/${roomId}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1600)
      const body = await page.locator('body').innerText()
      const bare = bareNames(body)
      rec('Display Board → room detail', bare.length === 0, bare.length ? `BARE: ${bare.join(', ')}` : 'ok')
    } else {
      rec('Display Board → room detail', false, 'could not find a room with patients')
    }
  } catch (e) {
    rec('Display Board → room detail', false, `ERROR: ${e.message}`)
  }
} catch (e) {
  console.error('SUITE FAILED:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${'─'.repeat(60)}\nDr. TITLE ON SCREEN: ${results.length - failed.length}/${results.length} screens clean`)
if (failed.length) { console.log('FAILING: ' + failed.map((f) => f.screen).join(', ')); process.exitCode = 1 }
