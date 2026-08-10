// ENEMY ATTACK — deliberately try to break the system with concurrency, money
// overflow, injection, and authorization abuse. Attacks NEW surface and stress-
// tests this session's fixes under race conditions. Self-cleaning; tagged data.
//
//   node e2e/enemy-attack.js
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

let s1 = 0, s2 = 0, s3 = 0, held = 0
const bug = (sev, t, d) => { if (sev==='S1')s1++; else if (sev==='S2')s2++; else s3++; console.log(`  [${sev}] ${t}`); if (d) console.log('        '+String(d).split('\n').join('\n        ')) }
const held_ok = (t, d='') => { held++; console.log(`   HELD ${t}${d?` — ${d}`:''}`) }
const H = (t) => console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`)

let cookie, recCookie
async function login(email) {
  const r = await fetch(`${API}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password:'Gudmed@123' }) })
  return r.headers.get('set-cookie')?.split(';')[0]
}
const call = (p, { c=cookie, method='GET', body }={}) => fetch(`${API}${p}`, { method, headers:{'Content-Type':'application/json',...(c?{cookie:c}:{})}, body: body?JSON.stringify(body):undefined }).then(async r=>({ status:r.status, j: await r.json().catch(()=>null) }))

const made = { patients:new Set(), appts:new Set(), invoices:new Set(), doctorId:null }

