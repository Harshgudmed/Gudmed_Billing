// GudMed Display Manager — makes the queue boards plug-and-play. On boot it
// detects every external monitor and opens the self-pairing display page
// (/display/auto) fullscreen on each. Each window is tied to that specific
// monitor (by its OS display id), so unplugging ONE never disturbs the others.
// No URL typing, ever.
const { app, BrowserWindow, screen, globalShortcut, Tray, Menu, nativeImage } = require('electron')
const path = require('node:path')
const store = require('./deviceStore')
const monitorIdentity = require('./monitorIdentity')

// display.id -> BrowserWindow. Keyed by the OS monitor id (not a running index),
// so removing one monitor only closes that one window and leaves the rest alone.
const windows = new Map()
let quitting = false
let tray = null

// display.id -> { key, internal } from monitorIdentity. `key` is the monitor's
// own hardware path, so a screen keeps its pairing across the position
// renumbering Windows does on every replug; `internal` is Windows' own answer
// to "is this the built-in laptop panel". Refreshed at the top of each sync; a
// display missing here just falls back to its bounds-derived id.
let monitorInfoByDisplayId = new Map()

async function refreshMonitorInfo() {
  const byPosition = await monitorIdentity.getMonitorInfoByPosition()
  const next = new Map()
  for (const d of screen.getAllDisplays()) {
    // Windows reports PHYSICAL pixel positions; Electron's `bounds` are in
    // scaled (DIP) space, so on a machine with any display scaling the two
    // disagree — which is why the TVs behind a 125%-scaled laptop failed to
    // match on bounds alone. `nativeOrigin` is Electron's physical-pixel
    // origin, i.e. the same space Windows is speaking, so try that first and
    // keep bounds as the fallback for displays that report no nativeOrigin.
    const info = (d.nativeOrigin && byPosition.get(`${d.nativeOrigin.x},${d.nativeOrigin.y}`))
      || byPosition.get(`${d.bounds.x},${d.bounds.y}`)
    if (info) next.set(d.id, info)
  }

  // Last line of defence: if two displays resolved to the SAME key, using them
  // would mirror one board onto two screens. Drop the lot and let everything
  // fall back to position-derived ids, which never collide.
  const keys = [...next.values()].map((v) => v.key)
  if (new Set(keys).size !== keys.length) {
    console.warn('[display-manager] colliding hardware keys — using position-based ids this pass')
    monitorInfoByDisplayId = new Map()
    return
  }
  monitorInfoByDisplayId = next

  for (const d of screen.getAllDisplays()) {
    const i = next.get(d.id)
    console.log(`[display-manager] display ${d.id} @ ${d.bounds.x},${d.bounds.y} -> ${i ? `${i.key}${i.internal ? ' (INTERNAL — no board)' : ''}` : 'no hardware id (position fallback)'}`)
  }
}

function hardwareKeyFor(display) {
  return monitorInfoByDisplayId.get(display.id)?.key || null
}

// The external monitors we put boards on — a laptop's built-in panel is skipped
// (boards belong on the TVs, not the operator's screen). If every display is
// internal, or GUDMED_INCLUDE_INTERNAL=1, use them all.
function targetDisplays() {
  const all = screen.getAllDisplays()
  if (process.env.GUDMED_INCLUDE_INTERNAL === '1') return all

  // Boards belong on the TVs, never on the machine running the manager.
  // Windows' own connection type (HDMI/DisplayPort vs the built-in panel) is
  // the only signal that gets this right here: Electron reports
  // `display.internal === false` for this laptop's panel, and the operator's
  // screen is not necessarily the PRIMARY one either — with a TV set as the
  // main display, filtering on "primary" left the laptop showing a board.
  // When Windows has an answer for EVERY display, trust it completely — including
  // when the answer is "none of these are TVs". Falling back to "show on
  // everything rather than nothing" here is what put a board on the laptop: at
  // boot, before the hub's screens have woken up, the laptop is briefly the only
  // display. Use GUDMED_INCLUDE_INTERNAL=1 to develop on a single-screen machine.
  const known = all.filter((d) => monitorInfoByDisplayId.has(d.id))
  if (known.length === all.length) {
    return all.filter((d) => !monitorInfoByDisplayId.get(d.id).internal)
  }

  // Fallback for when Windows couldn't be asked (or didn't cover every display):
  // skip the primary and anything Electron does flag as internal.
  const primaryId = screen.getPrimaryDisplay().id
  const boards = all.filter((d) => d.id !== primaryId && !d.internal)
  // Never end up with zero boards (e.g. a single-screen dev laptop).
  return boards.length ? boards : all
}

// Is this display one we should be showing a board on right now?
function isBoardDisplay(displayId) {
  return targetDisplays().some((d) => d.id === displayId)
}

function urlForDisplay(display) {
  const base = store.getConfig().baseUrl.replace(/\/$/, '')
  const hardwareKey = hardwareKeyFor(display)
  const deviceId = store.deviceIdForDisplay(display, hardwareKey)
  // `monitor` is reported as the device's friendly name, so Screen Health names
  // each row by the actual panel + port rather than "Unnamed display" — which
  // is both how an admin tells the rows apart and how anyone can check the id
  // really came from the monitor rather than being invented here.
  const monitor = hardwareKey ? `&monitor=${encodeURIComponent(hardwareKey)}` : ''
  return `${base}/display/auto?deviceId=${encodeURIComponent(deviceId)}${monitor}`
}

