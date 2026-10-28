-- Advance payments directly against an order, before any bill exists.
-- billId becomes optional; a payment is against a bill (billId set) OR an
-- order directly (orderId set, billId null) — enforced in the application.
ALTER TABLE "VendorPayment" ALTER COLUMN "billId" DROP NOT NULL;
ALTER TABLE "VendorPayment" ADD COLUMN "orderId" TEXT;
CREATE INDEX "VendorPayment_orderId_idx" ON "VendorPayment"("orderId");
ALTER TABLE "VendorPayment"
  ADD CONSTRAINT "VendorPayment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
