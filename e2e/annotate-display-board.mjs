import { launch, shot, BASE } from './helpers.js'

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

function firstCard(page) {
  return page.locator('button').filter({ hasText: /Room\s+\S+/i }).first()
}

const { browser, page } = await launch({ width: 1600, height: 900 })

await page.goto(`${BASE}/display`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.locator('button').filter({ hasText: /Waiting/i }).first().click()
await page.waitForTimeout(1500)

const floorUrl = page.url()
const floorId = floorUrl.match(/\/display\/floor\/([^?/#]+)/)?.[1]

await annotate(page, [
  { locator: page.getByText(/Live Queue Display/i).first(), n: 1, side: 'right' },
  { locator: page.getByText(/All Floors/i).first(), n: 2, side: 'right' },
  { locator: page.getByRole('button').filter({ hasText: /Cardiology|Orthopedics|General|Medicine/i }).first(), n: 3, side: 'right' },
  { locator: firstCard(page), n: 4, side: 'left' },
  { locator: page.getByText(/Waiting/i).last(), n: 5, side: 'left' },
])
console.log('saved:', await shot(page, 'doc-display-floor-annotated'))

await page.evaluate(() => document.querySelectorAll('.gm-anno').forEach((e) => e.remove()))
await firstCard(page).click()
await page.waitForTimeout(1500)

await annotate(page, [
  { locator: page.getByText(/All Floors/i).first(), n: 1, side: 'right' },
  { locator: page.getByText(/Room\s+\S+/i).first(), n: 2, side: 'right' },
  { locator: page.getByText(/doctors in this room|Dr\./i).first(), n: 3, side: 'right' },
  { locator: page.getByText(/Waiting/i).first(), n: 4, side: 'left' },
  { locator: page.getByText(/Patient In/i).first(), n: 5, side: 'right' },
  { locator: page.getByText(/Up Next/i).first(), n: 6, side: 'left' },
  { locator: page.getByRole('button', { name: /Call next in/i }).first(), n: 7, side: 'right' },
  { locator: page.getByRole('button', { name: /Alert next/i }).first(), n: 8, side: 'right' },
])
console.log('saved:', await shot(page, 'doc-display-room-annotated'))

if (floorId) {
  await page.goto(`${BASE}/display/grid/${floorId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await annotate(page, [
    { locator: page.getByText(/1st Floor|Ground Floor|Floor/i).first(), n: 1, side: 'right' },
    { locator: page.getByText(/Waiting/i).first(), n: 2, side: 'left' },
    { locator: page.locator('[class*="rounded-xl"]').first(), n: 3, side: 'right' },
    { locator: page.getByText(/Room\s+\S+/i).first(), n: 4, side: 'right' },
    { locator: page.locator('[class*="rounded-lg"]').filter({ hasText: /^1$/ }).first(), n: 5, side: 'right' },
    { locator: page.getByText(/F\/U|NEW/i).first(), n: 6, side: 'left' },
  ])
  console.log('saved:', await shot(page, 'doc-display-grid-annotated'))
}

await browser.close()
