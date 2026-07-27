-- Physical display devices (waiting-room TVs/boxes) that self-register, pair to
-- a DisplayScreen, and report heartbeat/diagnostics. Idempotent + org-scoped.
CREATE TABLE IF NOT EXISTS "DisplayDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pairingCode" TEXT,
    "screenId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unpaired',
    "lastSeenAt" TIMESTAMP(3),
    "friendlyName" TEXT,
    "appVersion" TEXT,
    "lastBootAt" TIMESTAMP(3),
    "lastIpAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DisplayDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DisplayDevice_deviceId_key" ON "DisplayDevice"("deviceId");
CREATE INDEX IF NOT EXISTS "DisplayDevice_organizationId_idx" ON "DisplayDevice"("organizationId");
CREATE INDEX IF NOT EXISTS "DisplayDevice_screenId_idx" ON "DisplayDevice"("screenId");

-- Guarded FKs (add only if missing) — matches this project's idempotent style.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DisplayDevice_organizationId_fkey') THEN
    ALTER TABLE "DisplayDevice" ADD CONSTRAINT "DisplayDevice_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DisplayDevice_screenId_fkey') THEN
    ALTER TABLE "DisplayDevice" ADD CONSTRAINT "DisplayDevice_screenId_fkey"
      FOREIGN KEY ("screenId") REFERENCES "DisplayScreen"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
