// GudMed Display Manager — the desktop app that makes the queue boards truly
// plug-and-play. On boot it detects every connected monitor and opens the
// self-pairing display page (/display/auto) fullscreen on each, giving each a
// STABLE per-slot identity so plugging/unplugging the same monitors reuses the
// same devices (no new row each time). No URL typing, ever.
const { app, BrowserWindow, screen, globalShortcut } = require('electron')
const store = require('./deviceStore')

// slotIndex -> BrowserWindow. Slots are stable: the monitors sorted left-to-right
// map to slot 0, 1, 2… so the same layout always reuses the same identities.
const windows = new Map()
let quitting = false

// Deterministic ordering of the connected monitors (left-to-right, then top-down)
// so slot 0 is always the same physical screen across replugs.
function sortedDisplays() {
  return screen.getAllDisplays().slice().sort(
    (a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y)
  )
}

function urlForSlot(slotIndex) {
  const base = store.getConfig().baseUrl.replace(/\/$/, '')
  const deviceId = store.deviceIdForSlot(slotIndex)
  return `${base}/display/auto?deviceId=${encodeURIComponent(deviceId)}`
}

function openWindowForSlot(slotIndex, display) {
  if (windows.has(slotIndex)) return
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x, y, width, height,
    fullscreen: true,
    kiosk: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1120',
    // Persistent per-slot session so identity/storage never collide between screens.
    webPreferences: { partition: `persist:slot-${slotIndex}`, contextIsolation: true, nodeIntegration: false },
  })

  win.loadURL(urlForSlot(slotIndex))

  // Retry if the web app is briefly unreachable (server restart / network blip).
  win.webContents.on('did-fail-load', () => {
    setTimeout(() => { if (!win.isDestroyed()) win.loadURL(urlForSlot(slotIndex)) }, 5000)
  })

  win.on('closed', () => {
    windows.delete(slotIndex)
    // Reopen unless quitting or that slot no longer has a monitor.
    if (!quitting && sortedDisplays()[slotIndex]) {
      setTimeout(() => { const d = sortedDisplays()[slotIndex]; if (d) openWindowForSlot(slotIndex, d) }, 1000)
    }
  })

  windows.set(slotIndex, win)
}

function syncDisplays() {
  const displays = sortedDisplays()
  displays.forEach((d, i) => {
    // If a window for this slot exists but the monitor moved, reposition it.
    const existing = windows.get(i)
    if (existing && !existing.isDestroyed()) {
      const b = d.bounds
      existing.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
    } else {
      openWindowForSlot(i, d)
    }
  })
  // Close windows for slots that no longer have a monitor.
  for (const [slot, win] of windows) {
    if (slot >= displays.length) { win.destroy(); windows.delete(slot) }
  }
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'))
  app.setLoginItemSettings({ openAtLogin: true })

  syncDisplays()
  screen.on('display-added', syncDisplays)
  screen.on('display-removed', syncDisplays)
  screen.on('display-metrics-changed', syncDisplays)

  // Support escape hatch: quit the kiosk.
  globalShortcut.register('CommandOrControl+Shift+Q', () => { quitting = true; app.quit() })
})

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { /* signage app: stay alive, wait for monitors */ })
