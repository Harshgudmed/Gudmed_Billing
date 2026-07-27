-- DeathCertificate.certificateNumber: from GLOBALLY unique to unique PER HOSPITAL.
--
-- The number is minted by a per-organization counter in the controller
-- (count of this org's rows + 1 -> DC-00001, DC-00002 ...), so every org's
-- series independently starts at DC-00001. The old column-level @unique made
-- that number global across every tenant: the SECOND hospital to commit
-- "DC-00001" hit a P2002 unique violation and could not issue its first death
-- certificate. Invoices already got this right with
-- @@unique([organizationId, invoiceNumber]) (see
-- 20260718090000_invoice_number_scoped_per_org); death certificates must be
-- scoped the same way.
--
-- No data de-duplication step is needed: because the OLD index was globally
-- unique on certificateNumber alone, no two rows can share a certificateNumber,
-- so the composite (organizationId, certificateNumber) is unique by
-- construction already.
--
-- Idempotent + guarded so it is safe on a database a developer already adjusted
-- by hand, and on one built purely from migrations (production).

-- 1. Drop the old global unique index ("DeathCertificate_certificateNumber_key"
--    from 0_init). It is a plain unique INDEX, so DROP INDEX (not ALTER TABLE
--    ... DROP CONSTRAINT) is correct. IF EXISTS so a DB where it was already
--    removed does not error. The non-unique
--    "DeathCertificate_certificateNumber_idx" is left in place.
DROP INDEX IF EXISTS "DeathCertificate_certificateNumber_key";

-- 2. Create the per-hospital composite unique index. Prisma's own name for
--    @@unique([organizationId, certificateNumber]) so `migrate diff` sees no
--    drift. IF NOT EXISTS so re-running is harmless.
CREATE UNIQUE INDEX IF NOT EXISTS "DeathCertificate_organizationId_certificateNumber_key"
ON "DeathCertificate" ("organizationId", "certificateNumber");
