# Pre-Production Security & Quality Audit — GudMed HMS

> Red-team code audit. Findings are backed by `file:line` evidence (verified by
> direct reading + three focused review passes). **Coverage is partial and
> honest** — see "Coverage & Gaps". This is a code REVIEW, not a test run; where a
> finding was reproduced by running, it is noted.

_Generated: 2026-07-08_

---

## LIVE PRODUCTION INCIDENT (already fixed) — invoice-number collision

**Symptom:** every `POST /api/billing` (create invoice) returned `500` for every
patient. **Real cause (reproduced + fixed):** after data was migrated into the
fresh `gudmed-db-2`, invoices were copied but `BillCounter` was NOT, so the
counter sat at 1 while `INV-2026-27-000018` already existed. Each create collided
on the `@unique` invoiceNumber (Prisma **P2002**); the failed transaction rolled
back the counter increment too, so it never advanced → permanent deadlock.
- Fix shipped: `nextInvoiceNumber` (`billingController.js:116`) now reconciles the
  counter with the real max invoice and jumps past it (commit `69cbf5d`).
- Also shipped: billing errors now surface the real Prisma code/meta instead of a
  blanket "Internal server error" (commit `5fa5b98`).
- **Verified by running:** forced the local counter to 1 behind 18 invoices → the
  create healed to `INV-...-000019` and kept incrementing.

---

## CRITICAL FINDINGS

### C1 — `AUTH_ENFORCED` defined two ways → demo-password backdoor
`middleware/auth.js:9-12` (prod = enforced) vs `authController.js:32` (unset = demo
ON). In demo mode `authController.js:34-40` accepts `Gudmed@123` for ANY account and
overwrites its hash. If the flag isn't explicitly `'true'` in prod → log in as any
staff email → full account takeover.
**NOTE:** owner asked to KEEP the demo login as-is for demos — the safe fix is to
gate the demo password to non-production ONLY, not remove it. Deferred per owner.

### C2 — Hardcoded `/import` secret = unauthenticated cross-tenant DB write/delete
`importController.js:13-16` accepts the literal `'GudMedImport2026!'` (committed in
repo) regardless of env; `/import` is mounted BEFORE `authenticate`
(`routes/index.js:32-33`). Bulk-upserts every model incl. `user`, and can
`deleteMany`. Anyone with the header injects an admin or wipes data.

### C3 — Cross-tenant IDOR: Lab & Radiology updates write by `id`, no org filter
`laboratoryController.js:331-364`, `radiologyController.js:380-419` `update({where:{id}})`
from `req.body`, no `organizationId` check → Org-A can alter Org-B **clinical lab
results / radiology reports** (patient-safety, not just leakage).

### C4 — Billing payment has NO idempotency → double-charge
`billingController.js:395-494`; `Payment` model has no `idempotencyKey`. Two identical
POSTs each create a payment and each `increment` amountPaid.

### C5 — "Record payment" button not disabled + no guard → duplicate payments
`BillingModule.jsx:567` `recordPayment` sets no saving state; button (`~1403`) has NO
`disabled`. Every click fires another payment. With C4, nothing stops triple-charge.

---

## HIGH FINDINGS

- **H1 — Cross-tenant PHI disclosure via Notifications** `notificationController.js:27-196`
  — consultation/prescription/invoice/lab/radiology `findUnique({where:{id}})` with no
  org filter; returns patient PII + fires WhatsApp to the victim's phone.
- **H2 — Multi-tenant fail-open `org-demo` fallback** `reqContext.js:17-19` (+ dup in
  authController, laboratoryController, notificationController, whatsappBotController).
- **H3 — JWT secret defaults to `'secret'`** outside `NODE_ENV==='production'`
  (`config/security.js:6`) → forge admin JWT on any staging/mislabeled deploy.
- **H4 — No rate limiting on auth** (`server.js:54-76`) → unlimited credential stuffing.
- **H5 — `createInvoiceWithPayment` two POSTs, no rollback** (`src/lib/billing.js:14-32`)
  → invoice created but payment fails = orphaned unpaid invoice while cash collected.
- **H6 — Pharmacy stock TOCTOU** `sale.controller.js:87-101` reads stock then decrements
  with no row lock → oversell / negative stock under concurrency.

---

## MEDIUM FINDINGS

