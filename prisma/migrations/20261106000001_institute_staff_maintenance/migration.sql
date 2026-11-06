-- Institute management, phase 1 (rest): departments, staff, asset maintenance log.

CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    -- Null = a department of the whole institute (e.g. Finance); otherwise it belongs to one branch.
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "departments_id_tenant_id_key" ON "departments"("id", "tenant_id");
-- NULL branches compare equal here, so an institute-wide name is unique too.
CREATE UNIQUE INDEX "departments_unique_name" ON "departments"("tenant_id", COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid), "name");
CREATE INDEX "departments_tenant_id_branch_id_idx" ON "departments"("tenant_id", "branch_id");

CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "department_id" UUID,
    "full_name" TEXT NOT NULL,
    "job_title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_tenant_id_branch_id_idx" ON "staff"("tenant_id", "branch_id");

-- Target for the maintenance composite key.
CREATE UNIQUE INDEX "assets_id_branch_id_tenant_id_key" ON "assets"("id", "branch_id", "tenant_id");

CREATE TABLE "asset_maintenance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "performed_on" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SERVICE',
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "next_due_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asset_maintenance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "asset_maintenance_asset_id_performed_on_idx" ON "asset_maintenance"("asset_id", "performed_on");
CREATE INDEX "asset_maintenance_tenant_id_branch_id_idx" ON "asset_maintenance"("tenant_id", "branch_id");

ALTER TABLE "departments" ADD CONSTRAINT "departments_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff" ADD CONSTRAINT "staff_department_fkey" FOREIGN KEY ("department_id", "tenant_id") REFERENCES "departments"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A maintenance entry must belong to an asset of the same branch and tenant.
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_fkey" FOREIGN KEY ("asset_id", "branch_id", "tenant_id") REFERENCES "assets"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_rules" CHECK ("kind" IN ('INSPECTION','REPAIR','SERVICE') AND "cost" >= 0 AND ("next_due_on" IS NULL OR "next_due_on" >= "performed_on"));

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "departments";
CREATE POLICY tenant_isolation ON "departments" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "staff";
CREATE POLICY tenant_isolation ON "staff" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "asset_maintenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_maintenance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "asset_maintenance";
CREATE POLICY tenant_isolation ON "asset_maintenance" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
