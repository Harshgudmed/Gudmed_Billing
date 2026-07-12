-- Add a numeric sort key for the patient queue.
--
-- QueueManagement was ordered by the `priority` STRING (ORDER BY priority DESC).
-- That sorts alphabetically, so "high" landed below "low" and a patient bumped
-- to a higher priority never moved up. `priorityRank` is the value the queue
-- now sorts on; it is derived from `priority` in lib/queuePriority.js and kept
-- in step on every insert/update.

ALTER TABLE "QueueManagement" ADD COLUMN "priorityRank" INTEGER NOT NULL DEFAULT 40;

-- Backfill existing rows from their current priority string. Anything not in
-- this set keeps the column default (40 = "normal"), matching priorityRank().
UPDATE "QueueManagement" SET "priorityRank" =
  CASE "priority"
    WHEN 'urgent' THEN 100
    WHEN 'high'   THEN 80
    WHEN 'medium' THEN 60
    WHEN 'normal' THEN 40
    WHEN 'low'    THEN 20
    ELSE 40
  END;

-- Index the exact ORDER BY the list read uses, scoped per tenant.
CREATE INDEX "QueueManagement_organizationId_priorityRank_joinedQueueAt_idx"
  ON "QueueManagement" ("organizationId", "priorityRank", "joinedQueueAt");
