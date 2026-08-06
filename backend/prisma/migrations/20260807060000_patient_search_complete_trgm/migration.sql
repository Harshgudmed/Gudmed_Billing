-- Finish the patient-search indexes, so the search stops reading the whole table.
--
-- THE SYMPTOM
-- Patient search on production takes ~16 seconds. The browser gives up before
-- the reply arrives, and because an aborted request carries no headers at all,
-- the console reports it as a CORS failure — which sends everyone looking at the
-- CORS configuration, which is correct and always was.
--
-- THE CAUSE
-- patientSearchWhere (src/lib/patientSearch.js) matches five fields:
--     firstName, middleName, lastName, mrn, phonePrimary
-- each with Prisma's `contains` + `mode: 'insensitive'`, i.e. ILIKE '%term%'.
-- A btree cannot serve a leading-wildcard ILIKE; only a GIN trigram index can.
--
-- 20260716180000 created trigram indexes for firstName, lastName and mrn — and
-- deliberately DROPPED the one on phonePrimary, on the reasoning that phone
-- search uses the btree from 20260712140000. That reasoning does not hold: the
-- search asks for `contains`, not `startsWith`, so the btree is unusable and
-- phonePrimary has had no usable index since. middleName never had one at all.
--
-- That leaves two of the five OR branches unindexable, and an OR is only as
-- indexable as its worst branch: Postgres cannot BitmapOr three index scans with
-- two sequential scans, so it does ONE sequential scan for the whole predicate.
-- Measured here on 200,552 patients:
--
--     Seq Scan on "Patient"  ... Rows Removed by Filter: 200544
--     Execution Time: 718 ms          (local SSD)
--
-- 718 ms locally becomes ~16 s on the production instance. The three existing
-- trigram indexes were doing nothing at all — one missing branch wasted them.
--
-- THE FIX
-- Index the two remaining branches so all five are indexable and the planner can
-- BitmapOr them.
--
-- Cost: two GIN indexes on Patient. They are only written on patient
-- insert/update, which is rare compared with how often search runs.
--
-- Built non-CONCURRENTLY because Prisma runs a migration inside a transaction
-- and CREATE INDEX CONCURRENTLY cannot run in one. Patient is ~200k rows here
-- and ~1M in some environments; the build holds a write lock on Patient for that
-- time, so deploy this outside OPD registration hours.
--
-- IF NOT EXISTS throughout so this is idempotent and safe on a developer
-- database that already has either index from an old `prisma db push`.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Never indexed, yet searched on every query — this is the branch that forced
-- the sequential scan.
CREATE INDEX IF NOT EXISTS "idx_patient_middlename_trgm"
  ON "Patient" USING GIN ("middleName" gin_trgm_ops);

-- Re-created deliberately. 20260716180000 dropped this believing the btree from
-- 20260712140000 covered phone search; it does not, because the search uses
-- `contains` (ILIKE '%…%') and a btree can only serve a left-anchored match.
-- The btree stays — exact and prefix lookups still use it.
CREATE INDEX IF NOT EXISTS "idx_patient_phone_trgm"
  ON "Patient" USING GIN ("phonePrimary" gin_trgm_ops);
