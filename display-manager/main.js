// GudMed Display Manager — makes the queue boards plug-and-play. On boot it
// detects every external monitor and opens the self-pairing display page
// (/display/auto) fullscreen on each. Each window is tied to that specific
// monitor (by its OS display id), so unplugging ONE never disturbs the others.
// No URL typing, ever.
const { app, BrowserWindow, screen, globalShortcut, Tray, Menu, nativeImage } = require('electron')
const path = require('node:path')
const store = require('./deviceStore')

// display.id -> BrowserWindow. Keyed by the OS monitor id (not a running index),
// so removing one monitor only closes that one window and leaves the rest alone.
const windows = new Map()
let quitting = false
let tray = null

// The external monitors we put boards on — a laptop's built-in panel is skipped
// (boards belong on the TVs, not the operator's screen). If every display is
// internal, or GUDMED_INCLUDE_INTERNAL=1, use them all.
function targetDisplays() {
  const all = screen.getAllDisplays()
  if (process.env.GUDMED_INCLUDE_INTERNAL === '1') return all
  // The operator's OWN screen is the PRIMARY display (and/or a laptop's built-in
  // panel). Boards belong on the TVs, not on the machine running the manager.
  // `internal` alone is unreliable on Windows — it's often reported false for the
  // built-in panel — so we key off the primary display id, which Windows reports
  // correctly, and also drop anything explicitly flagged internal.
  const primaryId = screen.getPrimaryDisplay().id
  const boards = all.filter((d) => d.id !== primaryId && !d.internal)
  // Never end up with zero boards (e.g. a single-screen dev laptop): fall back
  // to every display so something still shows.
  return boards.length ? boards : all
}

function urlForDisplay(display) {
  const base = store.getConfig().baseUrl.replace(/\/$/, '')
  const deviceId = store.deviceIdForDisplay(display)
  return `${base}/display/auto?deviceId=${encodeURIComponent(deviceId)}`
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
  const deviceId = store.deviceIdForDisplay(display)
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
      markDeviceOffline(win.gudmedDeviceId) // the exact device this window used
      win.destroy()
      windows.delete(id)
    }
  }
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
  syncDisplays()
  screen.on('display-added', syncDisplays)
  screen.on('display-removed', syncDisplays)
  screen.on('display-metrics-changed', syncDisplays)

  globalShortcut.register('CommandOrControl+Shift+Q', () => { quitting = true; app.quit() })
})

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { /* signage app: stay alive, wait for monitors */ })
