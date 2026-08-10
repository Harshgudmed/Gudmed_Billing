// Put every module toggle back on, and say whether anything had been turned off.
//
//   node e2e/restore-modules.mjs            # report and repair
//   node e2e/restore-modules.mjs --check    # report only, exit 1 if any are off
//
// WHY THIS EXISTS
// Settings → Modules renders each module's on/off switch as a button with no text,
// no aria-label, no title and no icon class. The audit walk therefore knew it only
// by its position in the DOM, could not tell it from any other button, and clicked
// all fifteen — each one PATCHing /settings with modulesEnabled: {…: false}.
//
// The consequence was not a broken switch. A disabled module's route is filtered out
// of the router, so `/admin/laboratory` fell through to the catch-all and rendered
// the Dashboard, with the URL quietly changing to `/admin`. Twelve routes did that,
// and the audit went on measuring the Dashboard under twelve different module names
// — page sizes, Lighthouse scores, coverage, all of it, filed under modules it had
// never opened. That is the single most expensive kind of wrong answer this project
// has produced, because it looks exactly like a real result.
//
// The walk no longer presses unnamed controls. This runs anyway, after every module,
// because a guard that depends on one regex staying correct is not a guard.
// Credentials come from helpers.js so there is one place to change them. A copy
// here was already wrong once — it guessed the password, got a 401, printed
// "skipping", and the guard silently did nothing.
import { PASSWORD, ROLES } from './helpers.js'

const BASE = process.env.API_BASE || 'http://localhost:5000/api'
const CHECK_ONLY = process.argv.includes('--check')

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: ROLES.admin.email, password: PASSWORD }),
})
if (!login.ok) { console.log(`  restore-modules: cannot log in (${login.status}) — skipping`); process.exit(0) }
const token = (await login.json()).token
const auth = { authorization: `Bearer ${token}` }

const read = async () => {
  const s = await (await fetch(`${BASE}/settings`, { headers: auth })).json()
  return s.data?.modulesEnabled || s.modulesEnabled || {}
}

const before = await read()
const off = Object.entries(before).filter(([, v]) => v === false).map(([k]) => k)

if (!off.length) {
  console.log(`  restore-modules: all ${Object.keys(before).length} modules enabled — nothing to do`)
  process.exit(0)
}

console.log(`  restore-modules: ${off.length} module(s) were OFF — ${off.join(', ')}`)
if (CHECK_ONLY) process.exit(1)

const res = await fetch(`${BASE}/settings`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', ...auth },
  body: JSON.stringify({ resource: 'organization', modulesEnabled: Object.fromEntries(Object.keys(before).map((k) => [k, true])) }),
})
const after = await read()
const stillOff = Object.entries(after).filter(([, v]) => v === false).map(([k]) => k)
console.log(stillOff.length
  ? `  restore-modules: PATCH ${res.status} but still OFF — ${stillOff.join(', ')}`
  : `  restore-modules: repaired — all ${Object.keys(after).length} enabled again`)
process.exit(stillOff.length ? 1 : 0)
