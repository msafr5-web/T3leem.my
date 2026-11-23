-- Per-course attendance rules (null = the platform default) and manual adjustments of a trainee's attendance by the admin.
-- Defaults: late after 10% of the session, leaving up to 5 minutes early is fine, 85% of held sessions to pass.

ALTER TABLE "courses"
  ADD COLUMN "attendance_late_percent" INTEGER,
  ADD COLUMN "attendance_leave_grace_minutes" INTEGER,
  ADD COLUMN "attendance_pass_percent" INTEGER;
ALTER TABLE "courses" ADD CONSTRAINT "courses_attendance_late_valid" CHECK ("attendance_late_percent" IS NULL OR "attendance_late_percent" BETWEEN 1 AND 50);
ALTER TABLE "courses" ADD CONSTRAINT "courses_attendance_grace_valid" CHECK ("attendance_leave_grace_minutes" IS NULL OR "attendance_leave_grace_minutes" BETWEEN 0 AND 30);
ALTER TABLE "courses" ADD CONSTRAINT "courses_attendance_pass_valid" CHECK ("attendance_pass_percent" IS NULL OR "attendance_pass_percent" BETWEEN 50 AND 100);

-- A manual adjustment (source = 'MANUAL') keeps the admin's status and the reason; the automatic settling never overwrites it.
ALTER TABLE "session_attendance"
  ADD COLUMN "note" TEXT,
  ADD COLUMN "adjusted_by" UUID,
  ADD COLUMN "adjusted_at" TIMESTAMPTZ(3);
ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_note_length" CHECK ("note" IS NULL OR char_length("note") <= 300);
ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_source_valid" CHECK ("source" IN ('OTP', 'ZOOM', 'MANUAL'));
