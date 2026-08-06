-- Seven human-visible document numbers: from GLOBALLY unique to unique PER HOSPITAL.
--
-- Every one of these columns is filled by a PER-ORGANIZATION counter
-- (src/lib/counters.js — nextSeriesNumber / generateUHID, backed by BillCounter
-- keyed (organizationId, series, year)), while the column itself carried a
-- global @unique. The two do not agree: each org's series independently starts
-- at 1, so the SECOND hospital to perform any of these actions is handed the
-- exact string org #1 already used, hits a P2002 unique violation, and simply
-- cannot do that thing at all. None of the call sites retry, so the user gets a
-- 500. This is not theoretical — this database already holds two orgs, and
-- org-demo already owns "LAB-2026-27-000001", "RCP-2026-27-000004" and
-- "1000000001".
--
--   Patient.mrn                 <- generateUHID          (series 'UHID')
--   PharmacySale.receiptNumber  <- nextSeriesNumber      (series 'OPD_RCP')
--   Payment.receiptNumber       <- nextSeriesNumber      (series 'OPD_RCP')
--   LabOrder.orderNumber        <- nextSeriesNumber      (series 'LAB_ORDER')
--   LabOrder.accessionNumber    <- set by the lab/LIS, matched per-org
--   RadiologyOrder.orderNumber  <- nextSeriesNumber      (series 'RAD_ORDER')
--   PreTriage.screeningNumber   <- nextSeriesNumber      (series 'PRE_TRIAGE')
--
-- Invoice.invoiceNumber, DeathCertificate.certificateNumber, Bill.billNumber
-- and BillPayment.receiptNumber were already fixed this way — see
-- 20260718090000_invoice_number_scoped_per_org and
-- 20260727120000_death_cert_number_scoped_per_org. This migration finishes the
-- job for the columns that were missed. Only these seven change: every other
-- column-level @unique left in the schema (Organization.slug, User.email,
-- password/invitation tokens, Permission.code, DisplayDevice.deviceId, and the
-- 1:1 foreign keys) is deliberately global and is NOT touched.
--
-- Why scope the constraint instead of making the VALUE globally unique: these
-- are each one hospital's own internal document number. They are printed on that
-- hospital's cards, receipts and forms and mean nothing anywhere else. Nothing
-- in this codebase looks any of them up without a tenant — there is not a single
-- findUnique({ where: { <number> } }) on any of the seven, and the one external
-- entry point (integration/queueProcessor.js, matching an incoming HL7 analyzer
-- result to its LabOrder by accession) already filters on organizationId.
-- Stuffing an org discriminator into the value would instead change the shape of
-- a number that is already printed on a million patients' cards.
--
-- No data de-duplication step is needed anywhere: because the OLD index was
-- globally unique on the column alone, no two rows can share a value, so the
-- composite (organizationId, <column>) is unique by construction already —
-- verified against this database, 0 duplicate pairs on all seven. Nothing is
-- rewritten, so the historical Patient.mrn shapes still in the table
-- (MRN-26-1048905, MRN100469, UHID202607178657, DEMOFLOW-*, plain 10-digit) are
-- preserved exactly as they are: this migration only ever touches indexes,
-- never a row.
--
-- Every DROP is a plain unique INDEX from 0_init (not a table CONSTRAINT), so
-- DROP INDEX — not ALTER TABLE ... DROP CONSTRAINT — is correct. Each new index
-- uses Prisma's own name for the corresponding @@unique([...]) so `migrate diff`
-- sees no drift. IF EXISTS / IF NOT EXISTS throughout so this is idempotent and
-- safe both on a database a developer already adjusted by hand and on one built
-- purely from migrations.
--
-- Nullable columns (LabOrder.accessionNumber) keep their existing behaviour:
-- Postgres treats NULLs as distinct under a unique index, so rows without an
-- accession number are unaffected.
--
-- Indexes are built non-CONCURRENTLY on purpose: Prisma runs a migration inside
-- a transaction and CREATE INDEX CONCURRENTLY cannot run in one. Patient is the
-- only large table here (~1.05M rows); its build takes a couple of seconds and
-- holds a write lock on Patient for that time, so deploy this outside OPD
-- registration hours.

-- 1. Patient.mrn (the UHID). The non-unique "Patient_mrn_idx" btree and the
--    "idx_patient_mrn_trgm" GIN index are left in place — search needs them.
DROP INDEX IF EXISTS "Patient_mrn_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Patient_organizationId_mrn_key"
ON "Patient" ("organizationId", "mrn");

-- 2. PharmacySale.receiptNumber
DROP INDEX IF EXISTS "PharmacySale_receiptNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "PharmacySale_organizationId_receiptNumber_key"
ON "PharmacySale" ("organizationId", "receiptNumber");

-- 3. Payment.receiptNumber. The non-unique "Payment_receiptNumber_idx" is kept.
DROP INDEX IF EXISTS "Payment_receiptNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_organizationId_receiptNumber_key"
ON "Payment" ("organizationId", "receiptNumber");

-- 4. LabOrder.orderNumber
DROP INDEX IF EXISTS "LabOrder_orderNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "LabOrder_organizationId_orderNumber_key"
ON "LabOrder" ("organizationId", "orderNumber");

-- 5. LabOrder.accessionNumber. The non-unique "LabOrder_accessionNumber_idx" is
--    kept — queueProcessor matches incoming results on it.
DROP INDEX IF EXISTS "LabOrder_accessionNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "LabOrder_organizationId_accessionNumber_key"
ON "LabOrder" ("organizationId", "accessionNumber");

-- 6. RadiologyOrder.orderNumber
DROP INDEX IF EXISTS "RadiologyOrder_orderNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "RadiologyOrder_organizationId_orderNumber_key"
ON "RadiologyOrder" ("organizationId", "orderNumber");

-- 7. PreTriage.screeningNumber. The non-unique "PreTriage_screeningNumber_idx"
--    is kept.
DROP INDEX IF EXISTS "PreTriage_screeningNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "PreTriage_organizationId_screeningNumber_key"
ON "PreTriage" ("organizationId", "screeningNumber");
