-- Explicit floor display order, replacing the previous implicit (and buggy)
-- reliance on name-sort ("1st Floor" sorted before "Ground Floor" since
-- '1' < 'G') or createdAt-sort (a fragile proxy that breaks the moment a
-- floor is added out of physical building sequence).
ALTER TABLE "Floor" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill: today's floors happen to have been created in the correct
-- physical order (Ground, 1st, 2nd, 3rd), so createdAt order is a safe
-- one-time seed for existing rows only — going forward, sortOrder is the
-- single source of truth, set explicitly at creation.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt" ASC) - 1 AS rn
  FROM "Floor"
)
UPDATE "Floor" f
SET "sortOrder" = ranked.rn
FROM ranked
WHERE f.id = ranked.id;
