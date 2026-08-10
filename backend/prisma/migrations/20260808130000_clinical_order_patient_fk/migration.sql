-- The eighteenth Patient reference.
--
-- ClinicalOrder carried a bare `patientId String` column with no `@relation` next
-- to it, so Prisma never asked the database for a foreign key. It was the only
-- Patient reference still unenforced after 20260808120000 restored the other 17 —
-- invisible precisely because the schema looked complete: the column was there, the
-- code wrote to it, and nothing checked that the id meant anything.
--
-- Cascade matches LabOrder and RadiologyOrder. An order belongs to the patient.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClinicalOrder_patientId_fkey') THEN
    ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

-- NOT VALID for the same reason as the sibling migration: the constraint is enforced
-- from now on and cannot fail the deploy on data that predates it. Validate it
-- separately, once check-orphans.mjs reports production clean.

-- Guarded for the same reason as the sibling migration: production may already
-- have this key, and re-adding it aborts the whole deploy.
