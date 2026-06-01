CREATE TYPE "MailDocumentCategory" AS ENUM (
  'INVOICE',
  'CONTRACT',
  'ESTIMATE',
  'DELIVERY_NOTE',
  'RECEIPT',
  'NOTICE',
  'OTHER'
);

CREATE TABLE IF NOT EXISTS "MailDocument" (
  "id" TEXT NOT NULL,
  "company" TEXT,
  "category" "MailDocumentCategory" NOT NULL DEFAULT 'OTHER',
  "title" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "ocrText" TEXT,
  "confidence" INTEGER,
  "relatedReceivedInvoiceId" TEXT,
  "memo" TEXT,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "MailDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MailDocument_company_category_createdAt_idx"
  ON "MailDocument"("company", "category", "createdAt");

ALTER TABLE "MailDocument"
  ADD CONSTRAINT "MailDocument_relatedReceivedInvoiceId_fkey"
  FOREIGN KEY ("relatedReceivedInvoiceId") REFERENCES "ReceivedInvoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MailDocument"
  ADD CONSTRAINT "MailDocument_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
