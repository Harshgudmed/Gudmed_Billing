-- A medicine bought at the billing counter has no prescribing doctor.
--
-- doctorId was NOT NULL, so fulfillInvoiceItems threw inside the invoice
-- transaction and billing ANY medicine failed outright — the pharmacy never
-- received the item to dispense, and the patient's bill did not save either.
--
-- Widening only: every existing row already has a doctor, and code that still
-- sends one keeps working unchanged.
ALTER TABLE "Prescription" ALTER COLUMN "doctorId" DROP NOT NULL;
