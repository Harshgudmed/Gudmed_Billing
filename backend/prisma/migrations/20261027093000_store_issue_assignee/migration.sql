-- An item/asset can be issued to a named person, not only a department (sir's topic 9).
ALTER TABLE "StoreIssue" ADD COLUMN "assignedToName" TEXT;
