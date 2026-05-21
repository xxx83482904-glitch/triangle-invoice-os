ALTER TABLE "Client" ADD COLUMN "sortOrder" INTEGER;
ALTER TABLE "Vendor" ADD COLUMN "sortOrder" INTEGER;

CREATE TABLE "SelectOption" (
  "id" TEXT NOT NULL,
  "company" TEXT,
  "group" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "SelectOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SelectOption_group_company_sortOrder_idx" ON "SelectOption"("group", "company", "sortOrder");
