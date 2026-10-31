-- CreateTable
CREATE TABLE "signup_verifications" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "academy_name" TEXT NOT NULL,
    "city" TEXT,
    "admin_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sends" INTEGER NOT NULL DEFAULT 1,
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signup_verifications_email_created_at_idx" ON "signup_verifications"("email", "created_at");

-- CreateIndex
CREATE INDEX "signup_verifications_slug_idx" ON "signup_verifications"("slug");

