import { launch, login, gotoModule, clickByName, shot } from './helpers.js'

async function annotate(page, marks) {
  const items = []
  for (const m of marks) {
    const box = await m.locator.boundingBox()
    if (!box) continue
    items.push({ box, n: m.n, side: m.side || 'right' })
  }

  await page.evaluate((items) => {
    document.querySelectorAll('.gm-anno').forEach((e) => e.remove())
    const layer = document.createElement('div')
    layer.className = 'gm-anno'
    Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: '99999', pointerEvents: 'none' })
    document.body.appendChild(layer)

    for (const it of items) {
      const r = it.box
      const ring = document.createElement('div')
      Object.assign(ring.style, {
        position: 'fixed', left: `${r.x - 4}px`, top: `${r.y - 4}px`,
        width: `${r.width + 8}px`, height: `${r.height + 8}px`,
        border: '3px solid #E8590C', borderRadius: '8px', boxShadow: '0 0 0 3px rgba(232,89,12,.18)',
      })
      layer.appendChild(ring)

      const onLeft = it.side === 'left'
      const badge = document.createElement('div')
      badge.textContent = String(it.n)
      Object.assign(badge.style, {
        position: 'fixed', top: `${r.y + r.height / 2 - 15}px`,
        left: onLeft ? `${r.x - 46}px` : `${r.x + r.width + 16}px`,
        width: '30px', height: '30px', borderRadius: '50%', background: '#E8590C', color: '#fff',
        font: '700 15px/30px ui-sans-serif,system-ui,sans-serif', textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,.3)',
      })
      layer.appendChild(badge)

      const line = document.createElement('div')
      Object.assign(line.style, {
        position: 'fixed', top: `${r.y + r.height / 2 - 1.5}px`,
        left: onLeft ? `${r.x - 16}px` : `${r.x + r.width + 4}px`,
        width: '14px', height: '3px', background: '#E8590C',
      })
      layer.appendChild(line)
    }
  }, items)
}

const { browser, page } = await launch({ width: 1600, height: 920 })
await login(page, 'admin')
await gotoModule(page, 'admin', 'settings')
await clickByName(page, 'TV Boards')
await page.waitForTimeout(1500)

await annotate(page, [
  { locator: page.getByRole('button', { name: /Screen Health/i }), n: 1, side: 'right' },
  { locator: page.getByRole('button', { name: /Doctor's Timetable/i }), n: 2, side: 'right' },
  { locator: page.getByRole('button', { name: /Open Floor Overview/i }), n: 3, side: 'right' },
  { locator: page.getByRole('button', { name: /Add New Screen/i }), n: 4, side: 'right' },
  { locator: page.getByText(/not assigned to any screen/i).first(), n: 5, side: 'left' },
  { locator: page.getByPlaceholder(/Search by screen name/i), n: 6, side: 'right' },
  { locator: page.getByText(/rooms covered/i).first(), n: 7, side: 'left' },
  { locator: page.locator('[class*="grid"]').filter({ hasText: /rooms/ }).first(), n: 8, side: 'left' },
])
console.log('saved:', await shot(page, 'doc-settings-tv-boards-annotated'))

await page.evaluate(() => document.querySelectorAll('.gm-anno').forEach((e) => e.remove()))
await page.getByRole('button', { name: /Add New Screen/i }).click()
await page.getByText(/Create Display Screen/i).waitFor({ timeout: 10000 })
await page.waitForTimeout(700)
await annotate(page, [
  { locator: page.getByPlaceholder(/1st Floor North Corridor/i), n: 1, side: 'right' },
  { locator: page.locator('input[type="number"]').first(), n: 2, side: 'right' },
  { locator: page.locator('input[type="range"]').first(), n: 3, side: 'right' },
  { locator: page.getByPlaceholder(/OPD Registration closes/i), n: 4, side: 'right' },
  { locator: page.getByText(/Available Rooms/i).first(), n: 5, side: 'left' },
  { locator: page.getByText(/Rooms shown on this TV/i).first(), n: 6, side: 'right' },
  { locator: page.getByRole('button', { name: /Cancel/i }), n: 7, side: 'left' },
  { locator: page.getByRole('button', { name: /Create Screen/i }), n: 8, side: 'left' },
])
console.log('saved:', await shot(page, 'doc-settings-tv-board-dialog-annotated'))
await browser.close()
