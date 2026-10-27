-- Vendor extras (Purchase module): VRF number and a second contact person/phone.
-- Additive and nullable, so vendors created before these existed keep working.
ALTER TABLE "Vendor" ADD COLUMN "vrfNumber" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "contactPerson2" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "phone2" TEXT;
