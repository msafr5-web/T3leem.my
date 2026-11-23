-- Attendance and check-out for corporate training: one row per trainee per session (a live classroom, or one day of a
-- recorded course), the Zoom join/leave intervals behind it, and a one-per-session record that the late alert went out.
-- Deleting a trainee or a course removes their attendance with them (cascade), so erasure stays complete.

CREATE TABLE "session_attendance" (
  "id"                UUID NOT NULL,
  "tenant_id"         UUID NOT NULL,
  "user_id"           UUID NOT NULL,
  "course_id"         UUID NOT NULL,
  -- LIVE = a virtual classroom (session_ref = its id); DAY = one day of a recorded course (session_ref = the module id).
  "kind"              TEXT NOT NULL,
  "session_ref"       UUID NOT NULL,
  "starts_at"         TIMESTAMPTZ(3) NOT NULL,
  "ends_at"           TIMESTAMPTZ(3) NOT NULL,
  -- PENDING until the session is over; then PRESENT, LATE or ABSENT.
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  -- The trainee proved who they are with the e-mailed code.
  "otp_verified_at"   TIMESTAMPTZ(3),
  "first_join_at"     TIMESTAMPTZ(3),
  "last_leave_at"     TIMESTAMPTZ(3),
  "attended_seconds"  INTEGER NOT NULL DEFAULT 0,
  "source"            TEXT NOT NULL DEFAULT 'OTP',
  "finalized_at"      TIMESTAMPTZ(3),
  "created_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_attendance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "session_attendance_kind_valid" CHECK ("kind" IN ('LIVE', 'DAY')),
  CONSTRAINT "session_attendance_status_valid" CHECK ("status" IN ('PENDING', 'PRESENT', 'LATE', 'ABSENT')),
  CONSTRAINT "session_attendance_window_valid" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "session_attendance_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "session_attendance_course_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "session_attendance_user_session_key" ON "session_attendance"("user_id", "kind", "session_ref");
CREATE INDEX "session_attendance_course_idx" ON "session_attendance"("tenant_id", "course_id", "starts_at");

CREATE TABLE "attendance_intervals" (
  "id"          UUID NOT NULL,
  "tenant_id"   UUID NOT NULL,
  "user_id"     UUID NOT NULL,
  "kind"        TEXT NOT NULL,
  "session_ref" UUID NOT NULL,
  "joined_at"   TIMESTAMPTZ(3) NOT NULL,
  -- Null while the person is still in (or Zoom never told us they left).
  "left_at"     TIMESTAMPTZ(3),
  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_intervals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_intervals_order_valid" CHECK ("left_at" IS NULL OR "left_at" >= "joined_at"),
  CONSTRAINT "attendance_intervals_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "attendance_intervals_session_idx" ON "attendance_intervals"("tenant_id", "user_id", "kind", "session_ref");

CREATE TABLE "attendance_alerts" (
  "id"           UUID NOT NULL,
  "tenant_id"    UUID NOT NULL,
  "kind"         TEXT NOT NULL,
  "session_ref"  UUID NOT NULL,
  "absent_count" INTEGER NOT NULL,
  "created_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Null until the e-mail really went out, so a crash between the two steps is retried instead of lost.
  "sent_at"      TIMESTAMPTZ(3),
  CONSTRAINT "attendance_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_alerts_kind_valid" CHECK ("kind" IN ('LIVE', 'DAY'))
);
-- One alert per session: the unique key is what makes the sweep safe to repeat.
CREATE UNIQUE INDEX "attendance_alerts_session_key" ON "attendance_alerts"("tenant_id", "kind", "session_ref");

-- Tenant isolation (same policy as every tenant table).
ALTER TABLE "session_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session_attendance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "session_attendance";
CREATE POLICY tenant_isolation ON "session_attendance" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "attendance_intervals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_intervals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "attendance_intervals";
CREATE POLICY tenant_isolation ON "attendance_intervals" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "attendance_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_alerts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "attendance_alerts";
CREATE POLICY tenant_isolation ON "attendance_alerts" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
