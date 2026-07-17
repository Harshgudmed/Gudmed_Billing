-- Patient address: Ethiopian administrative divisions -> Indian address fields.
--
-- WHY: this schema was forked from an Ethiopian HMS. The columns were named
-- region/zone/woreda/kebele — words that mean nothing to an Indian front desk,
-- and which no Indian address maps onto. The data already in them is Indian
-- (region="Telangana", zone="Chennai", woreda="City Center", kebele="Block V"),
-- so the rename below follows the data, not the old labels.
--
-- RENAME, not add+copy+drop: in Postgres a column rename is a catalogue-only
-- change — no table rewrite, no row locks held while 1.05M rows are copied, and
-- no window where the old and new columns can disagree. It is instant and
-- reversible.
--
-- Safe to re-run: each rename is guarded, so a partially-applied migration
-- (or a database already carrying the new names) does not error.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Patient' AND column_name = 'region') THEN
    ALTER TABLE "Patient" RENAME COLUMN "region" TO "state";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Patient' AND column_name = 'zone') THEN
    ALTER TABLE "Patient" RENAME COLUMN "zone" TO "city";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Patient' AND column_name = 'woreda') THEN
    ALTER TABLE "Patient" RENAME COLUMN "woreda" TO "locality";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Patient' AND column_name = 'kebele') THEN
    ALTER TABLE "Patient" RENAME COLUMN "kebele" TO "street";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Patient' AND column_name = 'postalCode') THEN
    ALTER TABLE "Patient" RENAME COLUMN "postalCode" TO "pincode";
  END IF;
END $$;

-- District had no Ethiopian counterpart to rename, so it is new. Indian
-- addresses carry it between city and state.
ALTER TABLE "Patient" ADD COLUMN IF NOT EXISTS "district" TEXT;
