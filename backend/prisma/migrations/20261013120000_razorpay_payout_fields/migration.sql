-- RazorpayX payout tracking fields.
-- Vendor: cache the Razorpay contact and fund-account IDs so they are not
--         re-created on every payment to the same vendor.
-- VendorPayment: track the payout ID and its status from Razorpay.

ALTER TABLE "Vendor"
  ADD COLUMN IF NOT EXISTS "razorpayContactId"     TEXT,
  ADD COLUMN IF NOT EXISTS "razorpayFundAccountId" TEXT;

ALTER TABLE "VendorPayment"
  ADD COLUMN IF NOT EXISTS "razorpayPayoutId" TEXT,
  ADD COLUMN IF NOT EXISTS "payoutStatus"     TEXT;
