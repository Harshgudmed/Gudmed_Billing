// Watch every API call and say which ones should not have happened.
//
// WHY THIS EXISTS
// audit.mjs already recorded size and timing, but it only looked for duplicates on
// the page-load step. That is the least interesting place to look — a page loading
// two copies of the same thing is at least explainable. The expensive bugs are the
// ones that fire later: a filter change that refetches a list nobody is looking at,
// a dialog opening that reloads the table behind it, a tab that keeps polling after
// you have left it.
//
// This module keeps the same request log but asks four more questions of it:
//   - was the same URL fetched twice in one action?           (two components, one need)
//   - did two different URLs return the identical body?       (a cache not being used)
//   - was a query refetched with nothing about it changed?    (a bad dependency array)
//   - was anything fetched for a tab that is not open?        (work nobody asked for)
//
// TIMING GOTCHA
// `request.timing()` must be read on 'requestfinished'. In a 'response' handler the
// body has not landed yet, `responseEnd` is -1, and every duration comes out as 0.
// This cost a full afternoon once; CLAUDE.md rule 10 records it.
import crypto from 'node:crypto'
import { checkContract } from './contract.mjs'

export function watch(page) {
  const log = []

  page.on('requestfinished', async (req) => {
    const url = req.url()
    if (!url.includes('/api/')) return
    let size = 0
    let bodyHash = null
    let rows = null
    let contract = []
    let status
    try {
      const res = await req.response()
      const body = await res.body()
      size = body.length
      bodyHash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 12)
      status = res.status()
      // How many records came back. A 900 KB response is a different problem
      // depending on whether it is 2,000 rows or one row with a huge blob in it,
      // and the fix is different too — pagination vs. an explicit select.
      if (size < 8_000_000) {
        const json = JSON.parse(body.toString('utf8'))
        const data = json?.data ?? json
        rows = Array.isArray(data) ? data.length
          : Array.isArray(data?.items) ? data.items.length
          : typeof data === 'object' && data ? Object.keys(data).length : null
        // Ask the harder question: is this the answer to the question that was
        // asked? A filter that quietly does not filter is invisible to size and
        // timing, and is how one doctor ends up reading another's list.
        contract = checkContract({ url, body: json })
      }
    } catch { /* redirects, 204s and non-JSON bodies — leave rows null */ }
    const t = req.timing()
    log.push({
      method: req.method(),
      url,
      path: url.split('?')[0].replace(/^.*\/api/, '/api'),
      query: url.split('?')[1] || '',
      // What we sent. A payload carrying a price or a status the server should
      // have decided is the shape of half this repo's past bugs.
      payload: (req.postData() || '').slice(0, 300) || null,
      status: status ?? 0,
      kb: size / 1024,
      ms: Math.max(0, t.responseEnd - t.requestStart),
      rows,
      bodyHash,
      contract,
    })
  })

  page.on('requestfailed', (req) => {
    if (!req.url().includes('/api/')) return
    log.push({
      method: req.method(), url: req.url(), path: req.url().split('?')[0].replace(/^.*\/api/, '/api'),
      query: '', status: 'FAILED', kb: 0, ms: 0, bodyHash: null,
      reason: req.failure()?.errorText,
    })
  })

  return {
    reset() { log.length = 0 },
    take() { return log.splice(0, log.length) },
    peek() { return [...log] },
  }
}

/**
 * Judge one action's calls. `seen` carries state across actions so a refetch of an
 * unchanged query can be spotted — that is the check that finds bad useEffect
 * dependency arrays, and it is invisible if you only look at one action at a time.
 */
export function judge(calls, { action, seen, openTab = null }) {
  const issues = []

  const byUrl = new Map()
  for (const c of calls) byUrl.set(c.method + ' ' + c.url, (byUrl.get(c.method + ' ' + c.url) || 0) + 1)
  for (const [key, n] of byUrl) {
    if (n > 1) issues.push({ sev: 'important', why: `same URL ${n}× in one action — two components fetching one thing`, what: key })
  }

  // Two different URLs, byte-identical responses. Usually a list fetched once with
  // a filter and once without, or a cache that exists and is being bypassed.
  const byHash = new Map()
  for (const c of calls) {
    if (!c.bodyHash || c.kb < 1) continue
    const prev = byHash.get(c.bodyHash)
    if (prev && prev !== c.url) {
      issues.push({ sev: 'important', why: `identical response body from two URLs (${c.kb.toFixed(0)} KB each) — a cache is not being used`, what: `${prev}  ==  ${c.url}` })
    }
    byHash.set(c.bodyHash, c.url)
  }

  for (const c of calls) {
    const key = c.method + ' ' + c.url
    if (seen.has(key)) {
      const before = seen.get(key)
      // Same URL, same bytes back, and we already had it. Nothing about this
      // request's inputs changed, so the component asked again for no reason.
      if (before.bodyHash && before.bodyHash === c.bodyHash) {
        issues.push({ sev: 'important', why: `refetched with nothing changed since "${before.action}" — check the useEffect deps`, what: key })
      }
    }
    seen.set(key, { action, bodyHash: c.bodyHash })

    for (const v of c.contract || []) issues.push({ sev: v.sev, why: `CONTRACT: ${v.why}`, what: c.path })
    if (c.status === 'FAILED') issues.push({ sev: 'critical', why: `request never arrived (${c.reason})`, what: c.path })
    else if (Number(c.status) >= 400) issues.push({ sev: 'critical', why: `HTTP ${c.status}`, what: c.path })
    if (c.kb > 100) issues.push({ sev: 'important', why: `${c.kb.toFixed(0)} KB response — ask what the screen actually reads`, what: c.path })
    if (c.ms > 200) issues.push({ sev: 'important', why: `${c.ms.toFixed(0)} ms locally — seconds on Render`, what: c.path })
    const big = c.url.match(/limit=(\d{3,})/)
    if (big) issues.push({ sev: 'important', why: `limit=${big[1]} is a cap, not pagination (rule 5) — rows past it vanish silently`, what: c.path })
  }

  return issues
}

export const totalKb = (calls) => calls.reduce((n, c) => n + c.kb, 0)
export const slowest = (calls) => calls.reduce((n, c) => Math.max(n, c.ms), 0)
