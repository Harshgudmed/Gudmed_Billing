// DOCTOR ACCOUNTABILITY AUDIT — timetable, room links, commission config.
//
//   node e2e/audit-doctor-accountability.js
//
// WHY THIS EXISTS: the timetable is the one place in this app where a business
// rule lives inside an unstructured JSON blob (User.preferences), with no column
// types, no foreign keys and no database constraint of any kind behind it. Every
// guard is application code, and application code is what this audit doubts.
//
// backend/scripts/bug-hunt-api.mjs already covers four cases — backwards shift,
// self-overlap, unknown roomId, stale write WITH expectedUpdatedAt. This goes at
// what those miss.
//
// SAFETY: every doctor whose preferences/config this touches is snapshotted first
// and restored in the finally block. These are real configured business rules.
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backend = path.join(__dirname, '..', 'backend')
const require = createRequire(path.join(backend, 'package.json'))
const { PrismaClient } = require('@prisma/client')

for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const API = process.env.E2E_API || 'http://localhost:5000/api'
const db = new PrismaClient()

let s1 = 0, s2 = 0, s3 = 0, clean = 0
const bug = (sev, title, detail) => {
  if (sev === 'S1') s1++; else if (sev === 'S2') s2++; else s3++
  console.log(`  [${sev}] ${title}`)
  if (detail) console.log(String(detail).split('\n').map((l) => `        ${l}`).join('\n'))
}
const ok = (m, d = '') => { clean++; console.log(`   ok   ${m}${d ? ` — ${d}` : ''}`) }
const info = (m, d = '') => console.log(`   ..   ${m}${d ? ` — ${d}` : ''}`)
const H = (t) => console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`)

const cookies = {}
async function login(key, email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.E2E_PASSWORD || 'Gudmed@123' }),
  })
  const c = r.headers.get('set-cookie')
  if (r.status === 200 && c) { cookies[key] = c.split(';')[0]; return true }
  return false
}
async function call(pathname, { as = 'admin', method = 'GET', body } = {}) {
  const t0 = Date.now()
  const r = await fetch(`${API}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookies[as] ? { cookie: cookies[as] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await r.json() } catch { /* non-JSON */ }
  return { status: r.status, json, ms: Date.now() - t0 }
}

const restore = []       // [{ id, preferences }]
const madeRooms = []
const restoreCfg = []    // [{ doctorId, snapshot }] — snapshot null means it did NOT exist, so delete it

const blank = () => ({
  weeklySlots: Object.fromEntries(
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      .map((d) => [d, { active: false, shifts: [] }]),
  ),
  exceptions: [],
})
const save = (doctorId, timetable, expectedUpdatedAt) =>
  call('/doctor-accountability?resource=timetable', {
    method: 'POST',
    body: { doctorId, timetable, ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}) },
  })
const readPrefs = async (id) => {
  const u = await db.user.findUnique({ where: { id }, select: { preferences: true, updatedAt: true } })
  let p = {}
  try { p = u?.preferences ? JSON.parse(u.preferences) : {} } catch { p = { __unparseable: true } }
  return { prefs: p, updatedAt: u?.updatedAt }
}

console.log('\n╔══════════════════════════════════════════════════════════════════════════╗')
console.log('║  DOCTOR ACCOUNTABILITY AUDIT — timetable · rooms · commission            ║')
console.log('╚══════════════════════════════════════════════════════════════════════════╝')

