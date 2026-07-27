// Persistent local state for the Display Manager, kept in a plain JSON file in
// the OS user-data dir (NOT browser storage — survives cache clears, one of the
// review's key points). Two things live here:
//   • config.baseUrl — where the GudMed web app is (default localhost dev).
//   • devices[displayKey] — a stable deviceId per physical monitor, so a screen
//     keeps its identity (and its pairing) across reboots and cable reconnects.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

let filePath = null
let cache = { config: { baseUrl: 'http://localhost:5173' }, devices: {} }

function init(userDataDir) {
  filePath = path.join(userDataDir, 'gudmed-display.json')
  try {
    cache = { ...cache, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) }
    cache.config = cache.config || { baseUrl: 'http://localhost:5173' }
    cache.devices = cache.devices || {}
  } catch { save() }
  // Env override wins (handy for pointing a fleet at production without editing files).
  if (process.env.GUDMED_URL) cache.config.baseUrl = process.env.GUDMED_URL
  return cache.config
}

function save() {
  try { fs.writeFileSync(filePath, JSON.stringify(cache, null, 2)) } catch { /* read-only dir */ }
}

// A stable key for a monitor: its resolution + position. Survives reboots for a
// fixed layout; if Windows reorders monitors the worst case is a one-time re-pair.
function displayKey(display) {
  const b = display.bounds
  return `${b.width}x${b.height}_${b.x}_${b.y}`
}

// The permanent deviceId for a given monitor — created once, then reused forever.
function deviceIdFor(display) {
  const key = displayKey(display)
  if (!cache.devices[key]) { cache.devices[key] = crypto.randomUUID(); save() }
  return cache.devices[key]
}

module.exports = { init, deviceIdFor, getConfig: () => cache.config }
