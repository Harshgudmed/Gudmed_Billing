# Codebase Architecture Audit — GudMed HMS
### For planning a new Billing & Credit module

_Generated: 2026-07-08. Every claim is backed by a file path (and line where useful).
"NOT FOUND" means it was searched for and does not exist. This is a **factual read**
of the code, not a test run._

> Scope note: a separate `AUDIT_REPORT.md` in this repo is a **security** red-team
> audit. This document is the **architecture** audit requested for billing-module
> planning. Where the two overlap (money integrity, tenant isolation) it is noted.

---

## 1. PROJECT OVERVIEW

- **Project name / purpose:** Hospital Management System (HMS). Root `package.json`
  name = `hospital-frontend` ("Hospital Management System - React 19 + Vite Frontend");
  backend `backend/package.json` name = `hospital-backend` ("Hospital Management System
  - Express MVC Backend"). This is a **multi-tenant hospital management platform**
  (OPD, IPD, pharmacy, lab, radiology, billing, insurance, etc.) branded "GudMed".
- **Primary language:** JavaScript (ES Modules, `"type": "module"` in both
  `package.json` files). **Plain JavaScript, NOT TypeScript** — there is a
  `jsconfig.json`, no `tsconfig.json`, and source files are `.js`/`.jsx`/`.mjs`.
- **Backend framework:** **Express 4.21.2** (`backend/package.json:27`). NOT NestJS.
  Classic MVC (routes → controllers → services).
- **Frontend framework:** **React 19** + **Vite 6** (`package.json:38,54`), React
  Router 6.30, TailwindCSS 3.4, Radix UI, react-hook-form + Zod, axios, `sonner`
  (toasts), `xlsx`, `html5-qrcode`.
- **ORM / DB layer:** **Prisma 6.11.1** (`@prisma/client` + `prisma`
  `backend/package.json:21,39`). Single schema at
  [backend/prisma/schema.prisma](backend/prisma/schema.prisma) (2677 lines).
- **Database engine:** **PostgreSQL** (`datasource db { provider = "postgresql" }`
  [schema.prisma:8-11](backend/prisma/schema.prisma#L8-L11)), connected via
  `DATABASE_URL` env var. Prisma client is a global singleton in
  [backend/src/config/db.js](backend/src/config/db.js).
- **Package manager:** npm (`package-lock.json` present in root; backend has its own
  `package.json`). It is a **two-package repo** (frontend at root, backend in
  `backend/`), not a formal monorepo/workspace.
- **Run commands:**
  - Frontend dev: `npm run dev` (Vite, port 5173).
  - Backend dev: `cd backend && npm run dev` (`nodemon server.js`).
  - Both together: `npm run dev:all` (concurrently runs backend + vite) — `package.json:8`.
  - Backend prod: `cd backend && npm start` (`node server.js`) — `backend/package.json:8`.
  - Build (frontend): `npm run build` (`vite build`).
- **Deployment:** Backend on **Render** (`render.yaml`), frontend on **Vercel**
  (`vercel.json`, multiple `*.vercel.app` origins allowlisted in `server.js:28-35`).
  Render build runs `prisma db push` (see §8 — no migration history).

---

## 2. FOLDER STRUCTURE

```
billing/                         (repo root = React frontend)
├── src/                         React 19 app
│   ├── api/                     axios client + per-module API call wrappers
│   ├── components/              feature UI, one folder per module (see below)
│   │   ├── billing/             BillingModule.jsx, PaymentFields.jsx, utils/printBilling.js
│   │   ├── inpatient/           IPD screens (tabs/)
│   │   ├── opd/                 OPD consultation workflow
│   │   ├── pharmacy/, laboratory/, radiology/, patients/, appointments/
│   │   ├── insurance/, ambulance/, daycare/, death-certificates/
│   │   ├── doctor-accountability/, pretriage/, queue/, dashboard/, settings/
│   │   ├── common/              shared widgets (e.g. PatientLookup.jsx) + hooks/
│   │   └── ui/                  Radix-based design-system primitives
│   ├── lib/                     frontend helpers (incl. billing.js — see §9)
│   ├── pages/, styles/, assets/
│   └── ...
├── backend/                     Express API
│   ├── server.js                app entry (CORS, helmet, mounts /api, HL7 boot)
│   ├── prisma/
│   │   ├── schema.prisma        THE database schema (all models)
│   │   ├── seed.js              seed script (prisma.seed hook)
│   │   ├── ERD.md / ERD-detailed.md   generated entity-relationship docs
│   │   └── generate-erd.mjs
│   ├── src/
│   │   ├── config/              db.js (Prisma), security.js (JWT), cookie.js
│   │   ├── middleware/          auth.js, errorHandler.js, validate.js
│   │   ├── routes/              one *Routes.js per module + index.js (mounts all)
│   │   ├── controllers/         one *Controller.js per module (request handlers)
│   │   ├── services/            razorpayService, whatsappService, appointmentFees, …
│   │   ├── inpatient/           IPD domain services (billService, billPaymentService,
│   │   │                        tariffService, dischargeService, orderService, rbac.js …)
│   │   ├── pharmacy/            pharmacy sub-module (controllers/ + validations/)
│   │   ├── integration/         HL7 listener/parser + tests
│   │   ├── lib/                 reqContext.js (getOrgId/getActor/safeMoney)
│   │   ├── utils/               dates, queueNumber, scope, patientSnapshot, catalogImport
│   │   └── validations/         Zod schemas (appointment, consultation, preTriage)
│   ├── scripts/                 seed + verify-*.mjs one-off ops/QA scripts
│   └── uploads/patient-documents/   local disk uploads (ephemeral on Render)
├── AUDIT_REPORT.md              (separate security audit)
├── render.yaml, vercel.json     deploy config
└── receipt-design-*.html        static receipt design mockups
```

**Top-level source folders, one line each:**
- `src/api` — frontend HTTP layer (axios) calling the backend `/api`.
- `src/components/<module>` — React screens; **`billing/` already exists**.
- `backend/src/routes` — Express routers; `index.js` is the master mount point.
- `backend/src/controllers` — request handlers; most business logic lives here.
- `backend/src/services` + `backend/src/inpatient` — reusable domain logic (payments, tariffs, WhatsApp, Razorpay).
- `backend/src/middleware` — `authenticate`, `authorize`, Zod `validate`, `errorHandler`.
- `backend/prisma` — schema + seed + ERD (single source of DB truth).

---

## 3. DATABASE SCHEMA (most important)

**DB layer:** **Prisma** (PostgreSQL). All models live in ONE file:
[backend/prisma/schema.prisma](backend/prisma/schema.prisma). **There is NO
`migrations/` folder** — schema is applied with `prisma db push` (Render build cmd
in `render.yaml`), so there is no migration history (see §8 / §11).

**Global conventions across every model:**
- **Primary key:** `id String @id @default(cuid())` — CUID strings, NOT serial ints or UUIDs. (Enumerable — flagged in the security audit's IDOR findings.)
- **Multi-tenancy:** almost every table has `organizationId String` + `@@index([organizationId])` and a cascade relation to `Organization`. This is the tenant boundary the billing module must respect.
- **Money:** stored as **`Float`** everywhere (no `Decimal`) — see §11.
- **Timestamps:** `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
- **JSON:** stored as **`String`** (stringified JSON) in most models — e.g. `Invoice.items`, `Prisma... items`, `Patient.allergies`; a few newer IPD models use the native `Json` type (`IpdCharge.resolvedFrom`, `ClinicalNote.vitals`).

### 3.1 Billing-relevant tables (detailed)

#### `BillingService` — service/price catalog — [schema.prisma:949](backend/prisma/schema.prisma#L949)
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | String (cuid) | no | cuid() | PK |
| organizationId | String | no | | FK→Organization, indexed |
| serviceName | String | no | | |
| serviceCode | String | yes | | |
| serviceCategory | String | yes | | indexed; consultation/procedure/accommodation |
| department | String | yes | | |
| unitPrice | Float | no | | |
| isTaxable | Boolean | no | false | |
| taxPercentage | Float | no | 0 | |
| isCoveredByInsurance | Boolean | no | true | |
| insuranceCopayPercentage | Float | yes | | |
| description | String | yes | | |
| isActive | Boolean | no | true | |

#### `Invoice` — OPD/pharmacy invoice — [schema.prisma:985](backend/prisma/schema.prisma#L985)
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | String (cuid) | no | cuid() | PK |
| organizationId | String | no | | FK→Organization |
| patientId | String | no | | FK→Patient (cascade) |
| consultationId | String | yes | | FK→Consultation |
| invoiceNumber | String | no | | **@unique**, indexed. Format `INV-<FY>-000123` |
| invoiceDate | DateTime | no | now() | |
| dueDate | DateTime | yes | | |
| items | String | no | | **stringified JSON** array of line items |
| subtotal | Float | no | | |
| discountAmount | Float | no | 0 | |
| discountPercentage | Float | no | 0 | |
| taxAmount | Float | no | 0 | |
| totalAmount | Float | no | | |
| paymentStatus | String | no | "unpaid" | unpaid/partially_paid/paid/cancelled/refunded |
| amountPaid | Float | no | 0 | |
| balanceDue | Float | yes | | |
| insuranceClaimAmount | Float | no | 0 | |
| insuranceClaimStatus | String | yes | | |
| patientCopayAmount | Float | no | 0 | |
| status | String | no | "draft" | draft/sent/overdue/paid/cancelled |
| notes, termsAndConditions | String | yes | | |
| cancelledAt/ById/cancellationReason | | yes | | cancellation trail |
| **FKs/relations** | | | | patient, consultation, createdBy(User), cancelledBy(User), **payments Payment[]** |

#### `Payment` — OPD payment/refund ledger — [schema.prisma:1046](backend/prisma/schema.prisma#L1046)
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | String (cuid) | no | cuid() | PK |
| organizationId | String | no | | FK→Organization |
| invoiceId | String | no | | FK→Invoice (cascade) |
| patientId | String | yes | | FK→Patient |
| paymentDate | DateTime | no | now() | |
| receiptNumber | String | no | | **@unique**, indexed. Format `RCP<Date.now()>` (see §11 M4) |
| amount | Float | no | | |
| paymentMethod | String | no | | cash/credit_card/debit_card/mobile_money/insurance/bank_transfer/cheque |
| paymentReference, cardLastFour, mobileMoneyProvider | String | yes | | method-specific |
| bankName, chequeNumber, chequeDate | | yes | | |
| processedById | String | yes | | FK→User |
| isRefund | Boolean | no | false | a refund is a Payment row with isRefund:true |
| refundReason | String | yes | | |
| originalPaymentId | String | yes | | soft link (no FK) to refunded payment |
| notes | String | yes | | |

> **NOTE:** `Payment` has **NO `idempotencyKey`** (contrast the IPD `BillPayment` which
> does). This is the double-charge gap from the security audit (C4). A new billing
> module should add idempotency here.

#### Doctor commission / fee tables (revenue-share, already money-touching)
- **`DoctorFeeSlab`** [schema.prisma:1098](backend/prisma/schema.prisma#L1098) — day-based follow-up fee (`fromDays`,`toDays`,`feeAmount`); `@@unique([doctorId, fromDays, toDays])`.
- **`DoctorCommissionConfig`** [schema.prisma:1124](backend/prisma/schema.prisma#L1124) — per-doctor rate; `doctorId @unique`; `commissionType` percentage|fixed_per_consultation.
- **`DoctorCommission`** [schema.prisma:1144](backend/prisma/schema.prisma#L1144) — one row per invoice/consultation; `status` pending|approved|paid|cancelled; `settledAt/ById/Ref` settlement trail; `period` "YYYY-MM".

### 3.2 IPD (inpatient) enterprise billing tables — the mature money engine
These are newer and more rigorous than the OPD `Invoice`/`Payment` pair. A credit
module should study/extend these patterns.

- **`Bill`** [schema.prisma:1760](backend/prisma/schema.prisma#L1760) — many bills per admission; `status` DRAFT|FINAL|CANCELLED; `billType` INTERIM|FINAL|SUPPLEMENTARY; `payerType` CASH|INSURANCE|TPA|CORPORATE|GOVT|EMPLOYEE; totals `bedTotal/serviceTotal/subtotal/taxTotal/discountTotal/depositTotal/payableTotal/paidTotal/balanceDue`; `paymentStatus` UNPAID|PARTIAL|PAID|REFUNDED; `billNumber` `@@unique([organizationId, billNumber])`.
- **`BillPayment`** [schema.prisma:1801](backend/prisma/schema.prisma#L1801) — **signed, immutable, numbered receipts**; `type` ADVANCE|PAYMENT|REFUND; `method` CASH|UPI|CARD|BANK_TRANSFER|CHEQUE; **`idempotencyKey`** with `@@unique([organizationId, idempotencyKey])`; `receiptNumber` `@@unique([organizationId, receiptNumber])`; `status` SUCCESS|VOID; `creditNoteId String?` — **reserved for a future Phase-3 credit-note feature (currently unused)**.
- **`IpdCharge`** [schema.prisma:1715](backend/prisma/schema.prisma#L1715) — structured charge line; frozen `taxPct/taxAmount/discountPct/discountAmount/lineTotal`; `@@unique([organizationId, sourceModule, sourceRef])` (idempotent posting); `status` ACTIVE|CANCELLED|RETURNED; links to `Bill` (SetNull).
- **`BillCounter`** [schema.prisma:1833](backend/prisma/schema.prisma#L1833) — per-org/per-FY atomic sequence; `series` (INV, IPD, RCP); `@@unique([organizationId, series, year])`. **Used by BOTH OPD invoice numbering and IPD bill/receipt numbering.**
- Supporting IPD tariff engine: **`BedCategory`, `TariffPlan`, `TariffRule`, `ChargeMaster`, `PatientTariff`, `BedOccupancy`** [schema.prisma:1597-1712](backend/prisma/schema.prisma#L1597-L1712) — configurable rate cards, no hardcoded percentages, snapshot-per-admission.

### 3.3 Other money-touching tables (secondary modules)
- **`PharmacySale`** [schema.prisma:777](backend/prisma/schema.prisma#L777) — `subtotal/discountAmount/taxAmount/totalAmount/amountPaid/amountDue`, `receiptNumber @unique`, `payments` (JSON multi-payment ledger).
- **`DayCareCase`** [schema.prisma:2476](backend/prisma/schema.prisma#L2476) — `fee/amountPaid/paymentStatus`.
- **`AmbulanceTrip`** [schema.prisma:2512](backend/prisma/schema.prisma#L2512) — `charge/distanceKm`.
- **`InsuranceCase`** [schema.prisma:2548](backend/prisma/schema.prisma#L2548) — `coverageLimit`, payer policy per patient.
- **`InsuranceClaim`** [schema.prisma:2578](backend/prisma/schema.prisma#L2578) — `claimAmount/approvedAmount`, `status` pending|submitted|approved|rejected|settled.
- **`Admission`** [schema.prisma:540](backend/prisma/schema.prisma#L540) — `depositAmount`, `totalBillAmount`, `additionalCharges` (JSON), legacy IPD billing snapshot fields.

### 3.4 Core clinical / platform tables (context)
`Organization` (tenant root, `settings`/`modulesEnabled` as JSON, subscription fields),
`User` (staff; `role` free String; `consultationFee`, `followUpDays`), `Department`,
`Patient` (`mrn @unique`, `hasInsurance`+insurance fields, optional portal `passwordHash`),
`PatientDocument`, `Appointment`, `Consultation` (visit record), `Ward`/`Bed`,
`PharmacyDrug`/`PharmacyBatch`/`Prescription`/`PharmacyPurchaseOrder`/`StockLedger`/`Vendor`/`MedicineReference`,
`LabTest`/`LabOrder`/`LabResult`, `RadiologyExam`/`RadiologyOrder`/`RadiologyReport`,
`MachineIntegration`/`MachineResultsQueue`/`IntegrationLog`,
`Notification`, `AuditLog`, `UserActivity`, `UserInvitation`,
`Permission`/`RolePermission` (**defined but NO code references — unused, see §7**),
`eAptsConfig`/`EaptsMedicationMapping`/`EaptsTransaction`,
IPD nursing (`VitalsRecord`,`ClinicalNote`,`MedicationAdministration`),
IPD discharge/orders (`DischargeClearance`,`HousekeepingTask`,`ClinicalOrder`,`OrderTask`,`ClinicalOrderEvent`,`IpdConsultation`),
`PreTriage`, `QueueManagement`, `DeathCertificate`.

### 3.5 PostgreSQL / Prisma enums (the only real enums)
Most "enum-like" fields are free `String` with allowed values documented in comments.
**True Prisma enums exist only for the integration module** ([schema.prisma:1279-1312](backend/prisma/schema.prisma#L1279-L1312)):
- `MachineType`: lab_analyzer, radiology_equipment, vital_signs_monitor
- `ConnectionType`: hl7, astm, rest_api, file_upload, serial
- `ConnectionStatus`: connected, disconnected, error
- `QueueStatus`: pending, matched, imported, failed, manual_review
- `LogType`: connection, result_import, error, config_change
- `InvitationStatus`: pending, accepted, expired, cancelled

### 3.6 Key relationships (plain English)
- An **Organization** has many of everything (hard multi-tenant root; cascade delete).
- A **Patient** has many Appointments, Consultations, Invoices, Payments, Admissions, PharmacySales, Lab/Radiology orders, InsuranceCases.
- A **Consultation** (visit) optionally has many **Invoices**; an Invoice belongs to one Patient and optionally one Consultation.
- An **Invoice** has many **Payments** (one-to-many); a refund is a Payment with `isRefund=true`.
- A **User (doctor)** has one `DoctorCommissionConfig`, many `DoctorFeeSlab`s and `DoctorCommission`s.
- An **Admission** has many **Bill**s, many **IpdCharge**s, many **BillPayment**s, one `PatientTariff`, many `BedOccupancy` segments — the IPD money engine.
- A **Bill** has many **IpdCharge**s and many **BillPayment**s.
- An **InsuranceCase** (policy) has many **InsuranceClaim**s.

---

## 4. EXISTING MODULES / FEATURES

Each backend module = `routes/<x>Routes.js` + `controllers/<x>Controller.js`
(+ sometimes a `services/` or `inpatient/`/`pharmacy/` folder). Frontend mirror in
`src/components/<x>/`.

| Module | Location | What it does | Touches money/patients/billing? |
|---|---|---|---|
| **Billing** | `controllers/billingController.js`, `routes/billingRoutes.js`, `src/components/billing/` | Service catalog, invoices, payments, refunds, add-item, stats | **YES — this is the OPD billing core** |
| **Payments (Razorpay)** | `controllers/paymentController.js`, `services/razorpayService.js` | Online payment: create-order, verify signature, payment links, webhook | **YES — online money-in** |
| **Inpatient (IPD)** | `controllers/inpatientController.js`, `src/inpatient/*` | Admissions, beds, tariff engine, structured charges, IPD bills/payments, discharge, nursing, CPOE orders | **YES — the most complete billing engine** |
| **Doctor Accountability** | `controllers/doctorAccountabilityController.js`, `routes/doctorAccountabilityRoutes.js` | Doctor commission config + commission records + settlement | **YES — revenue share** |
| **Fee Slabs** | `controllers/feeSlabController.js`, `services/appointmentFees.js` | Day-based follow-up fee calculation per doctor | **YES — pricing** |
| **Pharmacy** | `src/pharmacy/*`, `routes/pharmacyRoutes.js` | Drugs, batches, sales (POS), prescriptions, purchase orders, stock ledger, stats | **YES — sales money + patients** |
| **Patients** | `controllers/patientController.js` | Patient CRUD, records, MRN | Patients |
| **Appointments** | `controllers/appointmentController.js` | Scheduling, check-in, reschedule, calendar; sets `consultationFee` | Patients + fee |
| **Consultations / OPD** | `controllers/consultationController.js`, `src/components/opd/` | Visit records, diagnosis, orders; feeds invoices | Patients + billing source |
| **Laboratory** | `controllers/laboratoryController.js` | Test catalog + orders + results (with `price`) | Patients + priceable |
| **Radiology** | `controllers/radiologyController.js` | Exam catalog + orders + reports (with `price`) | Patients + priceable |
| **Insurance / TPA** | `controllers/insuranceController.js` | Payer policies + claim tracking | **YES — money/claims** |
| **Day-Care** | `controllers/dayCareController.js` | Same-day procedures with `fee`/`amountPaid` | **YES — money** |
| **Ambulance** | `controllers/ambulanceController.js` | Trip logging with per-trip `charge` | **YES — money** |
| **Death Certificates** | `controllers/deathCertificateController.js` | Legal death record issuance | Patients |
| **Pre-Triage / Triage / Queue** | `controllers/preTriageController.js`, `triageController.js` | Screening + unified patient queue | Patients |
| **Notifications / WhatsApp** | `controllers/notificationController.js`, `whatsappBotController.js`, `services/whatsappService.js` | WhatsApp/Twilio patient messaging + bot | Patients (PHI) |
| **Patient Portal** | `controllers/patientPortalController.js` | Patient-facing dashboard + document upload | Patients |
| **Dashboard** | `controllers/dashboardController.js` | Aggregate stats | Reads money |
| **Settings** | `controllers/settingsController.js` | Org/module settings, user management | Config |
| **Machine Integration / HL7** | `controllers/machineIntegrationController.js`, `src/integration/*` | Lab-analyzer HL7 ingestion | Clinical |
| **Import** | `controllers/importController.js` | Bulk data import (header-secret protected) | All models |
| **Clinical KB** | `controllers/clinicalKbController.js` | ICMR knowledge-base lookup | Reference |

---

## 5. API / ROUTES

**Base path:** everything is mounted under `/api` (`server.js:85`). Master mount +
auth ordering is in [backend/src/routes/index.js](backend/src/routes/index.js).

**Protection model** (`routes/index.js:31-73`):
- `/api/auth/*` and `/api/import` are mounted **BEFORE** `authenticate` → the only
  routes reachable without a login token. (`/import` is guarded by an
  `x-import-secret` header inside its controller, not by JWT.)
- Everything else sits behind `router.use(authenticate)` then `authorize()`.
  **Important:** `authorize()` is a **no-op unless `AUTH_ENFORCED` is true**
  (`middleware/auth.js:62`), and no route passes specific roles — so role
  enforcement is effectively all-or-nothing (see §7).

### Auth — `/api/auth` (public) — `authRoutes.js`
| Method | Path | Handler |
|---|---|---|
| POST | /auth/login | login |
| POST | /auth/patient-login | patientLogin |
| POST | /auth/logout | logout |
| GET | /auth/me | me (re-runs `authenticate`) |

### Billing — `/api/billing` (protected) — `billingRoutes.js`
The billing API is a **3-verb dispatcher** keyed on `req.body.resource` /
`req.query.resource`, not RESTful sub-paths:
| Method | Path | Handler | Dispatches on |
|---|---|---|---|
| GET | /billing | getAll | `?resource=services\|invoices\|payments\|stats` |
| POST | /billing | create | `body.resource=service\|invoice\|payment\|refund\|invoiceItem` |
| PATCH | /billing | update | `body.resource=invoice\|service` |

### Payments (Razorpay) — `/api/payments` (protected) — `paymentRoutes.js`
| Method | Path | Handler |
|---|---|---|
| POST | /payments/create-order | createRazorpayOrder |
| POST | /payments/verify | verifyPayment (verifies signature) |
| POST | /payments/create-link | createLink (shareable link) |
| POST | /payments/webhook | handleWebhook (Razorpay → us; verifies webhook sig) |
| GET | /payments/invoice/:invoiceId | getPaymentsByInvoice |

### Inpatient / IPD — `/api/inpatient` (protected) — `inpatientRoutes.js`
Also a dispatcher (`getAll`/`create`/`update`/`remove` keyed on `resource`/`action`).
Billing actions route to `src/inpatient/billService.js` + `billPaymentService.js`:
`generateBill`, `finalizeBill`, `collectPayment` (`inpatientController.js:1703,1740,1785,2004`).
| Method | Path | Handler |
|---|---|---|
| GET | /inpatient | getAll |
| GET | /inpatient/timeline/:patientId | getPatientTimeline |
| POST | /inpatient | create |
| PATCH | /inpatient | update |
| DELETE | /inpatient | remove |

### Doctor Accountability — `/api/doctor-accountability` (protected)
GET/POST/PATCH/DELETE `/` → `handleGet/handlePost/handlePatch/handleDelete` (dispatcher).

### Fee Slabs — `/api/fee-slabs` (protected)
GET `/`, GET `/calculate`, POST `/`, PATCH `/:id`, DELETE `/:id`.

### Pharmacy — `/api/pharmacy` (protected) — `pharmacyRoutes.js`
Full REST-ish sub-routes: `/drugs`, `/drugs/:id`, `/drugs/lookup`, `/batches`,
`/sales`, `/prescriptions` (+ `/:id/dispense`), `/purchase-orders` (+ `/:id/receive`),
`/medicine-reference`, `/import`, `/stats`.

### Other modules (all protected, most are `resource`-dispatchers)
- `/patients` — GET `/`, `/:id`, `/:id/records`; POST `/`; PATCH/PUT `/:id`; DELETE `/:id`.
- `/appointments` — GET `/`, `/calendar-counts`, `/stats`, `/:id`; POST `/`, `/:id/reschedule`; PATCH `/bulk/status`, `/:id`; DELETE `/:id`.
- `/consultations` — GET `/`; POST `/`; PATCH `/:id`; DELETE `/:id`.
- `/laboratory` — POST `/import`; GET `/health`, `/`; POST `/`; PATCH `/` (resource-dispatch).
- `/radiology` — POST `/import`; GET `/`; POST `/`; PATCH `/`.
- `/insurance`, `/ambulance`, `/day-care`, `/death-certificates` — GET/POST/PATCH/DELETE `/` (dispatchers).
- `/pre-triage` — GET `/`,`/:id`; POST `/`,`/:id/convert`; PATCH `/:id`.
- `/triage` — GET `/`; POST `/`; PATCH `/:id`.
- `/notifications` — POST `/consultation|/prescription|/lab-result|/radiology-report|/pharmacy-team`; GET/POST `/whatsapp-webhook`.
- `/patient-portal` — (patient-session only) GET `/me`; POST `/documents`; DELETE `/documents/:id`.
- `/machine-integration` — GET `/health`,`/`; POST `/reprocess`,`/drain`,`/`; PATCH `/`.
- `/dashboard`, `/settings`, `/clinical-kb`.
- `/import` — POST `/` (header-secret; **public — mounted before authenticate**).

---

## 6. BUSINESS LOGIC LAYER

- **Where logic lives:** primarily in **controllers** (`backend/src/controllers/*`).
  The **IPD** and **pharmacy** modules are the exception and the better pattern — they
  push real logic into **services** (`src/inpatient/billService.js`,
  `billPaymentService.js`, `tariffService.js`; `src/pharmacy/stockService.js`). The
  OPD billing controller does its money math + transactions inline in the controller.

- **Typical end-to-end pattern (OPD payment, the canonical money flow):**
  1. **Route:** `POST /api/billing` → `billingRoutes.js:7` → `create` controller.
  2. **Auth/tenant:** `authenticate` + `authorize()` already ran (index.js); controller calls `getOrgId(req)` (`reqContext.js`) to resolve the tenant.
  3. **Validate:** `paymentSchema.safeParse(req.body)` (Zod, defined at top of `billingController.js:43`).
  4. **Transaction (`db.$transaction`)** — `billingController.js:451-519`:
     verify invoice belongs to org → `tx.payment.create` → **atomic** `tx.invoice.update({ amountPaid: { increment: amount } })` → recompute `balanceDue`/`paymentStatus` → write `tx.auditLog` **inside** the tx (money trail rolls back with the payment).
  5. **Model/DB:** Prisma client (`db` from `config/db.js`) writes to PostgreSQL.
  6. **Response:** `res.status(201).json({ success: true, data: payment })`.

  The **IPD** equivalent (`collectPayment` in `billPaymentService.js:42`) is stronger:
  idempotency-key dedupe + atomic per-FY receipt counter + `recalcBill` ledger recompute.

- **Shared helpers / cross-cutting utilities:**
  - [backend/src/lib/reqContext.js](backend/src/lib/reqContext.js): **`getOrgId(req)`** (tenant), **`getActor(req)`** (who-did-it for audit), **`svcErr(res,e)`** (status-preserving error responder), **`safeMoney(value)`** (finite/non-negative money coercion — **use this in the new module**).
  - `financialYear()` — Indian FY (Apr–Mar) helper, duplicated in `billingController.js:107` and `inpatient/billService.js:11`.
  - `nextInvoiceNumber(tx, orgId)` (`billingController.js:116`) / `nextReceiptNumber` (`billPaymentService.js:27`) — counter-reconcile numbering (self-healing after migration).
  - `backend/src/utils/*`: `dates.js`, `queueNumber.js`, `scope.js`, `patientSnapshot.js`, `catalogImport.js`.
  - Zod `validate()` middleware (`middleware/validate.js`) — used by appointments/consultations/pre-triage; **billing validates inline instead** (calls `.safeParse` in the controller).

---

## 7. AUTHENTICATION & AUTHORIZATION

- **Authentication:** **JWT** (`jsonwebtoken`), signed in `authController.login`
  (`authController.js:63`) with 8h expiry. Delivered primarily as an **httpOnly
  cookie** (`res.cookie(TOKEN_COOKIE, …)`), with the raw token also returned in the
  body for non-browser clients. `authenticate` middleware
  (`middleware/auth.js:25`) reads **cookie first, `Authorization: Bearer` header
  fallback**, verifies with `JWT_SECRET`, and attaches `req.user` + `req.organizationId`.
- **JWT payload:** `{ userId, id, organizationId, role, fullName, email }` for staff;
  `{ patientId, organizationId, role: 'patient', name }` for patients.
- **`AUTH_ENFORCED` master switch** (`middleware/auth.js:9-12`): in **production**
  auth is ON unless explicitly `false`; in **dev/demo** it is OFF unless explicitly
  `true`. When OFF, missing/invalid tokens fall back to the demo org (`org-demo`).
  Production `render.yaml` sets `AUTH_ENFORCED="true"`.
- **Password hashing:** `bcryptjs`. **Demo backdoor:** when `AUTH_ENFORCED` is off,
  `Gudmed@123` logs into any account (`authController.js:34-40`) — intentional for
  demos (flagged C1 in the security audit).
- **Roles:** `User.role` is a **free-text String** (no DB enum). Documented values
  (`schema.prisma:133`): `super_admin, admin, doctor, nurse, receptionist,
  pharmacist, lab_tech, lab_supervisor, radiologist, radiology_tech, billing_clerk,
  inventory_manager`. Seed script also uses `billing`, `housekeeping`,
  `lab_technician`, `radiology_technician` (`scripts/seed-staff-roles.mjs`).
  ⚠ **Role-name inconsistency** (`billing` vs `billing_clerk`, `lab_tech` vs
  `lab_technician`) — reconcile before wiring billing approvals.
- **Authorization:** `authorize(...roles)` middleware (`middleware/auth.js:60`).
  Behavior: no-op if `AUTH_ENFORCED` off; else `admin`/`super_admin` always pass,
  `patient` role is blocked from the staff API, otherwise the role must be in the
  allow-list. **BUT** every route in `index.js` calls `authorize()` with **no roles**
  → "any authenticated non-patient user". So today there is **effectively no
  per-role restriction** on billing endpoints; isolation is by **data scoping**
  (`organizationId` + doctor scoping in controllers), per the comment at
  `index.js:40-48`.
- **`Permission` / `RolePermission` tables exist but are UNUSED** — a codebase search
  (`backend/src`) found **no references** to `rolePermission`/`db.permission`. There
  is a schema for granular permissions, but no code reads it.

**Implication for billing approvals:** there is **no existing approval-level or
permission framework** to hook into. The building blocks that DO exist and are usable:
(a) the `authorize(...roles)` middleware (pass real roles to it), (b) `req.user.role`
from the JWT, (c) `getActor(req)` for stamping who approved, (d) `AuditLog` for the
approval trail, (e) the unused `Permission`/`RolePermission` tables if you want RBAC.
A billing approval workflow (e.g. discount/refund/credit approval tiers) must be
**built** — see the IPD `force`-discharge auth gap (R5) for how NOT to do it.

---

## 8. NAMING & CODING CONVENTIONS

- **Language:** plain **JavaScript ESM** (`import`/`export`, `"type":"module"`).
  No TypeScript. Frontend components `.jsx`; ops scripts `.mjs`.
- **File naming:** backend controllers/routes are **camelCase** with a suffix
  (`billingController.js`, `billingRoutes.js`); the pharmacy + some import
  controllers use **dot.case** (`sale.controller.js`, `drug.validation.js`,
  `labImport.controller.js`). Frontend components are **PascalCase** (`BillingModule.jsx`).
  → **Inconsistent**; match the neighbor when adding files.
- **Casing:** functions/vars **camelCase**; Prisma models **PascalCase**; DB columns
  **camelCase**; constants **UPPER_SNAKE** (`ORGANIZATION_ID`, `JWT_SECRET`).
- **DB migrations:** **Prisma `db push`, NOT `migrate`.** There is **no
  `prisma/migrations/` folder**. `render.yaml` build runs
  `npx prisma db push --skip-generate`. `package.json` does expose
  `db:migrate` (`prisma migrate dev`) and `db:push`, but the deployed path is push.
  → **To add billing tables:** edit `schema.prisma`, run `cd backend && npx prisma
  db push` (dev) / it auto-applies on Render deploy. (⚠ `db push` on a rename/drop
  can lose data — the security audit's M6.)
  **Example** — how a table is added today (`Bill` model block in
  `schema.prisma:1760-1796`): declare the `model`, add `organizationId` + relation +
  `@@unique`/`@@index`, add the reverse relation array on `Organization`
  (`schema.prisma:100-102`), then `db push`.
- **Standard way a NEW backend module is wired end-to-end** (observed pattern):
  1. Add `model`(s) to `schema.prisma` (+ reverse relations on `Organization`), `db push`.
  2. Write **Zod schemas** (inline in the controller, e.g. `billingController.js:6-104`, or a `validations/*.js` file).
  3. Write a **controller** in `src/controllers/` using `db` (Prisma), `getOrgId(req)`, `db.$transaction` for money, `getActor(req)` for stamping, and `AuditLog` writes inside the tx.
  4. Write a **router** in `src/routes/` (`Router()` + verbs).
  5. **Mount it** in `src/routes/index.js` behind `authenticate` + `authorize()`.
  6. Add the frontend API wrapper in `src/api/` and a `src/components/<module>/` screen.
  (Heavier domains additionally extract a `src/<module>/` service layer — follow the IPD/pharmacy example for billing.)
- **Error handling:** two patterns coexist —
  (a) **try/catch in controller** returning `res.status(...).json({ success:false, error })`, throwing `Object.assign(new Error(msg), { status })` for typed errors (billing/IPD services);
  (b) **`next(err)`** to the central [errorHandler.js](backend/src/middleware/errorHandler.js), which maps `ZodError`→400 and Prisma `P2002`→409 / `P2025`→404 / else 500.
- **Standard JSON response shape:** **`{ success: boolean, data?, error?, meta? }`**.
  List endpoints add `meta: { total, limit, offset, hasMore }` (`billingController.js:183`).
  Errors: `{ success:false, error, code?, details? }`.
- **Validation:** **Zod** everywhere (`zod` in both package.json). Two styles: the
  `validate(schema)` middleware, or inline `schema.safeParse(req.body)` in the
  controller (billing uses inline). Money fields use `.nonnegative()`/`.positive()`
  in the core billing schemas.

---

## 9. EXISTING BILLING-RELATED CODE

**A substantial billing system already exists. Do NOT rebuild these; extend them.**

**Backend — OPD billing:**
- [backend/src/controllers/billingController.js](backend/src/controllers/billingController.js) — service catalog CRUD, invoice create (with self-healing `nextInvoiceNumber`), **payment** (ACID, atomic increment, audit-in-tx), **refund/credit-note** (`refundSchema`, `paymentMethod:'credit_note'` = adjustment vs cash-out, atomic decrement), **add invoice item**, invoice cancel (blocks cancel if payments exist), stats aggregation.
- [backend/src/routes/billingRoutes.js](backend/src/routes/billingRoutes.js) — the 3-verb dispatcher.
- [backend/src/controllers/paymentController.js](backend/src/controllers/paymentController.js) + [services/razorpayService.js](backend/src/services/razorpayService.js) — Razorpay orders, **signature verification** on verify + webhook, payment links. ⚠ **references `db.paymentTransaction` (`paymentController.js:70`) — a model that does NOT exist in `schema.prisma`** (call is wrapped in `.catch(()=>{})`, so it silently no-ops). Also `paymentController.js:150` uses `db.invoice.fields?.totalAmount` which is not a real value assignment. **Both are latent bugs to clean up.**

**Backend — IPD billing (the mature engine):**
- [backend/src/inpatient/billService.js](backend/src/inpatient/billService.js) — `getCurrentBill`, `generateBill` (link ACTIVE charges, snapshot totals), `finalizeBill` (atomic per-FY number, freeze to FINAL), `cancelBill`, `cancelCharge` (audit-safe, never deletes).
- [backend/src/inpatient/billPaymentService.js](backend/src/inpatient/billPaymentService.js) — `collectPayment` (**idempotency-key dedupe**, atomic receipt number), `voidPayment`, `refund` (signed-negative ledger entry), `ensureLegacyDepositAdvance`, `collections` (cashier reconciliation report), `recalcBill`.
- [backend/src/inpatient/tariffService.js](backend/src/inpatient/tariffService.js) — bed-day + service charge computation (tariff-rule resolution, `computeRunningBill`).
- `consultationBillingService.js`, `orderBillingService.js` — auto-post charges from IPD consultations/orders.

**Backend — doctor revenue share & pricing:**
- `controllers/doctorAccountabilityController.js` (commission config + records + settlement).
- `controllers/feeSlabController.js` + `services/appointmentFees.js` (day-based follow-up fee calc).

**Frontend — billing:**
- [src/components/billing/BillingModule.jsx](src/components/billing/BillingModule.jsx) — the billing screen (invoices, record-payment; ⚠ security audit C5: record-payment button lacks a disabled/saving guard).
- `src/components/billing/PaymentFields.jsx`, `src/components/billing/utils/printBilling.js`.
- [src/lib/billing.js](src/lib/billing.js) — `createInvoiceWithPayment` helper (⚠ security audit H5: two sequential POSTs, no rollback → possible orphaned invoice).
- Receipt design mockups at repo root: `receipt-design-1-classic.html`, `-2-modern.html`, `-3-elegant.html`.

**Keyword sweep — what already exists for each term:**
| Term | Where it lives |
|---|---|
| invoice | `Invoice` model, `billingController`, `src/lib/billing.js`, IPD `Bill` |
| payment | `Payment` + `BillPayment` models, `paymentController`, `billPaymentService` |
| refund | `refundSchema`/refund branch (`billingController.js:524`), `billPaymentService.refund` |
| credit / credit note | `paymentMethod:'credit_note'` in refunds; `BillPayment.creditNoteId` (**reserved, unused**) — **the "credit module" hook** |
| charge | `IpdCharge`, `ChargeMaster`, `AmbulanceTrip.charge` |
| receipt | `Payment.receiptNumber`, `BillPayment.receiptNumber`, `PharmacySale.receiptNumber` |
| transaction | `db.$transaction` (money), `EaptsTransaction`, missing `paymentTransaction` model |
| discount | `Invoice.discountAmount/Percentage`, `IpdCharge.discount*`, `Bill.discountTotal` |
| tax / GST | `taxAmount`, `taxPercentage`, `PharmacyDrug.gstRate`, `ChargeMaster.taxRatePct` |
| insurance / claim | `InsuranceCase`, `InsuranceClaim`, `Invoice.insuranceClaim*`, `Patient.hasInsurance` |
| price / amount | `BillingService.unitPrice`, `LabTest.price`, `RadiologyExam.price`, `ChargeMaster.basePrice` |
| counter / numbering | `BillCounter` (INV/IPD/RCP series), `nextInvoiceNumber`, `nextReceiptNumber` |

**There is NO existing "credit" (patient credit balance / advance-as-store-credit /
credit-note ledger / corporate credit-line) feature.** `BillPayment.creditNoteId` is
a reserved-but-unused column and `Payment` supports refunds only. A **credit module**
is genuinely new work — but it should sit on the IPD `BillPayment` ledger pattern
(signed, immutable, numbered, idempotent), not the weaker OPD `Payment` model.

---

## 10. INTEGRATIONS & EXTERNAL SERVICES

- **Payment gateway: Razorpay** (`razorpay` npm dep; `services/razorpayService.js`,
  `controllers/paymentController.js`). Orders, payment links, signature + webhook
  verification. Keys: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
- **WhatsApp / SMS: Twilio** (and a Meta/WhatsApp-Cloud path)
  (`services/whatsappService.js`, `whatsappBotController.js`,
  `notificationController.js`). Env: `WHATSAPP_PROVIDER`, `WHATSAPP_API_KEY`,
  `WHATSAPP_API_URL`, `WHATSAPP_COUNTRY_CODE`, `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `META_PHONE_NUMBER_ID`,
  `WHATSAPP_PHARMACY_TEAM_PHONE`, `WHATSAPP_VERIFY_TOKEN`.
- **Lab-analyzer integration: HL7** (`simple-hl7` dep; `src/integration/hl7Listener.js`,
  `hl7Parser.js`). Opt-in via `ENABLE_HL7_LISTENERS=true`.
- **eAPTS (Ethiopian pharmacy system):** schema + config models exist
  (`EaptsConfig`, `EaptsTransaction`); API keys stored per-org in DB.
- **Barcode lookup:** optional external API (`BARCODE_LOOKUP_ENABLED`,
  `BARCODE_API_URL`, `BARCODE_API_KEY`) — `src/pharmacy/barcodeProvider.js`.
- **GudMed doctor API:** `GUDMED_API_URL`, `GUDMED_DOCTOR_MOBILE/PASSWORD/CODE`.
- **Insurance/TPA:** **internal tracking only** (`InsuranceCase`/`InsuranceClaim`);
  **NO external TPA/insurer API integration found — NOT FOUND.**

**Env variable names in use (names only; values redacted):**
`DATABASE_URL`, `PORT`, `NODE_ENV`, `ORGANIZATION_ID`, `JWT_SECRET`, `AUTH_ENFORCED`,
`FRONTEND_URL`, `IMPORT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`WHATSAPP_PROVIDER`, `WHATSAPP_API_KEY`, `WHATSAPP_API_URL`, `WHATSAPP_COUNTRY_CODE`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `META_PHONE_NUMBER_ID`,
`WHATSAPP_PHARMACY_TEAM_PHONE`, `WHATSAPP_VERIFY_TOKEN`, `ENABLE_HL7_LISTENERS`,
`DEFAULT_REQUESTED_BY_ID`, `GUDMED_API_URL`, `GUDMED_DOCTOR_MOBILE`,
`GUDMED_DOCTOR_PASSWORD`, `GUDMED_DOCTOR_CODE`, `BARCODE_LOOKUP_ENABLED`,
`BARCODE_API_URL`, `BARCODE_API_KEY`, `MEDICINE_DATASET_URL`, `REMOTE_DATABASE_URL`,
`SEED_TARGET`. (Frontend: `VITE_API_URL`, currently commented out in favor of a
relative `/api` proxy.)

---

## 11. GAPS & OBSERVATIONS (things that affect adding a billing/credit module)

**Data model & money integrity**
1. **Money is `Float` everywhere** (Invoice/Payment/Bill/IpdCharge/etc.) — floating-point paisa drift. A new money module should consider Prisma `Decimal`, but must match the existing `Float` columns it joins to (mixing types mid-schema is a migration risk). This is the security audit's **M5**.
2. **No `prisma/migrations/` history** — schema is `db push`. Adding tables is easy, but **renames/drops can silently lose data** (M6, and root cause of the live invoice-counter incident). Recommend introducing real migrations before shipping a billing module that alters existing tables.
3. **Two parallel billing engines with different rigor:** OPD (`Invoice`/`Payment`, **no idempotency**, `RCP`+`Date.now()` receipt numbers that can collide — M4) vs IPD (`Bill`/`BillPayment`, **idempotency-key + atomic FY counter**). A unified billing/credit module should standardize on the **IPD ledger pattern** and backfill idempotency into OPD `Payment`.
4. **`Payment` model lacks `idempotencyKey`** → double-charge on double-submit (security audit **C4/C5**). Fix as part of the new module.
5. **`paymentController.js` references a non-existent `paymentTransaction` model** (`:70`) and a bogus `db.invoice.fields?.totalAmount` write (`:150`). Razorpay verify also sets `amountPaid = invoice.totalAmount` regardless of captured amount (wrong for partial payments). Clean these up.

**Auth / approvals (critical for a credit/approval workflow)**
6. **No permission/approval framework in use.** `Permission`/`RolePermission` tables exist but are dead code; `authorize()` is called with no roles on every route (all authenticated staff can hit billing). Role names are inconsistent (`billing` vs `billing_clerk`). Any discount/refund/credit-approval tiering must be **built from scratch** (roles + `authorize(...roles)` + AuditLog). Note the IPD `force`-discharge bypass (**R5**) as an anti-pattern: a money-gate with no role check.
7. **Multi-tenant "fail-open" fallback:** `getOrgId()` (`reqContext.js:18`) falls back to `org-demo` when no org is on the request. In enforced prod this is fine, but the new module must always scope writes by `organizationId` and never trust a client-supplied one (the security audit's IDOR cluster C3/R1 shows several existing modules that got this wrong).

**Operational**
8. **File uploads → local ephemeral disk** (`uploads/`, no S3) — any billing PDFs/receipts stored on disk vanish on Render redeploy (**R2**). Store generated invoices/receipts in object storage.
9. **No scheduler/cron dependency exists** (confirmed: no `node-cron`/queue in either package.json) — so recurring billing (auto-reminders for dues, statement runs, credit-limit sweeps) has **no infrastructure yet**; it must be added (**R14** in the security audit; also matches the WhatsApp/queue project memory).
10. **Unbounded list endpoints** on billing/lab/radiology/consultation (`limit` uncapped — **R13**) and unbounded client-side fetches (**R10**). A billing module with large ledgers must paginate server-side (billing `getAll` already caps at 1000 — follow that).

**Things a human should confirm**
- Whether the new "Billing & Credit" module should **extend the OPD `Invoice`/`Payment` core, the IPD `Bill`/`BillPayment` ledger, or unify both.** They are currently separate and inconsistent — this is the single biggest architectural decision.
- The intended meaning of **"credit"**: patient advance/store-credit balance? credit notes (the reserved `BillPayment.creditNoteId`)? corporate/TPA credit lines with limits? Each implies different tables.
- Whether to migrate money columns to **`Decimal`** now (cheaper before more billing data accrues).
- Whether to introduce **real Prisma migrations** before touching existing billing tables.
- Target **currency/locale**: schema defaults are mixed — `Organization.country` defaults to `"Ethiopia"` and there are Ethiopian-calendar/eAPTS fields, but settings default `currency:"INR"`, timezone `Asia/Kolkata`, and numbering uses the **Indian financial year**. Confirm the real deployment locale before designing tax/GST and statement logic.

---

_End of architecture audit._
