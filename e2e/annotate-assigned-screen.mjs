import { launch, login, gotoModule, clickByName, shot } from './helpers.js'

async function annotate(page, marks) {
  const items = []
  for (const m of marks) {
    const box = await m.locator.boundingBox().catch(() => null)
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

const { browser, page } = await launch({ width: 1600, height: 900 })
await login(page, 'admin')
await gotoModule(page, 'admin', 'settings')
await clickByName(page, 'TV Boards')
await page.waitForTimeout(1500)

const popupPromise = page.waitForEvent('popup')
await page.locator('button[title="Open TV Board"]').first().click()
const board = await popupPromise
await board.waitForLoadState('networkidle')
await board.waitForTimeout(1500)

await annotate(board, [
  { locator: board.getByText(/GudMed|Hospital/i).first(), n: 1, side: 'right' },
  { locator: board.getByText(/ROOMS/i).first(), n: 2, side: 'right' },
  { locator: board.locator('header span').filter({ hasText: /^$/ }).first(), n: 3, side: 'left' },
  { locator: board.getByText(/Waiting/i).first(), n: 4, side: 'left' },
  { locator: board.getByText(/\d{1,2}:\d{2}/).first(), n: 5, side: 'left' },
  { locator: board.locator('[class*="rounded-xl"]').first(), n: 6, side: 'right' },
  { locator: board.getByText(/Room\s+\S+/i).first(), n: 7, side: 'right' },
  { locator: board.locator('[class*="rounded-lg"]').filter({ hasText: /^1$/ }).first(), n: 8, side: 'right' },
  { locator: board.getByText(/F\/U|NEW/i).first(), n: 9, side: 'left' },
])
console.log('saved:', await shot(board, 'doc-display-assigned-screen-annotated'))

await board.close()
await browser.close()
