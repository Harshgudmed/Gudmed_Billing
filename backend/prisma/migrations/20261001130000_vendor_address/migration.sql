-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "district" TEXT,
ADD COLUMN     "houseNumber" TEXT,
ADD COLUMN     "locality" TEXT,
ADD COLUMN     "street" TEXT;


-- The one-line address vendors had so far becomes their Street / Block, so
-- nothing typed before is lost and the form shows it where it now belongs.
UPDATE "Vendor" SET "street" = "address" WHERE "street" IS NULL AND "address" IS NOT NULL AND btrim("address") <> '';
