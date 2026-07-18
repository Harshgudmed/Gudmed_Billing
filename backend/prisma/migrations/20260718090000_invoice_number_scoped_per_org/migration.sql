-- Invoice.invoiceNumber: from GLOBALLY unique to unique PER HOSPITAL.
--
-- The number is minted by a per-organization + per-financial-year counter
-- (src/lib/counters.js#nextSeriesNumber), so every org's series independently
-- starts at INV-<FY>-000001. The old column-level @unique made that number
-- global across every tenant: the SECOND hospital to commit "INV-2026-27-000001"
-- hit a P2002 unique violation and simply could not raise an invoice. Rooms
-- already got this right with @@unique([organizationId, floorId, roomNumber]);
-- invoices must be scoped the same way.
--
-- No data de-duplication step is needed: because the OLD index was globally
-- unique on invoiceNumber alone, no two rows can share an invoiceNumber, so the
-- composite (organizationId, invoiceNumber) is unique by construction already.
--
-- Idempotent + guarded so it is safe on a database that a developer already
-- adjusted by hand, and on one built purely from migrations (production).

-- 1. Drop the old global unique index. It is a plain unique INDEX
--    ("Invoice_invoiceNumber_key" from 0_init), not a table CONSTRAINT, so
--    DROP INDEX (not ALTER TABLE ... DROP CONSTRAINT) is correct. IF EXISTS so a
--    DB where it was already removed does not error.
DROP INDEX IF EXISTS "Invoice_invoiceNumber_key";

-- 2. Create the per-hospital composite unique index. Prisma's own name for
--    @@unique([organizationId, invoiceNumber]) so `migrate diff` sees no drift.
--    IF NOT EXISTS so re-running is harmless.
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_organizationId_invoiceNumber_key"
ON "Invoice" ("organizationId", "invoiceNumber");
