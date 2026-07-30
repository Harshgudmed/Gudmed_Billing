import { useState, useEffect, useRef, useCallback } from 'react'
import client from '@/api/client'

// The version the device reports (bump when the display app changes).
const APP_VERSION = '1.0.0'
const LS_KEY = 'gudmed_display_device_id'

// Where the device's stable identity comes from, most-trusted first:
//   1. ?deviceId=...  — injected by the Electron Display Manager, which stores
//      the id in a local file (survives browser-cache clears; see the plan).
//   2. localStorage   — fallback for a plain kiosk browser / Android box.
// Whatever the backend returns on register becomes authoritative and is cached.
function readStoredId() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('deviceId')
    if (fromUrl) return fromUrl
    return localStorage.getItem(LS_KEY) || null
  } catch { return null }
}
function cacheId(id) { try { localStorage.setItem(LS_KEY, id) } catch { /* private mode */ } }

// The monitor's own hardware path, passed through by the Display Manager (e.g.
// DISPLAY\GSM5B55\b&107a8ed1&0&UID257). Reported as this device's friendly name
// so Screen Health lists the actual panel + port instead of "Unnamed display",
// which is what makes each row identifiable — and lets anyone check the id
// really is the monitor's, not one we invented.
function readMonitorName() {
  try { return new URLSearchParams(window.location.search).get('monitor') || null } catch { return null }
}

// Registers this physical display, then keeps it alive (heartbeat) and watches
// for the admin to pair it to a screen. Returns the live pairing state.
export function useDisplayDevice() {
  const [state, setState] = useState({ ready: false, status: 'connecting', screenId: null, pairingCode: null, deviceId: null })
  const deviceIdRef = useRef(null)

  const apply = useCallback((d) => {
    if (!d) return
    deviceIdRef.current = d.deviceId
    cacheId(d.deviceId)
    setState({ ready: true, status: d.status, screenId: d.screenId || null, pairingCode: d.pairingCode || null, deviceId: d.deviceId })
  }, [])

  useEffect(() => {
    let alive = true

    async function register() {
      try {
        const res = await client.post('/display/devices/register', {
          deviceId: readStoredId(),
          appVersion: APP_VERSION,
          friendlyName: readMonitorName(),
        })
        if (alive) apply(res.data)
      } catch {
        if (alive) setState(s => ({ ...s, ready: true, status: 'connecting' }))
      }
    }
    register()

    // Poll pairing/status every 5s (this also refreshes lastSeen server-side).
    const statusTimer = setInterval(async () => {
      const id = deviceIdRef.current
      if (!id) return register()
      try {
        const res = await client.get(`/display/devices/${id}/status`)
        if (alive) apply(res.data)
      } catch (err) {
        // If the device was deleted server-side, re-register cleanly.
        if (err?.status === 404) return register()
        if (alive) setState(s => ({ ...s, status: 'connecting' }))
      }
    }, 5_000)

    // Explicit heartbeat every 15s so health stays accurate even if a poll is missed.
    const beatTimer = setInterval(() => {
      const id = deviceIdRef.current
      if (id) client.post(`/display/devices/${id}/heartbeat`, { appVersion: APP_VERSION }).catch(() => {})
    }, 15_000)

    return () => { alive = false; clearInterval(statusTimer); clearInterval(beatTimer) }
  }, [apply])

  return state
}
