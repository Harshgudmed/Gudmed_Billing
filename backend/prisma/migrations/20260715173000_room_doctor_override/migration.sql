-- Persisted "who's really sitting here right now" override for a shared
-- room (the absent-doctor case) — see lib/activeDoctor.js.

ALTER TABLE "Room" ADD COLUMN "overrideDoctorId" TEXT;
ALTER TABLE "Room" ADD COLUMN "overrideSetAt" TIMESTAMP(3);
ALTER TABLE "Room" ADD COLUMN "overrideSetById" TEXT;

CREATE INDEX "Room_overrideDoctorId_idx" ON "Room"("overrideDoctorId");

ALTER TABLE "Room" ADD CONSTRAINT "Room_overrideDoctorId_fkey" FOREIGN KEY ("overrideDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Room" ADD CONSTRAINT "Room_overrideSetById_fkey" FOREIGN KEY ("overrideSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
