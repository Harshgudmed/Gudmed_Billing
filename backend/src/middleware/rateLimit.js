/**
 * A small fixed-window rate limiter, for the routes that are reachable without
 * a login.
 *
 * WHY THIS EXISTS
 * Everything behind `authenticate` is already bounded by who can log in. The
 * handful of routes mounted ABOVE it are not: the partner appointment feed
 * answers anyone holding a static key, over the public internet. Without a
 * ceiling, a key that leaks is not a leak of one doctor's list — it is an
 * unthrottled export of every doctor's patients, names and phone numbers, at
 * whatever rate the network allows, until somebody notices and rotates it.
 *
 * A limiter does not stop a determined attacker who has the key. It turns a
 * silent bulk extraction into something slow and loud enough to be caught,
 * which is the realistic goal.
 *
 * WHY NOT express-rate-limit
 * One endpoint needs this, the behaviour is thirty lines, and the dependency
 * would ship into production for that. This file follows the same shape as the
 * other helpers here (counters.js, dates.js): written once, commented, reused.
 *
 * WHAT THIS IS NOT
 * The counter lives in this process's memory. Two instances mean two counters,
 * so a service scaled horizontally allows the limit per instance rather than in
 * total. That is a real limitation and worth knowing before relying on it as a
 * hard cap — it is a brake, not a lock. The lock is the key, plus the optional
 * IP allow-list.
 */

// A client that stops calling would otherwise sit in the Map forever, so
// expired entries are swept — cheaply, and not on every request.
const SWEEP_EVERY_MS = 5 * 60_000

/**
 * @param {object}    options
 * @param {number}    options.limit     requests allowed per window
 * @param {number}    options.windowMs  window length in milliseconds
 * @param {string}    options.message   the `message` a refusal carries
 * @param {function}  options.keyBy     req -> the string to count against.
 *                                      Defaults to the caller's address.
 *
 * Refusals answer in the SAME envelope the route itself uses —
 * `{ status, message, body: {} }` — because the caller is a partner backend
 * parsing one shape. A limiter that answers in a different shape turns a
 * throttle into a parse error on their side.
 */
export function rateLimit({ limit, windowMs, message = 'Too many requests', keyBy } = {}) {
  // One bucket store PER LIMITER, not one for the module. Sharing it would mean
  // two routes counting into the same total, so calls to one would refuse the
  // other — which is exactly what the test caught when this Map was module-level.
  const buckets = new Map()
  let lastSweep = Date.now()

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now()

    if (now - lastSweep >= SWEEP_EVERY_MS) {
      lastSweep = now
      for (const [k, e] of buckets) {
        if (now - e.start >= windowMs) buckets.delete(k)
      }
    }

    // WHY THIS IS NOT ALWAYS req.ip. It was, and on production it barely
    // counted: 150 requests in five seconds drew three refusals instead of
    // ninety. Behind Render's load balancer the address Express resolves varies
    // between edge nodes, so nearly every request opened its own bucket and no
    // bucket ever filled. A limiter keyed on something that changes per request
    // is not a limiter.
    //
    // `keyBy` lets the caller count against something stable — for the partner
    // feed, the credential itself, which is both constant across a partner's
    // requests and the thing actually at risk. IP remains the default for
    // routes that have nothing better.
    const key = keyBy ? keyBy(req) : req.ip
    if (!key) return next()

    const entry = buckets.get(key)
    if (!entry || now - entry.start >= windowMs) {
      buckets.set(key, { start: now, count: 1 })
      return next()
    }

    entry.count += 1
    if (entry.count <= limit) return next()

    // Seconds until this window ends, so a well-behaved caller can wait exactly
    // as long as it needs to rather than guessing.
    const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000)
    res.set('Retry-After', String(retryAfter))
    return res.status(429).json({ status: 429, message, body: {} })
  }
}
