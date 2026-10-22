-- Provider management: trainers, course regulatory metadata, training/development plans,
-- virtual classrooms. Hand-written (not the raw `prisma migrate diff` output) so existing
-- courses keep their instructor: the column is renamed and each instructor user becomes a
-- trainer with the SAME id, instead of dropping instructor_id and losing the link.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "PlanType" AS ENUM ('TRAINING', 'DEVELOPMENT');
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "MeetingProvider" AS ENUM ('ZOOM', 'TEAMS', 'GOOGLE_MEET', 'OTHER');
CREATE TYPE "ClassroomStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- ---------------------------------------------------------------------------
-- users.full_name
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "full_name" TEXT;

-- ---------------------------------------------------------------------------
-- trainers
-- ---------------------------------------------------------------------------
CREATE TABLE "trainers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "specialization" TEXT,
    "bio" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trainers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trainers_user_id_key" ON "trainers"("user_id");
CREATE INDEX "trainers_tenant_id_idx" ON "trainers"("tenant_id");
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data move: course instructors (users) -> trainers.
-- FORCE ROW LEVEL SECURITY applies to the table owner too, so without lifting it these
-- statements would see zero rows. Lifted only inside this migration's transaction.
-- ---------------------------------------------------------------------------
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "courses" NO FORCE ROW LEVEL SECURITY;

INSERT INTO "trainers" ("id", "tenant_id", "user_id", "full_name", "email", "updated_at")
SELECT u."id", u."tenant_id", u."id", COALESCE(u."full_name", split_part(u."email", '@', 1)), u."email", CURRENT_TIMESTAMP
FROM "users" u
WHERE u."id" IN (SELECT DISTINCT "instructor_id" FROM "courses");

ALTER TABLE "courses" DROP CONSTRAINT "courses_instructor_id_fkey";
ALTER TABLE "courses" RENAME COLUMN "instructor_id" TO "trainer_id";
ALTER TABLE "courses" ADD CONSTRAINT "courses_trainer_id_fkey"
  FOREIGN KEY ("trainer_id") REFERENCES "trainers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "courses" FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- courses: description + regulatory metadata
-- ---------------------------------------------------------------------------
ALTER TABLE "courses"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "license_number" TEXT,
  ADD COLUMN "license_authority" TEXT,
  ADD COLUMN "license_expires_on" DATE,
  ADD COLUMN "accreditation_number" TEXT,
  ADD COLUMN "training_hours" DECIMAL(6,1),
  ADD COLUMN "duration_days" INTEGER;

ALTER TABLE "courses" ADD CONSTRAINT "courses_training_hours_positive" CHECK ("training_hours" IS NULL OR "training_hours" > 0);
ALTER TABLE "courses" ADD CONSTRAINT "courses_duration_days_positive" CHECK ("duration_days" IS NULL OR "duration_days" > 0);

-- ---------------------------------------------------------------------------
-- training plans
-- ---------------------------------------------------------------------------
CREATE TABLE "training_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "PlanType" NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_on" DATE,
    "ends_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "training_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_plans_period_valid" CHECK ("ends_on" IS NULL OR "starts_on" IS NULL OR "ends_on" >= "starts_on")
);
CREATE INDEX "training_plans_tenant_id_status_idx" ON "training_plans"("tenant_id", "status");

CREATE TABLE "training_plan_courses" (
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "training_plan_courses_pkey" PRIMARY KEY ("plan_id", "course_id")
);
ALTER TABLE "training_plan_courses" ADD CONSTRAINT "training_plan_courses_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "training_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_plan_courses" ADD CONSTRAINT "training_plan_courses_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- virtual classrooms
-- ---------------------------------------------------------------------------
CREATE TABLE "virtual_classrooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID,
    "trainer_id" UUID,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "capacity" INTEGER,
    "provider" "MeetingProvider" NOT NULL DEFAULT 'ZOOM',
    "join_url" TEXT,
    "status" "ClassroomStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "virtual_classrooms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "virtual_classrooms_duration_valid" CHECK ("duration_minutes" BETWEEN 15 AND 720),
    CONSTRAINT "virtual_classrooms_capacity_valid" CHECK ("capacity" IS NULL OR "capacity" > 0)
);
CREATE INDEX "virtual_classrooms_tenant_id_starts_at_idx" ON "virtual_classrooms"("tenant_id", "starts_at");
ALTER TABLE "virtual_classrooms" ADD CONSTRAINT "virtual_classrooms_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "virtual_classrooms" ADD CONSTRAINT "virtual_classrooms_trainer_id_fkey"
  FOREIGN KEY ("trainer_id") REFERENCES "trainers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS on every new tenant-owned table (same policy as 20261022000001_enable_rls)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trainers', 'training_plans', 'training_plan_courses', 'virtual_classrooms']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_current_tenant_id())
         WITH CHECK (tenant_id = app_current_tenant_id())',
      t
    );
  END LOOP;
END
$$;
