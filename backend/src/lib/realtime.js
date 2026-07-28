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

export const getIO = () => io
