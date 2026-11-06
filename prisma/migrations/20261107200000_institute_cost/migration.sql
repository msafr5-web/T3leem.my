-- Institute management, phase 4: the cost engine. Versioned cost policies (draft -> approved, frozen once approved),
-- room sub-meter readings, the VAT stated on an electricity bill, and the date an asset left service.

ALTER TABLE "utility_bills" ADD COLUMN "vat_amount" DECIMAL(12,2);
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_vat" CHECK ("vat_amount" IS NULL OR ("vat_amount" >= 0 AND "vat_amount" <= "amount"));

ALTER TABLE "assets" ADD COLUMN "retired_on" DATE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_retired_on" CHECK ("retired_on" IS NULL OR "purchase_date" IS NULL OR "retired_on" >= "purchase_date");

CREATE TABLE "cost_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "params" JSONB NOT NULL,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cost_policies_tenant_id_version_key" ON "cost_policies"("tenant_id", "version");
-- One working draft and one approved policy at a time per institute.
CREATE UNIQUE INDEX "cost_policies_one_draft" ON "cost_policies"("tenant_id") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "cost_policies_one_approved" ON "cost_policies"("tenant_id") WHERE "status" = 'APPROVED';
ALTER TABLE "cost_policies" ADD CONSTRAINT "cost_policies_status" CHECK ("status" IN ('DRAFT','APPROVED','SUPERSEDED'));
ALTER TABLE "cost_policies" ADD CONSTRAINT "cost_policies_approval" CHECK (("status" = 'DRAFT') = ("approved_by" IS NULL) OR "status" = 'SUPERSEDED');

-- An approved policy is frozen: its parameters never change and it is never deleted, so every report that cites a
-- version can be explained and reproduced later. The only change allowed is APPROVED -> SUPERSEDED.
CREATE OR REPLACE FUNCTION institute_freeze_cost_policy() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'institute_policy_frozen' USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.params IS DISTINCT FROM OLD.params OR NEW.version <> OLD.version OR NEW.tenant_id <> OLD.tenant_id OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NOT (OLD.status = NEW.status OR (OLD.status = 'APPROVED' AND NEW.status = 'SUPERSEDED')) THEN
      RAISE EXCEPTION 'institute_policy_frozen' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER cost_policies_freeze BEFORE UPDATE OR DELETE ON "cost_policies" FOR EACH ROW EXECUTE FUNCTION institute_freeze_cost_policy();

CREATE TABLE "room_meter_readings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    -- First day of the month the reading covers.
    "period" DATE NOT NULL,
    "kwh" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "room_meter_readings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "room_meter_readings_room_id_period_key" ON "room_meter_readings"("room_id", "period");
CREATE INDEX "room_meter_readings_tenant_id_branch_id_period_idx" ON "room_meter_readings"("tenant_id", "branch_id", "period");
ALTER TABLE "room_meter_readings" ADD CONSTRAINT "room_meter_readings_room_fkey" FOREIGN KEY ("room_id", "branch_id", "tenant_id") REFERENCES "rooms"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_meter_readings" ADD CONSTRAINT "room_meter_readings_rules" CHECK ("kwh" >= 0 AND EXTRACT(DAY FROM "period") = 1);

ALTER TABLE "cost_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cost_policies";
CREATE POLICY tenant_isolation ON "cost_policies" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "room_meter_readings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_meter_readings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "room_meter_readings";
CREATE POLICY tenant_isolation ON "room_meter_readings" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
