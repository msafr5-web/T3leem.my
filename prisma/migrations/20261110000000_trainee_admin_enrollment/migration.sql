-- Corporate trainees: the academy's admin enrolls employees directly (no payment) and records their staff number.
-- Existing RLS policies on "users" and "enrollments" already cover the new columns (they filter rows by tenant_id).

ALTER TABLE "users" ADD COLUMN "employee_no" TEXT;
-- NULLs are distinct in PostgreSQL, so only people who have a staff number are constrained.
CREATE UNIQUE INDEX "users_tenant_id_employee_no_key" ON "users"("tenant_id", "employee_no");

ALTER TABLE "enrollments" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'SELF';
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_source_valid" CHECK ("source" IN ('SELF', 'ADMIN'));
