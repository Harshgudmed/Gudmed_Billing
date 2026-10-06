-- One vendor per GSTIN in a hospital (vendors without a GSTIN are NULL and never
-- collide).
--
-- Older pharmacy suppliers were free text, so before the rule is created this
-- cleans up what would have stopped it — a stopped migration leaves a deploy
-- half done:
--   1. A blank GSTIN ('' or spaces) means "none given": it becomes NULL.
--   2. Where one GSTIN sits on several vendors of a hospital, the oldest vendor
--      keeps it and the others lose only that one field (name, phone and the
--      rest stay). What was cleared is kept in "_vendor_gstin_cleared" so it can
--      be put back by hand; the table is dropped again when nothing was cleared.

UPDATE "Vendor" SET "gstNumber" = NULL WHERE "gstNumber" IS NOT NULL AND btrim("gstNumber") = '';

CREATE TABLE "_vendor_gstin_cleared" AS
SELECT v.id AS "vendorId", v."organizationId", v."gstNumber", now() AS "clearedAt"
FROM "Vendor" v
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId", "gstNumber" ORDER BY "createdAt", id) AS rn
  FROM "Vendor" WHERE "gstNumber" IS NOT NULL
) ranked ON ranked.id = v.id
WHERE ranked.rn > 1;

UPDATE "Vendor" SET "gstNumber" = NULL WHERE id IN (SELECT "vendorId" FROM "_vendor_gstin_cleared");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "_vendor_gstin_cleared") THEN
    DROP TABLE "_vendor_gstin_cleared";
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_organizationId_gstNumber_key" ON "Vendor"("organizationId", "gstNumber");
