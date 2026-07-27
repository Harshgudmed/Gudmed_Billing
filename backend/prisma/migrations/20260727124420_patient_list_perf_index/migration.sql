-- Composite index for the default patient-list query:
-- WHERE organizationId = ? AND isActive = ? ORDER BY createdAt DESC
-- Idempotent (IF NOT EXISTS) so it is safe on Render re-runs. On a large table
-- this briefly locks writes while building; acceptable for a low-write clinic.
CREATE INDEX IF NOT EXISTS "idx_patient_org_active_created"
  ON "Patient" ("organizationId", "isActive", "createdAt");
