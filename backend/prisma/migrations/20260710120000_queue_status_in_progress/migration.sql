-- Rename the queue's "in service" status to "in_progress".
--
-- QueueManagement.status was the only place in the codebase spelling this state
-- `in_service`; Appointment, LabOrder and RadiologyOrder all use `in_progress`.
-- The frontend rendered and counted `in_progress`, so the In Progress tile was
-- permanently stuck at zero and no button could ever produce that state.
--
-- `status` is a plain String column (no Postgres enum), so only the stored rows
-- need rewriting — there is no type to alter.

UPDATE "QueueManagement" SET "status" = 'in_progress' WHERE "status" = 'in_service';