- **M1 — Opaque 500 for all billing DB errors** — PARTIALLY FIXED (now surfaces Prisma
  code in billing create; other controllers still generic).
- **M2 — CORS reflects any `*.vercel.app` with credentials** (`server.js:48,57,61`).
- **M3 — No start-of-handler guard clause** in saveInvoice/handleSale/handleSaveOrder/
  handleCreateOrder (rely on `disabled` only; async re-render race).
- **M4 — `RCP`+`Date.now()` receipt numbers** collide on `@unique` same-ms
  (`billingController.js:413,502`) → P2002 on a legit second payment.
- **M5 — Money stored/computed as `Float`** (schema + GST back-calc) → paisa drift.
- **M6 — Schema via `prisma db push`, no migration history** (`render.yaml:5`) → future
  rename/drop risks silent data loss. (Also the ROOT of the live incident class.)

---

## FINAL SUMMARY

**Counts:** Critical 5 · High 6 · Medium 6 · (Low: not separately enumerated).

**Scores:** Security **2/10** · Architecture 5/10 · Database 4/10 · Backend 4/10 ·
Frontend 5/10 · **Production Readiness ≈ 25/100**.

**Release recommendation: 🚫 DO NOT RELEASE** with real patient data until C1–C5 +
H1–H3 are fixed. (Fine for controlled demos.)

**Stop-the-release issues:** C1, C2, C3, C4/C5.

**Top-10 most dangerous:** 1) C2 unauth `/import` 2) C1 demo-password backdoor 3) C3
cross-tenant clinical tampering 4) C4+C5 double-charge 5) H1 PHI disclosure 6) H3
forgeable JWT 7) H2 org-demo fallback 8) H4 no rate limiting 9) H6 oversell / H5
orphaned invoice 10) M-class money/opaque-error issues.

**Priority fix order:** (1) `/import` behind auth + drop hardcoded secret · (2) org
filters on lab/radiology update + notifications · (3) payment idempotency + disable
button · (4) gate demo password to non-prod · (5) env-gate org-demo fallback ·
(6) rate limiting + CORS allowlist · (7) Decimal money + Prisma migrations.

**Re-test checklist:** `/import` 401 without admin token; Org-A cannot read/update
Org-B lab/radiology/notification (401/404); double-click "Record payment" = exactly
one payment; invoice-then-payment failure leaves no orphan; two concurrent last-unit
sales → one fails, stock never negative; forged JWT rejected on staging; billing
unknown-patient returns clean 404 not 500 (DONE).

---

## Coverage & Gaps (honest)
- **NOT** every file inspected — a full HMS is too large for one pass.
- **Covered:** auth/RBAC/tenant isolation, billing/payment/pharmacy money-integrity &
  concurrency, the live 500, the shared billing helpers.
- **NOT covered:** IPD admission/discharge internals, appointments/scheduler, file
  uploads, reports/PDF, insurance, ambulance, death-certificate, HL7/machine
  integration, frontend perf profiling, accessibility, dependency-CVE scan.

## Status of fixes
- ✅ Live billing 500 (counter) — fixed + verified + deployed.
- ✅ Billing error surfacing — fixed + deployed.
- ⏳ C2–C5, H1–H6 — a hardening branch (`security-fixes-critical`) exists; these are
  NOT yet applied. C1 (demo login) intentionally left as-is per owner.

---
---

# ROUND 2 — Remaining Modules (Insurance, Ambulance, DayCare, Death-Cert, Appointments, Uploads, IPD scan)

_Method: pattern-scanned EVERY controller + inpatient/pharmacy services for tenant
gaps (update/delete/find by bare `id`), then read the hits. New findings below._

## CRITICAL (new)

### R1 — Cross-tenant IDOR cluster in the "secondary" modules (update + delete with NO org filter)
The core modules (pharmacy, billing, IPD, fee-slab, doctor-accountability, settings,
patient-portal) correctly guard writes with `findFirst({ id, organizationId })`
first. **These do NOT** — they take `id` from the request and write directly, so any
authenticated user in Org-A can tamper with / destroy Org-B's records (CUIDs are
enumerable):
- **Insurance** — `insuranceController.js`
  - `updateCase` `:95` `insuranceCase.update({ where:{ id }})` — no org check → change
    another org's coverageLimit / status / payer.
  - `updateClaim` `:143` `insuranceClaim.update({ where:{ id }})` — no org check → set
    another org's **claimAmount / approvedAmount / status='settled'** (MONEY tampering).
  - `remove` `:176-177` `insuranceClaim.delete` / `insuranceCase.delete({ where:{ id }})`
    — no org check → **delete another org's insurance case (claims cascade)**.
