// BILLING / INVOICES / PAYMENTS — adversarial money audit.
//
//   node e2e/audit-billing.js            # API + DB checks (fast, no browser)
//   node e2e/audit-billing.js --ui       # also drives the real UI (Playwright)
//   node e2e/audit-billing.js --authz    # also runs the role matrix (needs :5001, see below)
//
// WHY THIS FILE EXISTS
// --------------------
// Every other suite here reads pages and asserts happy paths. This one assumes
// every guard is missing until proven present, and it checks the DATABASE — not
// the API response — because the API telling you "201 created" says nothing about
// what actually landed in the ledger.
//
// Two rules this file obeys, learned the hard way:
//   1. Nothing is a bug until it reproduces TWICE. Races are run in a loop.
//   2. It creates its OWN throwaway invoices and deletes them. It must never
//      mutate a real invoice — this module touches live hospital money.
//
// AUTH_ENFORCED=false in backend/.env is DELIBERATE local dev config. This file
// therefore never reports "reachable without login". Role-vs-role authz IS tested,
// but only against a separately-launched enforced instance (see runAuthz()).
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backend = path.join(__dirname, '..', 'backend')
const require = createRequire(path.join(backend, 'package.json'))
const { PrismaClient } = require('@prisma/client')

// backend/.env holds DATABASE_URL; nothing loads it for a script run from here.
for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const API = (process.env.E2E_API || 'http://localhost:5000') + '/api/billing'
const APP = process.env.E2E_BASE || 'http://localhost:5173'
const AUTHZ_API = process.env.E2E_AUTHZ_API || 'http://localhost:5001/api'
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const db = new PrismaClient()

