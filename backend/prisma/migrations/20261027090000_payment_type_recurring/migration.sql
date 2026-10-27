-- Classify a vendor payment and flag recurring ones (sir's topic 8).
ALTER TABLE "VendorPayment"
  ADD COLUMN "paymentType" TEXT NOT NULL DEFAULT 'full',
  ADD COLUMN "isRecurring" BOOLEAN NOT NULL DEFAULT false;
