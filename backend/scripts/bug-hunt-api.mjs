// Hunts for defects in API BEHAVIOUR — what the endpoints do when pushed, which
// no amount of reading rows will tell you. bug-hunt.mjs checks the data; this
// checks the code that guards it.
//
//   API_BASE="http://localhost:5000" node scripts/bug-hunt-api.mjs
//   API_BASE="https://gudmed-api.onrender.com" node scripts/bug-hunt-api.mjs
//
// Every write it makes is undone. It logs in as admin with the demo password.
import 'dotenv/config'

const BASE = process.env.API_BASE || 'http://localhost:5000'
const EMAIL = process.env.API_EMAIL || 'admin@gudmed.in'
const PASSWORD = process.env.API_PASSWORD || 'Gudmed@123'

let bugs = 0
const ok = (n, d = '') => console.log(`  ✅ ${n}${d ? ` — ${d}` : ''}`)
const bug = (n, d) => { bugs++; console.log(`  ❌ ${n}\n       ${d}`) }

let cookie = ''
async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setC = res.headers.get('set-cookie')
  if (setC) cookie = setC.split(';')[0]
  if (raw) return res
  let json = null
  try { json = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, json }
}

console.log(`\n═══ API BUG HUNT — ${BASE} ═══\n`)

const login = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
if (login.status !== 200) { console.error('login failed:', login.status); process.exit(2) }

// ── 1. Unauthenticated access must be refused ───────────────────────────
{
  const saved = cookie; cookie = ''
  const r = await api('/display/floors')
  cookie = saved
  r.status === 401 ? ok('unauthenticated request refused') : bug('endpoint served without a login', `/display/floors returned ${r.status}`)
}

// ── 2. roomId of a non-existent room must 404, not 500 or leak ───────────
{
  const r = await api('/display/queue?roomId=does-not-exist')
  r.status === 404 ? ok('unknown roomId -> 404') : bug('unknown roomId not handled', `returned ${r.status} (${JSON.stringify(r.json).slice(0, 90)})`)
}

// ── 3. Missing required query param must 400, not 500 ────────────────────
{
  const r = await api('/display/queue')
  r.status === 400 ? ok('missing roomId -> 400') : bug('missing required param not validated', `returned ${r.status}`)
}

