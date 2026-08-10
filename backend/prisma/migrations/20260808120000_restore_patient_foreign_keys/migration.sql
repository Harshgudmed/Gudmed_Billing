-- Put back the 17 foreign keys that point at Patient.
--
-- WHAT WENT WRONG
-- schema.prisma has always declared these relations, several of them with
-- `onDelete: Cascade`. The database did not have them. It has 165 foreign keys, 41
-- of them pointing at User — and, until this migration, zero pointing at Patient.
--
-- They were dropped deliberately during a data trim (deleting 850,000 patients was
-- taking 15+ minutes because 17 tables each re-checked their key per deleted row)
-- on what was believed to be a disposable copy. That copy became the working
-- database and the constraints were never restored.
--
-- WHAT IT COST
-- With no foreign key, `onDelete: Cascade` is a comment. Deleting a patient left
-- their appointments behind pointing at nobody: 381 of them, all from 2026-06-26.
-- Prisma's schema declares `patient` as required, so every `findMany` whose page
-- happened to contain one of those rows threw
--
--     Inconsistent query result: Field patient is required to return data, got `null`
--
-- and returned a hard 500. In practice that was the Appointments "Today" tab and
-- any search that matched one — a screen the front desk uses all day, down, with a
-- stack trace instead of a list.
--
-- BEFORE APPLYING THIS TO A DATABASE WITH DATA
-- Run `node backend/scripts/check-orphans.mjs` first. Postgres validates every
-- existing row when a constraint is added, so a single orphan makes the whole
-- migration fail — which is the correct behaviour, but you want to find that out
-- from a script, not from a failed deploy.
--
-- This takes a lock on each table while it validates. On the production row counts
-- (~200k patients, ~198k appointments) run it in the same window as any other
-- schema work, outside OPD hours.

-- WHY `NOT VALID`
-- Without it, Postgres re-checks every existing row the moment the constraint is
-- added: 197,632 appointments and 197,647 queue rows, under an ACCESS EXCLUSIVE
-- lock that blocks reads AND writes on those tables for the whole scan. On Render
-- that runs as `prisma migrate deploy && node server.js` — so a single legacy
-- orphan anywhere in that data makes the migration fail, the `&&` short-circuits,
-- and the API never starts. A deploy that takes the backend down is worse than the
-- bug it was fixing.
--
-- `NOT VALID` adds the constraint WITHOUT scanning what is already there. From this
-- moment on Postgres enforces it on every insert and update, and `ON DELETE CASCADE`
-- starts working — which is the whole point, because it has been a comment until
-- now. The lock is momentary.
--
-- What it does NOT do is remove orphans that already exist. Those still make
-- Prisma throw `Inconsistent query result: Field patient is required`, so:
--
--   1. deploy this (safe, cannot fail, no new orphans possible)
--   2. run `node backend/scripts/check-orphans.mjs` against production
--   3. if it finds any, clean them, then in a quiet window:
--        ALTER TABLE "Appointment" VALIDATE CONSTRAINT "Appointment_patientId_fkey";
--      VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock — reads and writes continue.

ALTER TABLE "PatientDocument"      ADD CONSTRAINT "PatientDocument_patientId_fkey"           FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE CASCADE  ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Appointment"          ADD CONSTRAINT "Appointment_patientId_fkey"               FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE CASCADE  ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Consultation"         ADD CONSTRAINT "Consultation_patientId_fkey"              FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE CASCADE  ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Admission"            ADD CONSTRAINT "Admission_patientId_fkey"                 FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Prescription"         ADD CONSTRAINT "Prescription_patientId_fkey"              FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE CASCADE  ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PharmacySale"         ADD CONSTRAINT "PharmacySale_patientId_fkey"              FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Invoice"              ADD CONSTRAINT "Invoice_patientId_fkey"                   FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE CASCADE  ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Payment"              ADD CONSTRAINT "Payment_patientId_fkey"                   FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "MachineResultsQueue"  ADD CONSTRAINT "MachineResultsQueue_matchedPatientId_fkey" FOREIGN KEY ("matchedPatientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "LabOrder"             ADD CONSTRAINT "LabOrder_patientId_fkey"                  FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE CASCADE  ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RadiologyOrder"       ADD CONSTRAINT "RadiologyOrder_patientId_fkey"            FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE CASCADE  ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PreTriage"            ADD CONSTRAINT "PreTriage_patientId_fkey"                 FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "QueueManagement"      ADD CONSTRAINT "QueueManagement_patientId_fkey"           FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DayCareCase"          ADD CONSTRAINT "DayCareCase_patientId_fkey"               FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AmbulanceTrip"        ADD CONSTRAINT "AmbulanceTrip_patientId_fkey"             FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "InsuranceCase"        ADD CONSTRAINT "InsuranceCase_patientId_fkey"             FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DeathCertificate"     ADD CONSTRAINT "DeathCertificate_patientId_fkey"          FOREIGN KEY ("patientId")        REFERENCES "Patient"("id") ON DELETE CASCADE  ON UPDATE CASCADE NOT VALID;
