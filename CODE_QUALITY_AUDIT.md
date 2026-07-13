# Code-Quality / Architecture / Reusability Audit — GudMed HMS

> Complements the security audit in `AUDIT_REPORT.md` (5 rounds, 31 findings — not
> repeated here). THIS report focuses on **duplication, reusability, simplification,
> architecture, DB design, and maintainability**, with file:line evidence.
> _Generated 2026-07-08._ Coverage: backend controllers/services, Prisma schema,
> frontend module components. NOT exhaustively line-read — high-signal findings only.

---

## A. DUPLICATION — extract these shared utilities FIRST (highest ROI)

### D1 — `financialYear()` defined twice [Medium · Maintainability]
`controllers/billingController.js:107` AND `inpatient/billService.js:11` — identical
Indian-FY logic. A change to FY rules must be made in 2 places.
**Fix:** one `backend/src/lib/money.js` (or `dates.js`) exporting `financialYear`;
import in both. Removes 1 copy, prevents drift.

### D2 — money rounding `round2`/`r2` defined 5+ times [High · Data integrity + Maintainability]
`inpatientController.js:1394` (`r2`), `billPaymentService.js:6`, `billService.js:8`,
`consultationBillingService.js:12` (`r2`), `orderBillingService.js:18` (`r2`), plus
`inr()` in `printBilling.js`. Same `Math.round(n*100)/100` copy-pasted.
**Fix:** `backend/src/lib/money.js` → `export const round2`, `export function inr`.
Single source for all money maths. **Every billing/IPD/pharmacy path benefits.**
(Underlying M5 — Float money — should be addressed here too: move to `Decimal`.)

### D3 — receipt-number generation duplicated, 2 formats, collision-prone [High · Data integrity]
`billingController.js:459` `'RCP'+Date.now()`, `:557` `'REF'+Date.now()`,
`sale.controller.js:130` & `prescription.controller.js:187`
`RCP-${Date.now()}-${random}`. Inconsistent AND same-ms collisions on the `@unique`
column (audit M4). Meanwhile a CORRECT atomic counter exists
(`nextInvoiceNumber`, `billPaymentService.nextReceiptNumber`).
**Fix:** one `nextReceiptNumber(tx, org, series)` helper backed by `BillCounter`;
replace all four call sites. Kills the collision class + the format inconsistency.

### D4 — resource-based dispatcher copy-pasted in 7 controllers [Medium · Maintainability]
`billing, doctorAccountability, inpatient, insurance, laboratory, radiology,
machineIntegration` all hand-roll `switch (req.body.resource)` create/update/remove.
Each re-implements the same validate→guard→write shape differently (which is exactly
why the tenant-guard gaps in the audit were scattered/inconsistent).
**Fix:** a small `resourceRouter({ resource: { schema, guard, handler } })` helper,
or split each `resource` into its own route+controller. Standardizes validation,
tenant-guard, and response shape in ONE place.

