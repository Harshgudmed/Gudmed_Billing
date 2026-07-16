// Shared browser-driving helpers so a one-off check never needs a fresh script
// again. Everything here is deliberately small and explicit — see e2e/README.md.
//
// Requires Playwright:  npm i -D playwright && npx playwright install chromium
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const BASE = process.env.E2E_BASE || 'http://localhost:5173'
const SHOT_DIR = path.join(__dirname, 'shots')

// The app has role-scoped login routes (/admin/login, /doctor/login, ...) and
// role-prefixed module paths (/admin/settings) — a bare /login bounces back to
// the login screen, which is what made ad-hoc scripts silently "fail to log in".
export const ROLES = {
  admin: { email: 'admin@gudmed.in' },
  doctor: { email: 'priya@gudmed.in' },
  receptionist: { email: 'reception@gudmed.in' },
}
export const PASSWORD = process.env.E2E_PASSWORD || 'Gudmed@123'

/** Launch a browser + page, collecting console/page errors into `page._errors`. */
export async function launch({ width = 1600, height = 1000, headless = true } = {}) {
  const browser = await chromium.launch({ headless, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width, height } })
  page._errors = []
  // A 401 on first paint is normal (auth probe before the cookie is set).
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) page._errors.push(m.text()) })
  page.on('pageerror', (e) => page._errors.push(String(e)))
  return { browser, page }
}

/** Log in as a role and land on its home. Throws if login didn't stick. */
export async function login(page, role = 'admin') {
  const r = ROLES[role]
  if (!r) throw new Error(`Unknown role "${role}". Known: ${Object.keys(ROLES).join(', ')}`)
  await page.goto(`${BASE}/${role}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 15000 })
  await page.fill('input[type="email"]', r.email)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(1200)
  if (page.url().includes('/login')) throw new Error(`Login as ${role} failed — still on ${page.url()}`)
  return page.url()
}

/** Go to a module path, role-prefixed automatically ('settings' -> /admin/settings). */
export async function gotoModule(page, role, modulePath) {
  const clean = String(modulePath).replace(/^\//, '')
  await page.goto(`${BASE}/${role}/${clean}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return page.url()
}

/** Click a tab/button by visible name (tries role=tab, then role=button). */
export async function clickByName(page, name) {
  const rx = new RegExp(`^\\s*${name}\\s*$`, 'i')
  for (const getter of [page.getByRole('tab', { name: rx }), page.getByRole('button', { name: rx })]) {
    if (await getter.count()) { await getter.first().click(); await page.waitForTimeout(600); return true }
  }
  return false
}

/** Screenshot into e2e/shots/<name>.png. */
export async function shot(page, name, { fullPage = false } = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const file = path.join(SHOT_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage })
  return file
}
