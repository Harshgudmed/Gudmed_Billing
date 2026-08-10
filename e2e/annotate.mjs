// Annotated screenshots for the user manual: numbered markers + arrows drawn
// ON the real page, then captured. Because the callouts are anchored to live
// selectors rather than drawn by hand in an image editor, re-running this after
// a UI change regenerates every figure correctly instead of leaving the docs
// showing last month's screen.
//
//   node e2e/annotate.mjs
import { launch, login, gotoModule, shot } from './helpers.js'

/**
 * Draw numbered callouts over elements.
 * Locators (Playwright's `:has-text()`, `getByRole`, etc.) are resolved to
 * plain pixel rects FIRST — the browser's own `document.querySelector` inside
 * page.evaluate has no idea what `:has-text()` means, so the drawing step only
 * ever receives numbers, never selector strings.
 * @param marks [{ locator, n, side }] — side: 'left' | 'right'
 */
async function annotate(page, marks) {
  const items = []
  for (const m of marks) {
    const box = await m.locator.boundingBox()
    if (!box) continue // element not found/visible — skip its callout, don't crash the run
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

      // Highlight ring around the target
      const ring = document.createElement('div')
      Object.assign(ring.style, {
        position: 'fixed', left: `${r.x - 4}px`, top: `${r.y - 4}px`,
        width: `${r.width + 8}px`, height: `${r.height + 8}px`,
        border: '3px solid #E8590C', borderRadius: '8px', boxShadow: '0 0 0 3px rgba(232,89,12,.18)',
      })
      layer.appendChild(ring)

      // Numbered badge
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

      // Connector line from badge to the ring
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
await gotoModule(page, 'admin', 'queue')
await page.waitForTimeout(1500)

const row = page.locator('table tbody tr').nth(2) // 3rd row — one still "waiting", so every action button is visible
await annotate(page, [
  { locator: row.locator('td').nth(5), n: 1, side: 'left' },                          // Priority cell
  { locator: row.getByRole('button', { name: 'Call in' }), n: 2, side: 'right' },
  { locator: row.getByRole('button', { name: 'Alert next' }), n: 3, side: 'right' },
  { locator: row.getByRole('button', { name: 'Complete' }), n: 4, side: 'right' },
])
console.log('saved:', await shot(page, 'doc-queue-annotated'))
await browser.close()
