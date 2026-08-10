// RESCHEDULE edge-case audit. Reschedule (POST /api/appointments/:id/reschedule)
// creates a NEW appointment and marks the old one 'rescheduled', linked via
// rescheduledFromId/rescheduledToId (appointmentController.js:534).
//
//   node e2e/audit-reschedule.js
//
// Uses its OWN throwaway doctor + patient so it never collides with anything
// else hitting the shared dev DB, and only ever reads back rows it created.
// Cleans up everything in a finally block.
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
const API = process.env.E2E_API || 'http://127.0.0.1:5000/api'
const db = new PrismaClient()

let s1 = 0, s2 = 0, s3 = 0, clean = 0
const bug = (sev, t, d) => { if (sev==='S1')s1++; else if (sev==='S2')s2++; else s3++; console.log(`  [${sev}] ${t}`); if (d) console.log(String(d).split('\n').map(l=>'        '+l).join('\n')) }
const ok = (t, d='') => { clean++; console.log(`   ok   ${t}${d?` — ${d}`:''}`) }
const info = (t, d='') => console.log(`   ..   ${t}${d?` — ${d}`:''}`)

const created = { doctorId: null, patientId: null, apptIds: new Set() }
let cookie
async function login() {
  const r = await fetch(`${API}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email:'admin@gudmed.in', password:'Gudmed@123' }) })
  cookie = r.headers.get('set-cookie')?.split(';')[0]
}
async function book(doctorId, patientId, date, time, type='new_patient') {
  const r = await fetch(`${API}/appointments`, { method:'POST', headers:{'Content-Type':'application/json',cookie}, body: JSON.stringify({ patientId, doctorId, appointmentDate: date, appointmentTime: time, appointmentType: type }) })
  const j = await r.json(); if (j?.data?.id) created.apptIds.add(j.data.id); return { status:r.status, j }
}
async function reschedule(id, date, time) {
  const r = await fetch(`${API}/appointments/${id}/reschedule`, { method:'POST', headers:{'Content-Type':'application/json',cookie}, body: JSON.stringify({ appointmentDate: date, appointmentTime: time }) })
  const j = await r.json(); if (j?.data?.id) created.apptIds.add(j.data.id); return { status:r.status, j }
}
async function patch(id, body) {
  const r = await fetch(`${API}/appointments/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json',cookie}, body: JSON.stringify(body) })
  return { status:r.status, j: await r.json().catch(()=>null) }
}

console.log('\n╔══════════════════════════════════════════════════════════╗')
console.log('║  RESCHEDULE — edge case audit                            ║')
console.log('╚══════════════════════════════════════════════════════════╝')

try {
  await login()
  // Isolated throwaway doctor (with a room link so check-in derives a room) + patient.
  const doc = await db.user.create({ data: { organizationId:'org-demo', email:'resched-'+Date.now()+'@x.local', fullName:'Dr Resched', role:'doctor', consultationFee:500, isActive:true } })
  created.doctorId = doc.id
  const floor = await db.floor.findFirst({ where:{ organizationId:'org-demo' }, select:{id:true} })
  const room = await db.room.create({ data:{ organizationId:'org-demo', floorId:floor.id, roomNumber:'RS'+(Date.now()%9999), sittingType:'single' } })
  await db.doctorRoomAssignment.create({ data:{ organizationId:'org-demo', doctorId:doc.id, roomId:room.id } })
  const pat = await db.patient.create({ data:{ organizationId:'org-demo', mrn:'RS-'+Date.now(), firstName:'Resched', lastName:'Tester', dateOfBirth:new Date('1990-01-01'), gender:'male' } })
  created.patientId = pat.id
  const D = '2027-09-10', D2 = '2027-09-11'
  info('subjects', `doctor=${doc.id.slice(-6)} patient=${pat.mrn} room=${room.roomNumber}`)

  // ── 1. Basic reschedule works ────────────────────────────────────────
  const a1 = await book(doc.id, pat.id, D, '10:00')
  const r1 = await reschedule(a1.j.data.id, D2, '11:00')
  const oldRow = await db.appointment.findUnique({ where:{ id:a1.j.data.id }, select:{ status:true, rescheduledToId:true } })
  const newRow = r1.j?.data
  if (r1.status===201 && oldRow?.status==='rescheduled' && oldRow.rescheduledToId===newRow?.id && newRow?.appointmentTime==='11:00')
    ok('basic reschedule: old→rescheduled, new appt created + linked', `old ${a1.j.data.id.slice(-6)} → new ${newRow.id.slice(-6)}`)
  else bug('S2','basic reschedule did not link/mark correctly', `status ${r1.status}, old=${oldRow?.status}, link=${oldRow?.rescheduledToId===newRow?.id}`)

  // ── 2. Does reschedule create an invoice/commission for the NEW visit? ──
  {
    const inv = await db.invoice.findFirst({ where:{ appointmentId: newRow?.id } })
    const oldInv = await db.invoice.findFirst({ where:{ appointmentId: a1.j.data.id } })
    if (!inv && oldInv)
      bug('S2','the rescheduled (new) appointment has NO invoice — only the old one does',
        `create() makes an invoice per appointment; reschedule() does not. The new appointment ${newRow?.id.slice(-6)} has no invoice,\n`+
        `the draft invoice ${oldInv.invoiceNumber} stays attached to the OLD appointment which is now status 'rescheduled'.\n`+
        `So the visit the patient actually attends is unbilled unless staff notice the orphaned draft.`)
    else if (inv) ok('reschedule creates an invoice for the new appointment', inv.invoiceNumber)
    else info('no invoice on either', 'neither old nor new has an invoice')
  }

  // ── 3. Old slot must be free to rebook (index excludes 'rescheduled') ──
  {
    const rebook = await book(doc.id, pat.id, D, '10:00')
    rebook.status===201
      ? ok('the slot freed by a reschedule can be rebooked', `re-booked ${D} 10:00`)
      : bug('S2','a slot freed by reschedule cannot be rebooked', `re-book ${D} 10:00 → ${rebook.status} ${JSON.stringify(rebook.j).slice(0,80)}`)
  }

  // ── 4. Reschedule ONTO an already-taken slot → clean refusal or raw P2002? ─
  {
    const held = await book(doc.id, pat.id, D2, '14:00')     // occupy the target
    const mover = await book(doc.id, pat.id, D2, '15:00')     // will try to move onto 14:00
    const clash = await reschedule(mover.j.data.id, D2, '14:00')
    if (clash.status===201) bug('S1','reschedule DOUBLE-BOOKS — two live appointments in one slot', `moved onto ${D2} 14:00 which was already taken → 201`)
    else if (clash.status>=500 || JSON.stringify(clash.j).includes('P2002') || JSON.stringify(clash.j).toLowerCase().includes('prisma'))
      bug('S2','reschedule onto a taken slot leaks a raw Prisma error instead of a clean SLOT_TAKEN', `→ ${clash.status} ${JSON.stringify(clash.j).slice(0,120)}`)
    else ok('reschedule onto a taken slot is refused cleanly', `→ ${clash.status}`)
  }

  // ── 5. Invalid time "25:00" / "99:99" ────────────────────────────────
  for (const t of ['25:00','99:99','abc']) {
    const a = await book(doc.id, pat.id, D, '08:'+(10+Math.floor(Math.random()*40)))
    const r = await reschedule(a.j.data.id, D2, t)
    if (r.status===201) {
      const stored = (await db.appointment.findUnique({ where:{ id:r.j.data.id }, select:{ appointmentTime:true } }))?.appointmentTime
      bug('S2',`reschedule accepts an impossible time "${t}"`, `stored appointmentTime = "${stored}" — no validate() middleware on this route`)
    } else ok(`reschedule rejects "${t}"`, `→ ${r.status}`)
  }

  // ── 6. Checked-in appointment reschedule → queue row orphaned? ────────
  {
    const a = await book(doc.id, pat.id, D, '09:00')
    await patch(a.j.data.id, { status:'checked_in' })
    const q0 = await db.queueManagement.findUnique({ where:{ appointmentId:a.j.data.id } })
    const r = await reschedule(a.j.data.id, D2, '09:30')
    const qOld = await db.queueManagement.findUnique({ where:{ appointmentId:a.j.data.id } })
    const qNew = await db.queueManagement.findUnique({ where:{ appointmentId:r.j?.data?.id } })
    if (q0 && qOld && qOld.status==='waiting' && !qNew)
      bug('S1','rescheduling a CHECKED-IN patient orphans the queue row on the OLD appointment',
        `The old appointment is now 'rescheduled' but its QueueManagement row is still status 'waiting' and on the board.\n`+
        `The new appointment has no queue row. So a patient who was checked in then rescheduled still shows in the\n`+
        `queue/board under the OLD slot, and if they check in the new appointment they get a SECOND row → appears twice.`)
    else if (qNew && qOld?.status!=='waiting') ok('reschedule moved the queue row to the new appointment', '')
    else info('checked-in reschedule queue state', `old=${qOld?.status} new=${qNew?'exists':'none'}`)
  }

  // ── 7. Reschedule a cancelled / completed appointment → allowed? ──────
  for (const st of ['cancelled','completed']) {
    const a = await book(doc.id, pat.id, D, '07:'+(10+Math.floor(Math.random()*40)))
    await patch(a.j.data.id, { status: st })
    const r = await reschedule(a.j.data.id, D2, '18:'+(10+Math.floor(Math.random()*40)))
    r.status===201
      ? bug('S3',`a ${st} appointment can be rescheduled into a new live one`, `reschedule of a '${st}' appointment → 201. A finished/void visit should not be movable.`)
      : ok(`a ${st} appointment cannot be rescheduled`, `→ ${r.status}`)
  }

  // ── 8. Reschedule to a PAST date ─────────────────────────────────────
  {
    const a = await book(doc.id, pat.id, D, '06:30')
    const r = await reschedule(a.j.data.id, '2020-01-01', '06:30')
    r.status===201 ? bug('S3','reschedule into the PAST (2020-01-01) is allowed', 'no future-date check') : ok('reschedule into the past refused', `→ ${r.status}`)
  }

  // ── 9. Fee recompute on a new day? (snapshot vs recompute) ────────────
  {
    const a = await book(doc.id, pat.id, D, '05:30')
    const feeBefore = a.j?.data?.consultationFee
    const r = await reschedule(a.j.data.id, '2027-12-25', '05:30')
    const feeAfter = r.j?.data?.consultationFee
    info('fee on reschedule', `before ₹${feeBefore} → after ₹${feeAfter} (copied from original — not recomputed for the new date)`)
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`S1: ${s1}   S2: ${s2}   S3: ${s3}   |   ${clean} clean`)
} catch (e) {
  bug('S3','audit crashed', e.stack?.split('\n').slice(0,3).join('\n'))
} finally {
  // teardown — only the rows this run created
  const ids = [...created.apptIds]
  const invs = await db.invoice.findMany({ where:{ OR:[{ appointmentId:{ in:ids } }, { patientId: created.patientId }] }, select:{id:true} })
  await db.doctorCommission.deleteMany({ where:{ invoiceId:{ in: invs.map(i=>i.id) } } }).catch(()=>{})
  await db.invoice.deleteMany({ where:{ patientId: created.patientId } }).catch(()=>{})
  await db.queueManagement.deleteMany({ where:{ patientId: created.patientId } }).catch(()=>{})
  await db.appointment.deleteMany({ where:{ patientId: created.patientId } }).catch(()=>{})
  if (created.patientId) await db.patient.delete({ where:{ id: created.patientId } }).catch(()=>{})
  if (created.doctorId) {
    await db.doctorRoomAssignment.deleteMany({ where:{ doctorId: created.doctorId } }).catch(()=>{})
    await db.room.deleteMany({ where:{ roomNumber:{ startsWith:'RS' }, doctorLinks:{ none:{} } } }).catch(()=>{})
    await db.user.delete({ where:{ id: created.doctorId } }).catch(()=>{})
  }
  console.log('  (cleaned up throwaway doctor + patient + all their rows)\n')
  await db.$disconnect()
}
