// Does what a tester does: FILLS a form, SUBMITS it, and then checks the
// database for what actually landed.
//
//   node e2e/contract-audit.js
//
// Every other test here reads pages and calls endpoints. None of them has ever
// submitted a form — which is exactly where "the frontend sent it and the
// backend didn't store it" lives, and why those bugs kept being found by a human
// and never by this suite.
//
// For each flow it records the real XHR the browser sent, the response, the
// round-trip time, and then reads the row back out of the database, and reports
// any field that was sent but is not stored, or stored as a different type.
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Prisma lives in backend/, not at the repo root where this file sits.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backend = path.join(__dirname, '..', 'backend')
const require = createRequire(path.join(backend, 'package.json'))
const { PrismaClient } = require('@prisma/client')

// backend/.env holds DATABASE_URL; nothing loads it for a script run from here.
for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const BASE = process.env.E2E_BASE || 'http://localhost:5173'
const db = new PrismaClient()

let bugs = 0
const ok = (n, d = '') => console.log(`  ✅ ${n}${d ? ` — ${d}` : ''}`)
const bug = (n, d) => { bugs++; console.log(`  ❌ ${n}\n       ${d}`) }

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

// Record every API call the app makes: what went out, what came back, how long.
const calls = []
page.on('request', (r) => { if (r.url().includes('/api/')) r._t0 = Date.now() })
page.on('response', async (res) => {
  const req = res.request()
  if (!req.url().includes('/api/')) return
  let body = null
  try { body = await res.json() } catch { /* non-JSON */ }
  let sent = null
  try { sent = req.postData() ? JSON.parse(req.postData()) : null } catch { sent = req.postData() }
  calls.push({
    method: req.method(), url: req.url().replace(/^.*\/api/, '/api'),
    status: res.status(), ms: Date.now() - (req._t0 || Date.now()), sent, got: body,
  })
})

/** The most recent write to a matching endpoint. */
const lastWrite = (match) => [...calls].reverse().find((c) => c.url.includes(match) && ['POST', 'PUT', 'PATCH'].includes(c.method))

