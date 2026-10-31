-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "features" JSONB NOT NULL DEFAULT '{"health":true,"recorded":true}',
ADD COLUMN     "owner_email" TEXT,
ADD COLUMN     "owner_name" TEXT,
ADD COLUMN     "owner_phone" TEXT,
ADD COLUMN     "subscription_ends_at" TIMESTAMP(3);


-- Academies that were already live count as approved.
UPDATE "tenants" SET "approved_at" = "created_at" WHERE "status" = 'ACTIVE';
