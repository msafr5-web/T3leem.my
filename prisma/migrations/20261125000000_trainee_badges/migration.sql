-- A trainee's optional public "digital badge": an unguessable link that shows their name, the academy and the
-- certificates they hold (each verifiable). Nothing is public unless the trainee turns it on, and they can turn it off
-- or replace the link at any time.
-- Like certificate_registry this is a global lookup by token (the public page has no tenant context), so it holds only
-- pointers and is NOT under RLS: every query by an academy names its tenant_id explicitly.

CREATE TABLE "trainee_badges" (
  "id"         UUID NOT NULL,
  "tenant_id"  UUID NOT NULL,
  "user_id"    UUID NOT NULL,
  "token"      TEXT NOT NULL,
  "enabled"    BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trainee_badges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trainee_badges_token_format" CHECK ("token" ~ '^[A-Za-z0-9_-]{22,64}$'),
  -- Erasing a trainee (or their academy) removes the badge with them.
  CONSTRAINT "trainee_badges_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "trainee_badges_user_id_key" ON "trainee_badges"("user_id");
CREATE UNIQUE INDEX "trainee_badges_token_key" ON "trainee_badges"("token");
CREATE INDEX "trainee_badges_tenant_idx" ON "trainee_badges"("tenant_id");
