-- Institute management, phase 2: programs (diplomas) -> levels -> subjects, instructors, students, class sessions, attendance.
-- Room and instructor double-booking is prevented by the database itself (exclusion constraints), not by application checks.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "admission_requirements" TEXT,
    "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "programs_branch_id_name_key" ON "programs"("branch_id", "name");
CREATE UNIQUE INDEX "programs_id_branch_id_tenant_id_key" ON "programs"("id", "branch_id", "tenant_id");
CREATE INDEX "programs_tenant_id_branch_id_idx" ON "programs"("tenant_id", "branch_id");

CREATE TABLE "levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "levels_program_id_sort_order_key" ON "levels"("program_id", "sort_order");
CREATE UNIQUE INDEX "levels_id_branch_id_tenant_id_key" ON "levels"("id", "branch_id", "tenant_id");
CREATE INDEX "levels_tenant_id_branch_id_idx" ON "levels"("tenant_id", "branch_id");

CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "fee" DECIMAL(12,2),
    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "subjects_level_id_name_key" ON "subjects"("level_id", "name");
CREATE UNIQUE INDEX "subjects_id_branch_id_tenant_id_key" ON "subjects"("id", "branch_id", "tenant_id");
CREATE INDEX "subjects_tenant_id_branch_id_idx" ON "subjects"("tenant_id", "branch_id");

CREATE TABLE "instructors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    -- Optional link to a platform account, so the instructor can sign in and see their own sessions.
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "qualifications" TEXT,
    "hourly_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instructors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "instructors_user_id_key" ON "instructors"("user_id");
CREATE UNIQUE INDEX "instructors_id_branch_id_tenant_id_key" ON "instructors"("id", "branch_id", "tenant_id");
CREATE INDEX "instructors_tenant_id_branch_id_idx" ON "instructors"("tenant_id", "branch_id");

CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "program_id" UUID,
    "level_id" UUID,
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "enrolled_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");
CREATE UNIQUE INDEX "students_id_branch_id_tenant_id_key" ON "students"("id", "branch_id", "tenant_id");
CREATE INDEX "students_tenant_id_branch_id_idx" ON "students"("tenant_id", "branch_id");

CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "class_sessions_id_branch_id_tenant_id_key" ON "class_sessions"("id", "branch_id", "tenant_id");
CREATE INDEX "class_sessions_tenant_id_branch_id_starts_at_idx" ON "class_sessions"("tenant_id", "branch_id", "starts_at");

CREATE TABLE "attendance" (
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_pkey" PRIMARY KEY ("session_id", "student_id")
);
CREATE INDEX "attendance_tenant_id_branch_id_idx" ON "attendance"("tenant_id", "branch_id");
CREATE INDEX "attendance_student_id_idx" ON "attendance"("student_id");

-- Referential integrity: every link stays inside the same tenant AND the same branch.
ALTER TABLE "programs" ADD CONSTRAINT "programs_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "levels" ADD CONSTRAINT "levels_program_fkey" FOREIGN KEY ("program_id", "branch_id", "tenant_id") REFERENCES "programs"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_level_fkey" FOREIGN KEY ("level_id", "branch_id", "tenant_id") REFERENCES "levels"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_program_fkey" FOREIGN KEY ("program_id", "branch_id", "tenant_id") REFERENCES "programs"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_level_fkey" FOREIGN KEY ("level_id", "branch_id", "tenant_id") REFERENCES "levels"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_subject_fkey" FOREIGN KEY ("subject_id", "branch_id", "tenant_id") REFERENCES "subjects"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_room_fkey" FOREIGN KEY ("room_id", "branch_id", "tenant_id") REFERENCES "rooms"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_instructor_fkey" FOREIGN KEY ("instructor_id", "branch_id", "tenant_id") REFERENCES "instructors"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_fkey" FOREIGN KEY ("session_id", "branch_id", "tenant_id") REFERENCES "class_sessions"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_fkey" FOREIGN KEY ("student_id", "branch_id", "tenant_id") REFERENCES "students"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain rules.
ALTER TABLE "programs" ADD CONSTRAINT "programs_fee" CHECK ("fee" >= 0);
ALTER TABLE "levels" ADD CONSTRAINT "levels_order" CHECK ("sort_order" >= 1);
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_rules" CHECK ("hours" BETWEEN 1 AND 2000 AND ("fee" IS NULL OR "fee" >= 0));
ALTER TABLE "instructors" ADD CONSTRAINT "instructors_rate" CHECK ("hourly_rate" >= 0);
ALTER TABLE "students" ADD CONSTRAINT "students_status" CHECK ("status" IN ('ACTIVE','GRADUATED','SUSPENDED','WITHDRAWN'));
-- A level only makes sense inside a program.
ALTER TABLE "students" ADD CONSTRAINT "students_level_needs_program" CHECK ("level_id" IS NULL OR "program_id" IS NOT NULL);
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_status" CHECK ("status" IN ('SCHEDULED','HELD','CANCELLED'));
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_time" CHECK ("ends_at" > "starts_at" AND "ends_at" - "starts_at" <= INTERVAL '12 hours');
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_status" CHECK ("status" IN ('PRESENT','ABSENT','LATE','EXCUSED'));

-- No two live sessions may overlap in the same room, or for the same instructor (cancelled ones free the slot).
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_no_room_overlap"
  EXCLUDE USING gist ("tenant_id" WITH =, "room_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" <> 'CANCELLED');
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_no_instructor_overlap"
  EXCLUDE USING gist ("tenant_id" WITH =, "instructor_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" <> 'CANCELLED');

-- Tenant isolation.
ALTER TABLE "programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "programs";
CREATE POLICY tenant_isolation ON "programs" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "levels" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "levels";
CREATE POLICY tenant_isolation ON "levels" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "subjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subjects" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "subjects";
CREATE POLICY tenant_isolation ON "subjects" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "instructors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instructors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "instructors";
CREATE POLICY tenant_isolation ON "instructors" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "students" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "students";
CREATE POLICY tenant_isolation ON "students" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "class_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "class_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "class_sessions";
CREATE POLICY tenant_isolation ON "class_sessions" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "attendance";
CREATE POLICY tenant_isolation ON "attendance" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
