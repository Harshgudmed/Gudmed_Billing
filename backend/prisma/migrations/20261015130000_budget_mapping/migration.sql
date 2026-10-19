-- Budget mapping: CapEx / OpEx / Project budgets linked to purchase requests.
-- A budget carries an allocation; requests optionally link to one so spending
-- can be tracked against the approved amount.

-- CreateTable: Budget
CREATE TABLE "Budget" (
    "id"              TEXT NOT NULL,
    "organizationId"  TEXT NOT NULL,
    "code"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "budgetType"      TEXT NOT NULL,
    "departmentId"    TEXT,
    "projectName"     TEXT,
    "financialYear"   TEXT NOT NULL,
    "allocatedAmount" DOUBLE PRECISION NOT NULL,
    "approvedDate"    TIMESTAMP(3),
    "approvedById"    TEXT,
    "notes"           TEXT,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Budget_organizationId_code_key" ON "Budget"("organizationId", "code");
CREATE INDEX "Budget_organizationId_idx" ON "Budget"("organizationId");
CREATE INDEX "Budget_departmentId_idx" ON "Budget"("departmentId");

ALTER TABLE "Budget"
    ADD CONSTRAINT "Budget_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Budget"
    ADD CONSTRAINT "Budget_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: PurchaseRequest — add optional budget link
ALTER TABLE "PurchaseRequest"
    ADD COLUMN "budgetId"       TEXT,
    ADD COLUMN "budgetApproved" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PurchaseRequest"
    ADD CONSTRAINT "PurchaseRequest_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PurchaseRequest_budgetId_idx" ON "PurchaseRequest"("budgetId");
