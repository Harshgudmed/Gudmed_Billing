-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "returnedQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VendorBill" ADD COLUMN     "debitNoteTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StoreIndent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "departmentId" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedByName" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "neededBy" TIMESTAMP(3),
    "purpose" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByName" TEXT,
    "closeReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreIndent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreIndentLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "indentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "quantity" DOUBLE PRECISION NOT NULL,
    "issuedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StoreIndentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "indentId" TEXT,
    "departmentId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "issuedByName" TEXT NOT NULL,
    "receivedByName" TEXT,
    "notes" TEXT,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByName" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreIssueLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "indentLineId" TEXT,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "quantity" DOUBLE PRECISION NOT NULL,
    "stockQty" DOUBLE PRECISION NOT NULL,
    "batchId" TEXT,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "StoreIssueLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "mode" TEXT NOT NULL,
    "reference" TEXT,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decisionRemark" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "receiptId" TEXT,
    "billId" TEXT,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "debitNoteNumber" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decisionRemark" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReturnLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "quantity" DOUBLE PRECISION NOT NULL,
    "stockQty" DOUBLE PRECISION NOT NULL,
    "batchId" TEXT,
    "batchNumber" TEXT,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "requestId" TEXT,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "awardedVendorId" TEXT,
    "orderId" TEXT,
    "awardedAt" TIMESTAMP(3),
    "awardNote" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "requestLineId" TEXT,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "quantity" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RfqLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqVendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "quotedAt" TIMESTAMP(3),
    "deliveryDays" INTEGER,
    "validTill" TIMESTAMP(3),
    "notes" TEXT,
    "emailedAt" TIMESTAMP(3),
    "emailError" TEXT,

    CONSTRAINT "RfqVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfqQuote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfqVendorId" TEXT NOT NULL,
    "rfqLineId" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "available" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RfqQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreIndent_organizationId_status_idx" ON "StoreIndent"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StoreIndent_departmentId_idx" ON "StoreIndent"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreIndent_organizationId_number_key" ON "StoreIndent"("organizationId", "number");

-- CreateIndex
CREATE INDEX "StoreIndentLine_organizationId_idx" ON "StoreIndentLine"("organizationId");

-- CreateIndex
CREATE INDEX "StoreIndentLine_indentId_idx" ON "StoreIndentLine"("indentId");

-- CreateIndex
CREATE INDEX "StoreIndentLine_itemId_idx" ON "StoreIndentLine"("itemId");

-- CreateIndex
CREATE INDEX "StoreIssue_organizationId_status_idx" ON "StoreIssue"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StoreIssue_indentId_idx" ON "StoreIssue"("indentId");

-- CreateIndex
CREATE INDEX "StoreIssue_departmentId_idx" ON "StoreIssue"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreIssue_organizationId_number_key" ON "StoreIssue"("organizationId", "number");

-- CreateIndex
CREATE INDEX "StoreIssueLine_organizationId_idx" ON "StoreIssueLine"("organizationId");

-- CreateIndex
CREATE INDEX "StoreIssueLine_issueId_idx" ON "StoreIssueLine"("issueId");

-- CreateIndex
CREATE INDEX "StoreIssueLine_itemId_idx" ON "StoreIssueLine"("itemId");

-- CreateIndex
CREATE INDEX "VendorPayment_organizationId_status_idx" ON "VendorPayment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "VendorPayment_billId_idx" ON "VendorPayment"("billId");

-- CreateIndex
CREATE INDEX "VendorPayment_vendorId_idx" ON "VendorPayment"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPayment_organizationId_number_key" ON "VendorPayment"("organizationId", "number");

-- CreateIndex
CREATE INDEX "PurchaseReturn_organizationId_status_idx" ON "PurchaseReturn"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PurchaseReturn_orderId_idx" ON "PurchaseReturn"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseReturn_vendorId_idx" ON "PurchaseReturn"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_organizationId_number_key" ON "PurchaseReturn"("organizationId", "number");

-- CreateIndex
CREATE INDEX "PurchaseReturnLine_organizationId_idx" ON "PurchaseReturnLine"("organizationId");

-- CreateIndex
CREATE INDEX "PurchaseReturnLine_returnId_idx" ON "PurchaseReturnLine"("returnId");

-- CreateIndex
CREATE INDEX "PurchaseReturnLine_orderLineId_idx" ON "PurchaseReturnLine"("orderLineId");

-- CreateIndex
CREATE INDEX "Rfq_organizationId_status_idx" ON "Rfq"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_organizationId_number_key" ON "Rfq"("organizationId", "number");

-- CreateIndex
CREATE INDEX "RfqLine_organizationId_idx" ON "RfqLine"("organizationId");

-- CreateIndex
CREATE INDEX "RfqLine_rfqId_idx" ON "RfqLine"("rfqId");

-- CreateIndex
CREATE INDEX "RfqVendor_organizationId_idx" ON "RfqVendor"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RfqVendor_rfqId_vendorId_key" ON "RfqVendor"("rfqId", "vendorId");

-- CreateIndex
CREATE INDEX "RfqQuote_organizationId_idx" ON "RfqQuote"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RfqQuote_rfqVendorId_rfqLineId_key" ON "RfqQuote"("rfqVendorId", "rfqLineId");

-- AddForeignKey
ALTER TABLE "StoreIndent" ADD CONSTRAINT "StoreIndent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIndent" ADD CONSTRAINT "StoreIndent_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIndentLine" ADD CONSTRAINT "StoreIndentLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIndentLine" ADD CONSTRAINT "StoreIndentLine_indentId_fkey" FOREIGN KEY ("indentId") REFERENCES "StoreIndent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIndentLine" ADD CONSTRAINT "StoreIndentLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIndentLine" ADD CONSTRAINT "StoreIndentLine_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIssue" ADD CONSTRAINT "StoreIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIssue" ADD CONSTRAINT "StoreIssue_indentId_fkey" FOREIGN KEY ("indentId") REFERENCES "StoreIndent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIssue" ADD CONSTRAINT "StoreIssue_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIssueLine" ADD CONSTRAINT "StoreIssueLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIssueLine" ADD CONSTRAINT "StoreIssueLine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "StoreIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIssueLine" ADD CONSTRAINT "StoreIssueLine_indentLineId_fkey" FOREIGN KEY ("indentLineId") REFERENCES "StoreIndentLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIssueLine" ADD CONSTRAINT "StoreIssueLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreIssueLine" ADD CONSTRAINT "StoreIssueLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "PurchaseReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_requestLineId_fkey" FOREIGN KEY ("requestLineId") REFERENCES "PurchaseRequestLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqVendor" ADD CONSTRAINT "RfqVendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqVendor" ADD CONSTRAINT "RfqVendor_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqVendor" ADD CONSTRAINT "RfqVendor_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqQuote" ADD CONSTRAINT "RfqQuote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqQuote" ADD CONSTRAINT "RfqQuote_rfqVendorId_fkey" FOREIGN KEY ("rfqVendorId") REFERENCES "RfqVendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfqQuote" ADD CONSTRAINT "RfqQuote_rfqLineId_fkey" FOREIGN KEY ("rfqLineId") REFERENCES "RfqLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

