-- Prevents double-booking: no two LIVE appointments for the same doctor at
-- the same date+time. Before this, the only guard was an app-level
-- findFirst-then-create check in appointmentController.js#create with no DB
-- backstop — two receptionists booking the same doctor+slot within the same
-- ~100ms window could both pass the check and both succeed. A partial index
-- (Prisma schema.prisma cannot express a WHERE-filtered unique constraint,
-- so this lives only as a hand-written migration, not a schema @@unique)
-- excludes cancelled/no_show/rescheduled rows (a freed slot must be
-- rebookable) and null doctorId (walk-ins with no doctor assigned yet).

-- Pre-flight check. "Verified zero violations" was true only of the database
-- it was written on — any other deploy target has its own booking history and
-- may well contain real double-bookings. These are CLINICAL records: this
-- migration must never silently cancel or delete one to make an index fit.
-- So fail loudly, and say exactly what to fix and how to find it.
DO $$
DECLARE
  clashes INT;
BEGIN
  SELECT COUNT(*) INTO clashes FROM (
    SELECT 1
    FROM "Appointment"
    WHERE "doctorId" IS NOT NULL
      AND status NOT IN ('cancelled', 'no_show', 'rescheduled')
    GROUP BY "organizationId", "doctorId", "appointmentDate", "appointmentTime"
    HAVING COUNT(*) > 1
  ) x;

  IF clashes > 0 THEN
    RAISE EXCEPTION
      'Cannot add the double-booking guard: % doctor/date/time slot(s) already hold more than one live appointment. These are real bookings — review and cancel or reschedule the duplicates, then re-deploy. Find them with: SELECT "organizationId","doctorId","appointmentDate","appointmentTime",COUNT(*),ARRAY_AGG(id) FROM "Appointment" WHERE "doctorId" IS NOT NULL AND status NOT IN (''cancelled'',''no_show'',''rescheduled'') GROUP BY 1,2,3,4 HAVING COUNT(*)>1;',
      clashes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_doctor_active_slot_key"
ON "Appointment" ("organizationId", "doctorId", "appointmentDate", "appointmentTime")
WHERE "doctorId" IS NOT NULL AND status NOT IN ('cancelled', 'no_show', 'rescheduled');