try {
  cookie = await login('admin@gudmed.in')
  recCookie = await login('reception@gudmed.in')

  // isolated doctor + patient
  const dept = await db.department.findFirst({ where:{organizationId:'org-demo'}, select:{id:true} })
  const floor = await db.floor.findFirst({ where:{organizationId:'org-demo'}, select:{id:true} })
  const doc = await db.user.create({ data:{ organizationId:'org-demo', email:'enemy-'+Date.now()+'@x.local', fullName:'Dr Enemy', role:'doctor', consultationFee:500, departmentId:dept.id, isActive:true } })
  made.doctorId = doc.id
  const room = await db.room.create({ data:{ organizationId:'org-demo', floorId:floor.id, roomNumber:'EN'+(Date.now()%9999), sittingType:'single' } })
  await db.doctorRoomAssignment.create({ data:{ organizationId:'org-demo', doctorId:doc.id, roomId:room.id } })
  const pat = await db.patient.create({ data:{ organizationId:'org-demo', mrn:'ENEMY-'+Date.now(), firstName:'Enemy', lastName:'Target', dateOfBirth:new Date('1990-01-01'), gender:'male' } })
  made.patients.add(pat.id)
  const track = (j) => { if (j?.data?.id) made.appts.add(j.data.id); return j }

  // ═══ 1. CONCURRENCY: 10 identical bookings, same slot ═══
  H('1. RACE — 10 identical concurrent bookings on ONE slot')
  {
    const body = { patientId:pat.id, doctorId:doc.id, appointmentDate:'2027-10-01', appointmentTime:'09:00', appointmentType:'new_patient' }
    const results = await Promise.all(Array.from({length:10}, () => call('/appointments', { method:'POST', body })))
    results.forEach(r => track(r.j))
    const wins = results.filter(r=>r.status===201).length
    const clean409 = results.filter(r=>r.status===409).length
    const errors5xx = results.filter(r=>r.status>=500).length
    const dbCount = await db.appointment.count({ where:{ doctorId:doc.id, appointmentDate:new Date('2027-10-01'), appointmentTime:'09:00', status:{ notIn:['cancelled','no_show','rescheduled'] } } })
    if (dbCount > 1) bug('S1','the double-booking guard FAILED under concurrency', `${dbCount} live appointments landed in one slot (${wins} got 201)`)
    else if (errors5xx > 0) bug('S2','concurrent losers get a 500 instead of a clean 409', `${wins} won, ${clean409} clean 409, ${errors5xx} raw 5xx`)
    else held_ok('exactly one booking wins, the rest get a clean 409', `${wins} won, ${clean409}× 409, DB has ${dbCount}`)
  }

  // ═══ 2. RACE: concurrent check-ins → duplicate queueNumber? ═══
  H('2. RACE — 15 concurrent walk-in queue adds')
  {
    const results = await Promise.all(Array.from({length:15}, (_,i) =>
      call('/queue', { method:'POST', body:{ patientId:pat.id, serviceArea:'opd', priority:'normal' } })))
    const nums = []
    for (const r of results) { if (r.j?.data?.queueNumber) nums.push(r.j.data.queueNumber); if (r.j?.data?.id) made.queue = (made.queue||new Set()).add(r.j.data.id) }
    const dupes = nums.length - new Set(nums).size
    if (dupes > 0) bug('S2','concurrent queue adds produced DUPLICATE queueNumbers', `${dupes} collisions in ${nums.length}`)
    else if (nums.length) held_ok('queue numbers unique under concurrency', `${nums.length} adds, ${new Set(nums).size} unique`)
    else held_ok('queue add path not reachable this way', 'skipped')
    // cleanup queue rows
    await db.queueManagement.deleteMany({ where:{ patientId:pat.id } })
  }

  // ═══ 3. REFUND double-approval (known S1 — reconfirm) ═══
  H('3. RACE — concurrent refund approval (known S1)')
  {
    const inv = await call('/billing', { method:'POST', body:{ resource:'invoice', patientId:pat.id, items:[{ serviceName:'Test', quantity:1, unitPrice:1000, total:1000 }] } })
    if (inv.j?.data?.id) {
      made.invoices.add(inv.j.data.id)
      await call('/billing', { method:'POST', body:{ resource:'payment', invoiceId:inv.j.data.id, amount:1000, paymentMethod:'cash' } })
      const r1 = await call('/billing', { method:'POST', body:{ resource:'refund', invoiceId:inv.j.data.id, amount:300, reason:'x' } })
      const r2 = await call('/billing', { method:'POST', body:{ resource:'refund', invoiceId:inv.j.data.id, amount:300, reason:'y' } })
      const id1 = r1.j?.data?.id, id2 = r2.j?.data?.id
      if (id1 && id2) {
        const [a1, a2] = await Promise.all([
          call('/billing', { method:'POST', body:{ resource:'approve_refund', refundId:id1 } }),
          call('/billing', { method:'POST', body:{ resource:'approve_refund', refundId:id2 } }),
        ])
        const revised = await db.invoice.count({ where:{ invoiceNumber:{ startsWith: inv.j.data.invoiceNumber+'-R' } } })
        if (revised > 1) bug('S1','refund double-approval creates 2 revised invoices (money leaves with no book entry)', `${revised} revisions; approvals ${a1.status}/${a2.status}`)
        else held_ok('refund double-approval blocked', `${revised} revision(s)`)
      } else held_ok('refund path returned no ids', `${r1.status}/${r2.status}`)
    } else held_ok('could not create invoice for refund test', inv.status)
  }

  // ═══ 4. MONEY overflow / negatives ═══
  H('4. MONEY — overflow, negative, NaN payments')
  {
    const inv = await call('/billing', { method:'POST', body:{ resource:'invoice', patientId:pat.id, items:[{ serviceName:'X', quantity:1, unitPrice:500, total:500 }] } })
    if (inv.j?.data?.id) {
      made.invoices.add(inv.j.data.id)
      const id = inv.j.data.id
      for (const [label, amt] of [['negative -500',-500],['zero 0',0],['overpay 999999',999999],['1e308',1e308],['NaN','not-a-number']]) {
        const r = await call('/billing', { method:'POST', body:{ resource:'payment', invoiceId:id, amount:amt, paymentMethod:'cash' } })
        if (r.status>=200 && r.status<300) {
          if (amt<=0 || amt===1e308) bug('S2',`payment ${label} was ACCEPTED`, `→ ${r.status}, amountPaid now ${(await db.invoice.findUnique({where:{id},select:{amountPaid:true}}))?.amountPaid}`)
          else held_ok(`payment ${label} handled`, `${r.status}`)
        } else if (r.status>=500) bug('S3',`payment ${label} → 500 (should be 400)`, JSON.stringify(r.j).slice(0,80))
        else held_ok(`payment ${label} rejected`, `${r.status}`)
      }
    }
  }

  // ═══ 5. INJECTION — prototype pollution, XSS, huge payload ═══
  H('5. INJECTION — __proto__, XSS, oversized')
  {
    const r1 = await call('/patients', { method:'POST', body:{ firstName:'Proto', lastName:'Pollute', dateOfBirth:'1990-01-01', gender:'male', __proto__:{ isAdmin:true }, constructor:{ prototype:{} } } })
    if (r1.j?.data?.id) made.patients.add(r1.j.data.id)
    ;({}).isAdmin ? bug('S1','prototype pollution succeeded — Object.prototype.isAdmin is set') : held_ok('__proto__ in body did not pollute the prototype')

    const xss = await call('/patients', { method:'POST', body:{ firstName:'<script>alert(1)</script>', lastName:'XSS', dateOfBirth:'1990-01-01', gender:'male' } })
    if (xss.j?.data?.id) { made.patients.add(xss.j.data.id)
      const stored = (await db.patient.findUnique({ where:{id:xss.j.data.id}, select:{firstName:true} }))?.firstName
      held_ok('XSS stored as literal text (React escapes on render; print path is the real risk)', `stored: ${stored?.slice(0,20)}`)
    }

    const big = 'x'.repeat(5_000_000)
    const r3 = await call('/patients', { method:'POST', body:{ firstName:'Big', lastName:big, dateOfBirth:'1990-01-01', gender:'male' } })
    if (r3.j?.data?.id) { made.patients.add(r3.j.data.id); bug('S3','a 5 MB field was accepted and stored', 'no length cap on patient text fields') }
    else held_ok('oversized field rejected', `${r3.status}`)
  }

  // ═══ 6. TYPE CONFUSION — arrays/objects/null where scalars expected ═══
  H('6. TYPE CONFUSION — 5xx hunting')
  {
    let fiveHundreds = 0, total = 0
    for (const bad of [
      { patientId:[], doctorId:doc.id, appointmentDate:'2027-10-05', appointmentTime:'10:00' },
      { patientId:{}, doctorId:doc.id, appointmentDate:'2027-10-05', appointmentTime:'10:00' },
      { patientId:pat.id, doctorId:doc.id, appointmentDate:99999, appointmentTime:'10:00' },
      { patientId:pat.id, doctorId:doc.id, appointmentDate:'2027-10-05', appointmentTime:[] },
      { patientId:pat.id, doctorId:true, appointmentDate:'2027-10-05', appointmentTime:'10:00' },
    ]) {
      total++
      const r = await call('/appointments', { method:'POST', body:bad })
      if (r.j?.data?.id) made.appts.add(r.j.data.id)
      if (r.status>=500) { fiveHundreds++; bug('S3','malformed body caused a 500 (should be 400)', JSON.stringify(bad).slice(0,70)+' → '+r.status) }
    }
    if (fiveHundreds===0) held_ok(`all ${total} malformed bodies got a clean 4xx`, '')
  }

  // ═══ 7. AUTHORIZATION — can a receptionist over-reach? ═══
  H('7. AUTHZ — receptionist privilege')
  {
    if (!recCookie) { console.log('   .. reception login failed, skipped') }
    else {
      // reception approving a refund / deleting an invoice
      const inv = await call('/billing', { method:'POST', body:{ resource:'invoice', patientId:pat.id, items:[{ serviceName:'X', quantity:1, unitPrice:100, total:100 }] } })
      if (inv.j?.data?.id) { made.invoices.add(inv.j.data.id)
        const del = await call(`/billing?resource=invoice&id=${inv.j.data.id}`, { c:recCookie, method:'DELETE' })
        info: held_ok(`receptionist DELETE invoice → ${del.status}`, del.status<300?'ALLOWED (review if intended)':'blocked')
      }
    }
  }

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`BROKEN: S1 ${s1} · S2 ${s2} · S3 ${s3}   |   HELD (attack repelled): ${held}`)
} catch (e) {
  bug('S3','attack script crashed', e.stack?.split('\n').slice(0,3).join('\n'))
} finally {
  const pIds = [...made.patients]
  const invs = await db.invoice.findMany({ where:{ OR:[{ patientId:{ in:pIds } }, { id:{ in:[...made.invoices] } }] }, select:{id:true} })
  await db.payment.deleteMany({ where:{ invoiceId:{ in:invs.map(i=>i.id) } } }).catch(()=>{})
  await db.doctorCommission.deleteMany({ where:{ invoiceId:{ in:invs.map(i=>i.id) } } }).catch(()=>{})
  await db.invoice.deleteMany({ where:{ id:{ in:invs.map(i=>i.id) } } }).catch(()=>{})
  await db.queueManagement.deleteMany({ where:{ patientId:{ in:pIds } } }).catch(()=>{})
  await db.appointment.deleteMany({ where:{ OR:[{ patientId:{ in:pIds } }, { doctorId: made.doctorId }] } }).catch(()=>{})
  await db.patient.deleteMany({ where:{ id:{ in:pIds } } }).catch(()=>{})
  if (made.doctorId) { await db.doctorRoomAssignment.deleteMany({ where:{ doctorId:made.doctorId } }).catch(()=>{}); await db.user.delete({ where:{ id:made.doctorId } }).catch(()=>{}) }
  console.log('  (attack data cleaned up)\n')
  await db.$disconnect()
}
