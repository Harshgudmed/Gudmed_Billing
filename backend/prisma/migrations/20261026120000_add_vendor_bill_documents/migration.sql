-- Invoice / supporting file attachments for a vendor bill.
-- One bill may carry several files (a PO can be billed across invoices).
CREATE TABLE "VendorBillDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "label" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorBillDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VendorBillDocument_organizationId_idx" ON "VendorBillDocument"("organizationId");
CREATE INDEX "VendorBillDocument_billId_idx" ON "VendorBillDocument"("billId");

ALTER TABLE "VendorBillDocument"
  ADD CONSTRAINT "VendorBillDocument_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorBillDocument"
  ADD CONSTRAINT "VendorBillDocument_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
