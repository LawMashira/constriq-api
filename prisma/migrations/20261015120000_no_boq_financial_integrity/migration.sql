-- AlterTable
ALTER TABLE "Project" ADD COLUMN "usesBoq" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RevenuePosting" ADD COLUMN "isReversed" BOOLEAN NOT NULL DEFAULT false;
