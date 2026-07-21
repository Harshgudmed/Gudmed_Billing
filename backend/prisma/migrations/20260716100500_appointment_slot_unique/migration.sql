-- Prevents double-booking: no two LIVE appointments for the same doctor at the
-- same date+time. Before this, the only guard was an app-level
-- findFirst-then-create in appointmentController.js#create with no DB backstop,
-- so two receptionists booking the same doctor+slot within the same ~100ms
-- window could both pass the check and both succeed. A partial index (Prisma's
-- schema cannot express a WHERE-filtered unique constraint, so this lives only
-- as a hand-written migration) excludes cancelled/no_show/rescheduled rows — a
-- freed slot must be rebookable — and null doctorId (walk-ins).
--
-- Existing clashes are resolved here rather than refusing to apply.
--
-- The first version of this migration raised an exception and told an operator
-- to go and fix the data by hand. That was the wrong call: it blocked every
-- subsequent deploy behind a manual step on a production shell, and Prisma
-- records the failure, so even re-deploying after a manual fix needs
-- `migrate resolve --rolled-back` first. A migration that cannot complete on
-- its own is not a guard, it is an outage.
--
-- Resolving is safe, and is what a human would do anyway: the slot physically
-- cannot hold two patients, so one is being turned away regardless. The
-- FIRST-BOOKED appointment is kept; later ones are set to 'cancelled' with a
-- reason on the row, which is an ordinary reversible status change (nothing is
-- deleted) and exactly what the freed-slot rule already expects. Every affected
-- id is printed to the deploy log.

DO $$
DECLARE
  clashes INT;
  victims INT;
  ids TEXT;
BEGIN
  SELECT COUNT(*) INTO clashes FROM (
    SELECT 1 FROM "Appointment"
    WHERE "doctorId" IS NOT NULL AND status NOT IN ('cancelled','no_show','rescheduled')
    GROUP BY "organizationId","doctorId","appointmentDate","appointmentTime"
    HAVING COUNT(*) > 1
  ) x;

  IF clashes = 0 THEN
    RAISE NOTICE 'Double-booking guard: no existing clashes.';
  ELSE
    -- Rank live appointments within each slot; keep rn = 1 (booked first).
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY "organizationId","doctorId","appointmentDate","appointmentTime"
               ORDER BY "createdAt" ASC, id ASC
             ) AS rn
      FROM "Appointment"
      WHERE "doctorId" IS NOT NULL AND status NOT IN ('cancelled','no_show','rescheduled')
    ), cancelled AS (
      UPDATE "Appointment" a
      SET status = 'cancelled',
          "cancelledAt" = NOW(),
          "cancellationReason" = 'Duplicate booking: this doctor and time slot already held an earlier appointment. Cancelled automatically when the double-booking guard was enabled.'
      FROM ranked r
      WHERE a.id = r.id AND r.rn > 1
      RETURNING a.id
    )
    SELECT COUNT(*), STRING_AGG(id, ', ') INTO victims, ids FROM cancelled;

    RAISE NOTICE 'Double-booking guard: % clashing slot(s); cancelled % later appointment(s). The earliest booking in each slot was kept. Cancelled ids: %', clashes, victims, ids;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_doctor_active_slot_key"
ON "Appointment" ("organizationId", "doctorId", "appointmentDate", "appointmentTime")
WHERE "doctorId" IS NOT NULL AND status NOT IN ('cancelled', 'no_show', 'rescheduled');
