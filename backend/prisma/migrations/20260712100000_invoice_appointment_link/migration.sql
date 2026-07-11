-- Give Invoice a real foreign key to the Appointment it was auto-raised for.
--
-- Until now the appointment booking flow stored the appointment id inside the
-- invoice's free-text `notes` ("Auto-voucher | Appointment: <id> | Type: ...").
-- That could not be joined or queried, so nothing could cleanly answer "which
-- invoice belongs to this appointment". This adds a nullable `appointmentId`
-- column + index + FK, and backfills the existing auto-voucher invoices from the
-- note (only when the referenced appointment still exists, so the FK holds).

-- 1. Column (nullable — most invoices are counter/pharmacy/lab, not appointments).
ALTER TABLE "Invoice" ADD COLUMN "appointmentId" TEXT;

-- 2. Backfill legacy auto-voucher invoices from the notes string, guarded by an
--    existence check against Appointment so a dangling id can't break the FK.
UPDATE "Invoice" i
SET "appointmentId" = substring(i.notes from 'Appointment: ([^ |]+)')
FROM "Appointment" a
WHERE i.notes LIKE 'Auto-voucher | Appointment:%'
  AND a.id = substring(i.notes from 'Appointment: ([^ |]+)');

-- 3. Index for lookups by appointment.
CREATE INDEX IF NOT EXISTS "Invoice_appointmentId_idx" ON "Invoice"("appointmentId");

-- 4. Foreign key. ON DELETE SET NULL matches Prisma's default for an optional
--    relation: deleting an appointment must not delete its (legal) invoice.
DO $$ BEGIN
  ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
