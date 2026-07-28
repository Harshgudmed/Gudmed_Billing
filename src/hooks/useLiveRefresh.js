import { useEffect } from 'react'
import { getSocket, getDisplayOrgId } from '@/lib/realtimeSocket'

// Reusable real-time refresh for the display boards. Pass your data-loading
// function (a useCallback that changes when the route params change). It runs
// once on mount AND again whenever that callback changes (e.g. you switch floor
// or department tab) — exactly like the old `useEffect(() => { load() }, [load])`
// — then also re-runs every time the server pushes a `display:refresh`, so the
// board updates the instant the queue changes instead of every 3 seconds.
// A slow polling fallback keeps the screen fresh if the socket can't connect.
//
// One hook, used by every board view — no per-view socket/poll code (DRY).
export function useLiveRefresh(onRefresh, { fallbackMs = 30000 } = {}) {
  useEffect(() => {
    let alive = true
    let joinedOrg = null
    const socket = getSocket()
    const fire = () => { if (alive) onRefresh?.() }
    const join = () => { if (joinedOrg) socket.emit('display:join', { orgId: joinedOrg }) }

    getDisplayOrgId().then((orgId) => { if (!alive) return; joinedOrg = orgId; join() })
    socket.on('connect', join)          // re-join after a reconnect
    socket.on('display:refresh', fire)  // live push

    fire()                                       // initial load (and on every param change)
    const timer = setInterval(fire, fallbackMs)  // fallback if the socket is down

    return () => {
      alive = false
      socket.off('connect', join)
      socket.off('display:refresh', fire)
      clearInterval(timer)
    }
  }, [onRefresh, fallbackMs]) // depend on the load callback so param changes re-load, like before
}
