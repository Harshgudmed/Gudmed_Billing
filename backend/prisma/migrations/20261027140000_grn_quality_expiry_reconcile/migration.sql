-- GRN quality inspection, expiry-applicable flag, return-lot and reconcile (sir's topic 11 GRN).
ALTER TABLE "Item" ADD COLUMN "expiryApplicable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GoodsReceiptLine" ADD COLUMN "qualityStatus" TEXT NOT NULL DEFAULT 'passed';
ALTER TABLE "GoodsReceiptLine" ADD COLUMN "returnLot" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GoodsReceipt" ADD COLUMN "reconciled" BOOLEAN NOT NULL DEFAULT true;
