-- Links QueueManagement to a real Room row (display board's per-room
-- grouping needs this — the existing "assignedRoom" free-text label is
-- ambiguous across floors). Nullable and additive: existing rows/behaviour
-- keep working unchanged until callers start setting it.

ALTER TABLE "QueueManagement" ADD COLUMN "roomId" TEXT;

CREATE INDEX "QueueManagement_roomId_status_idx" ON "QueueManagement"("roomId", "status");

ALTER TABLE "QueueManagement" ADD CONSTRAINT "QueueManagement_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