### D5 — tenant-ownership guard hand-written everywhere [High · Security + Maintainability]
`findFirst({ where:{ id, organizationId }})` then 404 is repeated in ~15 handlers
(and MISSING in several — the audit's C3/R1 IDOR cluster). Copy-paste means each new
handler can silently forget it.
**Fix:** `assertOwned(model, id, orgId)` service helper (throws 404) or a Prisma
middleware that injects `organizationId` into every `where`. Makes cross-tenant leaks
structurally hard instead of relying on every author remembering.

### D6 — money coercion `Number(req.body.x)` scattered [Medium · Data integrity]
Already partly fixed via `safeMoney` (reqContext.js) but only applied to
ambulance/daycare/insurance. Billing/IPD/pharmacy still coerce inline.
**Fix:** route ALL stored money through `safeMoney`; better, put money fields in the
Zod schemas as `.nonnegative().finite()` so validation is declarative.

### D7 — Frontend: patient dropdown fetch `?limit=1000` duplicated in 5 modules [High · Performance + Reusability]
`Ambulance:61, DayCare:56, Insurance:57, Radiology:175` (+ OPD variants) each load up
to 1000 patients into memory. A correct debounced-search component ALREADY exists:
`components/common/PatientLookup.jsx`.
**Fix:** replace every bulk `client.get('/patients?limit=1000')` picker with
`<PatientLookup>` (as Pharmacy now does). Removes 5 unbounded fetches + 5 copies of
select/label state; fixes the R10 scale problem in one move.

### D8 — Frontend: status→badge-color maps duplicated [Low · Maintainability]
`getStatusBadgeClass` in `DashboardModule.jsx` and similar maps in `AdmissionsTab`,
`PatientProfile`. **Fix:** `src/lib/statusBadge.js` (map + component). One place to
theme all statuses.

### D9 — Frontend: receipt-payload object built per module [Medium · Reusability]
Lab/Radiology/Billing each assemble the print object `{ invoiceNo, labId,
patientName, ... payments }` by hand (`LaboratoryModule:930`, `RadiologyModule:417`).
The receipt RENDERERS are already shared (good) but the DATA mapping is not.
**Fix:** `src/lib/receiptMapper.js` → `toDiagnosticReceipt(order, invoice, org)`;
Lab & Radiology call it. Removes ~30 lines of parallel mapping and keeps the two in
sync.

---

## B. ARCHITECTURE

### AR1 — `inpatientController.js` is a 2833-line God file (103 db/tx calls) [High · Maintainability + Scalability]
One file handles ward/bed/admission/transfer/discharge/vitals/notes/orders/billing
dispatch. Hard to navigate, test, or change safely.
**Fix:** it ALREADY has a good service layer (`inpatient/*.js`) — finish the job: move
the remaining inline DB logic out of the controller into those services, and split the
controller by resource (admissionController, bedController, ipdBillingController…).

### AR2 — Inconsistent layering: IPD has services, everything else doesn't [High · Architecture]
`inpatient/` has a proper service layer (billService, tariffService, dischargeService…
— genuinely the best-designed part). But billing/lab/radiology/insurance/etc. put ALL
Prisma + business logic directly in controllers (`billingController` 43 db calls in one
file). Two different architectures in one codebase.
**Fix:** adopt the IPD pattern everywhere — thin controllers (parse + respond) → a
`services/` layer owning DB + business rules. Start with billing (extract
`billingService` with createInvoice/recordPayment/refund).

### AR3 — `billingController.create()` is a mega-dispatcher [Medium · Maintainability]
One `create` handles resource=service|invoice|payment|refund|add-item, each a big
inline block with its own transaction. 763-line file.
**Fix:** split into `createInvoice`, `recordPayment`, `recordRefund` service functions;
the controller just routes. Makes each independently testable (the payment idempotency
+ receipt-counter fixes would land in one obvious place).

### AR4 — No migration history (schema via `db push`) [Medium · Data integrity]
`render.yaml:5` runs `prisma db push` on deploy; `prisma/migrations/` doesn't exist.
This is the ROOT of the live incident class (counter-lag P2002). No auditable schema
history; a future rename/drop risks silent data loss.
**Fix:** adopt `prisma migrate` (baseline the current DB, commit migrations).

---

## C. DATABASE / SCHEMA

### DB1 — Money stored as `Float` throughout [High · Data integrity]
`Invoice.amountPaid/balanceDue`, `Payment.amount`, `PharmacySale.*`, IPD bills — all
`Float`. IEEE-754 → paisa drift, `balanceDue` never cleanly 0, CGST+SGST off by ₹0.01.
**Fix:** migrate money columns to `Decimal @db.Decimal(12,2)`; pair with D2's shared
money helper.

### DB2 — Business data hidden in JSON string blobs [Medium · Scalability + Data integrity]
`Invoice.items`, `PharmacySale.items`, `PharmacySale.payments`, `Prescription.items`,
`LabOrder.tests` are `String` JSON. Consequences: cannot query/aggregate/report on line
items, no FK integrity, every read `JSON.parse`s, and the pharmacy `payments`-NULL
issue (old rows) is a direct symptom of an unmodeled ledger.
**Fix (staged):** for anything you REPORT on (payments, invoice line items), promote to
real rows (`InvoiceItem`, and reuse the `Payment` table for pharmacy instead of a JSON
field). Keep JSON only for truly opaque snapshots.

### DB3 — Two parallel counter systems [Low · Maintainability]
`BillCounter` (OPD invoice + IPD bill) is good, but receipt numbers bypass it (D3).
Unify all sequences behind `BillCounter`.

---

## D. FRONTEND

### FE1 — Module components are 1500–2400+ lines [High · Maintainability]
`PharmacyModule`, `LaboratoryModule`, `RadiologyModule`, `BillingModule`,
`inpatientController`-equivalents each mix: data fetching + business logic + many
dialogs + tables + print building in ONE component.
**Fix:** split each into `useXdata()` hook (fetch/state) + presentational subcomponents
(`<SaleDialog>`, `<OrdersTable>`, `<PaymentModal>`). Enables memoization + testability.

### FE2 — Unbounded fetches (limit 1000–5000) on mount [High · Performance]
See D7 + audit R10. OpdModule loads ~5000 drugs + 500 patients + 2000 tests at once.
**Fix:** server-side search (PatientLookup pattern) + paginate.

### FE3 — Duplicated fetch/error/loading handling [Medium · Reusability]
Every module repeats `try { const res = await client.get(...); if (res.success) set…
} catch {}`. **Fix:** a `useApi()/useResource()` hook returning `{data,loading,error}`
+ a shared `<AsyncBoundary>` for loading/empty/error states.

---

## MODULE CHECKLIST (condensed — full security per AUDIT_REPORT.md)

| Module | Tenant guard | Validation | Dup logic | Service layer | Biggest issue |
|--------|:---:|:---:|:---:|:---:|---|
| Auth | n/a | ok | — | partial | demo-pwd flag split (C1) |
| Billing | ✅(now) | ok | high | ❌ | Float money, mega-dispatcher, receipt-counter |
| IPD | ✅ | ok | round2 dup | ✅ (best) | 2833-line controller |
| Pharmacy | ✅ | ok | receipt dup | ✅ (pharmacy/) | items/payments as JSON |
| Lab | ✅(now) | ok | receipt-map dup | ❌ | logic in controller |
| Radiology | ✅(now) | ok | receipt-map dup | ❌ | logic in controller |
| Insurance | ✅(now) | ✅(now) | dispatcher dup | ❌ | claim vs coverage rule (R4) |
| Ambulance/DayCare/DeathCert | ✅(now) | ✅(now) | patient-fetch dup | ❌ | thin, fine after fixes |
| Notifications | partial | ok | — | ❌ | org-demo pin (R7), setTimeout (fixed) |
| Dashboard | read | ok | badge-map dup | ❌ | fine |

---

## SCORECARDS

### BACKEND /10
Bug density 5 · API design 5 · Security 3 (→6 after the fixes shipped) · Validation 6 ·
Performance 6 · Architecture 5 (IPD 8, rest 4) · Reusability 4 · Testability 3 ·
**Production readiness 5/10**

### FRONTEND /10
Bug density 6 · Component design 4 (giant modules) · State mgmt 5 · Performance 4
(unbounded fetches) · Accessibility 3 · Architecture 5 · Reusability 5 (improving) ·
Testability 3 · **Production readiness 5/10**

### DATABASE /10
Schema quality 6 · Query efficiency 6 · Indexing 6 · Relations 7 · Transactions 7
(IPD strong) · Data integrity 4 (Float + JSON blobs) · Normalization 5 (JSON) ·
Scalability 5 · **Production readiness 5/10**

### CROSS-CUTTING
Architecture 5 · Complexity 4 (God files) · Reusability 4 · Maintainability 4 ·
Security 3→6 (post-fixes) · Workflow correctness 6 · Compliance 4 (audit-log gaps) ·
**Overall production readiness ≈ 45/100** (was ~25 pre-fixes; the shipped security
fixes lift it, but Float-money + God-files + JSON-ledgers + no-migrations keep it mid).

---

## FINAL SUMMARY

**Counts (this report — quality/arch, distinct from the 31 security findings):**
High 6 (D2,D3,D5,D7,AR1,AR2,DB1,FE1,FE2) · Medium 8 · Low 3.

**Release recommendation:** 🚫 **Do Not Release** as a multi-tenant SaaS yet
(security fixes shipped, but Float-money, no-migrations, and the tenant-guard-by-
copy-paste pattern are enterprise blockers). ✅ Fine for a single-org / demo deployment.

**Top simplification wins (do first):**
1. `backend/src/lib/money.js` → `round2`, `inr`, `financialYear`, `safeMoney` (kills D1,D2,D6).
2. `nextReceiptNumber(tx,org,series)` → replace 4 Date.now() sites (D3, M4).
3. Replace 5 bulk patient fetches with `<PatientLookup>` (D7, R10).
4. `assertOwned()` / Prisma org-scoping middleware (D5 — makes IDOR structurally hard).

**Top reusable extractions:** money.js · nextReceiptNumber · assertOwned ·
receiptMapper.js · useResource() hook · statusBadge.js · resourceRouter.

**Priority refactor order:** (1) shared money+receipt helpers · (2) org-scoping
middleware · (3) extract `billingService` (thin controller) · (4) split
`inpatientController` · (5) Decimal money migration + adopt Prisma migrations ·
(6) promote payments/invoice-items out of JSON · (7) frontend module splits + server
search.

**Stop-the-release (quality):** DB1 Float money (financial correctness), AR4 no
migrations (data-loss risk on schema change), D5 copy-paste tenant guards (leaks recur).

**Top 10 most dangerous (quality+security combined):** see AUDIT_REPORT.md top-10 for
security; add: Float money, God-file inpatientController, JSON ledgers (unreportable),
receipt-number collisions, no migrations.

**Most valuable shared utilities to build first:** `money.js`, `nextReceiptNumber`,
`assertOwned`/org-middleware, `PatientLookup` everywhere, `useResource()` hook.
