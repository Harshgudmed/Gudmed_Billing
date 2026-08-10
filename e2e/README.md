# e2e — browser checks

Reusable Playwright helpers so a quick "show me this screen" or "does this still
work" check never needs a throwaway script again.

## Setup (once)

```bash
npm i -D playwright
npx playwright install chromium
```

The app must be running (`npm run dev:all`).

## Screenshot any screen

```bash
node e2e/shot.js settings --tab=Rooms
node e2e/shot.js doctor-accountability --tab="Doctor's Timetable"
node e2e/shot.js queue --role=receptionist --full
node e2e/shot.js "" --name=admin-home
```

Flags: `--role=` (admin|doctor|receptionist, default admin) · `--tab=` (clicks a
tab/button by name) · `--name=` (output filename) · `--full` (full page) ·
`--wait=ms`. Output lands in `e2e/shots/`. Console errors are printed too.

## Smoke test every role + module

```bash
node e2e/smoke.js          # exits 1 if any module blanks or logs a console error
```

## Writing a new check

Import the helpers — don't re-solve login:

```js
const { launch, login, gotoModule, clickByName, shot } = require('./helpers')

const { browser, page } = await launch()
await login(page, 'admin')
await gotoModule(page, 'admin', 'settings')
await clickByName(page, 'Rooms')
await shot(page, 'my-check')
console.log(page._errors)   // console/page errors collected for you
await browser.close()
```

## Gotchas these helpers already handle

- Login is **role-scoped**: `/admin/login`, not `/login` (a bare `/login` bounces
  back and looks like "wrong password").
- Module paths are **role-prefixed**: `/admin/settings`, not `/settings`.
- A `401` on first paint is normal (auth probe before the cookie is set) and is
  filtered out of `page._errors`.
- `login()` throws if it's still on `/login` afterwards, instead of silently
  screenshotting the login page.

## Credentials

Defaults to the demo accounts with password `Gudmed@123`. Override with
`E2E_BASE`, `E2E_PASSWORD` env vars.
