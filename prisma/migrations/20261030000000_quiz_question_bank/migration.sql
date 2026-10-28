-- CreateEnum
CREATE TYPE "QuizQuestionType" AS ENUM ('MCQ', 'TEXT');

-- CreateEnum
CREATE TYPE "QuizDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "quiz_duration_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "quiz_question_count" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "module_id" UUID,
    "code" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" "QuizQuestionType" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "correct_answer" TEXT NOT NULL,
    "difficulty" "QuizDifficulty" NOT NULL DEFAULT 'MEDIUM',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "questions" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "max_score" INTEGER,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quiz_questions_course_id_module_id_idx" ON "quiz_questions"("course_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_questions_course_id_code_key" ON "quiz_questions"("course_id", "code");

-- CreateIndex
CREATE INDEX "quiz_attempts_course_id_module_id_idx" ON "quiz_attempts"("course_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_user_id_module_id_key" ON "quiz_attempts"("user_id", "module_id");

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data rules the API also enforces: bounded quiz settings, an MCQ always has 2-6 options.
ALTER TABLE "courses" ADD CONSTRAINT "courses_quiz_duration_range" CHECK ("quiz_duration_minutes" BETWEEN 1 AND 180);
ALTER TABLE "courses" ADD CONSTRAINT "courses_quiz_count_range" CHECK ("quiz_question_count" BETWEEN 1 AND 50);
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000);
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_mcq_options" CHECK (
  "type" <> 'MCQ' OR (jsonb_typeof("options") = 'array' AND jsonb_array_length("options") BETWEEN 2 AND 6)
);
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_deadline" CHECK ("expires_at" > "started_at");

-- RLS on the new tenant-owned tables (same policy as 20261022000001_enable_rls).
ALTER TABLE "quiz_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quiz_questions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "quiz_questions";
CREATE POLICY tenant_isolation ON "quiz_questions"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "quiz_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quiz_attempts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "quiz_attempts";
CREATE POLICY tenant_isolation ON "quiz_attempts"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
