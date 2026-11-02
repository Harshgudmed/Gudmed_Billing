-- Rate contracts (Purchase): a negotiated vendor+item rate, good for a date
-- range — ordering that item from that vendor while one is active does not
-- need a fresh RFQ (sir: "Rate Contract auto-trigger").
-- GRN: invoice no./date recorded with the receipt itself, the e-way bill
-- number, and a document table for the invoice/delivery-challan/logistics-
-- challan scans (mirrors VendorBillDocument).
-- Purchase order: delivery address, when it is not the hospital's own
-- warehouse.

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "ewayBillNumber" TEXT,
ADD COLUMN     "invoiceDate" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "deliverElsewhere" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deliveryAddress" TEXT;

-- CreateTable
CREATE TABLE "RateContract" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "gstRate" DOUBLE PRECISION,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "label" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceiptDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateContract_organizationId_itemId_vendorId_idx" ON "RateContract"("organizationId", "itemId", "vendorId");

-- CreateIndex
CREATE INDEX "RateContract_organizationId_isActive_idx" ON "RateContract"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RateContract_organizationId_number_key" ON "RateContract"("organizationId", "number");

-- CreateIndex
CREATE INDEX "GoodsReceiptDocument_organizationId_idx" ON "GoodsReceiptDocument"("organizationId");

-- CreateIndex
CREATE INDEX "GoodsReceiptDocument_receiptId_idx" ON "GoodsReceiptDocument"("receiptId");

-- AddForeignKey
ALTER TABLE "RateContract" ADD CONSTRAINT "RateContract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateContract" ADD CONSTRAINT "RateContract_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateContract" ADD CONSTRAINT "RateContract_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateContract" ADD CONSTRAINT "RateContract_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptDocument" ADD CONSTRAINT "GoodsReceiptDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptDocument" ADD CONSTRAINT "GoodsReceiptDocument_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
