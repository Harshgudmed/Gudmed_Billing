-- Who verified/rejected a PatientDocument, and when (uploadedById/uploadedAt
-- already tracked the upload; this tracks the review the same way).
ALTER TABLE "PatientDocument" ADD COLUMN IF NOT EXISTS "verifiedById" TEXT;
ALTER TABLE "PatientDocument" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
