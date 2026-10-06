-- Default categories get a permanent code (MEDICAL, LINEN) beside their name.
--
-- The seed used to recognise its categories by name, and so planted the tree
-- only into a hospital with no categories at all — a default added in a later
-- release never reached a hospital that already had the rest. With a code the
-- seed checks each default one by one and adds only the missing ones, and a
-- hospital that renames "Linen" to "Bed Linen" keeps it: same code, not re-made.
--
-- Additive: two columns (null / false for every existing row) and one index.
-- Postgres treats NULLs as distinct, so a hospital's own categories (no code)
-- never collide on the index.

-- AlterTable
ALTER TABLE "ItemCategory" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "systemCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_organizationId_systemCode_key" ON "ItemCategory"("organizationId", "systemCode");
