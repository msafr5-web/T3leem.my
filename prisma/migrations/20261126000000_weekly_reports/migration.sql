-- One weekly attendance digest per academy per week (Sunday-start, Riyadh time): the unique key makes sending idempotent.
CREATE TABLE "attendance_weekly_reports" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  UUID NOT NULL,
  "week_start" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at"    TIMESTAMPTZ(3),
  CONSTRAINT "attendance_weekly_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_weekly_reports_week_valid" CHECK ("week_start" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
CREATE UNIQUE INDEX "attendance_weekly_reports_week_key" ON "attendance_weekly_reports"("tenant_id", "week_start");

ALTER TABLE "attendance_weekly_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_weekly_reports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "attendance_weekly_reports";
CREATE POLICY tenant_isolation ON "attendance_weekly_reports" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
