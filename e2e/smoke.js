// Login + module smoke pass for every real role.
//
//   node e2e/smoke.js
//
// Checks each role can log in, lands on its home, and that every module it can
// reach renders without a console error or a blank screen. Exits non-zero if
// anything fails, so it can gate a release.
import { launch, login, gotoModule, shot, ROLES } from './helpers.js'

// Modules each role should be able to open. Keep in sync with the sidebar.
const MODULES = {
  admin: ['', 'patients', 'appointments', 'queue', 'opd', 'pharmacy', 'laboratory', 'radiology', 'billing', 'inpatient', 'doctor-accountability', 'settings'],
  doctor: ['', 'appointments', 'queue', 'doctor-accountability'],
  receptionist: ['', 'patients', 'appointments', 'queue'],
}

;(async () => {
  let failures = 0
  for (const role of Object.keys(ROLES)) {
    const { browser, page } = await launch()
    try {
      console.log(`\n=== ${role} ===`)
      const url = await login(page, role)
      console.log(`  login OK -> ${url}`)

      for (const mod of MODULES[role] || []) {
        page._errors.length = 0
        await gotoModule(page, role, mod)
        await page.waitForTimeout(1200)
        // A blank screen = almost no rendered text.
        const text = (await page.locator('body').innerText().catch(() => '')) || ''
        const blank = text.trim().length < 40
        const errs = page._errors.slice(0, 3)
        const label = mod || '(home)'
        if (blank || errs.length) {
          failures++
          console.log(`  ✗ ${label}${blank ? ' — BLANK SCREEN' : ''}`)
          for (const e of errs) console.log(`      ${e}`)
          await shot(page, `smoke-fail-${role}-${label.replace(/\W+/g, '-') || 'home'}`)
        } else {
          console.log(`  ✓ ${label}`)
        }
      }
    } catch (e) {
      failures++
      console.log(`  ✗ ${role}: ${e.message}`)
    } finally {
      await browser.close()
    }
  }
  console.log(failures ? `\nFAILED — ${failures} problem(s)` : '\nAll green.')
  process.exit(failures ? 1 : 0)
})()
