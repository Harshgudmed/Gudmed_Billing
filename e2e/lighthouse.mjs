// Lighthouse, run against a logged-in session.
//
// WHY IT NEEDS ITS OWN BROWSER
// Every screen in this app is behind auth. Pointing Lighthouse at
// /admin/appointments without a session scores the login redirect — a fast, empty,
// meaningless 100. So this launches its own Chromium with a debugging port open,
// logs in through the real form, and only then hands the port to Lighthouse.
//
// READ THE SCORE HONESTLY
// A localhost run has no network latency, no Render cold start and no Vercel edge
// in front of it. Performance measured here is a ceiling the deployed app will
// never reach — report it as such, or it is a lie that flatters us.
//
// ACCESSIBILITY IS THE ONE THAT TRANSFERS. It does not care where the server is,
// and it is what catches the nine icon-only buttons in Appointments that have no
// name a screen reader can read out.
import { chromium } from 'playwright'
import { ROLES, PASSWORD } from './helpers.js'

const PORT = 9333

export async function runLighthouse({ BASE, ROLE = 'admin', module: mod = '' }) {
  const lighthouse = (await import('lighthouse')).default

  const browser = await chromium.launch({
    args: [`--remote-debugging-port=${PORT}`, '--no-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.goto(`${BASE}/${ROLE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[type=email]', (ROLES[ROLE] || ROLES.admin).email)
    await page.fill('input[type=password]', PASSWORD)
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.click('button[type=submit]'),
    ])
    await page.waitForTimeout(1500)
    if (page.url().includes('/login')) throw new Error('login failed — Lighthouse would have scored the login page')

    const url = `${BASE}/${ROLE}/${mod}`
    console.log(`\n  Lighthouse · ${url}`)

    const result = await lighthouse(url, {
      port: PORT,
      output: 'json',
      logLevel: 'error',
      // Desktop: this app is used on reception counters and ward PCs, not phones.
      formFactor: 'desktop',
      screenEmulation: { mobile: false, width: 1600, height: 1000, deviceScaleFactor: 1, disabled: false },
      throttlingMethod: 'simulate',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    })

    const lhr = result.lhr
    const score = (k) => Math.round((lhr.categories[k]?.score ?? 0) * 100)
    const metric = (k) => lhr.audits[k]?.displayValue || '-'

    const out = {
      url,
      measuredOn: BASE.includes('localhost') ? 'localhost (optimistic — no network latency, no cold start)' : BASE,
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo'),
      LCP: metric('largest-contentful-paint'),
      FCP: metric('first-contentful-paint'),
      TBT: metric('total-blocking-time'),
      CLS: metric('cumulative-layout-shift'),
      speedIndex: metric('speed-index'),
      // The failures worth acting on, with how many elements each one hits.
      failing: Object.values(lhr.audits)
        .filter((a) => a.score !== null && a.score < 1 && a.details?.items?.length)
        .map((a) => ({ id: a.id, title: a.title, items: a.details.items.length, score: a.score }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 15),
    }

    console.log(`    performance ${out.performance}  ·  accessibility ${out.accessibility}  ·  ` +
                `best-practices ${out.bestPractices}  ·  seo ${out.seo}`)
    console.log(`    LCP ${out.LCP} · FCP ${out.FCP} · TBT ${out.TBT} · CLS ${out.CLS} · SpeedIndex ${out.speedIndex}`)
    console.log(`    measured on ${out.measuredOn}`)
    if (out.failing.length) {
      console.log('    failing audits:')
      for (const f of out.failing) console.log(`      ${String(Math.round(f.score * 100)).padStart(3)}  ${f.title.slice(0, 62)}  (${f.items} elements)`)
    }
    return out
  } finally {
    await browser.close()
  }
}