// Tell the server a screen just went away so the admin sees it offline instantly,
// instead of waiting out the ~90s heartbeat gap. Takes the EXACT deviceId the
// window was opened with — recomputing it from a removed monitor's (now empty)
// bounds produced a bogus id, so the real screen was never marked offline and
// kept showing "online" after an HDMI unplug.
function markDeviceOffline(deviceId) {
  if (!deviceId) return
  const base = store.getConfig().baseUrl.replace(/\/$/, '')
  fetch(`${base}/api/display/devices/${encodeURIComponent(deviceId)}/offline`, { method: 'POST' }).catch(() => {})
}

function openWindowForDisplay(display) {
  if (windows.has(display.id)) return
  const { x, y, width, height } = display.bounds
  const deviceId = store.deviceIdForDisplay(display, hardwareKeyFor(display))
  // Build the window NORMAL (not fullscreen) and hidden. Creating it with
  // `fullscreen:true` up front makes Windows fullscreen it on whichever monitor
  // it first appears on — usually the primary — so a 3rd/4th display got a window
  // that never actually landed on it and the screen stayed black. Instead we
  // position it on the exact target monitor, show it, THEN enter kiosk.
  const win = new BrowserWindow({
    x, y, width, height,
    show: false,
    frame: false,
    skipTaskbar: true, // signage window — keep it OFF the operator's taskbar
    autoHideMenuBar: true,
    backgroundColor: '#0b1120',
    webPreferences: { partition: `persist:dev-${deviceId}`, contextIsolation: true, nodeIntegration: false },
  })
  win.gudmedDeviceId = deviceId // remember it so removal can offline the RIGHT device

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.setBounds({ x, y, width, height }) // pin to the right monitor first
    win.show()
    win.setKiosk(true)                      // now go fullscreen ON that monitor
  })

  win.loadURL(urlForDisplay(display))

  // Retry only on a REAL load failure. Ignore ERR_ABORTED (-3): that fires on a
  // normal client-side navigation (e.g. /display/auto redirecting to the board)
  // and must NOT trigger a reload, or the board bounces in a loop.
  win.webContents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    setTimeout(() => { if (!win.isDestroyed()) win.loadURL(urlForDisplay(display)) }, 5000)
  })

  win.on('closed', () => {
    windows.delete(display.id)
    // Reopen only if this display should still be showing a board. Checking
    // merely that the monitor still EXISTS meant a window syncDisplays had just
    // deliberately closed — the laptop's, once Windows confirmed it as the
    // built-in panel — was reopened a second later, so a board could never be
    // taken off the operator's own screen.
    if (quitting || !isBoardDisplay(display.id)) return
    setTimeout(() => {
      const d = screen.getAllDisplays().find((x) => x.id === display.id)
      if (d && !windows.has(d.id) && isBoardDisplay(d.id)) openWindowForDisplay(d)
    }, 1000)
  })

  windows.set(display.id, win)
}

// Guards against overlapping runs, so a burst of monitor events can't have two
// syncs interleaving and opening/positioning windows from half-updated state.
let syncInFlight = false
let resyncQueued = false

async function syncDisplays() {
  if (syncInFlight) { resyncQueued = true; return }
  syncInFlight = true
  try {
    await refreshMonitorInfo() // resolve monitor identities before opening/closing anything
    const displays = targetDisplays()
    const liveIds = new Set(displays.map((d) => d.id))

    displays.forEach((d) => {
      const existing = windows.get(d.id)
      if (existing && !existing.isDestroyed()) {
        const b = d.bounds
        existing.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }) // follow a moved monitor
      } else {
        openWindowForDisplay(d)
      }
    })

    // Only the unplugged monitor's window closes — the others are untouched.
    for (const [id, win] of windows) {
      if (!liveIds.has(id)) {
        markDeviceOffline(win.gudmedDeviceId) // the exact device this window used
        win.destroy()
        windows.delete(id)
      }
    }
  } finally {
    syncInFlight = false
    if (resyncQueued) { resyncQueued = false; syncDisplays() }
  }
}

// A hub that brings several monitors up one at a time (e.g. a USB-C 4-port
// adapter) makes Windows fire display-added / display-metrics-changed several
// times within a second or two of each other, each carrying a different
// half-settled view of the layout. Debouncing collapses that burst into ONE
// sync, run once the layout has actually gone quiet.
let debounceTimer = null
function scheduleSyncDisplays() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(syncDisplays, 400)
}

// A discreet system-tray presence instead of a taskbar button, with a menu to
// reload/re-scan/quit (the global shortcut still quits too).
function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    tray.setToolTip('GudMed Display Manager — boards running')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'GudMed Display Manager', enabled: false },
      { type: 'separator' },
      { label: 'Reload all boards', click: () => { for (const [, w] of windows) if (!w.isDestroyed()) w.reload() } },
      { label: 'Re-scan monitors', click: () => syncDisplays() },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit() } },
    ]))
  } catch { /* tray is a nicety; Ctrl+Shift+Q still quits */ }
}

// Only ONE Display Manager may run — a second launch would open competing
// windows on the same monitors. Any extra instance quits immediately.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  store.init(app.getPath('userData'))
  app.setLoginItemSettings({ openAtLogin: true })

  createTray()
  syncDisplays() // immediate on startup — nothing to debounce yet
  screen.on('display-added', scheduleSyncDisplays)
  screen.on('display-removed', scheduleSyncDisplays)
  screen.on('display-metrics-changed', scheduleSyncDisplays)

  globalShortcut.register('CommandOrControl+Shift+Q', () => { quitting = true; app.quit() })
})

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { /* signage app: stay alive, wait for monitors */ })
