-- CreateTable: VendorDocument
-- Documents attached to a vendor (PAN cert, GST cert, other compliance papers).
-- Stored on disk under uploads/vendor-documents/; served only to finance/purchase roles.

CREATE TABLE "VendorDocument" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId"       TEXT NOT NULL,
    "docType"        TEXT NOT NULL,
    "label"          TEXT,
    "fileName"       TEXT NOT NULL,
    "fileUrl"        TEXT NOT NULL,
    "uploadedById"   TEXT,
    "uploadedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorDocument_pkey" PRIMARY KEY ("id")
);

-- Index for fast lookup by org and vendor
CREATE INDEX "VendorDocument_organizationId_idx" ON "VendorDocument"("organizationId");
CREATE INDEX "VendorDocument_vendorId_idx" ON "VendorDocument"("vendorId");

-- Foreign keys
ALTER TABLE "VendorDocument"
    ADD CONSTRAINT "VendorDocument_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorDocument"
    ADD CONSTRAINT "VendorDocument_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
