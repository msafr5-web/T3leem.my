-- Institute management, phase 1: branches, members (roles), rooms, assets.

CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branches_tenant_id_name_key" ON "branches"("tenant_id", "name");
-- Target of the composite foreign keys below (child rows must share the parent tenant).
CREATE UNIQUE INDEX "branches_id_tenant_id_key" ON "branches"("id", "tenant_id");

CREATE TABLE "institute_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "branch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "institute_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "institute_members_user_id_key" ON "institute_members"("user_id");
CREATE INDEX "institute_members_tenant_id_idx" ON "institute_members"("tenant_id");

CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CLASSROOM',
    "area_m2" DECIMAL(8,2) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "power_kw" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rooms_branch_id_name_key" ON "rooms"("branch_id", "name");
CREATE INDEX "rooms_tenant_id_branch_id_idx" ON "rooms"("tenant_id", "branch_id");
CREATE UNIQUE INDEX "rooms_id_branch_id_tenant_id_key" ON "rooms"("id", "branch_id", "tenant_id");

CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "room_id" UUID,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "serial_no" TEXT,
    "purchase_date" DATE,
    "purchase_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "salvage_percent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "useful_life_months" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'IN_SERVICE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "assets_tenant_id_branch_id_idx" ON "assets"("tenant_id", "branch_id");

-- Referential integrity. Composite keys make a cross-tenant (or cross-branch) link impossible,
-- even for a connection that bypasses row-level security.
ALTER TABLE "institute_members" ADD CONSTRAINT "institute_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "institute_members" ADD CONSTRAINT "institute_members_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- MATCH SIMPLE: when room_id is NULL the constraint is skipped; otherwise the room must be in the same branch and tenant.
ALTER TABLE "assets" ADD CONSTRAINT "assets_room_fkey" FOREIGN KEY ("room_id", "branch_id", "tenant_id") REFERENCES "rooms"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain rules.
ALTER TABLE "institute_members" ADD CONSTRAINT "institute_members_role" CHECK ("role" IN ('HQ','BRANCH_MANAGER','FINANCE','STUDENT_AFFAIRS','INSTRUCTOR'));
ALTER TABLE "institute_members" ADD CONSTRAINT "institute_members_branch_required" CHECK ("role" NOT IN ('BRANCH_MANAGER','STUDENT_AFFAIRS') OR "branch_id" IS NOT NULL);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_kind" CHECK ("kind" IN ('CLASSROOM','LAB','HALL'));
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_numbers" CHECK ("area_m2" > 0 AND "capacity" > 0 AND "power_kw" >= 0);
ALTER TABLE "assets" ADD CONSTRAINT "assets_status" CHECK ("status" IN ('IN_SERVICE','MAINTENANCE','RETIRED'));
ALTER TABLE "assets" ADD CONSTRAINT "assets_numbers" CHECK ("purchase_value" >= 0 AND "salvage_percent" BETWEEN 0 AND 100 AND ("useful_life_months" IS NULL OR "useful_life_months" > 0));

-- Tenant isolation (same policy as every other tenant table).
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "branches";
CREATE POLICY tenant_isolation ON "branches" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "institute_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "institute_members" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "institute_members";
CREATE POLICY tenant_isolation ON "institute_members" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rooms";
CREATE POLICY tenant_isolation ON "rooms" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assets";
CREATE POLICY tenant_isolation ON "assets" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
