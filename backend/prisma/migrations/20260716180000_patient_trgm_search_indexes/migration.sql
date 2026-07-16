-- Close the last of the schema-vs-migrations drift on Patient search.
--
-- schema.prisma has declared GIN trigram indexes on firstName / lastName / mrn
-- for a while, but no migration ever created them — they only ever reached a
-- developer's database through `prisma db push`. Production is built from
-- migrations alone, so production never had them and patient search there has
-- been doing sequential scans on a 1M-row table.
--
-- Same root cause as the Invoice.taxPercentage incident (commit d97556f, "a
-- live deploy bomb"): that one was a missing COLUMN and crashed every invoice
-- read; this one is a missing INDEX and merely made search slow, which is why
-- it went unnoticed. `npm run check:drift` now fails on this class of gap.
--
-- IF NOT EXISTS throughout: developer databases already have these from the
-- old `db push`, and re-running must be a no-op.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "idx_patient_firstname_trgm"
  ON "Patient" USING GIN ("firstName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_patient_lastname_trgm"
  ON "Patient" USING GIN ("lastName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_patient_mrn_trgm"
  ON "Patient" USING GIN ("mrn" gin_trgm_ops);

-- schema.prisma does not declare a phone trigram index (phone search uses the
-- btree from 20260712140000). Drop it so the migrations and the schema agree —
-- otherwise every future `prisma migrate dev` keeps trying to remove it.
DROP INDEX IF EXISTS "idx_patient_phone_trgm";
