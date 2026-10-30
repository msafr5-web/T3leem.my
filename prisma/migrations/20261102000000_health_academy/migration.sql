-- CreateTable
CREATE TABLE "health_settings" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trial_ends_at" TIMESTAMP(3),
    "price" DECIMAL(12,2),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "health_sectors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_questions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sector_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_index" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_user_states" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_user_states_pkey" PRIMARY KEY ("user_id","question_id")
);

-- CreateTable
CREATE TABLE "health_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sector_id" UUID,
    "client_session_id" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_entitlements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "health_sectors_tenant_id_slug_key" ON "health_sectors"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "health_questions_sector_id_active_idx" ON "health_questions"("sector_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "health_questions_tenant_id_code_key" ON "health_questions"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "health_sessions_user_id_created_at_idx" ON "health_sessions"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "health_sessions_user_id_client_session_id_key" ON "health_sessions"("user_id", "client_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_entitlements_user_id_key" ON "health_entitlements"("user_id");

-- CreateIndex
CREATE INDEX "health_entitlements_tenant_id_idx" ON "health_entitlements"("tenant_id");

-- AddForeignKey
ALTER TABLE "health_settings" ADD CONSTRAINT "health_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_questions" ADD CONSTRAINT "health_questions_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "health_sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_user_states" ADD CONSTRAINT "health_user_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_user_states" ADD CONSTRAINT "health_user_states_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "health_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_sessions" ADD CONSTRAINT "health_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_sessions" ADD CONSTRAINT "health_sessions_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "health_sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_entitlements" ADD CONSTRAINT "health_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules the application also checks.
ALTER TABLE "health_questions" ADD CONSTRAINT "health_questions_options" CHECK (
  jsonb_typeof("options") = 'array' AND jsonb_array_length("options") BETWEEN 2 AND 6
);
ALTER TABLE "health_questions" ADD CONSTRAINT "health_questions_correct_index" CHECK (
  "correct_index" >= 0 AND "correct_index" < jsonb_array_length("options")
);
ALTER TABLE "health_sessions" ADD CONSTRAINT "health_sessions_counts" CHECK ("total" BETWEEN 1 AND 200 AND "correct" BETWEEN 0 AND "total");

ALTER TABLE "health_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "health_settings";
CREATE POLICY tenant_isolation ON "health_settings"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "health_sectors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_sectors" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "health_sectors";
CREATE POLICY tenant_isolation ON "health_sectors"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "health_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_questions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "health_questions";
CREATE POLICY tenant_isolation ON "health_questions"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "health_user_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_user_states" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "health_user_states";
CREATE POLICY tenant_isolation ON "health_user_states"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "health_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "health_sessions";
CREATE POLICY tenant_isolation ON "health_sessions"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "health_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_entitlements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "health_entitlements";
CREATE POLICY tenant_isolation ON "health_entitlements"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
