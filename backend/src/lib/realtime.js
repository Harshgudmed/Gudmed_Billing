import { Server } from 'socket.io'

// One Socket.IO server for the whole app. Display boards connect and join a room
// per organization, so a single "refresh" signal reaches exactly that hospital's
// screens (never another tenant's) the instant its queue changes — replacing the
// every-3-seconds polling with an on-change push. Everything here is a safe no-op
// until initRealtime() runs, so importing the emit helper never crashes tests.
let io = null

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    // The display boards are public screens; the socket only carries a tiny
    // "something changed, re-fetch" ping (no data), so reflecting the origin is
    // fine and keeps it working across dev (5173) and the prod domain.
    cors: { origin: true, credentials: true },
  })

  io.on('connection', (socket) => {
    // A board announces which org (and optionally which screen) it is, so it
    // only ever receives its own hospital's updates.
    socket.on('display:join', ({ orgId, screenId } = {}) => {
      if (orgId) socket.join(`org:${orgId}`)
      if (screenId) socket.join(`screen:${screenId}`)
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
 * The payload carries no data — just the topic — so it is safe on the same
 * per-organization room the boards use.
 */
export function emitDataChanged(orgId, topic) {
  if (!io || !orgId || !topic) return
  io.to(`org:${orgId}`).emit('data:changed', { topic, at: Date.now() })
}

export const getIO = () => io
