// Asks Windows, in one query, for every screen's POSITION, its hardware device
// path, and whether it is the machine's own built-in panel. Two things depend
// on this:
//
//   1. IDENTITY — the device path (e.g. DISPLAY\GSM5B55\b&107a8ed1&0&UID257)
//      encodes the panel plus the adapter port it answered on, so a TV keeps
//      its pairing across the position renumbering Windows performs whenever
//      another screen is plugged in or removed. Note it stays distinct for two
//      IDENTICAL TVs: their EDID serials collided (both reported 16843009),
//      which is exactly what made one board mirror onto two screens; the port
//      component is what tells them apart.
//
//   2. WHICH SCREENS GET BOARDS — VideoOutputTechnology says outright whether a
//      screen is HDMI/DisplayPort or the internal laptop panel. Electron's
//      `display.internal` reports false for that panel on this hardware, and
//      the operator's screen is not necessarily the primary one, so neither
//      signal alone kept boards off the laptop. Windows' own answer does.
//
// Position is the join key back to Electron's displays: both describe the same
// desktop at the same instant and no two monitors can share a position. An
// earlier version joined the two lists by ORDER instead (1st↔1st, 2nd↔2nd); on
// a multi-port USB-C hub the orders disagreed, so two screens ended up sharing
// one identity while a third was orphaned. Never join these lists by index.
//
// Every failure degrades to an empty result, and the caller falls back to
// position-derived ids. This module never throws.
//
// Async (execFile): a hub brings its screens up one at a time, firing several
// display events in quick succession — a blocking query on each would freeze
// the app while windows are still being placed.
const { execFile } = require('node:child_process')

// EnumDisplayDevices(adapter, 0, …, EDD_GET_DEVICE_INTERFACE_NAME=1) turns a
// plain "\\.\DISPLAY1" adapter output into the monitor's device path;
// WmiMonitorConnectionParams then says how that monitor is wired. Both are
// keyed by the same normalised path, so they join cleanly.
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;using System.Runtime.InteropServices;
public class GudMedDisplay {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
 public struct DISPLAY_DEVICE{public int cb;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]public string DeviceName;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)]public string DeviceString;public int StateFlags;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)]public string DeviceID;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)]public string DeviceKey;}
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]
 public static extern bool EnumDisplayDevices(string dev,uint num,ref DISPLAY_DEVICE dd,uint flags);
}
"@
$conn = @{}
Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorConnectionParams | ForEach-Object {
  $conn[($_.InstanceName -replace '_\\d+$','')] = [int64]$_.VideoOutputTechnology
}
@([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  $s = $_
  $d = New-Object GudMedDisplay+DISPLAY_DEVICE
  $d.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($d)
  [void][GudMedDisplay]::EnumDisplayDevices($s.DeviceName, 0, [ref]$d, 1)
  $n = (($d.DeviceID -replace '^\\\\\\\\[?.]\\\\','') -replace '#\\{.*$','') -replace '#','\\'
  $t = $conn[$n]
  [PSCustomObject]@{
    X = $s.Bounds.X; Y = $s.Bounds.Y; W = $s.Bounds.Width; H = $s.Bounds.Height
    Id = $n
    Internal = ($t -eq 2147483648 -or $t -eq -2147483648)
  }
}) | ConvertTo-Json -Compress
`

function runQuery() {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err)
        const out = String(stdout).trim()
        if (!out) return resolve([])
        try {
          const parsed = JSON.parse(out)
          resolve(Array.isArray(parsed) ? parsed : [parsed])
        } catch (parseErr) { reject(parseErr) }
      }
    )
  })
}

// Map<"x,y", { key, internal }>. Returns an EMPTY map (never null) on any
// problem, which the caller reads as "no hardware info — fall back".
async function getMonitorInfoByPosition() {
  const byPosition = new Map()
  let rows
  try {
    rows = await runQuery()
  } catch (err) {
    console.warn('[monitorIdentity] display query failed, using position-based ids:', err.message)
    return byPosition
  }

  const seen = new Set()
  for (const r of rows) {
    const key = r && r.Id ? String(r.Id).trim() : ''
    if (!key) continue // no usable device path — this screen falls back on its own
    // Two monitors reporting the SAME device path can't be told apart, and
    // handing both one identity is the duplicate-board bug this exists to
    // prevent. Discard the whole pass rather than risk it.
    if (seen.has(key)) {
      console.warn(`[monitorIdentity] duplicate device path ${key} — using position-based ids this pass`)
      return new Map()
    }
    seen.add(key)
    byPosition.set(`${r.X},${r.Y}`, { key, internal: !!r.Internal })
  }
  return byPosition
}

module.exports = { getMonitorInfoByPosition }
