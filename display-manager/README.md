# GudMed Display Manager

A tiny desktop app that makes the waiting-room queue boards **plug-and-play**.

On boot it detects every connected monitor and opens the GudMed display page
(`/display/auto`) **fullscreen** on each one, with a stable per-monitor identity.
Plug in a new screen → a board opens on it. Close a board → it reopens itself.
**No URL typing, ever.**

## How it works

```
PC on → Display Manager starts (Windows login)
      → detects all monitors
      → opens /display/auto fullscreen on each (stable deviceId per monitor)
      → each screen shows a pairing code the first time
      → admin assigns it once in Settings → TV Boards → Screen Health
      → board shows automatically, and remembers forever
```

The monitor identity + the web app URL live in a plain JSON file in the OS
user-data folder (not browser storage — survives cache clears):
`%APPDATA%\GudMed Display Manager\gudmed-display.json`.

## Run it (development)

```bash
cd display-manager
npm install
npm start                 # opens boards using http://localhost:5173 by default
```

Point it at another server (e.g. production) without editing files:

```bash
set GUDMED_URL=https://app.gudmed.in   &&  npm start      # Windows cmd
```

…or edit `baseUrl` in the JSON config file after the first run.

## Build the installer (.exe)

```bash
cd display-manager
npm install
npm run build             # produces dist/GudMed Display Manager Setup x.y.z.exe
```

Install that `.exe` on each display PC. It auto-starts on login (toggle in
`app.setLoginItemSettings`), so after a reboot the boards come up by themselves.

## Controls

- **Exit kiosk / quit:** `Ctrl + Shift + Q`
- **Change which screen a monitor shows:** it's done in the web admin
  (Settings → TV Boards → Screen Health → Assign) — never on the TV itself.

## Notes

- Each monitor is keyed by its resolution + position. For a fixed layout this is
  stable across reboots. If Windows reorders monitors, the worst case is a
  one-time re-pair of the affected screen.
- Health (online / offline) is reported by the display page itself via heartbeat,
  visible in Screen Health. A future upgrade can switch this to WebSocket for
  ~3-second offline detection instead of ~45s.
