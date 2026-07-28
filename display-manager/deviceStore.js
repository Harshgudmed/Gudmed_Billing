// Persistent local state for the Display Manager, kept in a plain JSON file in
// the OS user-data dir (NOT browser storage — survives cache clears). Holds:
//   • config.baseUrl — where the GudMed web app is (default localhost dev).
//   • devices{}      — deviceId per monitor, keyed by the monitor's resolution +
//     position. For a fixed layout this is stable across reboots and replugs to
//     the same port, so a screen keeps its identity (and its pairing). Crucially
//     each monitor is independent, so unplugging one never re-labels the others.
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
  if (process.env.GUDMED_URL) cache.config.baseUrl = process.env.GUDMED_URL
  return cache.config
}

function save() {
  try { fs.writeFileSync(filePath, JSON.stringify(cache, null, 2)) } catch { /* read-only dir */ }
}

// A per-monitor key from its resolution + position — independent of the other
// monitors, so removing one never affects another's identity.
function displayKey(display) {
  const b = display.bounds
  return `${b.width}x${b.height}_${b.x}_${b.y}`
}

// The permanent deviceId for a given monitor — created once, reused forever.
function deviceIdForDisplay(display) {
  const key = displayKey(display)
  if (!cache.devices[key]) { cache.devices[key] = crypto.randomUUID(); save() }
  return cache.devices[key]
}

module.exports = { init, deviceIdForDisplay, getConfig: () => cache.config }
