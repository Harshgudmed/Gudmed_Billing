import { io } from 'socket.io-client'
import client from '@/api/client'

// ONE shared Socket.IO connection for the whole app — every hook reuses it, so
// a screen never opens more than a single socket. In prod the backend lives on
// its own origin (VITE_API_URL minus /api); in dev we connect same-origin and
// Vite proxies /socket.io to the backend.
const backendOrigin = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
  : undefined

let socket = null
export function getSocket() {
  if (!socket) {
    const opts = { path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true }
    socket = backendOrigin ? io(backendOrigin, opts) : io(opts)
  }
  return socket
}

// The board's organization, fetched once and reused (so joining a per-org room
// is one request, not one per view). Returns null if it can't be resolved —
// callers just skip the room join and rely on the polling fallback.
let orgPromise = null
export function getDisplayOrgId() {
  if (!orgPromise) {
    orgPromise = client.get('/display/whoami').then((r) => r.organizationId).catch(() => null)
  }
  return orgPromise
}