- **Ambulance** — `ambulanceController.js:125` `ambulanceTrip.delete({ where:{ id }})` — no org check.
- **Day-Care** — `dayCareController.js:139` `dayCareCase.delete({ where:{ id }})` — no org check.
- **Death-Certificate** — `deathCertificateController.js:132` `deathCertificate.delete({ where:{ id }})`
  — no org check AND no `if (!id)` guard → cross-tenant deletion of legal death records.
**Fix:** every one must `findFirst({ where:{ id, organizationId }})` (or `updateMany`/
`deleteMany` scoped by `organizationId`) before/instead of the bare-id write. Same
class as C3 — this is systemic across the newer/smaller modules.

## HIGH (new)

### R2 — Unrestricted file upload + ephemeral-disk data loss
`routes/patientPortalRoutes.js:7-17` — `multer({ storage })` has **no `fileFilter`
and no `limits`**:
- Any type accepted (`.html`/`.svg` with embedded JS, `.exe`, …). If a document is
  ever served inline, it's **stored XSS**; at minimum it's a malware-hosting vector.
- No size limit → one patient uploads a multi-GB file → **disk-exhaustion DoS**.
- Files are written to local disk `uploads/patient-documents/`. On Render the
  filesystem is **ephemeral**, so **every deploy/restart DELETES all uploaded patient
  documents** — silent data loss of clinical records.
**Fix:** add `fileFilter` (allowlist pdf/jp/png), `limits.fileSize`, and move storage
to S3/object storage (not the container disk).

## MEDIUM (new)

### R3 — Appointment double-booking: no slot-conflict check
`appointmentController.js` create (`~218`) inserts the appointment with no query for
an existing appointment on the same `doctorId + appointmentDate + appointmentTime`.
Two patients (or a double-submit) can book the **same doctor at the same time**.
**Fix:** inside the transaction, check for a conflicting non-cancelled appointment
before create; add a partial unique index on (doctorId, date, time) where active.

### R4 — Insurance claim can exceed policy coverage limit
`insuranceController.js createClaim:105-127` never checks `claimAmount` against the
case's remaining balance (`coverageLimit − amountUsed`, which `withUsage` computes for
display only). Claims can be created/approved beyond what the policy covers.
**Fix:** validate `claimAmount`/`approvedAmount` against remaining balance server-side.

## Verified SAFE (skeptical contrast — checked, guarded correctly)
- Pharmacy drug/batch/prescription update — `findFirst({ id, organizationId })` first.
- Billing invoice update, Settings toggleUserStatus, Fee-slab delete,
  Doctor-commission delete, IPD admission/bed update+delete (`ownedAdmission`/
  `ownedBed`), Patient-portal document delete (`doc.patientId === req.user.patientId`).

## Round-2 coverage & remaining gaps
- **Scanned:** all 26 controllers + 12 inpatient services + 7 pharmacy controllers for
  the tenant-write gap; read every hit.
- **Still NOT deep-audited:** IPD discharge money math & status transitions in full,
  HL7 listener robustness, WhatsApp/Twilio abuse, consultation cascade deletes,
  scheduler/reminders, frontend perf/accessibility, dependency CVEs. Recommend a
  Round 3 for those.

## Updated totals (Round 1 + Round 2)
- Critical **6** (C1–C5 + R1) · High **7** (H1–H6 + R2) · Medium **8** (M1–M6 + R3–R4).
- Security score unchanged at **2/10**; **Release recommendation still 🚫 DO NOT
  RELEASE** with real multi-tenant patient data until the IDOR cluster (C3 + R1) and
  the auth/import holes (C1/C2) are closed.

---
---

# ROUND 3 — IPD money/discharge, HL7, WhatsApp bot, dependencies, payments

## HIGH (new)

### R5 — IPD discharge `force:true` bypasses the paid-bill gate with no authorization
`inpatientController.js:1899-1930` — a NORMAL discharge for a CASH payer is blocked if
`balanceDue > 0`, BUT the whole gate is skipped when the request body contains
`force: true` (`:1909 if (typeCfg.requireClearances && !force)`). There is **no role
check** on `force` — any user who can hit discharge-finalize can release a patient
with an unpaid bill. **Revenue leak / broken financial control.**
**Fix:** gate `force` behind an admin/billing role (and audit who forced it).

