import { launch, login, gotoModule, clickByName, shot } from './helpers.js'

async function annotate(page, marks) {
  const items = []
  for (const m of marks) {
    const box = await m.locator.boundingBox()
    if (!box) continue
    items.push({ box, n: m.n, side: m.side })
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

const { browser, page } = await launch({ width: 1600, height: 1000 })
await login(page, 'admin')
await gotoModule(page, 'admin', 'settings')
await clickByName(page, 'Rooms')
await page.waitForTimeout(1000)

const row = page.locator('table tbody tr').nth(1) // a "Shared" room — more interesting than a Single one
await annotate(page, [
  // The FLOORS label itself, not a container guess — a generic <aside>
  // selector matched the app's main left NAV instead on this layout.
  { locator: page.getByText(/floors/i).first(), n: 1, side: 'right' },
  { locator: row.locator('td').nth(0), n: 2, side: 'left' },
  { locator: row.locator('td').nth(2), n: 3, side: 'left' },
  { locator: row.locator('td').nth(3), n: 4, side: 'right' },
])
console.log('saved:', await shot(page, 'doc-settings-rooms-annotated'))
await browser.close()
