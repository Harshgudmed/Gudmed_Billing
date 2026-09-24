-- A lab order billed today may be collected on another day: the patient is told
-- to come tomorrow, or asks to reschedule. LabOrder only had orderDate (the day
-- it was billed), so there was nowhere to keep the day it is actually due.
--
-- Additive and nullable: existing orders are untouched and read as due on their
-- orderDate. IF NOT EXISTS so a database that already has it is not an error.
ALTER TABLE "LabOrder" ADD COLUMN IF NOT EXISTS "scheduledDate" TIMESTAMP(3);