### R7 — WhatsApp bot is hard-pinned to ONE org (`org-demo`) → cross-tenant mixing
`whatsappBotController.js:5` `const ORG_ID = process.env.ORGANIZATION_ID || 'org-demo'`
is a module-level constant used for every bot DB operation (`:175, :196, :221`). In a
multi-tenant deploy, ALL WhatsApp-bot flows (pharmacy orders, patient lookups) run
against `org-demo` regardless of which hospital the patient actually belongs to →
cross-tenant data creation/disclosure via the bot channel. (Concrete instance of H2.)
**Fix:** resolve the org from the inbound number's mapped tenant, not a module const.

### R8 — Known HIGH-severity CVEs in production dependencies (fix available)
`npm audit --omit=dev` → **2 high**:
- **`multer ≤2.1.1`** — DoS via deeply nested field names + incomplete cleanup of
  aborted uploads. **Compounds R2** (the upload endpoint has no limits) → easy DoS.
- **`form-data 4.0.0-4.0.5`** — CRLF injection via unescaped multipart field names.
Both fixable via `npm audit fix`. **Fix:** run it + re-test uploads / outbound multipart.

## MEDIUM (new)

### R6 — IPD discharge is non-atomic: TOCTOU balance check + best-effort bill finalize
`inpatientController.js` — the outstanding-balance check (`:1915 getCurrentBill`) runs
OUTSIDE the discharge transaction (`:1942`), and `finalizeBill` runs AFTER the patient
is already marked discharged + bed freed, inside a swallowed `try/catch`
(`:1985-1992`). If finalize throws, the discharge still "succeeds" but the bill is
left un-frozen/inconsistent (bed charges may keep accruing), silently. Also a
race: charges added between the check and the discharge are not re-validated.
**Fix:** compute balance and finalize the bill INSIDE the discharge transaction so
discharge + bill-freeze commit or roll back together.

## Verified SAFE (Round 3 contrast — checked, correct)
- **Razorpay payments** — `paymentController.js:43,136` verify the Razorpay signature
  on BOTH `/payments/verify` and `/payments/webhook` before crediting; invalid → 400.
  No fake-payment confirmation path. (Minor: `/verify` sets `amountPaid =
  invoice.totalAmount` rather than the verified captured amount — fine for
  full-amount orders, worth tightening for partials.)
- **HL7 listener/parser** — `hl7Listener.js` wraps TCP + parse + ACK in try/catch,
  guards missing port/socket, `hl7Parser.js` throws cleanly on empty input and uses
  only `String()`/`split()` (no eval/exec). Reasonably crash-safe.
- **IPD payments** (`billPaymentService.js`) — uses `idempotencyKey` + an atomic
  per-FY receipt counter (the correct pattern the main billing path lacks, C4/M4).

## Round-3 coverage & remaining gaps
- **Covered:** IPD discharge/billing gates, HL7 listener/parser, WhatsApp-bot org
  scoping, Razorpay signature path, prod dependency CVEs.
- **Still NOT covered:** full IPD tariff/charge math correctness, consultation
  cascade-delete ownership (`consultationController.js:302-390`), scheduler/reminder
  jobs, frontend performance/accessibility, exhaustive input-fuzzing. A Round 4 could
  close these, but the money/security/patient-safety core is now well mapped.

## FINAL updated totals (Round 1 + 2 + 3)
- **Critical 6** (C1–C5, R1) · **High 10** (H1–H6, R2, R5, R7, R8) · **Medium 9**
  (M1–M6, R3, R4, R6).
- **Security 2/10 · Production Readiness ≈ 25/100 · 🚫 DO NOT RELEASE** with real
  multi-tenant patient data until: the IDOR cluster (C3 + R1), the auth/import holes
  (C1, C2), payment double-charge (C4/C5), and the dependency CVEs (R8) are fixed.
- **Quick wins available now:** `npm audit fix` (R8), add multer `fileFilter`+`limits`
  (R2), add org filters to the 4 secondary modules (R1) — all low-risk, high-value.

---
---

# ROUND 4 — IPD charge math, consultation cascade, frontend scale

