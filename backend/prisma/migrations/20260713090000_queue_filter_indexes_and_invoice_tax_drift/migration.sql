-- Two things, both safe to re-run.
--
-- 1) DRIFT FIX — Invoice."taxPercentage"
--    schema.prisma declares Invoice.taxPercentage, but no migration ever created
--    it (0_init has taxAmount only; the column reached the dev DB via an old
--    `db push`). A database built purely from migrations would therefore LACK the
--    column while the generated Prisma Client selects it — every invoice read
--    would fail. Added idempotently so an environment that already has it is a
--    no-op.
--
-- 2) QUEUE FILTER INDEXES
--    The queue list filters by status (and serviceArea) and then sorts by
--    priorityRank/joinedQueueAt. The old index only covered (organizationId,
--    priorityRank, joinedQueueAt), so a status-filtered read could not use it for
--    both the filter and the sort. These two replace it and match the real query
--    shapes. NOTE: the GIN trigram indexes on Patient are deliberately NOT touched
--    — `prisma migrate diff` wants to drop them because raw indexes aren't in the
--    Prisma schema, and dropping idx_patient_phone_trgm would undo the ~400x
--    patient-search speedup.

-- 1) Invoice tax drift
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2) Queue indexes: replace the sort-only index with filter+sort covering ones.
DROP INDEX IF EXISTS "QueueManagement_organizationId_priorityRank_joinedQueueAt_idx";

CREATE INDEX IF NOT EXISTS "QueueManagement_organizationId_status_priorityRank_joinedQu_idx"
  ON "QueueManagement" ("organizationId", "status", "priorityRank", "joinedQueueAt");

CREATE INDEX IF NOT EXISTS "QueueManagement_organizationId_serviceArea_status_priorityR_idx"
  ON "QueueManagement" ("organizationId", "serviceArea", "status", "priorityRank", "joinedQueueAt");
