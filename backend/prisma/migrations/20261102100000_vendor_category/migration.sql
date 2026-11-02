-- Vendor category (Purchase module): a free-text field so the vendor list can
-- be filtered the way the item catalogue is. Additive and nullable, so
-- vendors created before this existed keep working.
ALTER TABLE "Vendor" ADD COLUMN "category" TEXT;
