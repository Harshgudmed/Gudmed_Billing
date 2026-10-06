import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config/security.js'
import { isAuthEnforced } from '../middleware/auth.js'

// One Socket.IO server for the whole app. Display boards connect and join a room
// per organization, so a single "refresh" signal reaches exactly that hospital's
// screens (never another tenant's) the instant its queue changes — replacing the
// every-3-seconds polling with an on-change push. Everything here is a safe no-op
// until initRealtime() runs, so importing the emit helper never crashes tests.
//
// Two kinds of room:
//   org:<id>    display boards — they say which hospital they are; they only
//               ever hear "the queue changed, re-read it" (display:refresh)
//   staff:<id>  signed-in staff screens — the hospital is taken from the login
//               token, never from what the browser says; they hear which
//               module's data changed and that the bell has news (data:changed)
// Neither push carries data: each screen re-reads through its own login.
let io = null

/** The login token a staff socket presented: in the handshake, or the session cookie. */
function tokenOf(socket, given) {
  if (given) return given
  if (socket.handshake.auth?.token) return socket.handshake.auth.token
  const cookie = socket.handshake.headers?.cookie || ''
  const m = /(?:^|;\s*)token=([^;]+)/.exec(cookie)
  return m ? decodeURIComponent(m[1]) : null
}

/** The hospital of a valid staff login, or null. */
function staffOrg(token) {
  if (!token) return null
  try {
    const d = jwt.verify(token, JWT_SECRET)
    return d.role === 'patient' ? null : d.organizationId || null
  } catch {
    return null
  }
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    // The display boards are public screens; the socket only carries a tiny
    // "something changed, re-fetch" ping (no data), so reflecting the origin is
    // fine and keeps it working across dev (5173) and the prod domain.
    cors: { origin: true, credentials: true },
  })

  io.on('connection', (socket) => {
    const joinStaff = (token) => {
      const org = staffOrg(tokenOf(socket, token))
      if (org) socket.join(`staff:${org}`)
    }
    joinStaff()
    // A screen that signed in after its socket opened says so.
    socket.on('staff:join', ({ token } = {}) => joinStaff(token))

    // A board announces which org (and optionally which screen) it is, so it
    // only ever receives its own hospital's updates.
    socket.on('display:join', ({ orgId, screenId } = {}) => {
      if (orgId) socket.join(`org:${orgId}`)
      if (screenId) socket.join(`screen:${screenId}`)
      // With login switched off (the demo) there are no tokens: the staff
      // screens of that one hospital are joined by what they say.
      if (orgId && !isAuthEnforced()) socket.join(`staff:${orgId}`)
    })
  })

  return io
}

// THE reusable emit — call this wherever the queue changes (call-next, add to
// queue, status change, check-in…). It pushes a lightweight refresh to the org's
// boards; each board then re-fetches its own scoped data through the existing
// endpoint. Optionally target a single screen. No-op if realtime isn't up.
export function emitDisplayRefresh(orgId, screenId = null) {
  if (!io || !orgId) return
  const payload = { at: Date.now() }
  if (screenId) io.to(`screen:${screenId}`).emit('display:refresh', payload)
  else io.to(`org:${orgId}`).emit('display:refresh', payload)
}

/**
 * "Something in <topic> changed in this hospital — re-read it."
 *
 * The staff screens used to sit on whatever they loaded when they were opened,
 * which is why nearly every module carried a Refresh button: a lab order raised
 * at the counter did not appear on the lab's own screen until somebody pressed
 * it. This is the same push the display boards already use, with a topic so a
 * screen only re-reads when ITS data moved (see middleware/liveUpdates.js, which
 * fires it after every successful write, and the client's useLiveData).
 *
 * Only signed-in staff of this hospital hear it (the staff:<id> room, joined
 * from the login token). The payload carries no data — just the topic.
 */
export function emitDataChanged(orgId, topic) {
  if (!io || !orgId || !topic) return
  io.to(`staff:${orgId}`).emit('data:changed', { topic, at: Date.now() })
}

export const getIO = () => io
