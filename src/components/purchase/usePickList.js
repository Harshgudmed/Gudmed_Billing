import { useState, useEffect, useRef } from 'react'

/**
 * A short list a purchase form picks from — GST rates, states, vendors —
 * loaded when `enabled` turns on and again on reload(). A failed load keeps
 * what was there and sets `failed`, so the form can say so (<LoadFailed>): an
 * empty picker with no word read as "there is no such rate / vendor".
 *
 *   const gstRates = usePickList(purchaseApi.getGstRates)
 *   gstRates.list, gstRates.failed, gstRates.reload()
 */
export function usePickList(load, { enabled = true } = {}) {
  const [list, setList] = useState([])
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // The caller's loader may be a new arrow each render; the effect runs on
  // `enabled` and reload() only.
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    loadRef.current()
      .then((r) => { if (alive) { setList(r?.data ?? []); setFailed(false) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [enabled, attempt])
  return { list, failed, reload: () => setAttempt((n) => n + 1) }
}
