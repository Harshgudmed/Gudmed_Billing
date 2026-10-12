-- The modules a hospital has bought, set by the platform owner. Optional on
-- purpose: NULL means "no limit yet", so every hospital that exists today keeps
-- all its modules and nothing is rewritten.
ALTER TABLE "Organization" ADD COLUMN "modulesAllowed" TEXT;
