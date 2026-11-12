-- Bill/receipt (or any scan) attached to one AssetMaintenanceLog entry.

-- CreateTable
CREATE TABLE "AssetMaintenanceDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "maintenanceLogId" TEXT NOT NULL,
    "label" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetMaintenanceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetMaintenanceDocument_organizationId_idx" ON "AssetMaintenanceDocument"("organizationId");

-- CreateIndex
CREATE INDEX "AssetMaintenanceDocument_maintenanceLogId_idx" ON "AssetMaintenanceDocument"("maintenanceLogId");

-- AddForeignKey
ALTER TABLE "AssetMaintenanceDocument" ADD CONSTRAINT "AssetMaintenanceDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMaintenanceDocument" ADD CONSTRAINT "AssetMaintenanceDocument_maintenanceLogId_fkey" FOREIGN KEY ("maintenanceLogId") REFERENCES "AssetMaintenanceLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
