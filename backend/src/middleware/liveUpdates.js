import { getOrgId } from '../lib/reqContext.js'
import { emitDataChanged } from '../lib/realtime.js'

/**
 * Tells this hospital's open screens that something changed, so they re-read it
 * themselves instead of waiting for somebody to press Refresh.
 *
 * ONE place, not a line in every controller: any successful write (POST / PATCH
 * / PUT / DELETE) pushes the topic taken from the URL, so a module gets live
 * updates the moment its routes are mounted — including modules added later.
 * Reads are ignored, and so are failures: nothing changed, nothing to announce.
 *
 * The push carries the topic only — never data — and goes to this organization's
 * room alone (lib/realtime.js), so no patient detail crosses the socket and no
 * hospital can see another's traffic. Each screen then re-fetches through its
 * normal, authenticated, org-scoped endpoint.
 */
export function liveUpdates(req, res, next) {
  const method = req.method
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next()

  res.on('finish', () => {
    if (res.statusCode >= 400) return
    // '/api/laboratory/…' → 'laboratory'. baseUrl is the mount path, which is
    // exactly the module, so a controller never has to name itself.
    const topic = String(req.baseUrl || req.originalUrl || '')
      .replace(/^\/api\/?/, '')
      .split('/')
      .filter(Boolean)[0]
    if (!topic) return
    try {
      emitDataChanged(getOrgId(req), topic)
    } catch {
      // A push is a convenience: never let it break a write that already
      // succeeded, or a request made without an organization (imports, webhooks).
    }
  })

  next()
}
