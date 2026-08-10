// Drives the DEPLOYED site (Vercel frontend + Render API), not localhost.
//
//   node e2e/prod-check.js [modulePath] [--tab=Name] [--full]
//
// Same helpers as the local suites; only the base URL differs. Read-only —
// it logs in, navigates and screenshots. It changes nothing.
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.PROD_BASE || 'https://gudmed-hms.vercel.app'
const EMAIL = process.env.PROD_EMAIL || 'admin@gudmed.in'
const PASSWORD = process.env.PROD_PASSWORD || 'Gudmed@123'

const arg = (n) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : null }
const modulePath = (process.argv[2] || '').startsWith('--') ? '' : (process.argv[2] || '')
const tab = arg('tab')

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

try {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('input[type="email"]', { timeout: 30000 })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForTimeout(2500)
  if (page.url().includes('/login')) throw new Error(`login failed — still on ${page.url()}`)
  console.log('logged in ->', page.url())

  await page.goto(`${BASE}/admin/${modulePath}`.replace(/\/$/, ''), { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(3000)
  if (tab) {
    const rx = new RegExp(`^\\s*${tab}\\s*$`, 'i')
    for (const g of [page.getByRole('tab', { name: rx }), page.getByRole('button', { name: rx })]) {
      if (await g.count()) { await g.first().click(); await page.waitForTimeout(2500); break }
    }
  }

  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true })
  const name = ['prod', modulePath || 'home', tab].filter(Boolean).join('-').replace(/[^\w-]+/g, '-').toLowerCase()
  const file = path.join(__dirname, 'shots', `${name}.png`)
  await page.screenshot({ path: file, fullPage: process.argv.includes('--full') })
  console.log('screenshot:', file)
  console.log('\n--- page text ---')
  console.log((await page.locator('body').innerText()).split('\n').filter(Boolean).slice(0, 40).join('\n'))
  console.log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 5).join('\n  ')}` : '\nno console errors')
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
