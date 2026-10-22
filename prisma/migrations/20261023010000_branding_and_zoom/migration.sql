-- Provider branding (logo) and Zoom meeting linkage.

-- Logo stored in-row (bytea) until object storage is wired; size is capped by the API (512 KB)
-- and enforced here too so a bypassed API can't bloat the registry table.
ALTER TABLE "tenants"
  ADD COLUMN "logo" BYTEA,
  ADD COLUMN "logo_mime_type" TEXT,
  ADD COLUMN "logo_updated_at" TIMESTAMP(3);

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logo_size" CHECK ("logo" IS NULL OR octet_length("logo") <= 524288);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logo_mime" CHECK ("logo_mime_type" IS NULL OR "logo_mime_type" IN ('image/png', 'image/jpeg', 'image/webp'));

ALTER TABLE "virtual_classrooms" ADD COLUMN "external_meeting_id" TEXT;
