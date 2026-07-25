-- DisplayScreen: a waiting-room TV that consultation ROOMS are mapped to
-- (Settings -> TV Boards). Rooms, not doctors, are assigned to a screen, so
-- whichever doctor the timetable seats in a room today shows on the right TV
-- automatically. See schema.prisma / displayController.getScreenQueue.
--
-- Written IDEMPOTENTLY (IF NOT EXISTS + guarded FKs) on purpose: this table
-- was first created by an ad-hoc `db push` on the development database, so on
-- an environment that already has it this migration is a safe no-op, and on
-- one that does not (production) it creates it cleanly. This matches the
-- project's self-healing migration convention (see scripts/heal-migrations.mjs
-- and 20260716100500_appointment_slot_unique).

CREATE TABLE IF NOT EXISTS "DisplayScreen" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxDoctors" INTEGER NOT NULL DEFAULT 5,
    "sliderSpeedSeconds" INTEGER NOT NULL DEFAULT 30,
    "announcementText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DisplayScreen_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DisplayScreen_organizationId_idx" ON "DisplayScreen"("organizationId");

-- The room -> screen link. Nullable: a room not yet placed on any TV.
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "displayScreenId" TEXT;

CREATE INDEX IF NOT EXISTS "Room_displayScreenId_idx" ON "Room"("displayScreenId");

-- Foreign keys. Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so each is
-- guarded by a catalog check so re-running the migration never errors.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DisplayScreen_organizationId_fkey') THEN
    ALTER TABLE "DisplayScreen"
      ADD CONSTRAINT "DisplayScreen_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Room_displayScreenId_fkey') THEN
    ALTER TABLE "Room"
      ADD CONSTRAINT "Room_displayScreenId_fkey"
      FOREIGN KEY ("displayScreenId") REFERENCES "DisplayScreen"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
