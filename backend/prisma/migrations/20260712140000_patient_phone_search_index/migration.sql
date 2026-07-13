-- Make patient search fast on large tables.
--
-- The patient lookup (billing, OPD, everywhere) searches firstName/lastName/mrn/
-- phonePrimary with case-insensitive `ILIKE '%term%'`. firstName, lastName and
-- mrn already have GIN trigram indexes, but phonePrimary did NOT — and because
-- ONE unindexable branch of an OR forces Postgres to sequential-scan the whole
-- table, the entire search fell back to a full scan. On a 1.05M-row Patient table
-- a rare/no-match term took ~3.7-4.0 SECONDS.
--
-- Adding the matching trigram index lets the planner BitmapOr across all four
-- columns. Measured on the dev DB: the same searches drop to ~7-10 ms (~400x).

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX IF NOT EXISTS "idx_patient_phone_trgm"
  ON "Patient" USING GIN ("phonePrimary" gin_trgm_ops);
