-- Multi-currency: record the quoted currency + its rate to INR on orders and bills.
-- All stored amounts stay in INR (foreign × exchangeRate); these are for display.
ALTER TABLE "PurchaseOrder" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "PurchaseOrder" ADD COLUMN "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "VendorBill" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE "VendorBill" ADD COLUMN "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1;
