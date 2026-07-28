// Persistent local state for the Display Manager, kept in a plain JSON file in
// the OS user-data dir (NOT browser storage — survives cache clears). Holds:
//   • config.baseUrl — where the GudMed web app is (default localhost dev).
//   • slots[]        — an ORDERED list of stable deviceIds. The i-th connected
//     monitor (sorted consistently in main.js) reuses slots[i]. So the SAME set
//     of monitors always gets the SAME identities across unplug/replug/reboot —
//     no new device row each time. (The old scheme keyed by screen position,
//     which Windows changes on replug, so every replug looked like a new screen.)
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

let filePath = null
let cache = { config: { baseUrl: 'http://localhost:5173' }, slots: [] }

function init(userDataDir) {
  filePath = path.join(userDataDir, 'gudmed-display.json')
  try {
    cache = { ...cache, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) }
    cache.config = cache.config || { baseUrl: 'http://localhost:5173' }
    cache.slots = Array.isArray(cache.slots) ? cache.slots : []
  } catch { save() }
  if (process.env.GUDMED_URL) cache.config.baseUrl = process.env.GUDMED_URL
  return cache.config
}

function save() {
  try { fs.writeFileSync(filePath, JSON.stringify(cache, null, 2)) } catch { /* read-only dir */ }
}

// The permanent deviceId for the Nth screen slot — created once, reused forever.
function deviceIdForSlot(slotIndex) {
  if (!cache.slots[slotIndex]) { cache.slots[slotIndex] = crypto.randomUUID(); save() }
  return cache.slots[slotIndex]
}

module.exports = { init, deviceIdForSlot, getConfig: () => cache.config }
