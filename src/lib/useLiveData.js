import { useEffect, useRef } from 'react'
import { getSocket, getDisplayOrgId } from '@/lib/realtimeSocket'

/**
 * Keeps a staff screen current over the WebSocket the app already has.
 *
 * Every module used to carry a Refresh button because a list showed whatever it
 * loaded when the screen was opened: an order raised at the counter did not
 * appear in the lab until somebody pressed it. The server now announces each
 * successful write on this hospital's socket room (middleware/liveUpdates.js),
 * and this hook re-reads when the announcement is about ITS data.
 *
 *   useLiveData('laboratory', ordersTable.refresh)
 *   useLiveData(['pharmacy', 'billing'], reload)
 *
 * The push carries a topic and nothing else, so no patient detail crosses the
 * socket — the screen re-fetches through its own authenticated endpoint.
 *
 * Bursts are collapsed: receiving ten dispenses in a second re-reads once.
 * `fallbackMs` re-reads on a slow timer as well, so a blocked WebSocket (a
 * hospital proxy, a dropped connection) degrades to a quiet poll rather than a
 * stale screen. Pass 0 to turn that off.
 */
export function useLiveData(topics, onChange, { fallbackMs = 60000, quietMs = 400 } = {}) {
  // Kept in refs so a caller may pass an inline arrow without re-subscribing on
  // every render (the same reason useServerPagination keeps its fetch in one).
  const handler = useRef(onChange)
  handler.current = onChange
  const wanted = Array.isArray(topics) ? topics : [topics]
  const key = wanted.filter(Boolean).sort().join(',')

  useEffect(() => {
    if (!key) return
    const mine = new Set(key.split(','))
    const socket = getSocket()
    let alive = true
    let joined = null
    let timer = null

    // One re-read for a burst of writes.
    const reload = () => {
      if (!alive) return
      clearTimeout(timer)
      timer = setTimeout(() => { if (alive) handler.current?.() }, quietMs)
    }
    const onData = ({ topic } = {}) => { if (topic && mine.has(topic)) reload() }
    const join = () => { if (joined) socket.emit('display:join', { orgId: joined }) }

    getDisplayOrgId().then((orgId) => { if (!alive) return; joined = orgId; join() })
    socket.on('connect', join)          // re-join after a reconnect
    socket.on('data:changed', onData)

    const poll = fallbackMs ? setInterval(() => handler.current?.(), fallbackMs) : null

    return () => {
      alive = false
      clearTimeout(timer)
      if (poll) clearInterval(poll)
      socket.off('connect', join)
      socket.off('data:changed', onData)
    }
  }, [key, fallbackMs, quietMs])
}
