-- Tenant-scope LabResult and RadiologyReport.
--
-- Both tables carried a NULLABLE `organizationId` with no foreign key and no
-- index, while the Prisma schema now declares it required. A client generated
-- from that schema throws on any pre-existing row whose value is NULL, so the
-- column must be backfilled and tightened before the new code serves traffic.
--
-- Backfill source is the parent order, which has always been NOT NULL. Any row
-- whose parent has since been deleted cannot be attributed to a tenant; those
-- are deleted rather than guessed, so no record is ever silently reassigned to
-- the wrong hospital. (Both FKs cascade on delete, so such orphans should not
-- exist — this is a belt-and-braces guard for older, pre-cascade data.)

-- 1. Backfill from the parent order.
UPDATE "LabResult" r
SET "organizationId" = o."organizationId"
FROM "LabOrder" o
WHERE r."orderId" = o."id" AND r."organizationId" IS NULL;

UPDATE "RadiologyReport" r
SET "organizationId" = o."organizationId"
FROM "RadiologyOrder" o
WHERE r."orderId" = o."id" AND r."organizationId" IS NULL;

-- 2. Drop rows that could not be attributed to any tenant.
DELETE FROM "LabResult" WHERE "organizationId" IS NULL;
DELETE FROM "RadiologyReport" WHERE "organizationId" IS NULL;

-- 3. Tighten the column.
ALTER TABLE "LabResult" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "RadiologyReport" ALTER COLUMN "organizationId" SET NOT NULL;

-- 4. Index + foreign key (idempotent: the local dev DB already has these from a
--    prior `db push`, and re-running must not error).
CREATE INDEX IF NOT EXISTS "LabResult_organizationId_idx" ON "LabResult"("organizationId");
CREATE INDEX IF NOT EXISTS "RadiologyReport_organizationId_idx" ON "RadiologyReport"("organizationId");

DO $$ BEGIN
  ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RadiologyReport" ADD CONSTRAINT "RadiologyReport_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PharmacyBatch.organizationId was already NOT NULL in the baseline; only its
-- relation + index are new.
CREATE INDEX IF NOT EXISTS "PharmacyBatch_organizationId_idx" ON "PharmacyBatch"("organizationId");

DO $$ BEGIN
  ALTER TABLE "PharmacyBatch" ADD CONSTRAINT "PharmacyBatch_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