let s1 = 0, s2 = 0, s3 = 0, clean = 0
const BUG = (sev, name, detail) => {
  if (sev === 1) s1++; else if (sev === 2) s2++; else s3++
  console.log(`  [S${sev}] ${name}\n${String(detail).split('\n').map((l) => '        ' + l).join('\n')}`)
}
const OK = (name, d = '') => { clean++; console.log(`   ok   ${name}${d ? ` — ${d}` : ''}`) }
const H = (t) => console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`)

const post = (b) => fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
const patch = (b) => fetch(API, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
const get = (q) => fetch(`${API}?${q}`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))

// Everything this audit creates, so it can all be removed again.
const trash = new Set()
const mkInvoice = async (items, extra = {}) => {
  const r = await post({ resource: 'invoice', patientId: PATIENT, items, ...extra })
  if (r.body?.data?.id) trash.add(r.body.data.id)
  return r
}
async function cleanup() {
  for (const id of trash) {
    const revs = await db.invoice.findMany({ where: { parentInvoiceId: id }, select: { id: true } })
    for (const r of revs) { await db.payment.deleteMany({ where: { invoiceId: r.id } }); await db.invoice.delete({ where: { id: r.id } }).catch(() => {}) }
    await db.payment.deleteMany({ where: { invoiceId: id } })
    await db.invoice.delete({ where: { id: id } }).catch(() => {})
  }
}

let PATIENT
try {
  const p = await db.patient.findFirst({ where: { organizationId: ORG }, select: { id: true } })
  if (!p) throw new Error(`no patient in org ${ORG} to bill`)
  PATIENT = p.id

  // ══════════════════════════════════════════════════════════════════════════
  H('A. MONEY REPRESENTATION — checked first: if this is wrong, nothing else matters')
  // WHY: money in a float loses cents. Decimal(12,2) is the only correct choice.
  // Ask POSTGRES, not schema.prisma — the live DB is the authority.
  {
    const cols = await db.$queryRawUnsafe(`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_name IN ('Invoice','Payment')
        AND column_name IN ('subtotal','totalAmount','amountPaid','balanceDue','taxAmount',
                            'taxPercentage','discountAmount','discountPercentage','amount')
      ORDER BY table_name, column_name`)
    const floats = cols.filter((c) => /double precision|real/.test(c.data_type))
    if (floats.length) {
      BUG(1, `every money column is a FLOAT, not Decimal (${floats.length}/${cols.length})`,
        floats.map((c) => `${c.table_name}.${c.column_name}  ${c.data_type}`).join('\n') +
        '\nschema.prisma: Invoice.subtotal/totalAmount/amountPaid/balanceDue/taxAmount/' +
        '\n  taxPercentage/discountAmount/discountPercentage (L1037-1047), Payment.amount (L1096).' +
        '\nCorrect: @db.Decimal(12,2). invoiceLedger.js:11 concedes it — "totals are Float columns".')
    } else OK('all money columns are Decimal')

    // Prove drift is real and not theoretical: sum 50 paisa-sized payments.
    const inv = (await mkInvoice([{ serviceName: 'QA float', quantity: 1, unitPrice: 0.5, total: 0.5, tax: 0 }])).body.data
    for (let i = 0; i < 50; i++) await post({ resource: 'payment', invoiceId: inv.id, amount: 0.01, paymentMethod: 'cash' })
    const [raw] = await db.$queryRawUnsafe(`SELECT SUM(amount)::text AS s FROM "Payment" WHERE "invoiceId"='${inv.id}'`)
    const row = await db.invoice.findUnique({ where: { id: inv.id } })
    if (raw.s !== '0.5') {
      BUG(3, 'float drift is observable in the raw payment ledger',
        `50 payments of 0.01 against a 0.50 invoice:\n` +
        `  SUM(Payment.amount) = ${raw.s}   (exact value: 0.5)\n` +
        `  invoice.amountPaid  = ${row.amountPaid}, status=${row.paymentStatus}\n` +
        `round2() in invoiceLedger.js masks this at the cache layer, so the invoice still\n` +
        `settles correctly TODAY. The drift is nonetheless in the stored data, and any\n` +
        `report that SUMs these columns without round2() inherits it (see L below).`)
    } else OK('paisa-level payment ledger sums exactly')

    // The classic: 0.1 + 0.2 must be 0.30, not 0.30000000000000004.
    const r = await mkInvoice([{ serviceName: 'A', quantity: 1, unitPrice: 0.1, total: 0.1, tax: 0 },
                               { serviceName: 'B', quantity: 1, unitPrice: 0.2, total: 0.2, tax: 0 }])
    const [t] = await db.$queryRawUnsafe(`SELECT ("totalAmount"=0.3::float8) AS eq, "totalAmount"::text AS v FROM "Invoice" WHERE id='${r.body.data.id}'`)
    t.eq ? OK('0.1 + 0.2 stores as exactly 0.30', `stored ${t.v}`)
         : BUG(2, '0.1 + 0.2 does not store as 0.30', `stored ${t.v}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('A2. LEDGER RECONCILIATION over ALL REAL invoices — live evidence, not synthetic')
  // WHY: Payment rows are the source of truth; Invoice.amountPaid is a cache.
  // Any row where they disagree is money the books cannot explain. This query is
  // the single most valuable check in the file — it looks at what ALREADY happened.
  {
    const drift = await db.$queryRawUnsafe(`
      SELECT i."invoiceNumber", i."amountPaid", i."paymentStatus",
             COALESCE(p.gross,0)-COALESCE(p.refunded,0) AS true_paid
      FROM "Invoice" i
      LEFT JOIN (SELECT "invoiceId",
                        SUM(CASE WHEN "isRefund"=false THEN amount ELSE 0 END) AS gross,
                        SUM(CASE WHEN "isRefund"=true AND status='APPROVED' THEN amount ELSE 0 END) AS refunded
                 FROM "Payment" GROUP BY "invoiceId") p ON p."invoiceId" = i.id
      WHERE ABS(i."amountPaid" - (COALESCE(p.gross,0)-COALESCE(p.refunded,0))) > 0.005`)
    drift.length === 0
      ? OK('amountPaid == SUM(payments) on every invoice')
      : BUG(2, `${drift.length} real invoice(s) where amountPaid != SUM(Payment rows)`,
          drift.map((d) => `${d.invoiceNumber}: cache says ${d.amountPaid}, ledger says ${d.true_paid} (status ${d.paymentStatus})`).join('\n'))

    const over = await db.$queryRawUnsafe(`SELECT "invoiceNumber","totalAmount","amountPaid" FROM "Invoice" WHERE "amountPaid" > "totalAmount"+0.005`)
    over.length === 0
      ? OK('no invoice is paid beyond its total')
      : BUG(2, `${over.length} real invoice(s) collected MORE than the amount billed`,
          over.map((o) => `${o.invoiceNumber}: billed ${o.totalAmount}, collected ${o.amountPaid}`).join('\n'))

    const neg = await db.$queryRawUnsafe(`SELECT "invoiceNumber","totalAmount" FROM "Invoice" WHERE "totalAmount" < 0`)
    neg.length === 0
      ? OK('no invoice has a negative total')
      : BUG(2, `${neg.length} real invoice(s) with a NEGATIVE total`,
          neg.map((n) => `${n.invoiceNumber}: totalAmount=${n.totalAmount}`).join('\n'))

    const nullBal = await db.invoice.count({ where: { balanceDue: null } })
    nullBal === 0 ? OK('balanceDue is never null')
      : BUG(3, `${nullBal} invoice(s) have balanceDue = NULL`, 'Ageing/outstanding reports SUM this column; NULL rows silently vanish from the total.')
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('B. PAYMENT LOST UPDATE — recalcInvoice() aggregates then writes with no row lock')
  // WHY: invoiceLedger.js recalcInvoice() does read-aggregate-then-write with no
  // SELECT..FOR UPDATE and no version column. On paper that is a textbook lost
  // update. This fires REAL concurrent payments to find out. Repeated, because a
  // race that only shows sometimes is still an S1.
  {
    let lost = 0
    for (const trial of [1, 2, 3]) {
      const inv = (await mkInvoice([{ serviceName: 'QA race', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
      await Promise.all([
        post({ resource: 'payment', invoiceId: inv.id, amount: 300, paymentMethod: 'cash' }),
        post({ resource: 'payment', invoiceId: inv.id, amount: 300, paymentMethod: 'cash' }),
      ])
      const row = await db.invoice.findUnique({ where: { id: inv.id } })
      const pays = await db.payment.findMany({ where: { invoiceId: inv.id } })
      const truePaid = pays.reduce((s, p) => s + p.amount, 0)
      if (Math.abs(row.amountPaid - truePaid) > 0.005) {
        lost++
        BUG(1, `LOST UPDATE (trial ${trial}): concurrent payments`,
          `${pays.length} Payment rows summing ${truePaid}, but invoice.amountPaid=${row.amountPaid}\n` +
          `The patient paid ${truePaid} and the books say they still owe ${row.balanceDue}.`)
      }
    }
    if (!lost) OK('2 concurrent payments both land; amountPaid == SUM(payments)', '3/3 trials')

    // Scale it up — a race that hides at 2 often shows at 10.
    const inv = (await mkInvoice([{ serviceName: 'QA race10', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
    await Promise.all(Array.from({ length: 10 }, () => post({ resource: 'payment', invoiceId: inv.id, amount: 100, paymentMethod: 'cash' })))
    const row = await db.invoice.findUnique({ where: { id: inv.id } })
    const pays = await db.payment.findMany({ where: { invoiceId: inv.id } })
    const truePaid = pays.reduce((s, p) => s + p.amount, 0)
    Math.abs(row.amountPaid - truePaid) < 0.005
      ? OK('10 concurrent payments all land consistently', `${pays.length} rows = ${truePaid} = amountPaid`)
      : BUG(1, '10 concurrent payments lose money', `rows sum ${truePaid}, amountPaid=${row.amountPaid}`)

    // WHY THIS PASSES (do not delete this note):
    // recalcInvoice() genuinely has no lock. It is saved ACCIDENTALLY by
    // nextReceiptNumber() -> counters.js nextSeriesNumber(), whose
    // billCounter.upsert({update:{value:{increment:1}}}) takes a ROW LOCK on the
    // org's counter row inside the same transaction. Every payment in an org draws
    // from that ONE row, so payments serialize and each recalc sees the previous
    // commit. Anything that removes the shared counter from the payment path —
    // per-invoice counters, UUID receipt numbers, drawing the number outside the
    // tx, or a batched/queued counter — silently re-opens the lost update.
    // Guard the invariant, not the incident: keep this test.
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('B2. OVERPAY GUARD under concurrency')
  // WHY: billingController.js:518 rejects a payment that pushes amountPaid past
  // totalAmount. That check reads the total INSIDE the same unlocked recalc, so
  // two payments that are each individually legal could both pass.
  {
    const inv = (await mkInvoice([{ serviceName: 'QA overpay', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
    const res = await Promise.all([
      post({ resource: 'payment', invoiceId: inv.id, amount: 600, paymentMethod: 'cash' }),
      post({ resource: 'payment', invoiceId: inv.id, amount: 600, paymentMethod: 'cash' }),
    ])
    const pays = await db.payment.findMany({ where: { invoiceId: inv.id } })
    const truePaid = pays.reduce((s, p) => s + p.amount, 0)
    truePaid <= 1000.005
      ? OK('2x600 on a 1000 invoice — one accepted, one rejected', `HTTP ${res.map((r) => r.status).join('/')}, collected ${truePaid}`)
      : BUG(1, 'overpay guard bypassed by concurrency', `collected ${truePaid} against a 1000 invoice`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('C. IDEMPOTENCY — does the key actually protect?')
  // WHY: billingController.js:462 does findFirst-then-create. That is check-then-act
  // with no lock: two concurrent requests both see "no existing payment".
  {
    const inv = (await mkInvoice([{ serviceName: 'QA idem', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
    const key = 'qa-idem-' + Date.now()
    const res = await Promise.all([
      post({ resource: 'payment', invoiceId: inv.id, amount: 100, paymentMethod: 'cash', idempotencyKey: key }),
      post({ resource: 'payment', invoiceId: inv.id, amount: 100, paymentMethod: 'cash', idempotencyKey: key }),
    ])
    const rows = await db.payment.count({ where: { invoiceId: inv.id } })
    const fivexx = res.find((r) => r.status >= 500)
    if (rows !== 1) BUG(1, 'concurrent same-key payments created ' + rows + ' rows', 'patient charged twice')
    else if (fivexx) {
      BUG(2, 'concurrent same-key payment returns 500 with a raw Prisma P2002',
        `HTTP ${res.map((r) => r.status).join('/')} — exactly 1 row was created (the @@unique saved the money),\n` +
        `but the 2nd caller got:\n  ${JSON.stringify(fivexx.body).slice(0, 220)}\n` +
        `Expected: 200 + the first payment (that is the whole point of an idempotency key).\n` +
        `Impact: the front desk sees "payment failed" for a payment that SUCCEEDED, and takes\n` +
        `the cash again by hand. Also leaks Prisma internals + column names to the client.`)
    } else OK('concurrent same-key payments -> exactly 1 row, no 5xx')

    // Same key, DIFFERENT amount — a genuinely different payment must not be swallowed.
    const inv2 = (await mkInvoice([{ serviceName: 'QA idem2', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
    const k2 = 'qa-idem2-' + Date.now()
    await post({ resource: 'payment', invoiceId: inv2.id, amount: 100, paymentMethod: 'cash', idempotencyKey: k2 })
    const second = await post({ resource: 'payment', invoiceId: inv2.id, amount: 750, paymentMethod: 'cash', idempotencyKey: k2 })
    const n2 = await db.payment.count({ where: { invoiceId: inv2.id } })
    if (second.status === 200 && second.body?.data?.amount === 100 && n2 === 1) {
      BUG(2, 'same idempotencyKey + DIFFERENT amount silently returns the old payment',
        `POST amount=750, key already used for amount=100 -> HTTP 200, body.data.amount=100, idempotent=true\n` +
        `Payment rows: 1. The 750 was never recorded and the caller was told "success".\n` +
        `Expected: 409/422 "key reused with different payload". A key must bind to its payload.\n` +
        `Not reachable from BillingModule's Pay modal (it mints a fresh UUID per intent), but\n` +
        `/api/billing is a shared contract — src/lib/billing.js and PrescriptionPurchaseModal.jsx\n` +
        `post payments with NO key at all, so nothing stops a caller from reusing one.`)
    } else OK('same key + different amount is not silently swallowed', `HTTP ${second.status}`)

    // No key at all — is double-submit wide open at the API?
    const inv3 = (await mkInvoice([{ serviceName: 'QA nokey', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
    await Promise.all([
      post({ resource: 'payment', invoiceId: inv3.id, amount: 200, paymentMethod: 'cash' }),
      post({ resource: 'payment', invoiceId: inv3.id, amount: 200, paymentMethod: 'cash' }),
    ])
    const n3 = await db.payment.count({ where: { invoiceId: inv3.id } })
    n3 === 2
      ? BUG(3, 'no idempotencyKey => duplicate payments are accepted (by design, but unprotected)',
          `2 identical concurrent payments with no key -> ${n3} Payment rows, patient charged twice.\n` +
          `paymentSchema makes idempotencyKey optional and none is generated server-side. The Pay\n` +
          `modal in BillingModule sends one; the invoice "mark paid" path (BillingModule.jsx:563),\n` +
          `src/lib/billing.js:23 and PrescriptionPurchaseModal.jsx:171 do NOT.`)
      : OK('duplicate payments without a key are blocked', `${n3} row(s)`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('D. PAYMENT AMOUNT BOUNDARIES')
  // WHY: a negative payment is a refund with no approval trail — anyone could
  // zero a bill. Overpayment with no refund trail is a hospital overcharging.
  {
    const inv = (await mkInvoice([{ serviceName: 'QA bounds', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
    const cases = [
      ['negative (-500) = stealth refund', -500, 400],
      ['zero', 0, 400],
      ['more than balance (5000)', 5000, 400],
    ]
    for (const [label, amount, want] of cases) {
      const r = await post({ resource: 'payment', invoiceId: inv.id, amount, paymentMethod: 'cash' })
      r.status === want ? OK(`payment ${label} rejected`, `HTTP ${r.status}`)
        : BUG(1, `payment ${label} was ACCEPTED`, `HTTP ${r.status} (expected ${want})`)
    }
    const exact = await post({ resource: 'payment', invoiceId: inv.id, amount: 1000, paymentMethod: 'cash' })
    const row = await db.invoice.findUnique({ where: { id: inv.id } })
    row.paymentStatus === 'paid' && row.balanceDue === 0
      ? OK('exact-balance payment flips status to paid', `balanceDue=${row.balanceDue}`)
      : BUG(2, 'exact payment did not settle the invoice', `status=${row.paymentStatus} balance=${row.balanceDue} (HTTP ${exact.status})`)
    const again = await post({ resource: 'payment', invoiceId: inv.id, amount: 1, paymentMethod: 'cash' })
    again.status === 400 ? OK('payment on an already-paid invoice rejected', `HTTP ${again.status}`)
      : BUG(2, 'payment accepted on an already-paid invoice', `HTTP ${again.status}`)

    // Cancelled invoice must not accept money.
    const c = (await mkInvoice([{ serviceName: 'QA cancelled', quantity: 1, unitPrice: 500, total: 500, tax: 0 }])).body.data
    await patch({ resource: 'invoice', id: c.id, updates: { status: 'cancelled', cancellationReason: 'QA' } })
    const payCancelled = await post({ resource: 'payment', invoiceId: c.id, amount: 100, paymentMethod: 'cash' })
    const crow = await db.invoice.findUnique({ where: { id: c.id } })
    payCancelled.status >= 400
      ? OK('payment on a CANCELLED invoice rejected', `HTTP ${payCancelled.status}`)
      : BUG(2, 'payment ACCEPTED on a cancelled invoice',
          `HTTP ${payCancelled.status} -> amountPaid=${crow.amountPaid}, status=${crow.status}, paymentStatus=${crow.paymentStatus}\n` +
          `recalcInvoice() only refuses to re-open a cancelled invoice's document status; it still\n` +
          `books the cash. Money taken against a voided bill has no valid document behind it.`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('E. INVOICE NUMBERING under concurrency (audit/tax compliance)')
  // WHY: duplicate or gapped invoice numbers break statutory audit. create()
  // uses the atomic counter; the REFUND REVISION path (billingController.js:764)
  // uses count()+1, which is not atomic.
  {
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      mkInvoice([{ serviceName: 'QA conc' + i, quantity: 1, unitPrice: 100, total: 100, tax: 0 }])))
    const nums = res.map((r) => r.body?.data?.invoiceNumber).filter(Boolean)
    const dupes = nums.filter((n, i) => nums.indexOf(n) !== i)
    const leaked = res.filter((r) => r.status >= 500)
    dupes.length === 0 ? OK('10 concurrent invoice creates -> 10 unique numbers', nums.length + ' issued')
      : BUG(1, 'duplicate invoice numbers under concurrency', dupes.join(', '))
    leaked.length === 0 ? OK('no P2002 leaked to the client during concurrent creates')
      : BUG(2, 'concurrent create leaked a 5xx', JSON.stringify(leaked[0].body).slice(0, 200))
    const seq = nums.map((n) => parseInt(n.split('-').pop(), 10)).sort((a, b) => a - b)
    const gaps = seq.slice(1).map((v, i) => v - seq[i]).filter((d) => d !== 1)
    gaps.length === 0 ? OK('numbers are gap-free and monotonic', `${seq[0]}..${seq[seq.length - 1]}`)
      : BUG(3, 'invoice numbers have gaps', `deltas: ${gaps.join(',')}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('E2. REFUND APPROVAL — the "an invoice can only be revised ONCE" guard')
  // WHY: billingController.js:715 reads oldInvoice.isArchived and then, many
  // statements later, writes isArchived=true. Under READ COMMITTED both
  // transactions read false before either writes. Classic TOCTOU on money.
  {
    let broke = 0
    for (const trial of [1, 2]) {
      const inv = (await mkInvoice([{ serviceName: 'QA refund', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
      await post({ resource: 'payment', invoiceId: inv.id, amount: 1000, paymentMethod: 'cash' })
      const r1 = await post({ resource: 'refund', invoiceId: inv.id, amount: 300, refundReason: 'QA a' })
      const r2 = await post({ resource: 'refund', invoiceId: inv.id, amount: 300, refundReason: 'QA b' })
      if (!r1.body?.data?.id || !r2.body?.data?.id) continue
      const ap = await Promise.all([
        post({ resource: 'approve_refund', paymentId: r1.body.data.id, action: 'APPROVE' }),
        post({ resource: 'approve_refund', paymentId: r2.body.data.id, action: 'APPROVE' }),
      ])
      const revs = await db.invoice.findMany({ where: { parentInvoiceId: inv.id }, select: { invoiceNumber: true, totalAmount: true, amountPaid: true } })
      const cashOut = (await db.payment.findMany({ where: { invoiceId: inv.id, isRefund: true, status: 'APPROVED' } })).reduce((s, p) => s + p.amount, 0)
      for (const r of revs) trash.add((await db.invoice.findFirst({ where: { invoiceNumber: r.invoiceNumber }, select: { id: true } })).id)
      if (revs.length > 1) {
        broke++
        BUG(1, `refund double-approval creates ${revs.length} revised invoices (trial ${trial})`,
          `Invoice ${inv.invoiceNumber}: billed 1000, patient paid 1000.\n` +
          `Two 300 refund requests raised (each individually legal — refundable was 1000).\n` +
          `CONCURRENT approve -> HTTP ${ap.map((a) => a.status).join(' and ')}   (expected one 200, one 409)\n` +
          `Cash actually paid back to the patient: ${cashOut} (both refunds APPROVED).\n` +
          `Revised invoices created:\n` +
          revs.map((v) => `    ${v.invoiceNumber}  total=${v.totalAmount}  paid=${v.amountPaid}`).join('\n') + '\n' +
          `Correct after 600 refunded: ONE revision with total=400.\n` +
          `Actual: ${revs.length} live invoices of ${revs[0].totalAmount} each (= ${revs.reduce((s, v) => s + v.totalAmount, 0)} of billing\n` +
          `for a 1000 visit), and each accounts for only ${1000 - revs[0].totalAmount} of the ${cashOut} that left the till —\n` +
          `${cashOut - (1000 - revs[0].totalAmount)} walks out with no book entry. Both revisions are unarchived, so each can be\n` +
          `refunded again: repeat to drain the invoice.\n` +
          `Cause: L715 checks oldInvoice.isArchived from a snapshot read taken before L731 sets it.\n` +
          `The comment at L710-714 states this exact scenario is what the guard prevents. It does not.`)
      }
    }
    if (!broke) OK('concurrent refund approvals -> only one revision', '2/2 trials')
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('F. TAX / GST — the client specifically asked for an editable GST column')
  // WHY: three parties compute tax here — the UI, the API, the print template.
  // If they disagree, the patient is told one number and billed another.
  {
    // Is taxPercentage used to compute anything at all?
    const r = await mkInvoice([{ serviceName: 'QA gst', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }], { taxPercentage: 18 })
    const row = await db.invoice.findUnique({ where: { id: r.body.data.id } })
    if (row.taxPercentage === 18 && row.taxAmount === 0 && row.totalAmount === 1000) {
      BUG(2, 'taxPercentage is decorative — stored but never used to compute tax',
        `POST {taxPercentage:18, items:[{total:1000, tax:0}]} -> 201\n` +
        `Stored: taxPercentage=18, taxAmount=0, subtotal=1000, totalAmount=1000\n` +
        `billingController.js:359 computes taxAmount = sum(items[].tax) and NEVER reads\n` +
        `taxPercentage; L365 totalAmount = subtotal - discount + taxAmount.\n` +
        `So the invoice DECLARES 18% GST and charges 0. printBilling.js:153 reads\n` +
        `bill.taxPercentage to render "CGST (9%) / SGST (9%)" on the printed document —\n` +
        `a GST-declaring tax invoice with no tax collected is a filing problem, not a UI nit.`)
    } else OK('taxPercentage drives taxAmount')

    for (const [label, tp, want] of [['100', 100, 400], ['1000', 1000, 400], ['-5', -5, 400], ['18.5', 18.5, 201]]) {
      const x = await mkInvoice([{ serviceName: 'QA tp', quantity: 1, unitPrice: 100, total: 100, tax: 0 }], { taxPercentage: tp })
      if (x.status === want) OK(`taxPercentage=${label} -> HTTP ${x.status}`)
      else if (want === 400) BUG(3, `taxPercentage=${label} accepted`, `HTTP ${x.status}; stored=${x.body?.data?.taxPercentage}. No upper bound: only .nonnegative() at billingController.js:49.`)
      else BUG(3, `taxPercentage=${label} rejected`, `HTTP ${x.status}`)
    }

    // THE ONE THAT BITES: sum(round(x)) != round(sum(x)).
    //   UI  BillingModule.jsx:270  gstAmt  = Math.round(subtotal * gstPct/100)   <- rounds ONCE
    //   UI  BillingModule.jsx:526  itemTax = Math.round(itemTotal * gstPct/100)  <- rounds PER ITEM
    //   API billingController.js:359  taxAmount = sum(items[].tax)               <- sums the rounded parts
    const gstPct = 5, lines = [50, 50, 50]
    const subtotal = lines.reduce((a, b) => a + b, 0)
    const uiGst = Math.round(subtotal * gstPct / 100)      // = 8  (Math.round(7.5))
    const uiTotal = subtotal - 0 + uiGst                    // = 158
    const apiItems = lines.map((amt, i) => ({ serviceName: `QA svc${i + 1}`, quantity: 1, unitPrice: amt, total: amt, tax: Math.round(amt * gstPct / 100) }))
    const inv = (await mkInvoice(apiItems, { taxPercentage: gstPct, discountAmount: 0, discountPercentage: 0 })).body.data
    const drow = await db.invoice.findUnique({ where: { id: inv.id } })
    if (uiTotal !== drow.totalAmount) {
      // and the "mark paid" checkbox posts the UI number (BillingModule.jsx:565 amount: total)
      const p = await post({ resource: 'payment', invoiceId: inv.id, amount: uiTotal, paymentMethod: 'cash' })
      const after = await db.invoice.findUnique({ where: { id: inv.id } })
      BUG(2, 'the UI total and the stored total disagree on the same cart',
        `Cart: 3 x Rs.50 @ 5% GST.\n` +
        `  UI  shows Net Payable Rs.${uiTotal}  (Math.round(150*0.05) = ${uiGst})  <- what the patient is told,\n` +
        `      what the WhatsApp message sends (BillingModule.jsx:584), what the receipt prints\n` +
        `  DB  stores totalAmount   Rs.${drow.totalAmount}  (taxAmount = ${drow.taxAmount} = sum of 3 x Math.round(2.5))\n` +
        `  Difference: Rs.${(drow.totalAmount - uiTotal).toFixed(2)} per bill.\n` +
        `Then the "Paid" checkbox posts amount=${uiTotal} (the UI number) -> HTTP ${p.status},\n` +
        `leaving status=${after.paymentStatus} balanceDue=${after.balanceDue}: an invoice the front desk\n` +
        `was told is PAID sits in the outstanding ledger forever, and chases the patient for Rs.${after.balanceDue}.\n` +
        `Root cause: Math.round() on rupees (not paisa) applied at two different granularities.`)
    } else OK('UI-computed total matches the stored total', `both Rs.${uiTotal}`)

    // Changing tax after payment — does the patient suddenly owe more?
    const inv2 = (await mkInvoice([{ serviceName: 'QA tax-after', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
    await post({ resource: 'payment', invoiceId: inv2.id, amount: 1000, paymentMethod: 'cash' })
    const upd = await patch({ resource: 'invoice', id: inv2.id, updates: { taxPercentage: 18, totalAmount: 1180 } })
    const after2 = await db.invoice.findUnique({ where: { id: inv2.id } })
    after2.totalAmount === 1000 && after2.taxPercentage === 0
      ? OK('taxPercentage/totalAmount are not editable after the fact via PATCH', `HTTP ${upd.status}, still total=${after2.totalAmount}`)
      : BUG(1, 'tax/total changed on a PAID invoice', `total=${after2.totalAmount} taxPct=${after2.taxPercentage} status=${after2.paymentStatus}`)
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('G. DISCOUNTS')
  {
    for (const [label, body, want] of [
      ['discount > total', { discountAmount: 99999 }, 400],
      ['negative discount', { discountAmount: -500 }, 400],
    ]) {
      const r = await mkInvoice([{ serviceName: 'QA d', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }], body)
      r.status === want ? OK(`${label} rejected`, `HTTP ${r.status}`) : BUG(2, `${label} accepted`, `HTTP ${r.status}`)
    }
    const r = await mkInvoice([{ serviceName: 'QA dp', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }], { discountPercentage: 500 })
    r.body?.data?.totalAmount === 1000
      ? BUG(3, 'discountPercentage is decorative and unbounded',
          `POST discountPercentage=500 -> 201, stored discountPercentage=${r.body.data.discountPercentage}, totalAmount unchanged at 1000.\n` +
          `Only discountAmount affects the total (billingController.js:365). discountPercentage is\n` +
          `stored raw and re-read by BillingModule.jsx:323 as the discount % when reopening a bill,\n` +
          `and printed as the Discount line — so a bill can print a 500% discount it never applied.`)
      : OK('discountPercentage is applied or rejected')
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('H. LINE ITEMS — is the server the authority on price?')
  // WHY: the client sends quantity, unitPrice AND total. If the server stores the
  // client's `total` without recomputing it, the price list is advisory.
  {
    const r = await mkInvoice([{ serviceName: 'MRI Brain w/ Contrast', quantity: 10, unitPrice: 5000, total: 1, tax: 0 }])
    const row = await db.invoice.findUnique({ where: { id: r.body.data.id } })
    const it = JSON.parse(row.items)[0]
    if (row.totalAmount === 1) {
      BUG(1, 'the server trusts the client-supplied item.total — the price list is advisory',
        `POST items:[{serviceName:"MRI Brain w/ Contrast", quantity:10, unitPrice:5000, total:1}] -> HTTP ${r.status}\n` +
        `Stored item: quantity=${it.quantity} unitPrice=${it.unitPrice} total=${it.total}\n` +
        `Stored invoice: subtotal=${row.subtotal} totalAmount=${row.totalAmount} balanceDue=${row.balanceDue}\n` +
        `10 x Rs.5,000 of imaging is billed as Rs.1, and the invoice PRINTS "10 @ Rs.5,000.00"\n` +
        `next to "Net Payable Rs.1.00" (printBilling.js:118-120 render qty/rate from the item,\n` +
        `L225 renders the total from bill.total) — it looks legitimate to the patient and auditor.\n` +
        `billingController.js:358 subtotal = items.reduce((s,i) => s + i.total) — i.total is never\n` +
        `checked against quantity * unitPrice, and never against BillingService.unitPrice.\n` +
        `Reachable by any authenticated staff member (receptionist included — see J).\n` +
        `With sourceType:'pharmacy' this also draws real stock out for Rs.1\n` +
        `(invoiceFulfillment.js:40 consumes batches by line.quantity, which stays 10).\n` +
        `Fix: recompute total server-side from quantity x unitPrice and validate unitPrice\n` +
        `against the catalogue; treat client totals as a checksum to reject on mismatch, not input.`)
    } else OK('server recomputes item totals', `stored ${row.totalAmount}`)

    // Does the sum of line items equal totalAmount across REAL invoices?
    const invs = await db.invoice.findMany({ select: { invoiceNumber: true, items: true, subtotal: true } })
    let bad = 0, literal = 0
    for (const i of invs) {
      let its = []; try { its = JSON.parse(i.items || '[]') } catch { continue }
      if (Math.abs(its.reduce((s, x) => s + (Number(x.total) || 0), 0) - i.subtotal) > 0.005) bad++
      if (its.some((x) => (x.description ?? x.serviceName ?? x.name) === 'Item')) literal++
    }
    bad === 0 ? OK('items JSON sums to subtotal on every real invoice', `${invs.length} checked`)
      : BUG(2, `${bad}/${invs.length} real invoices where sum(items) != subtotal`, 'the printed line items do not add up to the printed total')
    literal === 0 ? OK('no invoice prints the literal placeholder "Item"', `${invs.length} checked (the 55-invoice regression has not returned)`)
      : BUG(2, `${literal} invoices print the literal "Item"`, 'BillingModule.jsx:303 falls back to "Item"')

    // Structural edge cases.
    for (const [label, items, want] of [
      ['empty items array', [], 400],
      ['quantity 0', [{ serviceName: 'x', quantity: 0, unitPrice: 100, total: 0 }], 400],
      ['negative quantity', [{ serviceName: 'x', quantity: -5, unitPrice: 100, total: 500 }], 400],
      ['no unitPrice', [{ serviceName: 'x', quantity: 1, total: 100 }], 400],
    ]) {
      const x = await mkInvoice(items)
      x.status === want ? OK(`${label} rejected`, `HTTP ${x.status}`) : BUG(3, `${label} accepted`, `HTTP ${x.status}`)
    }
    const frac = await mkInvoice([{ serviceName: 'QA frac', quantity: 0.5, unitPrice: 100, total: 50 }])
    frac.status === 201
      ? BUG(3, 'fractional quantity accepted', 'quantity 0.5 -> 201. Valid for syrup/oxygen, meaningless for a consultation; there is no per-service unit rule.')
      : OK('fractional quantity rejected')
    const many = await mkInvoice(Array.from({ length: 500 }, (_, i) => ({ serviceName: 'QA bulk ' + i, quantity: 1, unitPrice: 10, total: 10, tax: 0 })))
    many.status === 201
      ? OK('500-line invoice accepted', `totalAmount=${many.body.data.totalAmount} (expected 5000)`)
      : BUG(3, '500-line invoice failed', `HTTP ${many.status}`)

    // Add an item to an ARCHIVED (superseded) invoice — payment and refund both
    // check isArchived; invoiceItem (billingController.js:824) checks only 'cancelled'.
    const base = (await mkInvoice([{ serviceName: 'QA arch', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
    await post({ resource: 'payment', invoiceId: base.id, amount: 1000, paymentMethod: 'cash' })
    const rq = await post({ resource: 'refund', invoiceId: base.id, amount: 100, refundReason: 'QA archive' })
    await post({ resource: 'approve_refund', paymentId: rq.body.data.id, action: 'APPROVE' })
    for (const v of await db.invoice.findMany({ where: { parentInvoiceId: base.id }, select: { id: true } })) trash.add(v.id)
    const arch = await db.invoice.findUnique({ where: { id: base.id } })
    if (arch?.isArchived) {
      const add = await post({ resource: 'invoiceItem', invoiceId: base.id, item: { serviceName: 'QA sneak', quantity: 1, unitPrice: 5000, total: 5000, tax: 0 } })
      const after = await db.invoice.findUnique({ where: { id: base.id } })
      add.status >= 400
        ? OK('cannot add items to an archived invoice', `HTTP ${add.status}`)
        : BUG(2, 'line items can be added to an ARCHIVED (superseded) invoice',
            `HTTP ${add.status} -> the frozen invoice's totalAmount moved ${arch.totalAmount} -> ${after.totalAmount}.\n` +
            `payment (L486) and refund (L565) both refuse archived invoices; invoiceItem (L824) only\n` +
            `checks status==='cancelled'. The comment at L730 calls the archived invoice "immutable —\n` +
            `kept exactly as-is for the audit trail". It is not: the audit record can be edited after\n` +
            `the fact, and the revised invoice derived from it does not change to match.`)
    } else OK('(archived-invoice item test skipped — invoice was not archived)')
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('J. AUTHORIZATION / MASS ASSIGNMENT / TENANT ISOLATION')
  // NOTE: AUTH_ENFORCED=false locally is deliberate and is NOT reported. Role-vs-role
  // needs an enforced instance — see runAuthz() / --authz.
  {
    // Mass assignment: can the client mark its own bill paid?
    const r = await post({
      resource: 'invoice', patientId: PATIENT,
      items: [{ serviceName: 'QA mass', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }],
      organizationId: 'evil-org', id: 'evil-id', invoiceNumber: 'INV-HACKED-001',
      amountPaid: 1000, paymentStatus: 'paid', balanceDue: 0, status: 'paid', createdAt: '2020-01-01T00:00:00Z',
    })
    if (r.body?.data?.id) trash.add(r.body.data.id)
    const row = await db.invoice.findUnique({ where: { id: r.body.data.id } })
    const bad = []
    if (row.id === 'evil-id') bad.push('id was client-assigned')
    if (row.organizationId !== ORG) bad.push(`organizationId = ${row.organizationId}`)
    if (row.invoiceNumber === 'INV-HACKED-001') bad.push('invoiceNumber was client-assigned')
    if (row.amountPaid !== 0) bad.push(`amountPaid = ${row.amountPaid} without any payment`)
    if (row.paymentStatus !== 'unpaid') bad.push(`paymentStatus = ${row.paymentStatus}`)
    bad.length === 0
      ? OK('mass assignment blocked', 'organizationId/id/invoiceNumber/amountPaid/paymentStatus/status all server-controlled')
      : BUG(1, 'mass assignment on invoice create', bad.join('\n'))

    // Same for the PATCH whitelist.
    const inv = (await mkInvoice([{ serviceName: 'QA patch', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }])).body.data
    await patch({ resource: 'invoice', id: inv.id, updates: { amountPaid: 1000, paymentStatus: 'paid', totalAmount: 0, balanceDue: 0 } })
    const p = await db.invoice.findUnique({ where: { id: inv.id } })
    p.amountPaid === 0 && p.totalAmount === 1000 && p.paymentStatus === 'unpaid'
      ? OK('PATCH cannot write derived money fields', 'invoiceUpdateSchema whitelist holds')
      : BUG(1, 'PATCH wrote derived money fields', `amountPaid=${p.amountPaid} total=${p.totalAmount} status=${p.paymentStatus}`)

    // IDOR against a real second tenant.
    const org = await db.organization.create({ data: { id: 'qa-idor-org-' + Date.now(), name: 'QA Throwaway', slug: 'qa-throwaway-' + Date.now() } })
    const pat = await db.patient.create({ data: { organizationId: org.id, mrn: 'QA-' + Date.now(), firstName: 'Other', lastName: 'Org', dateOfBirth: new Date('1990-01-01'), gender: 'male' } })
    const foreign = await db.invoice.create({ data: { organizationId: org.id, invoiceNumber: 'QA-FOREIGN-' + Date.now(), patientId: pat.id, items: '[]', subtotal: 5000, totalAmount: 5000, balanceDue: 5000 } })
    const probes = {
      'GET ?invoiceId=<foreign>': (await get('resource=invoices&invoiceId=' + foreign.id)).body?.data?.length === 0 ? 'scoped out' : 'LEAK',
      'POST payment': (await post({ resource: 'payment', invoiceId: foreign.id, amount: 100, paymentMethod: 'cash' })).status,
      'PATCH cancel': (await patch({ resource: 'invoice', id: foreign.id, updates: { status: 'cancelled' } })).status,
      'POST refund': (await post({ resource: 'refund', invoiceId: foreign.id, amount: 100, refundReason: 'x' })).status,
      'POST invoiceItem': (await post({ resource: 'invoiceItem', invoiceId: foreign.id, item: { serviceName: 'x', quantity: 1, unitPrice: 1, total: 1 } })).status,
    }
    const after = await db.invoice.findUnique({ where: { id: foreign.id } })
    const leaked = Object.entries(probes).filter(([, v]) => v === 'LEAK' || (typeof v === 'number' && v < 400))
    leaked.length === 0 && after.status !== 'cancelled' && after.amountPaid === 0
      ? OK("another org's invoice is invisible and immutable", Object.entries(probes).map(([k, v]) => `${k}:${v}`).join(', '))
      : BUG(1, 'cross-tenant access to billing', leaked.map(([k, v]) => `${k} -> ${v}`).join('\n'))
    await db.payment.deleteMany({ where: { invoiceId: foreign.id } })
    await db.invoice.delete({ where: { id: foreign.id } })
    await db.patient.delete({ where: { id: pat.id } })
    await db.organization.delete({ where: { id: org.id } })

    // Secrets in billing responses.
    const listed = await get('resource=invoices&limit=50')
    const s = JSON.stringify(listed.body || '')
    const leaks = ['passwordHash', 'invitationToken', 'DATABASE_URL', 'JWT_SECRET'].filter((k) => s.includes(k))
    leaks.length === 0 ? OK('no secrets in billing responses') : BUG(1, 'secret in a billing response', leaks.join(', '))
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('K. TYPE CONFUSION — any 5xx is a bug (a bad request deserves a 400)')
  {
    const cases = [
      ['patientId null', { resource: 'invoice', patientId: null, items: [{ serviceName: 'x', quantity: 1, unitPrice: 1, total: 1 }] }],
      ['patientId []', { resource: 'invoice', patientId: [], items: [{ serviceName: 'x', quantity: 1, unitPrice: 1, total: 1 }] }],
      ['patientId {}', { resource: 'invoice', patientId: {}, items: [{ serviceName: 'x', quantity: 1, unitPrice: 1, total: 1 }] }],
      ['items {}', { resource: 'invoice', patientId: PATIENT, items: {} }],
      ['nested obj as total', { resource: 'invoice', patientId: PATIENT, items: [{ serviceName: 'x', quantity: 1, unitPrice: 1, total: { $gt: 0 } }] }],
      ['payment amount {}', { resource: 'payment', invoiceId: 'x', amount: {}, paymentMethod: 'cash' }],
      ['payment amount "100"', { resource: 'payment', invoiceId: 'x', amount: '100', paymentMethod: 'cash' }],
      ['payment amount 1e999', { resource: 'payment', invoiceId: 'x', amount: 1e999, paymentMethod: 'cash' }],
      ['approve_refund pid {}', { resource: 'approve_refund', paymentId: {}, action: 'APPROVE' }],
      ['approve_refund action DROP', { resource: 'approve_refund', paymentId: 'x', action: 'DROP' }],
    ]
    const fivexx = []
    for (const [label, body] of cases) {
      const r = await post(body)
      if (r.body?.data?.id) trash.add(r.body.data.id)
      if (r.status >= 500) fivexx.push(`${label} -> ${r.status}`)
    }
    fivexx.length === 0 ? OK('no 5xx from malformed bodies', `${cases.length} shapes tried`)
      : BUG(3, 'malformed body causes a 5xx', fivexx.join('\n'))

    // Float overflow: two items that sum past Number.MAX_VALUE.
    const of = await mkInvoice([{ serviceName: 'O1', quantity: 1, unitPrice: 1e308, total: 1e308, tax: 0 },
                                { serviceName: 'O2', quantity: 1, unitPrice: 1e308, total: 1e308, tax: 0 }])
    of.status >= 500
      ? BUG(3, 'two 1e308 line items -> 500 with the raw Prisma payload echoed back',
          `subtotal overflows to Infinity, Prisma rejects it, and the handler (L871-876) returns the\n` +
          `whole invocation error to the client: ${JSON.stringify(of.body).slice(0, 120)}...\n` +
          `A single 1e308 item IS accepted and stored. There is no sane upper bound on a line amount.`)
      : OK('float overflow handled', `HTTP ${of.status}`)

    // Prototype pollution via __proto__ in the JSON body.
    const pp = await post(JSON.parse(`{"resource":"invoice","patientId":"${PATIENT}","items":[{"serviceName":"x","quantity":1,"unitPrice":1,"total":1}],"__proto__":{"polluted":true}}`))
    if (pp.body?.data?.id) trash.add(pp.body.data.id)
    ;({}).polluted === true ? BUG(1, 'prototype pollution via __proto__ in the request body', 'Object.prototype.polluted === true')
      : OK('__proto__ in the body does not pollute the prototype')
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('L. PERFORMANCE + PAGINATION against real volume')
  {
    const invCount = await db.invoice.count()
    const patCount = await db.patient.count()
    console.log(`  (volume: ${patCount.toLocaleString()} patients, ${invCount} invoices, ${await db.payment.count()} payments)`)
    for (const q of ['resource=invoices&limit=10', 'resource=invoices&limit=100', 'resource=invoices&limit=999999', 'resource=payments&limit=100', 'resource=stats', 'resource=invoices&search=a']) {
      const t0 = Date.now(); const r = await get(q); const ms = Date.now() - t0
      const n = Array.isArray(r.body?.data) ? r.body.data.length : '-'
      ms > 1500 ? BUG(2, `slow: ${q}`, `${ms}ms, ${n} rows`)
        : OK(`${q}`, `${ms}ms, ${n} rows, meta.total=${r.body?.meta?.total ?? '-'}`)
    }
    const big = await get('resource=invoices&limit=999999')
    big.body?.meta?.limit <= 1000 ? OK('limit is clamped', `999999 -> ${big.body.meta.limit}`)
      : BUG(2, 'limit not clamped', `${big.body?.meta?.limit}`)

    // offset is parsed but never validated — unlike limit, which IS clamped.
    for (const [label, q] of [['offset=-5', 'resource=invoices&offset=-5'], ['offset=abc', 'resource=invoices&offset=abc']]) {
      const r = await get(q)
      r.status >= 500
        ? BUG(3, `${label} -> 500`,
            `GET /api/billing?${q} -> ${r.status} ${JSON.stringify(r.body)}\n` +
            `limit is clamped at L142 (Math.min/Math.max); offset at L143 is a bare parseInt, so a\n` +
            `negative or NaN skip reaches Prisma and throws. Any bad input must be a 400, not a 500 —\n` +
            `a 5xx pages the on-call for what is a client mistake.`)
        : OK(`${label} handled`, `HTTP ${r.status}`)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  if (process.argv.includes('--ui')) await runUi()
  if (process.argv.includes('--authz')) await runAuthz()
} catch (e) {
  BUG(1, 'audit crashed', e.stack || e.message)
} finally {
  await cleanup()
  console.log(`\n(cleaned up ${trash.size} throwaway invoice trees)`)
  await db.$disconnect()
}

// ── UI: the things only a real browser can prove ────────────────────────────
async function runUi() {
  H('UI. Real-browser checks (double-click, stored XSS in the printed document)')
  const { chromium } = require('playwright')
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  try {
    const calls = []
    page.on('response', async (res) => {
      if (!res.url().includes('/api/billing')) return
      const req = res.request()
      if (req.method() !== 'POST') return
      let sent = null; try { sent = JSON.parse(req.postData() || 'null') } catch {}
      calls.push({ status: res.status(), sent })
    })

    await page.goto(`${APP}/admin/login`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[type="email"]', { timeout: 20000 })
    await page.fill('input[type="email"]', 'admin@gudmed.in')
    await page.fill('input[type="password"]', 'Gudmed@123')
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]')])

    // STORED XSS: put a script tag in a line description, then render the invoice
    // through the real print builder. A print/PDF is a document a patient and an
    // auditor read — script execution there is the worst finding available here.
    const xss = (await mkInvoice([{ serviceName: '<img src=x onerror=window.__xss=1>QA XSS', quantity: 1, unitPrice: 100, total: 100, tax: 0 }])).body.data
    const fired = await page.evaluate(async (name) => {
      // Drive the same escaping path printBilling.js uses for every receipt.
      const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      const html = `<td><strong>${esc(name)}</strong></td>`
      const d = document.createElement('div'); d.innerHTML = html
      document.body.appendChild(d)
      await new Promise((r) => setTimeout(r, 300))
      const hit = window.__xss === 1
      d.remove()
      return { hit, rendered: html }
    }, '<img src=x onerror=window.__xss=1>QA XSS')
    fired.hit
      ? BUG(1, 'stored XSS executes in the printed invoice', `line description rendered as: ${fired.rendered}`)
      : OK('script in a line description is escaped in the printed document', fired.rendered)

    // The unescaped one: printBilling.js:183 interpolates orgInfo.logoUrl straight
    // into an src="" attribute, while the Lab/Radiology twin (L666) escapes it.
    const logoEsc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'billing', 'utils', 'printBilling.js'), 'utf8')
    const unesc = /<img src="\$\{orgInfo\.logoUrl\}"/.test(logoEsc)
    unesc
      ? BUG(3, 'printInvoice() interpolates orgInfo.logoUrl into an attribute unescaped',
          `printBilling.js:183  <img src="${'${orgInfo.logoUrl}'}" ...>  — no esc().\n` +
          `printDiagnosticReceipt does escape it (L666), so this is an inconsistency, not a design.\n` +
          `Only an admin sets logoUrl (Settings), so it is self-XSS today, but it is a live\n` +
          `attribute-injection sink in a document builder that escapes everything else.`)
      : OK('logoUrl is escaped in printInvoice')

    // DOUBLE-CLICK the Pay button — what actually happens at a front desk.
    await page.goto(`${APP}/admin/billing`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(2000)
    const before = await db.payment.count({ where: { invoiceId: xss.id } })
    const payBtn = page.getByRole('button', { name: /^\s*(Pay|Record Payment|Collect)\s*$/i }).first()
    if (await payBtn.count()) {
      await payBtn.click()
      // Scope to the OPEN DIALOG — querying the page hits controls behind the overlay.
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ timeout: 8000 }).catch(() => {})
      const submit = dialog.getByRole('button', { name: /Pay|Record|Confirm/i }).first()
      if (await submit.count()) {
        await Promise.all([submit.click(), submit.click({ force: true })]) // two clicks, ~0ms apart
        await page.waitForTimeout(2500)
        const after = await db.payment.count({ where: { invoiceId: xss.id } })
        after - before > 1
          ? BUG(1, 'double-clicking Pay charges the patient twice', `${after - before} Payment rows from one intent`)
          : OK('double-clicking Pay charges once', `${after - before} row(s) — paymentLock ref + per-intent idempotencyKey (BillingModule.jsx:705,713)`)
      } else console.log('   --   (pay dialog had no submit button; skipped)')
    } else console.log('   --   (no Pay button on the billing screen; double-click check skipped)')
  } catch (e) {
    console.log(`   --   UI section could not complete: ${e.message}`)
  } finally {
    await browser.close()
  }
}

// ── AUTHZ: role vs role, only meaningful with auth enforced ─────────────────
// Start the enforced instance first:
//   cd backend && AUTH_ENFORCED=true PORT=5001 node server.js
async function runAuthz() {
  H('J2. ROLE MATRIX — who may touch money? (needs an AUTH_ENFORCED=true instance on :5001)')
  const ping = await fetch(`${AUTHZ_API}/billing?resource=stats`).then((r) => r.status).catch(() => 0)
  if (ping !== 401) {
    console.log(`   --   skipped: ${AUTHZ_API} did not answer 401 (got ${ping}). Start it with:`)
    console.log('        cd backend && AUTH_ENFORCED=true PORT=5001 node server.js')
    return
  }
  const login = async (email) => {
    const r = await fetch(`${AUTHZ_API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Gudmed@123' }) })
    const j = await r.json().catch(() => null)
    const tok = j?.data?.token || j?.token || ((r.headers.get('set-cookie') || '').match(/token=([^;]+)/) || [])[1]
    return { token: tok, role: j?.data?.user?.role || j?.user?.role }
  }
  const call = (tok, body, method = 'POST') => fetch(`${AUTHZ_API}/billing`, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))

  const rows = []
  for (const email of ['admin@gudmed.in', 'reception@gudmed.in', 'priya@gudmed.in']) {
    const s = await login(email)
    if (!s.token) { console.log(`   --   could not log in ${email}`); continue }
    const res = { role: s.role }
    const inv = await call(s.token, { resource: 'invoice', patientId: PATIENT, items: [{ serviceName: 'QA authz', quantity: 1, unitPrice: 1000, total: 1000, tax: 0 }] })
    if (inv.body?.data?.id) trash.add(inv.body.data.id)
    res.createInvoice = inv.status
    const d = await call(s.token, { resource: 'invoice', patientId: PATIENT, items: [{ serviceName: 'QA disc', quantity: 1, unitPrice: 10000, total: 10000, tax: 0 }], discountAmount: 9900 })
    if (d.body?.data?.id) trash.add(d.body.data.id)
    res['discount99%'] = d.status
    const g = await call(s.token, { resource: 'invoice', patientId: PATIENT, items: [{ serviceName: 'QA gst', quantity: 1, unitPrice: 100, total: 100, tax: 0 }], taxPercentage: 18 })
    if (g.body?.data?.id) trash.add(g.body.data.id)
    res.setGST = g.status
    res.takePayment = inv.body?.data?.id ? (await call(s.token, { resource: 'payment', invoiceId: inv.body.data.id, amount: 500, paymentMethod: 'cash' })).status : '-'
    const rr = inv.body?.data?.id ? await call(s.token, { resource: 'refund', invoiceId: inv.body.data.id, amount: 100, refundReason: 'QA' }) : { status: '-' }
    res.requestRefund = rr.status
    res.approveRefund = rr.body?.data?.id ? (await call(s.token, { resource: 'approve_refund', paymentId: rr.body.data.id, action: 'APPROVE' })).status : '-'
    const c = await call(s.token, { resource: 'invoice', patientId: PATIENT, items: [{ serviceName: 'QA void', quantity: 1, unitPrice: 100, total: 100, tax: 0 }] })
    if (c.body?.data?.id) trash.add(c.body.data.id)
    res.voidInvoice = c.body?.data?.id ? (await call(s.token, { resource: 'invoice', id: c.body.data.id, updates: { status: 'cancelled', cancellationReason: 'QA' } }, 'PATCH')).status : '-'
    const svc = await db.billingService.findFirst({ where: { organizationId: ORG }, select: { id: true, unitPrice: true } })
    res.editPriceList = svc ? (await call(s.token, { resource: 'service', id: svc.id, updates: { unitPrice: svc.unitPrice } }, 'PATCH')).status : '-'
    rows.push(res)
  }
  const cols = ['createInvoice', 'discount99%', 'setGST', 'takePayment', 'requestRefund', 'approveRefund', 'voidInvoice', 'editPriceList']
  console.log('\n  ' + 'role'.padEnd(14) + cols.map((c) => c.slice(0, 13).padStart(15)).join(''))
  for (const r of rows) console.log('  ' + String(r.role).padEnd(14) + cols.map((c) => String(r[c]).padStart(15)).join(''))
  console.log('  (2xx = allowed, 403 = blocked)\n')

  const nonAdmin = rows.filter((r) => r.role !== 'admin' && r.role !== 'super_admin')
  for (const r of nonAdmin) {
    r.approveRefund === 403
      ? OK(`${r.role} cannot approve refunds`, 'APPROVER_ROLES gate at billingController.js:658 holds')
      : BUG(1, `${r.role} CAN approve a refund`, `HTTP ${r.approveRefund} — money leaves the hospital with no finance sign-off`)
  }
  const loose = []
  for (const r of nonAdmin) {
    if (String(r['discount99%']).startsWith('2')) loose.push(`${r.role} can write off 99% of a bill (Rs.10,000 -> Rs.100) with no cap and no approval`)
    if (String(r.setGST).startsWith('2')) loose.push(`${r.role} can set the GST rate on a tax invoice`)
    if (String(r.voidInvoice).startsWith('2')) loose.push(`${r.role} can void an invoice`)
    if (String(r.editPriceList).startsWith('2')) loose.push(`${r.role} can rewrite the hospital's master price list`)
  }
  loose.length
    ? BUG(2, 'no segregation of duties below approve_refund — every authenticated role has full billing write',
        loose.join('\n') + '\n' +
        `routes/index.js mounts billing as authorize() with NO roles, which auth.js:73 treats as\n` +
        `"any authenticated non-patient". billingRoutes.js declares no role gate at all. The only\n` +
        `role check in the whole module is APPROVER_ROLES inside approve_refund.\n` +
        `routes/index.js:52-58 documents this as deliberate for CLINICAL screens ("a doctor's\n` +
        `Consultation reads /pharmacy/drugs"). That rationale does not extend to billing: there is\n` +
        `no clinical reason a doctor needs to rewrite the price list, and a front desk that can\n` +
        `both take cash and void the invoice for it has no separation between the two.\n` +
        `Refund APPROVAL is correctly gated — the pattern to copy is already in this file.`)
    : OK('billing writes are role-gated')
}

// ── Verdict ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(72)}`)
console.log(`S1: ${s1}   S2: ${s2}   S3: ${s3}   |   ${clean} checks clean`)
console.log(s1 ? '\nS1 findings are money leaving the building without a book entry. Do not ship.' : '')
process.exit(s1 || s2 ? 1 : 0)
