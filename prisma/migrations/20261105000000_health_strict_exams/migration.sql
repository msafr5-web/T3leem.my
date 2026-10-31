-- AlterTable
ALTER TABLE "health_settings" ADD COLUMN     "daily_limit" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "questions_per_exam" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "strict_mode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "login_otps" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'login';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "health_exams" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sector_id" UUID,
    "questions" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "total" INTEGER NOT NULL,
    "score" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),

    CONSTRAINT "health_exams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_exams_user_id_started_at_idx" ON "health_exams"("user_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_phone_key" ON "users"("tenant_id", "phone");

-- AddForeignKey
ALTER TABLE "health_exams" ADD CONSTRAINT "health_exams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_exams" ADD CONSTRAINT "health_exams_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "health_sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Integrity and tenant isolation for the new table.
ALTER TABLE "health_settings" ADD CONSTRAINT "health_settings_limits" CHECK ("daily_limit" BETWEEN 1 AND 50 AND "questions_per_exam" BETWEEN 1 AND 100);
ALTER TABLE "health_exams" ADD CONSTRAINT "health_exams_score" CHECK ("total" >= 1 AND ("score" IS NULL OR ("score" >= 0 AND "score" <= "total")));
ALTER TABLE "health_exams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_exams" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "health_exams";
CREATE POLICY tenant_isolation ON "health_exams"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