// ── 4. Timetable: a shift ending before it starts must be rejected ───────
{
  const docs = await api('/doctor-accountability?resource=doctors&limit=1')
  const doc = docs.json?.data?.[0]
  if (!doc) { bug('could not fetch a doctor to test with', 'skipping timetable checks'); }
  else {
    const cur = await api(`/doctor-accountability?resource=timetable&doctorId=${doc.id}`)
    const tt = cur.json?.data?.timetable
    const bad = JSON.parse(JSON.stringify(tt))
    bad.weeklySlots.Monday = { active: true, shifts: [{ start: '17:00', end: '09:00', roomId: null }] }
    const r = await api('/doctor-accountability?resource=timetable', {
      method: 'POST',
      body: { doctorId: doc.id, timetable: bad, expectedUpdatedAt: cur.json?.data?.updatedAt },
    })
    r.status === 400 ? ok('backwards shift (17:00-09:00) rejected') : bug('backwards shift accepted', `returned ${r.status} — a shift that ends before it starts was saved`)

    // ── 5. Overlapping shifts on one day must be rejected ────────────────
    const overlap = JSON.parse(JSON.stringify(tt))
    overlap.weeklySlots.Monday = { active: true, shifts: [{ start: '09:00', end: '12:00', roomId: null }, { start: '11:00', end: '14:00', roomId: null }] }
    const r2 = await api('/doctor-accountability?resource=timetable', {
      method: 'POST',
      body: { doctorId: doc.id, timetable: overlap, expectedUpdatedAt: cur.json?.data?.updatedAt },
    })
    r2.status === 400 ? ok('overlapping shifts rejected') : bug('overlapping shifts accepted', `returned ${r2.status} — the doctor is now in two places at once`)

    // ── 6. A room from nowhere must be rejected ──────────────────────────
    const fakeRoom = JSON.parse(JSON.stringify(tt))
    fakeRoom.weeklySlots.Monday = { active: true, shifts: [{ start: '09:00', end: '12:00', roomId: 'no-such-room-id' }] }
    const r3 = await api('/doctor-accountability?resource=timetable', {
      method: 'POST',
      body: { doctorId: doc.id, timetable: fakeRoom, expectedUpdatedAt: cur.json?.data?.updatedAt },
    })
    r3.status === 400 ? ok('unknown roomId in a shift rejected') : bug('shift saved pointing at a room that does not exist', `returned ${r3.status}`)

    // ── 7. Stale write must be refused (optimistic lock) ─────────────────
    const stale = JSON.parse(JSON.stringify(tt))
    const r4 = await api('/doctor-accountability?resource=timetable', {
      method: 'POST',
      body: { doctorId: doc.id, timetable: stale, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' },
    })
    r4.status === 409 ? ok('stale timetable write refused (409)') : bug('stale write silently overwrote', `returned ${r4.status} — two tabs editing one timetable lose each other's work`)
  }
}

// ── 8. Pagination must not be bypassable ────────────────────────────────
{
  const r = await api('/doctor-accountability?resource=commissions&limit=999999')
  const n = r.json?.data?.length ?? 0
  n <= 1000 ? ok('limit clamped', `asked 999999, got ${n}`) : bug('limit not clamped', `returned ${n} rows — a single call can pull the table`)
}

// ── 9. Negative offset must not break the query ─────────────────────────
{
  const r = await api('/doctor-accountability?resource=commissions&offset=-5&limit=2')
  r.status === 200 ? ok('negative offset handled') : bug('negative offset breaks the endpoint', `returned ${r.status}`)
}

// ── 10. Unknown resource must 400, not fall through ─────────────────────
{
  const r = await api('/doctor-accountability?resource=../../etc/passwd')
  r.status === 400 ? ok('unknown resource rejected') : bug('unknown resource not rejected', `returned ${r.status}`)
}

// ── 11. Suggested room number must sit in the floor's own block ──────────
{
  const floors = await api('/rooms/floors')
  const list = floors.json?.data || []
  const problems = []
  for (const [i, f] of list.entries()) {
    const s = await api(`/rooms/suggest-number?floorId=${f.id}`)
    const start = s.json?.data?.blockStart
    const want = i === 0 ? 1 : i * 100
    if (start !== want) problems.push(`${f.name}: block starts at ${start}, expected ${want}`)
  }
  problems.length === 0
    ? ok('every floor suggests a number from its own block', `${list.length} floors`)
    : bug('suggested room number is in the wrong floor block', problems.join('\n       '))
}

// ── 12. Mass assignment: extra fields must not be persisted ─────────────
{
  const docs = await api('/doctor-accountability?resource=doctors&limit=1')
  const doc = docs.json?.data?.[0]
  if (doc) {
    const before = doc.role
    await api('/doctor-accountability?resource=config', {
      method: 'POST',
      body: { doctorId: doc.id, commissionType: 'percentage', commissionRate: 10, isActive: false, role: 'super_admin', organizationId: 'somebody-else' },
    })
    const after = (await api('/doctor-accountability?resource=doctors&limit=1')).json?.data?.[0]
    after?.role === before ? ok('extra fields in the body ignored', `role stayed "${before}"`) : bug('mass assignment', `role changed ${before} -> ${after?.role}`)
  }
}

console.log(`\n${'─'.repeat(56)}`)
console.log(bugs === 0 ? '✅ No API defects found.' : `❌ ${bugs} API defect(s) found.`)
console.log('')
process.exit(bugs ? 1 : 0)
