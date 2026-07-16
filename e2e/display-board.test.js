// Drives the live Display Board and asserts the things a patient standing in
// the lobby depends on. Every check here exists because it broke in real use.
//
//   node e2e/display-board.test.js
import { launch, login, shot, BASE } from './helpers.js'

const results = []
const rec = (id, title, pass, detail = '') => {
  results.push({ id, pass })
  console.log(`${pass ? '✅' : '❌'} ${id}  ${title}${detail ? `\n      ${detail}` : ''}`)
}

const { browser, page } = await launch()
try {
  await login(page, 'admin')

  // ── DB-001/002 overview renders, floors in creation order ──────────────
  await page.goto(`${BASE}/display`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const floorNames = await page.locator('button:has-text("waiting")').allInnerTexts()
  rec('DB-001', 'Overview renders floor tiles', floorNames.length > 0, `${floorNames.length} floors`)
  const order = floorNames.map((t) => t.split('\n')[0].trim())
  rec('DB-002', 'Ground Floor sorts before 1st Floor (sortOrder, not alphabetical)',
    order.indexOf('Ground Floor') === 0, order.join(' → '))

  // ── DB-003 counts are today-sized, not history-sized ───────────────────
  const totalWaiting = (await page.locator('body').innerText())
    .match(/(\d+)\s+waiting/g)?.map((s) => parseInt(s)) || []
  const sum = totalWaiting.reduce((a, b) => a + b, 0)
  rec('DB-003', 'Waiting counts are today-scale (not 1M+ history)', sum > 0 && sum < 20000, `sum across floors: ${sum}`)

  // ── drill into a floor ─────────────────────────────────────────────────
  await page.locator('button:has-text("waiting")').first().click()
  await page.waitForTimeout(1500)

  // ── BREADCRUMB must be visible, not hidden behind the navy header ──────
  const crumb = page.locator('nav[aria-label="Breadcrumb"]')
  const crumbVisible = await crumb.count() ? await crumb.first().isVisible() : false
  let crumbBelowHeader = false
  if (crumbVisible) {
    const hb = await page.locator('.bg-\\[\\#2E4168\\]').first().boundingBox()
    const cb = await crumb.first().boundingBox()
    crumbBelowHeader = hb && cb && cb.y >= hb.y + hb.height - 1
  }
  rec('DB-BC', 'Breadcrumb is visible and BELOW the header (not clipped behind it)',
    crumbVisible && crumbBelowHeader, crumbVisible ? (crumbBelowHeader ? 'in normal flow' : 'OVERLAPS header') : 'not visible')

  // ── open a room that has MULTIPLE doctor queues ────────────────────────
  // Ask the API which room actually has >1 doctor queue today, then go straight
  // there. Clicking through rooms and hoping to land on a multi-doctor one is
  // how a vacuous pass sneaks in — a single-doctor room satisfies the grouping
  // assertion trivially, which is exactly how the "three anonymous tables" bug
  // survived a green run.
  const floorsRes = await page.request.get(`${BASE}/api/display/floors`)
  const floors = (await floorsRes.json()).data || []
  let target = null
  outer: for (const f of floors) {
    const roomsRes = await page.request.get(`${BASE}/api/rooms?floorId=${f.id}`)
    for (const r of ((await roomsRes.json()).data || [])) {
      const qRes = await page.request.get(`${BASE}/api/display/queue?roomId=${r.id}`)
      const q = (await qRes.json()).data
      const withPatients = (q?.waitingGroups || []).filter((g) => g.patients.length > 0)
      if (withPatients.length > 1) { target = { room: r, groups: withPatients }; break outer }
    }
  }
  rec('DB-MULTI', 'Found a real MULTI-doctor room to test grouping against (not a vacuous pass)',
    Boolean(target), target ? `Room ${target.room.roomNumber}, ${target.groups.length} doctor queues` : 'none found via API')

  let opened = false
  if (target) {
    await page.goto(`${BASE}/display/room/${target.room.id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1600)
    opened = (await page.locator('body').innerText()).includes('UHID')
  }
  rec('DB-006', 'A room detail with real patients opens', opened)

  if (opened) {
    const body = await page.locator('body').innerText()

    // ── every queue group must name its doctor ──────────────────────────
    // Assert against the API's own group count, and match the doctor name and
    // its schedule note across the line break innerText inserts between spans.
    const expected = target.groups.length
    const drHeadings = (body.match(/Dr\.[^\n]+\n·\s*(active now|today from)/g) || []).length
    rec('DB-GRP', 'Every doctor queue in a multi-doctor room is labelled with its doctor',
      drHeadings >= expected, `API says ${expected} doctor queues; board shows ${drHeadings} doctor headings`)

    // Each doctor the API says has patients must be named on screen.
    const missing = target.groups.filter((g) => !body.includes(g.doctorName.replace(/^dr\.?\s+/i, '')))
    rec('DB-NAME', 'Each doctor with waiting patients is named on the board',
      missing.length === 0, missing.length ? `missing: ${missing.map((g) => g.doctorName).join(', ')}` : '')

    // ── no other-weekday note may appear on the board ────────────────────
    const otherDay = body.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+from\b/)
    rec('DB-DAY', 'No other-weekday schedule note (board is today-only)',
      !otherDay, otherDay ? `FOUND: "${otherDay[0]}"` : 'only "today from …" / "active now"')

    // ── doctor names must carry the Dr. title ───────────────────────────
    const bare = body.match(/^\s*(?!Dr\.)[a-z]+\s+·\s+(active now|today from)/mi)
    rec('DB-DRN', 'Doctor names render with the "Dr." title', !bare, bare ? `FOUND: "${bare[0].trim()}"` : '')

    await shot(page, 'qa-room-detail')
  }

  rec('DB-ERR', 'No console errors on the board', page._errors.length === 0, page._errors.slice(0, 3).join(' | '))
} catch (e) {
  console.error('SUITE FAILED:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${'─'.repeat(60)}\nDISPLAY BOARD: ${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('FAILURES: ' + failed.map((f) => f.id).join(', ')); process.exitCode = 1 }
