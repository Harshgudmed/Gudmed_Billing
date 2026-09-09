// The brake on the partner feed.
//
// Driven over real HTTP against the real Express app, because the thing most
// likely to be wrong is where the middleware sits: a limiter mounted after the
// controller counts requests it has already answered, which is no limiter at
// all.
//
// Run: node --test --test-force-exit src/lib/__tests__/rateLimit.test.js
import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { rateLimit } from '../../middleware/rateLimit.js'

const stamp = `RATELIMIT-${Date.now()}`

let server, baseUrl, handlerCalls

before(async () => {
  handlerCalls = 0

  const app = express()
  app.set('trust proxy', 1)
  // A window long enough that the test never races it, and a limit small
  // enough to reach in a few calls.
  app.get('/limited', rateLimit({ limit: 3, windowMs: 60_000, message: 'Too many requests — slow down' }),
    (_req, res) => { handlerCalls += 1; res.json({ ok: true }) })
  // A second route with a window short enough to watch it reset.
  app.get('/short', rateLimit({ limit: 1, windowMs: 300 }), (_req, res) => res.json({ ok: true }))

  await new Promise((resolve) => { server = app.listen(0, resolve) })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => { await new Promise((r) => server.close(r)) })

const get = (path) => fetch(`${baseUrl}${path}`)

describe(`the partner rate limiter (${stamp})`, () => {
  test('requests inside the limit are served', async () => {
    const codes = []
    for (let i = 0; i < 3; i++) codes.push((await get('/limited')).status)
    assert.deepEqual(codes, [200, 200, 200])
  })

  test('the request past the limit is refused with 429', async () => {
    const res = await get('/limited')
    assert.equal(res.status, 429)
  })

  // A limiter that runs after the handler has already answered protects
  // nothing — the database work is done by the time it counts.
  test('a refused request never reaches the handler', async () => {
    const before = handlerCalls
    await get('/limited')
    assert.equal(handlerCalls, before, 'the handler ran despite being over the limit')
  })

  // The partner backend parses one envelope. A refusal in a different shape
  // turns a throttle into a parse error on their side.
  test('a refusal carries the same envelope the feed uses', async () => {
    const res = await get('/limited')
    const body = await res.json()
    assert.deepEqual(Object.keys(body).sort(), ['body', 'message', 'status'])
    assert.equal(body.status, 429)
    assert.deepEqual(body.body, {}, 'a refusal must carry no data')
    assert.match(body.message, /too many/i)
  })

  test('Retry-After says how long to wait', async () => {
    const res = await get('/limited')
    const header = res.headers.get('retry-after')
    assert.ok(header, 'Retry-After is missing, so a caller can only guess')
    const seconds = Number(header)
    assert.ok(seconds > 0 && seconds <= 60, `expected 1-60 seconds, got ${header}`)
  })

  test('the window resets, and the caller is served again', async () => {
    assert.equal((await get('/short')).status, 200, 'first is inside the limit')
    assert.equal((await get('/short')).status, 429, 'second is over it')
    await new Promise((r) => setTimeout(r, 400)) // outlast the 300ms window
    assert.equal((await get('/short')).status, 200, 'a new window serves again')
  })
})