## MEDIUM (new)

### R9 — IPD bill-number counter has the SAME migration-lag collision risk as the (fixed) OPD counter
`inpatient/billService.js:84-94` `finalizeBill` uses `billCounter` (series `IPD`)
with `upsert(create value:0) → increment`, but does **not** reconcile against the max
existing IPD bill number. `Bill.billNumber` is unique per org
(`@@unique([organizationId, billNumber])`). If IPD bills were ever migrated into a
fresh DB without their counter (exactly what caused the live OPD incident), the first
`finalizeBill` would generate `IPD-<FY>-000001`, collide (P2002), roll back the
increment, and **deadlock IPD bill finalization** the same way. The OPD path was
fixed (`nextInvoiceNumber` self-heals); the IPD path was NOT.
**Fix:** apply the same reconcile-to-max pattern in `finalizeBill`.

### R10 — Many modules load UNBOUNDED datasets into the browser (scale/perf)
On mount, several modules fetch huge lists client-side instead of server-side search:
- `/patients?limit=1000` — Ambulance `:61`, DayCare `:56`, Insurance `:57`, Radiology `:175`
- `/pharmacy/drugs?limit=5000` — Pharmacy `:279`, OPD `:169`, PrescriptionPurchaseModal `:78`
- `/pharmacy/{prescriptions,batches,purchase-orders}?limit=5000` — Pharmacy `:280-282`
- `/laboratory?resource={tests,orders,results}&limit=2000` — Laboratory `:358,373,408`
- **OpdModule `:167-171`** loads ~500 patients + 5000 drugs + 1000 tests + 1000 exams
  **in one mount**.
At a real hospital (tens of thousands of patients/drugs) these become multi-MB
payloads + slow first paint + browser memory bloat, and silently TRUNCATE at the cap
(so a patient/drug beyond row 5000 is invisible/unselectable → correctness bug too).
**Fix:** use the debounced server-search pattern already implemented in
`components/common/PatientLookup.jsx` for these pickers, and paginate the lists.

## Verified SAFE (Round 4 contrast — checked, correct)
- **IPD tariff/charge math** (`tariffService.js`, `billService.js`) — careful `round2`
  throughout, calendar-day census-hour bed counting (fixes an earlier double-count on
  same-day transfer), frozen per-line tax snapshot with legacy fallback, atomic IPD
  bill counter, immutable FINAL bills with cancel-and-reissue. Genuinely solid; the
  only gap is R9 (counter reconcile) and the shared M5 (Float underneath).
- **Consultation delete** (`consultationController.js:361-392`) — verifies ownership
  (`findFirst({ id, organizationId })` + doctor scoping) BEFORE cascading deletes of
  lab/radiology/prescriptions inside a transaction. Correct.
- Minor code smell: bed-day segment-assignment has redundant/overridden branches
  (`tariffService.js:257-263`) — no billing impact, worth simplifying.

## Round-4 coverage & remaining gaps
- **Covered:** IPD tariff/charge/bed-day math, IPD bill counter, consultation cascade
  ownership, frontend unbounded-fetch scale.
- **Still NOT covered:** exhaustive input fuzzing per endpoint, WebSocket/realtime
  paths (if any), accessibility, full dependency tree beyond `npm audit`, load/soak
  testing. These are lower-severity; the core risk profile is now mapped across 4 rounds.

## FINAL updated totals (Round 1 + 2 + 3 + 4)
- **Critical 6** (C1–C5, R1) · **High 10** (H1–H6, R2, R5, R7, R8) · **Medium 11**
  (M1–M6, R3, R4, R6, R9, R10).  **= 27 findings.**
- **Security 2/10 · Production Readiness ≈ 25/100 · 🚫 DO NOT RELEASE** with real
  multi-tenant patient data until the stop-the-release set is fixed:
  C1 (demo-pwd, gate to non-prod), C2 (/import), C3+R1 (cross-tenant IDOR cluster),
  C4/C5 (payment double-charge), R8 (dependency CVEs).
- **The money-billing ENGINE (OPD invoice + IPD tariff/bill) is fundamentally sound**;
  the danger is concentrated in AUTH, TENANT ISOLATION, and INPUT/UPLOAD boundaries —
  fix those and readiness jumps substantially.

---
---

# ROUND 5 — Input fuzzing, background jobs, DoS surfaces

## HIGH (new)

