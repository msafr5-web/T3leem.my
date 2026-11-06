-- Institute management, phase 3: finance. Expenses, electricity bills, budgets, student invoices / instalments / payments,
-- and closed accounting periods. Money is NUMERIC(12,2). Nothing financial is hard-deleted once it has a ledger meaning:
-- payments are voided, invoices cancelled, and a closed month is locked by the database itself.

CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "room_id" UUID,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "incurred_on" DATE NOT NULL,
    "vendor" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "expenses_tenant_id_branch_id_incurred_on_idx" ON "expenses"("tenant_id", "branch_id", "incurred_on");

CREATE TABLE "utility_bills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "kwh" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "utility_bills_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "utility_bills_branch_id_period_start_key" ON "utility_bills"("branch_id", "period_start");
CREATE INDEX "utility_bills_tenant_id_branch_id_idx" ON "utility_bills"("tenant_id", "branch_id");

CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    -- Null = the branch total for the month; otherwise one expense category (ELECTRICITY counts the electricity bills).
    "category" TEXT,
    -- First day of the month.
    "period" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "warn_percent" INTEGER NOT NULL DEFAULT 80,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "budgets_unique_scope" ON "budgets"("tenant_id", "branch_id", "period", COALESCE("category", ''));
CREATE INDEX "budgets_tenant_id_branch_id_idx" ON "budgets"("tenant_id", "branch_id");

CREATE TABLE "student_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "issued_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "student_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "student_invoices_id_branch_id_tenant_id_key" ON "student_invoices"("id", "branch_id", "tenant_id");
CREATE INDEX "student_invoices_tenant_id_branch_id_idx" ON "student_invoices"("tenant_id", "branch_id");
CREATE INDEX "student_invoices_student_id_idx" ON "student_invoices"("student_id");

CREATE TABLE "invoice_installments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "due_on" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "invoice_installments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "invoice_installments_invoice_id_due_on_idx" ON "invoice_installments"("invoice_id", "due_on");

CREATE TABLE "student_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "student_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "student_payments_invoice_id_idx" ON "student_payments"("invoice_id");
CREATE INDEX "student_payments_tenant_id_branch_id_paid_on_idx" ON "student_payments"("tenant_id", "branch_id", "paid_on");

CREATE TABLE "closed_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    -- First day of the closed month.
    "period" DATE NOT NULL,
    "closed_by" UUID NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "closed_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "closed_periods_branch_id_period_key" ON "closed_periods"("branch_id", "period");
CREATE INDEX "closed_periods_tenant_id_idx" ON "closed_periods"("tenant_id");

-- Referential integrity: same tenant, same branch.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_room_fkey" FOREIGN KEY ("room_id", "branch_id", "tenant_id") REFERENCES "rooms"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_invoices" ADD CONSTRAINT "student_invoices_student_fkey" FOREIGN KEY ("student_id", "branch_id", "tenant_id") REFERENCES "students"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_installments" ADD CONSTRAINT "invoice_installments_invoice_fkey" FOREIGN KEY ("invoice_id", "branch_id", "tenant_id") REFERENCES "student_invoices"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_invoice_fkey" FOREIGN KEY ("invoice_id", "branch_id", "tenant_id") REFERENCES "student_invoices"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "closed_periods" ADD CONSTRAINT "closed_periods_branch_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain rules.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_rules" CHECK ("amount" > 0 AND length(btrim("category")) > 0 AND upper(btrim("category")) <> 'ELECTRICITY');
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_rules" CHECK ("amount" > 0 AND ("kwh" IS NULL OR "kwh" >= 0) AND "period_end" >= "period_start");
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_rules" CHECK ("amount" >= 0 AND "warn_percent" BETWEEN 1 AND 100 AND EXTRACT(DAY FROM "period") = 1);
ALTER TABLE "student_invoices" ADD CONSTRAINT "student_invoices_rules" CHECK ("amount" > 0 AND "discount" >= 0 AND "discount" < "amount" AND "status" IN ('OPEN','CANCELLED'));
ALTER TABLE "invoice_installments" ADD CONSTRAINT "invoice_installments_amount" CHECK ("amount" > 0);
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_rules" CHECK ("amount" > 0 AND "method" IN ('CASH','TRANSFER','CARD','OTHER') AND (("voided_at" IS NULL) = ("void_reason" IS NULL)));
ALTER TABLE "closed_periods" ADD CONSTRAINT "closed_periods_first_day" CHECK (EXTRACT(DAY FROM "period") = 1);

-- A closed month is locked: no insert, update or delete of an expense, bill or payment dated in it (nor moving one into or out of it).
CREATE OR REPLACE FUNCTION institute_guard_closed_period() RETURNS trigger AS $$
DECLARE
  col text := TG_ARGV[0];
  rec jsonb;
  d date;
BEGIN
  FOR rec IN
    SELECT x FROM (VALUES
      (CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END),
      (CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END)
    ) AS t(x) WHERE x IS NOT NULL
  LOOP
    d := (rec ->> col)::date;
    IF EXISTS (
      SELECT 1 FROM closed_periods c
      WHERE c.tenant_id = (rec ->> 'tenant_id')::uuid
        AND c.branch_id = (rec ->> 'branch_id')::uuid
        AND c.period = date_trunc('month', d)::date
    ) THEN
      RAISE EXCEPTION 'institute_period_closed' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expenses_closed_guard BEFORE INSERT OR UPDATE OR DELETE ON "expenses" FOR EACH ROW EXECUTE FUNCTION institute_guard_closed_period('incurred_on');
CREATE TRIGGER utility_bills_closed_guard BEFORE INSERT OR UPDATE OR DELETE ON "utility_bills" FOR EACH ROW EXECUTE FUNCTION institute_guard_closed_period('period_start');
CREATE TRIGGER student_payments_closed_guard BEFORE INSERT OR UPDATE OR DELETE ON "student_payments" FOR EACH ROW EXECUTE FUNCTION institute_guard_closed_period('paid_on');

-- Tenant isolation.
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "expenses";
CREATE POLICY tenant_isolation ON "expenses" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "utility_bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "utility_bills" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "utility_bills";
CREATE POLICY tenant_isolation ON "utility_bills" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budgets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "budgets";
CREATE POLICY tenant_isolation ON "budgets" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "student_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_invoices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_invoices";
CREATE POLICY tenant_isolation ON "student_invoices" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "invoice_installments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_installments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "invoice_installments";
CREATE POLICY tenant_isolation ON "invoice_installments" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "student_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_payments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "student_payments";
CREATE POLICY tenant_isolation ON "student_payments" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "closed_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "closed_periods" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "closed_periods";
CREATE POLICY tenant_isolation ON "closed_periods" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
