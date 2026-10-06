-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "billedQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VendorBill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorInvoiceNumber" TEXT NOT NULL,
    "vendorInvoiceKey" TEXT NOT NULL,
    "vendorInvoiceDate" TIMESTAMP(3) NOT NULL,
    "invoiceTotal" DOUBLE PRECISION,
    "gstType" TEXT NOT NULL DEFAULT 'intra',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igst" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tdsSection" TEXT,
    "tdsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tdsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER,
    "dueDate" TIMESTAMP(3),
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "mismatch" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decisionRemark" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBillLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "hsnCode" TEXT,
    "unitCode" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billableQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qtyOk" BOOLEAN NOT NULL DEFAULT true,
    "rateOk" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VendorBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorBill_organizationId_status_idx" ON "VendorBill"("organizationId", "status");

-- CreateIndex
CREATE INDEX "VendorBill_orderId_idx" ON "VendorBill"("orderId");

-- CreateIndex
CREATE INDEX "VendorBill_organizationId_vendorId_vendorInvoiceKey_idx" ON "VendorBill"("organizationId", "vendorId", "vendorInvoiceKey");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_organizationId_number_key" ON "VendorBill"("organizationId", "number");

-- CreateIndex
CREATE INDEX "VendorBillLine_organizationId_idx" ON "VendorBillLine"("organizationId");

-- CreateIndex
CREATE INDEX "VendorBillLine_billId_idx" ON "VendorBillLine"("billId");

-- CreateIndex
CREATE INDEX "VendorBillLine_orderLineId_idx" ON "VendorBillLine"("orderLineId");

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillLine" ADD CONSTRAINT "VendorBillLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillLine" ADD CONSTRAINT "VendorBillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillLine" ADD CONSTRAINT "VendorBillLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