### R12 — Unhandled async rejection in a detached `setTimeout` → can crash the whole API
`notificationController.js:102-113` — after responding, it fires
`setTimeout(async () => { await whatsapp.sendMessage(...); await startPharmacySession(...) }, 2000)`
with **no try/catch**. The HTTP response already returned, so any throw (Twilio
down, network blip, bad phone) becomes an **unhandled promise rejection** in a detached
callback → on modern Node this can **terminate the process**, taking the API down for
ALL users; at best it fails silently with no trace. (Also: the 2s timer is lost on any
restart.)
**Fix:** wrap the callback body in try/catch (log + swallow), or move it to a proper
job/queue.

## MEDIUM (new)

### R11 — Money fields accept negative / NaN / Infinity (no bounds) in secondary modules
`Number(req.body.x)` with no finite/`min` check on money:
- Ambulance `charge`/`distanceKm` (`ambulanceController.js:98-99`)
- Day-Care `fee`/`amountPaid` (`dayCareController.js:83,108-109`)
- Insurance `coverageLimit`/`claimAmount`/`approvedAmount` (`insuranceController.js:91,136-137`)
- Zod schemas missing `.nonnegative()`: `depositAmount` (`inpatientController.js:68`),
  lab `price` (`laboratoryController.js:38`), sale `total` (`sale.validation.js:16`).
`Number('abc')` = **NaN** stored into a Float column silently poisons any SUM/revenue
aggregate; negative values (`charge:-5000`, `claimAmount:-10000`) corrupt totals.
The CORE billing/payment schemas DO guard (`.positive()`/`.nonnegative()`), so this is
scoped to the secondary modules. **Fix:** `Number.isFinite` + `>= 0` (or Zod
`.nonnegative().finite()`) on every stored money/quantity field.

### R13 — Unbounded pagination `limit` on core list endpoints → memory-exhaustion DoS
`parseInt(req.query.limit)` with NO cap on: Billing (`billingController.js:158`),
Laboratory (`:96`), Radiology (`:116`), Consultation (`consultationController.js:9`).
A single `GET ...?limit=99999999` makes Prisma `take` millions of rows → huge query +
payload → OOM / API stall. **Appointments (`:13`) and Patients (`:89`) are correctly
capped** (`Math.min(..., 1000)`, NaN-safe) — apply that same cap to the four above.

## LOW / informational (new)

### R14 — No scheduler exists → appointment reminders never auto-send
No `node-cron`/queue dependency anywhere; `reminderSent` (`appointment.validation.js:24`)
is only ever set manually via the update endpoint. So the "reminder" feature is
effectively inert — reminders are never delivered automatically. (Matches the prior
project audit note.) **Fix:** add a scheduled job (cron/queue) if auto-reminders are a
requirement; otherwise remove the field to avoid implying a feature that doesn't run.

## Verified SAFE (Round 5 contrast — checked, correct)
- **Sort injection** — pharmacy list endpoints gate `sortBy` through a
  `SORTABLE_FIELDS` allowlist (`drug.controller.js:7,48`) before `{ [sortBy]: … }`. Safe.
- **Pagination cap** — `pharmacy/utils.js getPagination` caps limit at 5000; Appointments
  & Patients cap at 1000 (NaN-safe). (Only billing/lab/radiology/consultation are uncapped — R13.)
- **Mass-assignment** — lab/radiology `data: { ...updates }` uses Zod-parsed bodies
  (unknown keys stripped); the real risk there is the tenant gap (C3), not extra fields.

## FINAL TOTALS (Rounds 1–5)
- **Critical 6** (C1–C5, R1) · **High 11** (H1–H6, R2, R5, R7, R8, R12) · **Medium 13**
  (M1–M6, R3, R4, R6, R9, R10, R11, R13) · **Low 1** (R14).  **= 31 findings.**
- **Security 2/10 · Production Readiness ≈ 25–30/100 · 🚫 DO NOT RELEASE** with real
  multi-tenant patient data until the stop-the-release set is closed (C1–C5, R1, R8).
- **Audit is now broad across the whole system.** Remaining un-audited surface is
  low-severity (accessibility, load/soak testing, exhaustive per-field fuzzing).
  The money engine is sound; risk is concentrated in AUTH, TENANT ISOLATION,
  INPUT/UPLOAD, and one process-crash vector (R12).
