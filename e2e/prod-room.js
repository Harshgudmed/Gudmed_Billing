import { chromium } from 'playwright'
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'https://gudmed-hms.vercel.app'
const browser = await chromium.launch({ args:['--no-sandbox'] })
const page = await browser.newPage({ viewport:{width:1600,height:1000} })
try {
  await page.goto(`${BASE}/admin/login`, { waitUntil:'domcontentloaded', timeout:60000 })
  await page.waitForSelector('input[type="email"]', { timeout:30000 })
  await page.fill('input[type="email"]','admin@gudmed.in'); await page.fill('input[type="password"]','Gudmed@123')
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle',timeout:60000}).catch(()=>{}), page.click('button[type="submit"]')])
  await page.waitForTimeout(2000)
  // find Room 100's id via the API, then go straight to it
  const roomId = 'cmrn0y4pm00hdtbt467ammlcd'
  await page.goto(`${BASE}/display/room/${roomId}`, { waitUntil:'networkidle', timeout:60000 })
  await page.waitForTimeout(3000)
  fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true})
  const f = path.join(__dirname,'shots','prod-room100.png')
  await page.screenshot({ path:f })
  console.log('screenshot:', f)
  console.log('\n--- what the board shows ---')
  console.log(await page.locator('body').innerText())
} catch(e){ console.error('FAILED:', e.message); process.exitCode=1 } finally { await browser.close() }
