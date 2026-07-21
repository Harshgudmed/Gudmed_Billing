-- Backs the Display Board's "today only" queries (displayController.js).
-- Almost every QueueManagement row defaults to status='waiting' (queueSync
-- stamps one per non-cancelled appointment across whatever range it's run
-- for), so status alone barely narrows the table once it holds a year of
-- history — this composite lets the date range do the actual filtering
-- instead of a near-full-table scan on every 3s poll.
--
-- NOT `CONCURRENTLY`: `prisma migrate deploy` runs each migration inside a
-- transaction, and Postgres rejects CREATE INDEX CONCURRENTLY there
-- ("cannot run inside a transaction block") — so a CONCURRENTLY version
-- passes locally (applied by hand via `db execute`, which does not wrap in a
-- transaction) and then fails the real deploy. A plain CREATE INDEX takes a
-- brief write lock on the table, which is acceptable inside a deploy window.
-- IF NOT EXISTS keeps it safe on any database where it was already applied.
CREATE INDEX IF NOT EXISTS "QueueManagement_organizationId_status_joinedQueueAt_idx"
ON "QueueManagement" ("organizationId", "status", "joinedQueueAt");
