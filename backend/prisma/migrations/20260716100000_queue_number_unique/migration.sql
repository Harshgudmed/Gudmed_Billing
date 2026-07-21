-- Backs utils/queueNumber.js#nextQueueNumber's atomic counter. Before this
-- constraint (and that generator), queueNumber was `PREFIX + date +
-- Math.random()` with nothing enforcing uniqueness — on this project's own
-- dataset that produced 127,073 rows sharing a queueNumber with another row.
--
-- The de-duplication MUST live in this migration, not be done by hand first.
-- Every database this runs against (each deploy target, each developer) has its
-- own independent pile of random collisions; a migration that only creates the
-- index works solely on a database someone already cleaned by hand and fails
-- everywhere else with a bare unique-violation.

-- 1. Renumber every duplicate but the first. The row's own primary key is
--    appended, so the result is unique by construction (two rows cannot share
--    an id) — no second pass or retry loop can be needed. Only rows that are
--    ALREADY broken data are touched; the first row of each group keeps its
--    number.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", "queueNumber"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "QueueManagement"
)
UPDATE "QueueManagement" q
SET "queueNumber" = q."queueNumber" || '-H' || q.id
FROM ranked r
WHERE q.id = r.id AND r.rn > 1;

-- 2. Now the constraint can hold. IF NOT EXISTS so a database that already has
--    it (applied by hand during development) is not an error.
CREATE UNIQUE INDEX IF NOT EXISTS "QueueManagement_organizationId_queueNumber_key"
ON "QueueManagement" ("organizationId", "queueNumber");
