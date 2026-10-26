-- Link a patient document to the OPD consultation or IPD admission it was
-- uploaded from (both optional — a KYC document from the portal stays
-- patient-level). Also record who uploaded it, for the clinical audit trail.

ALTER TABLE "PatientDocument"
    ADD COLUMN "consultationId" TEXT,
    ADD COLUMN "admissionId"    TEXT,
    ADD COLUMN "uploadedById"   TEXT;

CREATE INDEX "PatientDocument_consultationId_idx" ON "PatientDocument"("consultationId");
CREATE INDEX "PatientDocument_admissionId_idx" ON "PatientDocument"("admissionId");

ALTER TABLE "PatientDocument"
    ADD CONSTRAINT "PatientDocument_consultationId_fkey"
    FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PatientDocument"
    ADD CONSTRAINT "PatientDocument_admissionId_fkey"
    FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
