-- Refund approval workflow: PENDING_APPROVAL -> APPROVED/REJECTED, plus the
-- immutable revised-invoice chain (Invoice.parentInvoiceId + Invoice.isArchived).
--
-- Guarded with IF NOT EXISTS on purpose. Production only ever ran `migrate deploy`
-- and so does NOT have these columns, but local/dev databases were previously
-- brought up with `prisma db push` and already do. The guards let this migration
-- apply cleanly to both instead of failing with "column already exists".

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "parentInvoiceId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "approvalDate" TIMESTAMP(3);

-- AddForeignKey (ADD CONSTRAINT has no IF NOT EXISTS — guard it explicitly)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_parentInvoiceId_fkey'
  ) THEN
    ALTER TABLE "Invoice"
      ADD CONSTRAINT "Invoice_parentInvoiceId_fkey"
      FOREIGN KEY ("parentInvoiceId") REFERENCES "Invoice"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: every refund that exists at this moment predates the approval workflow.
-- Its cash already moved and Invoice.amountPaid was already decremented, so it is
-- effectively APPROVED. Without this, the column default ('COMPLETED') would make
-- the receipt printer stop subtracting these refunds from "Total Paid"
-- (src/components/billing/utils/printBilling.js only subtracts status = 'APPROVED'),
-- silently inflating the total on a patient's receipt.
-- Scoped to 'COMPLETED' so a re-run can never demote a real PENDING_APPROVAL row.
UPDATE "Payment" SET "status" = 'APPROVED'
WHERE "isRefund" = true AND "status" = 'COMPLETED';
