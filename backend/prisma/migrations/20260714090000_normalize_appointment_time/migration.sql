-- Zero-pad every appointment time to HH:MM.
--
-- `Appointment.appointmentTime` is a String and is SORTED as one
-- (`orderBy: { appointmentTime: 'asc' }` in appointmentController.getAll). An
-- unpadded "9:00" therefore sorts AFTER "10:00" — lexicographically "9" > "1" —
-- so the 9am patient was listed at the BOTTOM of the day, below the 5pm ones.
--
-- The create/update paths validate `^\d{2}:\d{2}$`, but POST /:id/reschedule has no
-- validate() middleware and wrote req.body straight through, which is how the
-- unpadded values got in. That leak is closed in the same change; this backfills
-- the rows already stored.

UPDATE "Appointment"
SET "appointmentTime" =
      lpad(split_part("appointmentTime", ':', 1), 2, '0') || ':' ||
      lpad(split_part("appointmentTime", ':', 2), 2, '0')
WHERE "appointmentTime" ~ '^[0-9]{1,2}:[0-9]{1,2}$'
  AND "appointmentTime" !~ '^[0-9]{2}:[0-9]{2}$';
