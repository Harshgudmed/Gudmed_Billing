-- Every lab order has a scheduled day, stored — not guessed by the screen.
--
-- New rows: the database fills it with the moment the order is made, whichever
-- of the four paths creates it (Lab, Billing, consultation create / update).
-- Existing rows: the day they were ordered, which is when they were due before
-- this column existed. Only NULLs are touched, so a date already set by a
-- reschedule is kept, and running this twice changes nothing.
ALTER TABLE "LabOrder" ALTER COLUMN "scheduledDate" SET DEFAULT CURRENT_TIMESTAMP;
UPDATE "LabOrder" SET "scheduledDate" = "orderDate" WHERE "scheduledDate" IS NULL;