try {
  if (!await login('admin', 'admin@gudmed.in')) { console.log('\n  admin login failed — cannot continue\n'); process.exit(2) }
  const asPriya = await login('priya', 'priya@gudmed.in')
  const asReception = await login('reception', 'reception@gudmed.in')

  const docs = await db.user.findMany({
    where: { organizationId: 'org-demo', role: 'doctor', isActive: true },
    select: { id: true, fullName: true, departmentId: true, preferences: true },
    take: 3,
  })
  if (docs.length < 2) { console.log('\n  need at least 2 doctors\n'); process.exit(2) }
  const [D1, D2] = docs
  for (const d of docs) restore.push({ id: d.id, preferences: d.preferences })

  const room = await db.room.findFirst({ where: { organizationId: 'org-demo' }, select: { id: true, roomNumber: true, departmentId: true } })
  info('subjects', `D1=${D1.fullName}  D2=${D2.fullName}  room=${room?.roomNumber}`)

  // ══════════════════════════════════════════════════════════════════════════
  H('A. THE JSON BLOB — does saving a timetable damage anything else?')
  {
    // preferences is a shared blob. If the save overwrites it whole rather than
    // merging, every other setting stored beside the timetable is destroyed.
    const marker = { theme: 'dark', notificationsEmail: true, __auditMarker: 'DO-NOT-LOSE' }
    const before = await readPrefs(D1.id)
    await db.user.update({ where: { id: D1.id }, data: { preferences: JSON.stringify({ ...before.prefs, ...marker }) } })

    const tt = blank()
    tt.weeklySlots.Monday = { active: true, shifts: [{ start: '09:00', end: '12:00', roomId: room.id }] }
    const cur = await readPrefs(D1.id)
    const r = await save(D1.id, tt, cur.updatedAt?.toISOString())

    const after = await readPrefs(D1.id)
    if (r.status !== 200) info('save did not succeed, sibling-key test inconclusive', `${r.status} ${r.json?.error || ''}`)
    else if (after.prefs.__auditMarker === 'DO-NOT-LOSE' && after.prefs.theme === 'dark') {
      ok('saving a timetable preserves the other keys in preferences', 'read-modify-write merges rather than overwrites (controller L237-242)')
    } else {
      bug('S1', 'saving a timetable DESTROYS the other settings in preferences',
        `preferences before: ${JSON.stringify({ ...cur.prefs, ...marker }).slice(0, 120)}\n` +
        `preferences after:  ${JSON.stringify(after.prefs).slice(0, 120)}`)
    }
  }
  {
    // Arbitrary attacker-controlled JSON, stored forever, shipped on every GET.
    const tt = blank()
    tt.hacked = true
    tt.weeklySlots.Monday = { active: true, shifts: [{ start: '09:00', end: '10:00', roomId: room.id, evilKey: 'x'.repeat(50) }] }
    const cur = await readPrefs(D1.id)
    const r = await save(D1.id, tt, cur.updatedAt?.toISOString())
    const after = await readPrefs(D1.id)
    if (r.status === 200 && after.prefs.timetable?.hacked === true) {
      bug('S3', 'the timetable stores arbitrary unvalidated keys',
        `POST timetable {hacked: true, shifts:[{..., evilKey: "xxx..."}]} -> 200\n` +
        `Stored and echoed back on every GET. No schema validates the blob's shape; only the\n` +
        `shift times and roomIds are checked (controller L210-235). Low impact today, but it means\n` +
        `nothing stops a client writing junk that a later reader trusts.`)
    } else ok('unknown keys in the timetable are rejected or stripped', `${r.status}`)
  }
  {
    // Unbounded user-controlled column = storage/DoS surface.
    const tt = blank()
    tt.junk = 'x'.repeat(2_000_000) // 2 MB
    const cur = await readPrefs(D1.id)
    const r = await save(D1.id, tt, cur.updatedAt?.toISOString())
    if (r.status === 200) {
      const size = (await db.user.findUnique({ where: { id: D1.id }, select: { preferences: true } }))?.preferences?.length || 0
      bug('S3', 'the preferences blob has no size limit',
        `A 2 MB timetable was accepted (stored ${(size / 1e6).toFixed(2)} MB). Every subsequent GET of this\n` +
        `doctor ships it. There is no cap in the schema (String) or the controller. A handful of these\n` +
        `rows would bloat the table and slow every doctor list that selects preferences.`)
    } else ok('an oversized timetable is refused', `${r.status}`)
    // Put it back to something sane immediately.
    await save(D1.id, blank(), (await readPrefs(D1.id)).updatedAt?.toISOString())
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('B. SHIFT VALIDATION — beyond the four cases bug-hunt-api.mjs already covers')
  const shiftCases = [
    ['start == end (zero-length shift)', { start: '09:00', end: '09:00' }, 'reject'],
    ['adjacent shifts must be ALLOWED', [{ start: '09:00', end: '12:00' }, { start: '12:00', end: '15:00' }], 'accept'],
    ['shift crossing midnight', { start: '22:00', end: '02:00' }, 'reject'],
    ['empty time string', { start: '', end: '12:00' }, 'reject'],
    ['missing end', { start: '09:00' }, 'reject'],
    ['"25:00"', { start: '25:00', end: '26:00' }, 'reject'],
    ['"12:60"', { start: '12:60', end: '13:00' }, 'reject'],
    ['"-1:00"', { start: '-1:00', end: '10:00' }, 'reject'],
    ['null time', { start: null, end: '10:00' }, 'reject'],
    ['numeric time', { start: 900, end: 1200 }, 'reject'],
  ]
  for (const [label, shift, want] of shiftCases) {
    const tt = blank()
    tt.weeklySlots.Monday = { active: true, shifts: Array.isArray(shift) ? shift : [shift] }
    const cur = await readPrefs(D1.id)
    const r = await save(D1.id, tt, cur.updatedAt?.toISOString())
    const accepted = r.status === 200
    if (want === 'reject' && accepted) {
      bug('S2', `an invalid shift is accepted: ${label}`, `POST ${JSON.stringify(shift)} -> 200 and stored`)
    } else if (want === 'accept' && !accepted) {
      bug('S2', `a LEGITIMATE shift is refused: ${label}`,
        `POST ${JSON.stringify(shift)} -> ${r.status} ${r.json?.error || ''}\n` +
        `Back-to-back sessions are normal hospital practice; refusing them is an off-by-one in the\n` +
        `overlap check (assertNoSelfOverlap uses < so this should pass).`)
    } else {
      ok(`${label} -> ${want === 'accept' ? 'accepted' : 'rejected'}`, want === 'reject' ? String(r.json?.error || '').slice(0, 58) : '')
    }
  }
  {
    // The format trick: if "9:00" and "09:00" both parse but are compared as
    // strings anywhere, two "different" shifts describe the same hour.
    const tt = blank()
    tt.weeklySlots.Monday = { active: true, shifts: [{ start: '09:00', end: '12:00' }, { start: '9:00', end: '11:00' }] }
    const cur = await readPrefs(D1.id)
    const r = await save(D1.id, tt, cur.updatedAt?.toISOString())
    r.status === 400
      ? ok('"9:00" and "09:00" are recognised as the same hour', 'the overlap check parses to minutes, not strings')
      : bug('S2', 'unpadded and padded times defeat the overlap check',
          `shifts [{09:00-12:00}, {9:00-11:00}] -> ${r.status}. These overlap; the doctor is now in two\n` +
          `rooms at once and the display board will show them twice.`)
  }
  {
    // Day keys.
    const tt = blank()
    tt.weeklySlots.monday = { active: true, shifts: [{ start: '09:00', end: '12:00', roomId: room.id }] } // lowercase
    const cur = await readPrefs(D1.id)
    const r = await save(D1.id, tt, cur.updatedAt?.toISOString())
    if (r.status === 200) {
      const after = await readPrefs(D1.id)
      const stored = after.prefs.timetable?.weeklySlots?.monday
      bug('S3', 'a lowercase day key is stored but never read',
        `POST weeklySlots.monday {09:00-12:00} -> 200, stored: ${JSON.stringify(stored)}\n` +
        `lib/doctorTimetable.js DAY_NAMES is ["Monday",...] and every reader indexes by that exact\n` +
        `casing, so this shift is invisible to the display board while LOOKING saved to whoever typed it.\n` +
        `Not reachable from the current UI (it sends the canonical names) — it is an API-contract hole.`)
    } else ok('a lowercase day key is rejected', `${r.status}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('C. THE OPTIMISTIC LOCK — does it actually protect?')
  {
    const tt = blank()
    tt.weeklySlots.Tuesday = { active: true, shifts: [{ start: '10:00', end: '11:00', roomId: room.id }] }
    // Omitting expectedUpdatedAt entirely.
    const r = await save(D1.id, tt, undefined)
    if (r.status === 200) {
      bug('S2', 'the optimistic lock is bypassed simply by NOT sending expectedUpdatedAt',
        `POST /doctor-accountability?resource=timetable {doctorId, timetable}  (no expectedUpdatedAt) -> 200\n` +
        `controller L259: updateWhere = { id, ...(expectedUpdatedAt ? { updatedAt } : {}) }\n` +
        `With the field absent the where-clause has no guard at all and the write lands unconditionally.\n` +
        `A lock a client can opt out of protects nothing — and the UI is trusting it to. Any other caller\n` +
        `(a script, an integration, a second frontend) silently clobbers whoever saved last.`)
    } else ok('a save without expectedUpdatedAt is refused', `${r.status}`)
  }
  for (const [label, val] of [['null', null], ['empty string', ''], ['garbage', 'not-a-date'], ['a future date', '2099-01-01T00:00:00.000Z']]) {
    const tt = blank()
    tt.weeklySlots.Wednesday = { active: true, shifts: [{ start: '10:00', end: '11:00', roomId: room.id }] }
    const r = await save(D1.id, tt, val)
    if (r.status === 200 && (val === null || val === '')) {
      bug('S2', `expectedUpdatedAt: ${label} bypasses the lock`, `-> 200. A falsy value takes the same "no guard" branch as omitting it.`)
    } else if (r.status >= 500) {
      bug('S3', `expectedUpdatedAt: ${label} -> ${r.status}`, `new Date("${val}") is Invalid Date and reaches Prisma. Should be a 400.`)
    } else {
      ok(`expectedUpdatedAt: ${label} -> ${r.status === 409 ? 'conflict' : 'refused'}`, `${r.status}`)
    }
  }
  {
    // Two writers, same base version, fired together.
    const cur = await readPrefs(D1.id)
    const stamp = cur.updatedAt?.toISOString()
    const a = blank(); a.weeklySlots.Thursday = { active: true, shifts: [{ start: '08:00', end: '09:00', roomId: room.id }] }
    const b = blank(); b.weeklySlots.Thursday = { active: true, shifts: [{ start: '14:00', end: '15:00', roomId: room.id }] }
    const [ra, rb] = await Promise.all([save(D1.id, a, stamp), save(D1.id, b, stamp)])
    const wins = [ra.status, rb.status].filter((s) => s === 200).length
    wins === 1
      ? ok('two concurrent saves on the same version: exactly one wins', `${ra.status} / ${rb.status}`)
      : bug('S2', 'the optimistic lock does not serialise concurrent saves',
          `two saves with the SAME expectedUpdatedAt -> ${ra.status} / ${rb.status} (expected one 200, one 409)`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('D. AUTHORIZATION — can a doctor rewrite a colleague?')
  if (!asPriya) info('priya@gudmed.in did not authenticate', 'doctor-scoping checks skipped')
  else {
    const priya = await db.user.findUnique({ where: { email: 'priya@gudmed.in' }, select: { id: true } })
    const victim = docs.find((d) => d.id !== priya?.id) || D2

    // The GET path scopes to the caller's own doctor id (controller L13).
    const g = await call(`/doctor-accountability?resource=doctors&limit=5`, { as: 'priya' })
    const n = g.json?.data?.length ?? 0
    n <= 1
      ? ok('a doctor sees only themselves in resource=doctors', `count=${n}`)
      : bug('S2', 'a doctor can list other doctors', `resource=doctors returned ${n} rows for priya@gudmed.in`)

    // The POST path takes doctorId straight from the body (controller L196-197)
    // and never calls scopedDoctorId — which is imported, but only used in handleGet.
    const before = await readPrefs(victim.id)
    const tt = blank()
    tt.weeklySlots.Friday = { active: true, shifts: [{ start: '03:00', end: '04:00', roomId: room.id }] }
    const r = await call('/doctor-accountability?resource=timetable', {
      as: 'priya', method: 'POST',
      body: { doctorId: victim.id, timetable: tt, expectedUpdatedAt: before.updatedAt?.toISOString() },
    })
    const after = await readPrefs(victim.id)
    const changed = JSON.stringify(after.prefs.timetable?.weeklySlots?.Friday) === JSON.stringify(tt.weeklySlots.Friday)
    if (r.status === 200 && changed) {
      bug('S1', 'a doctor can REWRITE another doctor\'s timetable',
        `Logged in as priya@gudmed.in (role: doctor).\n` +
        `POST /doctor-accountability?resource=timetable {doctorId: "${victim.id}" /* NOT her */} -> 200\n` +
        `${victim.fullName}'s Friday is now 03:00-04:00 and she never touched it.\n` +
        `scopedDoctorId (utils/scope.js) IS imported by this controller and IS used in handleGet (L13),\n` +
        `but handlePost never calls it — L197 is literally \`const targetDoctorId = doctorId\` from the body.\n` +
        `The only check is that the target is in the same org (L201-206). Consequence: any doctor can\n` +
        `reschedule any colleague, move them into any room, or empty their week.`)
    } else ok('a doctor cannot write another doctor\'s timetable', `${r.status}`)

    // Same shape, on money. Snapshot FIRST and register it for teardown even when
    // it is null — "no config existed" is a state that must be restored too, or a
    // later run sees the rate this run wrote and reports the bug as fixed.
    const cfgBefore = await db.doctorCommissionConfig.findUnique({ where: { doctorId: victim.id } })
    restoreCfg.push({ doctorId: victim.id, snapshot: cfgBefore })
    const rc = await call('/doctor-accountability?resource=config', {
      as: 'priya', method: 'POST',
      body: { doctorId: victim.id, commissionType: 'percentage', commissionRate: 99 },
    })
    const cfgAfter = await db.doctorCommissionConfig.findUnique({ where: { doctorId: victim.id } })
    if (rc.status < 300 && cfgAfter?.commissionRate === 99 && cfgBefore?.commissionRate !== 99) {
      bug('S1', 'a doctor can change another doctor\'s COMMISSION RATE',
        `As priya@gudmed.in: POST resource=config {doctorId: "${victim.id}", commissionRate: 99} -> ${rc.status}\n` +
        `${victim.fullName}'s rate: ${cfgBefore ? cfgBefore.commissionRate : 'no config existed'} -> 99. Same root cause as above:\n` +
        `handlePost never scopes doctorId to the caller — any doctor can set any colleague's pay rate.`)
    } else ok('a doctor cannot change another doctor\'s commission rate', `${rc.status}`)
  }
  if (asReception) {
    const before = await readPrefs(D2.id)
    const tt = blank()
    tt.weeklySlots.Saturday = { active: true, shifts: [{ start: '05:00', end: '06:00', roomId: room.id }] }
    const r = await call('/doctor-accountability?resource=timetable', {
      as: 'reception', method: 'POST',
      body: { doctorId: D2.id, timetable: tt, expectedUpdatedAt: before.updatedAt?.toISOString() },
    })
    r.status === 200
      ? bug('S3', 'a RECEPTIONIST can rewrite any doctor\'s timetable', `POST as reception@gudmed.in -> 200. Arguably intended (front desk manages schedules) but nothing states it.`)
      : ok('a receptionist cannot rewrite a doctor\'s timetable', `${r.status}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('E. ROOMS — the JSON blob has no foreign key to protect it')
  {
    const floor = await db.floor.findFirst({ where: { organizationId: 'org-demo' }, select: { id: true } })
    const tmp = await db.room.create({
      data: { organizationId: 'org-demo', floorId: floor.id, roomNumber: `AUDIT-${Date.now() % 100000}`, sittingType: 'single' },
    })
    madeRooms.push(tmp.id)

    const tt = blank()
    tt.weeklySlots.Monday = { active: true, shifts: [{ start: '09:00', end: '10:00', roomId: tmp.id }] }
    const cur = await readPrefs(D2.id)
    const sr = await save(D2.id, tt, cur.updatedAt?.toISOString())
    if (sr.status !== 200) { info('could not attach the temp room to a timetable', `${sr.status}`) }
    else {
      // Now delete the room out from under it.
      const del = await call(`/rooms/${tmp.id}`, { method: 'DELETE' })
      const after = await readPrefs(D2.id)
      const dangling = after.prefs.timetable?.weeklySlots?.Monday?.shifts?.[0]?.roomId === tmp.id
      const stillExists = await db.room.findUnique({ where: { id: tmp.id }, select: { id: true } })

      if (del.status < 300 && dangling && !stillExists) {
        madeRooms.length = 0
        bug('S2', 'deleting a room leaves a DANGLING roomId inside the doctor\'s timetable',
          `DELETE /rooms/${tmp.id} -> ${del.status}, room row gone.\n` +
          `${D2.fullName}'s Monday shift still points at it: roomId="${tmp.id}".\n` +
          `DoctorRoomAssignment has a real FK and cascades; the timetable JSON does not — Postgres cannot\n` +
          `protect a value inside a text column. Nothing warns the admin that a doctor's session just lost\n` +
          `its room, and the delete endpoint never checks whether any timetable references it.`)
      } else if (del.status >= 400) {
        ok('a room referenced by a timetable cannot be deleted', `${del.status} ${String(del.json?.error || '').slice(0, 50)}`)
      } else if (!dangling) {
        ok('deleting a room also clears it from the timetable', '')
      }
    }
  }
  {
    // Department scoping: the controller validates the room's ORG (L212) but not
    // its department.
    const d1Dept = D1.departmentId
    const foreignRoom = await db.room.findFirst({
      where: { organizationId: 'org-demo', departmentId: { not: null, ...(d1Dept ? { not: d1Dept } : {}) } },
      select: { id: true, roomNumber: true, department: { select: { name: true } } },
    })
    if (!foreignRoom || !d1Dept) info('department-scoping check skipped', 'no doctor/room department pair to contrast')
    else {
      const tt = blank()
      tt.weeklySlots.Monday = { active: true, shifts: [{ start: '09:00', end: '10:00', roomId: foreignRoom.id }] }
      const cur = await readPrefs(D1.id)
      const r = await save(D1.id, tt, cur.updatedAt?.toISOString())
      const dept = await db.department.findUnique({ where: { id: d1Dept }, select: { name: true } })
      r.status === 200
        ? bug('S3', 'a doctor can be scheduled into another DEPARTMENT\'s room via the API',
            `${D1.fullName} (${dept?.name}) scheduled into Room ${foreignRoom.roomNumber} (${foreignRoom.department?.name}) -> 200\n` +
            `The controller validates the room's organization (L211-218) but never its department. The UI\n` +
            `filters the picker; the API does not — so the guard exists only where it is easiest to bypass.`)
        : ok('a doctor cannot take a room outside their department', `${r.status}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('F. LEAVE — isOnLeave() does String(date).slice(0,10)')
  {
    const ymd = new Date().toISOString().slice(0, 10)
    for (const [label, dateVal, shouldMatch] of [
      ['ISO date "2026-07-17"', ymd, true],
      ['full ISO "2026-07-17T00:00:00.000Z"', `${ymd}T00:00:00.000Z`, true],
      ['dd/mm/yyyy "17/07/2026"', '17/07/2026', false],
      ['US "07/17/2026"', '07/17/2026', false],
    ]) {
      const tt = blank()
      tt.exceptions = [{ date: dateVal, reason: 'audit' }]
      const cur = await readPrefs(D1.id)
      const r = await save(D1.id, tt, cur.updatedAt?.toISOString())
      if (r.status !== 200) { ok(`leave date ${label} rejected at save`, `${r.status}`); continue }
      const { isOnLeave } = await import(`file://${path.join(backend, 'src', 'lib', 'activeDoctor.js')}`)
      const after = await readPrefs(D1.id)
      const detected = isOnLeave(after.prefs.timetable, ymd)
      if (shouldMatch && detected) ok(`leave stored as ${label} is detected`, '')
      else if (!shouldMatch && !detected) {
        bug('S3', `a leave date written as ${label} is stored but NEVER detected`,
          `exceptions: [{date: "${dateVal}"}] saved -> 200, isOnLeave(today) -> false\n` +
          `isOnLeave (activeDoctor.js:33-37) does String(e.date).slice(0,10) === ymd, so only ISO matches.\n` +
          `Nothing validates the format at save. The doctor shows as available while on holiday, and the\n` +
          `admin who typed it has a confirmed leave row on screen. Not reachable from today's UI (it sends\n` +
          `ISO) — but nothing enforces that, and the save endpoint is a shared contract.`)
      } else info(`leave date ${label}`, `detected=${detected}`)
    }
  }
  {
    for (const [label, exc] of [['a string not an array', 'nope'], ['[null]', [null]], ['[{}]', [{}]], ['[{date:null}]', [{ date: null }]]]) {
      const tt = blank()
      tt.exceptions = exc
      const cur = await readPrefs(D1.id)
      const r = await save(D1.id, tt, cur.updatedAt?.toISOString())
      r.status >= 500
        ? bug('S3', `exceptions = ${label} -> ${r.status}`, `should be a 400`)
        : ok(`exceptions = ${label} -> ${r.status < 300 ? 'stored without crashing' : 'rejected'}`, `${r.status}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('G. COMMISSION CONFIG')
  {
    const snapshot = await db.doctorCommissionConfig.findUnique({ where: { doctorId: D2.id } })
    restoreCfg.push({ doctorId: D2.id, snapshot })
    for (const [label, body, want] of [
      ['rate 150%', { commissionType: 'percentage', commissionRate: 150 }, 'reject'],
      ['rate -10', { commissionType: 'percentage', commissionRate: -10 }, 'reject'],
      ['rate as a string "10"', { commissionType: 'percentage', commissionRate: '10' }, 'either'],
      ['unknown commissionType', { commissionType: 'moon-units', commissionRate: 10 }, 'reject'],
      ['rate 1e308', { commissionType: 'percentage', commissionRate: 1e308 }, 'reject'],
    ]) {
      const r = await call('/doctor-accountability?resource=config', { method: 'POST', body: { doctorId: D2.id, ...body } })
      const row = await db.doctorCommissionConfig.findUnique({ where: { doctorId: D2.id } })
      if (want === 'reject' && r.status < 300) {
        bug('S3', `commission config accepts ${label}`, `-> ${r.status}, stored rate=${row?.commissionRate} type=${row?.commissionType}`)
      } else if (want === 'either') {
        info(`${label} -> ${r.status}`, `stored ${row?.commissionRate}`)
      } else ok(`commission config rejects ${label}`, `${r.status}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('H. sittingType MUST NOT GATE LOGIC')
  {
    // It is documented as a cosmetic label set once at room creation and never
    // updated. If any code branches on it, a room with two real doctors but the
    // label "single" behaves wrong.
    const hits = []
    const scan = (dir, rel = '') => {
      for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = path.join(rel, e.name)
        if (e.isDirectory()) { if (!/node_modules|\.git|dist|build/.test(e.name)) scan(dir, r); continue }
        if (!/\.(js|jsx)$/.test(e.name)) continue
        for (const [i, line] of fs.readFileSync(path.join(dir, r), 'utf8').split('\n').entries()) {
          // Only a COMPARISON gates behaviour. Reading the value into form state
          // (useState(room?.sittingType), passing it to an <option>, sending it on
          // create) is the label being used as a label — that is its job.
          if (!/sittingType\s*(===|!==|==\s|!=\s)/.test(line)) continue
          if (/useState|setSittingType|value=|defaultValue/.test(line)) continue
          hits.push(`${r}:${i + 1}  ${line.trim().slice(0, 88)}`)
        }
      }
    }
    scan(path.join(backend, 'src'))
    scan(path.join(__dirname, '..', 'src'))
    hits.length === 0
      ? ok('nothing branches on sittingType', 'the cosmetic label never gates behaviour')
      : bug('S2', `${hits.length} place(s) branch on the cosmetic sittingType label`,
          hits.join('\n') + `\nsittingType is set once at room creation and never updated. A room whose real doctor count\nhas since changed will behave according to a stale label.`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('I. PERFORMANCE against 1105 doctors')
  for (const [label, url] of [
    ['resource=doctors limit=50', '/doctor-accountability?resource=doctors&limit=50'],
    ['resource=doctors limit=1000', '/doctor-accountability?resource=doctors&limit=1000'],
    ['resource=stats', '/doctor-accountability?resource=stats'],
    ['resource=commissions limit=100', '/doctor-accountability?resource=commissions&limit=100'],
  ]) {
    const r = await call(url)
    const n = Array.isArray(r.json?.data) ? r.json.data.length : '-'
    r.ms > 1500
      ? bug('S2', `slow: ${label}`, `${r.ms}ms, ${n} rows`)
      : ok(`${label} — ${r.ms}ms`, `${n} rows`)
  }
  {
    // Does resource=doctors honour `limit` AT ALL? Timing alone hides this: the
    // query is fast, it just returns everything.
    const total = await db.user.count({ where: { organizationId: 'org-demo', role: 'doctor' } })
    const r = await call('/doctor-accountability?resource=doctors&limit=5')
    const n = r.json?.data?.length ?? 0
    if (n > 5) {
      bug('S2', 'resource=doctors IGNORES limit — every call ships the whole doctor table',
        `GET ?resource=doctors&limit=5 -> ${n} rows (${total} doctors exist), ${r.ms}ms, ~${(JSON.stringify(r.json).length / 1024).toFixed(0)}KB\n` +
        `The Doctor's Timetable screen opens with this call. It is fast today because 1.1k rows is small,\n` +
        `but the page pays for every doctor in the hospital on every open, and the limit the client sends\n` +
        `is silently discarded — so no pagination the frontend adds can ever work.`)
    } else ok('resource=doctors honours limit', `asked 5, got ${n} of ${total}`)
  }
  {
    const r = await call('/doctor-accountability?resource=commissions&limit=999999')
    const n = r.json?.data?.length ?? 0
    const total = await db.doctorCommission.count({ where: { organizationId: 'org-demo' } })
    if (total <= 1000) info('commissions limit clamp — not testable', `only ${total} commission rows exist; a clamp cannot be observed below the cap`)
    else if (n <= 1000) ok('commissions limit is clamped', `asked 999999, got ${n} of ${total}`)
    else bug('S2', 'commissions limit not clamped', `${n} rows in one call`)
  }
  for (const [label, url] of [['offset=-5', '/doctor-accountability?resource=commissions&offset=-5&limit=2'], ['offset=abc', '/doctor-accountability?resource=commissions&offset=abc&limit=2']]) {
    const r = await call(url)
    r.status >= 500 ? bug('S3', `${label} -> ${r.status}`, 'a bad query param must be a 400, not a 5xx') : ok(`${label} handled`, `${r.status}`)
  }

} catch (e) {
  bug('S3', 'audit crashed', e.stack?.split('\n').slice(0, 4).join('\n') || e.message)
} finally {
  console.log('\n── restoring ──')
  for (const { id, preferences } of restore) {
    await db.user.update({ where: { id }, data: { preferences } }).catch(() => {})
  }
  console.log(`  restored preferences for ${restore.length} doctor(s)`)

  // Commission configs are real pay rates. Put back exactly what was there —
  // including "nothing", which means DELETE the row this run created. Getting
  // this wrong once already left Dr. Joshi on a 99% rate and Dr. Agarwal on
  // 1e308, and made a second run report the S1 as fixed.
  let put = 0, removed = 0
  for (const { doctorId, snapshot } of restoreCfg) {
    if (snapshot) {
      await db.doctorCommissionConfig.update({
        where: { doctorId },
        data: {
          commissionType: snapshot.commissionType,
          commissionRate: snapshot.commissionRate,
          isActive: snapshot.isActive,
          notes: snapshot.notes,
        },
      }).catch(() => {})
      put++
    } else {
      await db.doctorCommissionConfig.deleteMany({ where: { doctorId } }).catch(() => {})
      removed++
    }
  }
  if (put || removed) console.log(`  commission configs: ${put} restored, ${removed} removed (did not exist before this run)`)

  for (const id of madeRooms) await db.room.delete({ where: { id } }).catch(() => {})
  if (madeRooms.length) console.log(`  removed ${madeRooms.length} audit room(s)`)
  await db.$disconnect()
}

console.log(`\n${'─'.repeat(74)}`)
console.log(`S1: ${s1}   S2: ${s2}   S3: ${s3}   |   ${clean} check(s) clean`)
console.log('')
process.exit(s1 ? 1 : 0)
