@echo off
REM ============================================================
REM  GudMed — open the queue display fullscreen (no typing).
REM  Double-click this file, OR put a shortcut to it in:
REM     Win+R  ->  shell:startup   (so it runs at PC boot)
REM  To EXIT fullscreen kiosk: press  Alt + F4.
REM
REM  URL: pass it as an argument for a real hospital, e.g.
REM     open-display-screen.bat https://app.gudmed.in
REM  Left blank it falls back to the local dev server, which is
REM  only ever right on a developer's own machine.
REM  For a SECOND monitor, add:  --window-position=1920,0
REM ============================================================

set BASE=%~1
if "%BASE%"=="" set BASE=http://localhost:5173
set URL=%BASE%/display/auto

REM Use a separate profile so each screen keeps its own device identity.
set PROFILE=%LOCALAPPDATA%\GudMedDisplay\screen1

REM --autoplay-policy: a wall TV has nobody to click it, and Chrome refuses to
REM play audio until a page has had a user gesture. Without this the spoken
REM queue announcements run, report no error, and make no sound — which is the
REM hardest way for this to fail, because everything else looks correct.
set FLAGS=--user-data-dir="%PROFILE%" --kiosk --autoplay-policy=no-user-gesture-required

start "" chrome.exe %FLAGS% --new-window "%URL%"
if errorlevel 1 (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" %FLAGS% --new-window "%URL%"
)
if errorlevel 1 (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" %FLAGS% --new-window "%URL%"
)
if errorlevel 1 (
  REM Fallback: Microsoft Edge (kiosk)
  start "" msedge.exe --user-data-dir="%PROFILE%" --kiosk --autoplay-policy=no-user-gesture-required "%URL%" --edge-kiosk-type=fullscreen
)