try {
  console.log('\n═══ CONTRACT AUDIT — fill, submit, then look in the database ═══\n')

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.fill('input[type="email"]', 'admin@gudmed.in')
  await page.fill('input[type="password"]', 'Gudmed@123')
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForTimeout(1500)

  // ── FLOW 1: Settings -> Rooms -> Add Room ─────────────────────────────
  // A room carries roomNumber, departmentId and sittingType. If any of those is
  // dropped between the form and the row, this is where it shows.
  console.log('FLOW 1 — Add Room (Settings → Rooms)')
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: /^\s*Rooms\s*$/i }).first().click()
  await page.waitForTimeout(1800)

  const uniqueNo = String(9000 + Math.floor(Math.random() * 900))
  await page.getByRole('button', { name: /Add Room/i }).first().click()
  await page.waitForTimeout(900)

  // Scope everything to the OPEN DIALOG. Querying the page picks up the filter
  // controls on the screen behind, which the modal's overlay then blocks — the
  // click never lands and it reads like a product bug.
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 10000 })

  await dialog.getByPlaceholder(/e\.g\. 204/i).fill(uniqueNo)

  // Pick a department — the field a tester would say "didn't save".
  let pickedDept = null
  const deptCombo = dialog.locator('[role="combobox"]').first()
  if (await deptCombo.count()) {
    await deptCombo.click()
    await page.waitForTimeout(700)
    const opt = page.locator('[role="option"]').first() // portalled outside the dialog
    if (await opt.count()) {
      pickedDept = (await opt.innerText()).trim()
      await opt.click()
      await page.waitForTimeout(500)
    }
  }

  calls.length = 0
  await dialog.getByRole('button', { name: /^\s*Save Room\s*$/i }).click()
  await page.waitForTimeout(2500)

  const w = lastWrite('/rooms')
  if (!w) bug('Add Room sent no request', 'the Save button fired no API call')
  else {
    console.log(`  → ${w.method} ${w.url}  ${w.status}  ${w.ms}ms`)
    console.log(`     sent: ${JSON.stringify(w.sent)}`)

    const row = await db.room.findFirst({
      where: { roomNumber: uniqueNo },
      include: { department: { select: { id: true, name: true } } },
    })
    if (!row) bug('room was not stored', `the form posted ${JSON.stringify(w.sent)} and returned ${w.status}, but no row exists`)
    else {
      // Compare every field that was SENT against what is IN THE DATABASE.
      const mismatches = []
      if (w.sent?.roomNumber !== row.roomNumber) mismatches.push(`roomNumber: sent ${JSON.stringify(w.sent?.roomNumber)}, stored ${JSON.stringify(row.roomNumber)}`)
      if (w.sent?.sittingType !== row.sittingType) mismatches.push(`sittingType: sent ${JSON.stringify(w.sent?.sittingType)}, stored ${JSON.stringify(row.sittingType)}`)
      if (w.sent?.departmentId && w.sent.departmentId !== row.departmentId) mismatches.push(`departmentId: sent ${JSON.stringify(w.sent.departmentId)}, stored ${JSON.stringify(row.departmentId)}`)
      if (w.sent?.floorId && w.sent.floorId !== row.floorId) mismatches.push(`floorId: sent ${JSON.stringify(w.sent.floorId)}, stored ${JSON.stringify(row.floorId)}`)

      mismatches.length === 0
        ? ok('every field sent by Add Room is stored', `roomNumber=${row.roomNumber}, dept=${row.department?.name || 'none'}, type=${row.sittingType}`)
        : bug('Add Room: form and database disagree', mismatches.join('\n       '))

      if (pickedDept && !row.departmentId) bug('department picked in the form was not saved', `the dropdown showed "${pickedDept}" and the row has departmentId = null`)

      // Does the response describe the row that was actually created?
      const returned = w.got?.data
      if (returned && returned.roomNumber !== row.roomNumber) {
        bug('response does not match the stored row', `API returned roomNumber ${JSON.stringify(returned.roomNumber)}, database has ${JSON.stringify(row.roomNumber)}`)
      }

      await db.room.delete({ where: { id: row.id } }).catch(() => {})
      console.log(`     (cleaned up room ${uniqueNo})`)
    }
  }

  // ── Response times across everything the audit touched ─────────────────
  console.log('\nRESPONSE TIMES')
  const slow = calls.filter((c) => c.ms > 1500).sort((a, b) => b.ms - a.ms)
  slow.length === 0
    ? ok('no call over 1.5s', `${calls.length} calls, slowest ${Math.max(0, ...calls.map((c) => c.ms))}ms`)
    : bug('slow endpoints', slow.slice(0, 4).map((c) => `${c.ms}ms  ${c.method} ${c.url}`).join('\n       '))

  // ── Sensitive data must never reach the browser ────────────────────────
  console.log('\nSENSITIVE DATA IN RESPONSES')
  const leaks = []
  for (const c of calls) {
    const s = JSON.stringify(c.got || '')
    for (const key of ['passwordHash', '"password"', 'invitationToken', 'DATABASE_URL', 'JWT_SECRET']) {
      if (s.includes(key)) leaks.push(`${c.method} ${c.url} → response contains ${key}`)
    }
  }
  leaks.length === 0 ? ok('no secrets in any response') : bug('sensitive field sent to the browser', [...new Set(leaks)].join('\n       '))

  // ── Failed calls ──────────────────────────────────────────────────────
  console.log('\nFAILED CALLS')
  const failed = calls.filter((c) => c.status >= 400)
  failed.length === 0
    ? ok('no 4xx/5xx during the flow')
    : bug('requests failed during a normal flow', failed.map((c) => `${c.status}  ${c.method} ${c.url}  ${JSON.stringify(c.got).slice(0, 80)}`).join('\n       '))
} catch (e) {
  bug('audit crashed', e.message)
} finally {
  await browser.close()
  await db.$disconnect()
}

console.log(`\n${'─'.repeat(56)}`)
console.log(bugs === 0 ? '✅ No contract defects found.' : `❌ ${bugs} defect(s).`)
process.exit(bugs ? 1 : 0)
