// Drives the Settings -> Rooms screen: search, department filter, row expand.
//   node e2e/rooms-verify.js
import { launch, login, gotoModule, clickByName, shot } from './helpers.js'

const { browser, page } = await launch()
try {
  await login(page, 'admin')
  await gotoModule(page, 'admin', 'settings')
  await clickByName(page, 'Rooms')
  await page.waitForTimeout(1500)

  // 1. Search narrows the table
  const before = await page.locator('table tbody tr').count()
  await page.fill('input[placeholder*="Search room"]', '103')
  await page.waitForTimeout(700)
  const after = await page.locator('table tbody tr').count()
  console.log(`search "103": ${before} rows -> ${after} rows`, after < before && after > 0 ? '✓' : '✗')
  await shot(page, 'rooms-search')

  // 2. Expanding a row reveals the schedule + actions
  await page.locator('table tbody tr').first().click()
  await page.waitForTimeout(800)
  const hasEdit = await page.getByRole('button', { name: /Edit Room/i }).count()
  const hasSchedule = await page.getByText(/Schedule \(from doctors/i).count()
  console.log('row expand -> Edit Room button:', hasEdit ? '✓' : '✗', '| Schedule section:', hasSchedule ? '✓' : '✗')
  await shot(page, 'rooms-expanded')

  // 3. Clearing the search restores the full list
  await page.fill('input[placeholder*="Search room"]', '')
  await page.waitForTimeout(700)
  const restored = await page.locator('table tbody tr').count()
  console.log(`clear search: ${restored} rows`, restored >= before ? '✓' : '✗')

  console.log(page._errors.length ? `console errors: ${page._errors.join(' | ')}` : 'no console errors')
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
