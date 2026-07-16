// Verifies the Pharmacy label prints on the GudMed letterhead, not raw browser
// default HTML (it used to be a bare <html><body><h1> with no CSS at all).
//
//   node e2e/pharmacy-print.test.js
import { launch, login, gotoModule, clickByName } from './helpers.js'

const { browser, page } = await launch()
try {
  await login(page, 'admin')

  // printViaIframe() writes into a hidden iframe's OWN document (a separate
  // realm), so patching the parent's Document.prototype captures nothing —
  // watch for the iframe being inserted and read it there instead. Also stub
  // its print() so no real dialog blocks the run.
  await page.addInitScript(() => {
    window.__printedHTML = null
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.tagName === 'IFRAME') {
            const grab = () => {
              try {
                const doc = node.contentDocument
                if (doc?.documentElement?.outerHTML?.length > 50) {
                  window.__printedHTML = doc.documentElement.outerHTML
                }
                if (node.contentWindow) node.contentWindow.print = () => {}
              } catch { /* cross-origin — not ours */ }
            }
            grab()
            setTimeout(grab, 100)
            setTimeout(grab, 400)
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true })
  })

  await gotoModule(page, 'admin', 'pharmacy')
  await clickByName(page, 'Prescriptions')
  await page.waitForTimeout(2000)

  const printBtns = page.locator('button[title="Print label"]')
  const n = await printBtns.count()
  console.log('print buttons found:', n)
  if (!n) throw new Error('no print buttons on the Prescriptions tab')

  await printBtns.first().click()
  await page.waitForTimeout(1600)

  const html = await page.evaluate(() => window.__printedHTML)
  if (!html) throw new Error('could not capture the printed HTML')

  const checks = [
    ['GudMed letterhead CSS present', html.includes('hosp-header') && html.includes('#1e3a5f')],
    ['hospital name block', html.includes('hosp-name')],
    ['PHARMACY LABEL banner', html.includes('PHARMACY LABEL')],
    ['patient info box', html.includes('Patient Information')],
    ['styled table header', html.includes('thead th')],
    ['footer line', html.includes('class="footer"')],
    ['doctor shown with Dr. title', !/Prescribed By/.test(html) || /Prescribed By[\s\S]{0,160}Dr\./.test(html)],
    ['NOT the old bare unstyled document', !/<body><h1>[^<]*Pharmacy Label<\/h1>/.test(html)],
  ]
  let bad = 0
  for (const [name, ok] of checks) { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${name}`) }
  console.log(`\nPHARMACY LABEL: ${checks.length - bad}/${checks.length} checks passed`)
  if (bad) process.exitCode = 1
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
