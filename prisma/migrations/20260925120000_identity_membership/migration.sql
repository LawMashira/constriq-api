-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT');

ALTER TYPE "EntityType" ADD VALUE IF NOT EXISTS 'USER';
ALTER TYPE "EntityType" ADD VALUE IF NOT EXISTS 'ROLE';
ALTER TYPE "EntityType" ADD VALUE IF NOT EXISTS 'MEMBERSHIP';

ALTER TYPE "PermissionModule" ADD VALUE IF NOT EXISTS 'USERS';
ALTER TYPE "PermissionModule" ADD VALUE IF NOT EXISTS 'CONTRACTS';
ALTER TYPE "PermissionModule" ADD VALUE IF NOT EXISTS 'COST_CODES';
ALTER TYPE "PermissionModule" ADD VALUE IF NOT EXISTS 'CLIENTS';

ALTER TYPE "SystemRole" ADD VALUE IF NOT EXISTS 'EXECUTIVE_READ_ONLY';

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE IF NOT EXISTS "CompanyMembership" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CompanyMembership_userId_status_idx" ON "CompanyMembership"("userId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyMembership_companyId_userId_key" ON "CompanyMembership"("companyId", "userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CompanyMembership_companyId_fkey'
  ) THEN
    ALTER TABLE "CompanyMembership"
      ADD CONSTRAINT "CompanyMembership_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CompanyMembership_userId_fkey'
  ) THEN
    ALTER TABLE "CompanyMembership"
      ADD CONSTRAINT "CompanyMembership_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "CompanyMembership" ("id", "companyId", "userId", "status", "createdAt", "updatedAt")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  "companyId",
  "id",
  CASE
    WHEN "status"::text = 'ACTIVE' THEN 'ACTIVE'::"MembershipStatus"
    ELSE 'INVITED'::"MembershipStatus"
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("companyId", "userId") DO NOTHING;
