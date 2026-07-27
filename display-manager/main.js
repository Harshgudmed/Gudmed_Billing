// GudMed Display Manager — the desktop app that makes the queue boards truly
// plug-and-play. On boot it detects every connected monitor and opens the
// self-pairing display page (/display/auto) fullscreen on each, passing a stable
// per-monitor device id. Plug in a new monitor → a board opens on it live. A
// window that gets closed reopens itself. No URL typing, ever.
const { app, BrowserWindow, screen, globalShortcut } = require('electron')
const store = require('./deviceStore')

// displayId -> BrowserWindow, so we can react to monitors coming and going.
const windows = new Map()
let quitting = false

function urlFor(display) {
  const base = store.getConfig().baseUrl.replace(/\/$/, '')
  const deviceId = store.deviceIdFor(display)
  return `${base}/display/auto?deviceId=${encodeURIComponent(deviceId)}`
}

function openWindowForDisplay(display) {
  if (windows.has(display.id)) return
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x, y, width, height,
    fullscreen: true,
    kiosk: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1120',
    // Each monitor gets its own persistent session so cookies/storage never
    // collide between screens; identity itself comes from deviceStore, not here.
    webPreferences: { partition: `persist:display-${store.deviceIdFor(display)}`, contextIsolation: true, nodeIntegration: false },
  })

  win.loadURL(urlFor(display))

  // If the web app is momentarily unreachable (server restart, network blip),
  // keep retrying so the board comes back on its own — no one has to touch it.
  win.webContents.on('did-fail-load', () => {
    setTimeout(() => { if (!win.isDestroyed()) win.loadURL(urlFor(display)) }, 5000)
  })

  win.on('closed', () => {
    windows.delete(display.id)
    // A board should never just vanish — reopen it unless the whole app is quitting.
    if (!quitting) {
      const still = screen.getAllDisplays().find(d => d.id === display.id)
      if (still) setTimeout(() => openWindowForDisplay(still), 1000)
    }
  })

  windows.set(display.id, win)
}

function syncDisplays() {
  const displays = screen.getAllDisplays()
  for (const d of displays) openWindowForDisplay(d)
  // Close windows whose monitor was unplugged.
  for (const [id, win] of windows) {
    if (!displays.find(d => d.id === id)) { win.destroy(); windows.delete(id) }
  }
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'))

  // Start on Windows login so the boards come up by themselves after a reboot.
  app.setLoginItemSettings({ openAtLogin: true })

  syncDisplays()

  // React live to monitors being plugged in / unplugged / rearranged.
  screen.on('display-added', syncDisplays)
  screen.on('display-removed', syncDisplays)
  screen.on('display-metrics-changed', syncDisplays)

  // An escape hatch for staff/support: this shortcut quits the kiosk.
  globalShortcut.register('CommandOrControl+Shift+Q', () => { quitting = true; app.quit() })
})

app.on('before-quit', () => { quitting = true })
// Kiosk signage app: keep running even if all windows close (a monitor unplug
// shouldn't quit the manager — it should wait for the monitor to return).
app.on('window-all-closed', () => { /* stay alive */ })
