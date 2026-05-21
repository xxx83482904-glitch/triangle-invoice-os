ALTER TABLE "Project" ADD COLUMN "contractFileUrl" TEXT;
ALTER TABLE "Project" ADD COLUMN "contractOriginalFileName" TEXT;
ALTER TABLE "Project" ADD COLUMN "contractMimeType" TEXT;
ALTER TABLE "Project" ADD COLUMN "contractOcrText" TEXT;
ALTER TABLE "Project" ADD COLUMN "contractExtractedAmount" DECIMAL(14, 2);
ALTER TABLE "Project" ADD COLUMN "contractExtractedBillingCount" INTEGER;
ALTER TABLE "Project" ADD COLUMN "contractUploadedAt" TIMESTAMP(3);
