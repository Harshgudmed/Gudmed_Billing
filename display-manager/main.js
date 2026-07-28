// GudMed Display Manager — makes the queue boards plug-and-play. On boot it
// detects every external monitor and opens the self-pairing display page
// (/display/auto) fullscreen on each. Each window is tied to that specific
// monitor (by its OS display id), so unplugging ONE never disturbs the others.
// No URL typing, ever.
const { app, BrowserWindow, screen, globalShortcut } = require('electron')
const store = require('./deviceStore')

// display.id -> BrowserWindow. Keyed by the OS monitor id (not a running index),
// so removing one monitor only closes that one window and leaves the rest alone.
const windows = new Map()
let quitting = false

// The external monitors we put boards on — a laptop's built-in panel is skipped
// (boards belong on the TVs, not the operator's screen). If every display is
// internal, or GUDMED_INCLUDE_INTERNAL=1, use them all.
function targetDisplays() {
  const all = screen.getAllDisplays()
  const external = all.filter((d) => !d.internal)
  return (process.env.GUDMED_INCLUDE_INTERNAL === '1' || external.length === 0) ? all : external
}

function urlForDisplay(display) {
  const base = store.getConfig().baseUrl.replace(/\/$/, '')
  const deviceId = store.deviceIdForDisplay(display)
  return `${base}/display/auto?deviceId=${encodeURIComponent(deviceId)}`
}

// Tell the server this monitor just went away so the admin sees it offline
// instantly, instead of waiting out the ~90s heartbeat gap.
function markDisplayOffline(display) {
  const base = store.getConfig().baseUrl.replace(/\/$/, '')
  const deviceId = store.deviceIdForDisplay(display)
  fetch(`${base}/api/display/devices/${encodeURIComponent(deviceId)}/offline`, { method: 'POST' }).catch(() => {})
}

function openWindowForDisplay(display) {
  if (windows.has(display.id)) return
  const { x, y, width, height } = display.bounds
  const deviceId = store.deviceIdForDisplay(display)
  const win = new BrowserWindow({
    x, y, width, height,
    fullscreen: true,
    kiosk: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1120',
    webPreferences: { partition: `persist:dev-${deviceId}`, contextIsolation: true, nodeIntegration: false },
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
    // Reopen unless quitting or that monitor is truly gone.
    if (!quitting && screen.getAllDisplays().some((d) => d.id === display.id)) {
      setTimeout(() => { const d = screen.getAllDisplays().find((x) => x.id === display.id); if (d && !windows.has(d.id)) openWindowForDisplay(d) }, 1000)
    }
  })

  windows.set(display.id, win)
}

function syncDisplays() {
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
      const gone = screen.getAllDisplays().find((x) => x.id === id) || { id, bounds: { width: 0, height: 0, x: 0, y: 0 } }
      markDisplayOffline(gone)
      win.destroy()
      windows.delete(id)
    }
  }
}

// Only ONE Display Manager may run — a second launch would open competing
// windows on the same monitors. Any extra instance quits immediately.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  store.init(app.getPath('userData'))
  app.setLoginItemSettings({ openAtLogin: true })

  syncDisplays()
  screen.on('display-added', syncDisplays)
  screen.on('display-removed', syncDisplays)
  screen.on('display-metrics-changed', syncDisplays)

  globalShortcut.register('CommandOrControl+Shift+Q', () => { quitting = true; app.quit() })
})

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { /* signage app: stay alive, wait for monitors */ })
