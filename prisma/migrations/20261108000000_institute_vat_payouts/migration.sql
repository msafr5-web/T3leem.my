-- Institute management, phase 5: VAT on student invoices (standard 15% / State-borne for Saudi citizens in qualifying programmes)
-- and the ledger of instructor payouts.

-- Citizenship decides the VAT treatment; the national ID (needed on the invoice of a State-borne supply) is stored ENCRYPTED
-- (AES-256-GCM by the application): only its last four digits are readable in the table.
ALTER TABLE "students" ADD COLUMN "citizenship" TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE "students" ADD COLUMN "national_id_enc" TEXT;
ALTER TABLE "students" ADD COLUMN "national_id_last4" TEXT;
ALTER TABLE "students" ADD CONSTRAINT "students_citizenship" CHECK ("citizenship" IN ('SAUDI','OTHER'));
ALTER TABLE "students" ADD CONSTRAINT "students_id_last4" CHECK ("national_id_last4" IS NULL OR "national_id_last4" ~ '^[0-9]{4}$');
ALTER TABLE "students" ADD CONSTRAINT "students_id_pair" CHECK (("national_id_enc" IS NULL) = ("national_id_last4" IS NULL));

-- A programme whose fees qualify for the State bearing the VAT of Saudi citizens (private education covered by Royal Order A/86).
ALTER TABLE "programs" ADD COLUMN "state_borne_vat" BOOLEAN NOT NULL DEFAULT false;

-- The VAT decided at issue time is frozen on the invoice, with the rate used and a copy of the beneficiary's encrypted ID.
ALTER TABLE "student_invoices" ADD COLUMN "vat_treatment" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "student_invoices" ADD COLUMN "vat_rate_bp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "student_invoices" ADD COLUMN "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "student_invoices" ADD COLUMN "beneficiary_id_enc" TEXT;
ALTER TABLE "student_invoices" ADD COLUMN "beneficiary_id_last4" TEXT;
ALTER TABLE "student_invoices" ADD CONSTRAINT "student_invoices_vat" CHECK (
  "vat_treatment" IN ('NONE','STANDARD','STATE_BORNE')
  AND "vat_amount" >= 0
  AND ("vat_treatment" <> 'NONE' OR ("vat_amount" = 0 AND "vat_rate_bp" = 0))
  AND ("vat_treatment" <> 'STANDARD' OR "vat_rate_bp" > 0)
  AND ("vat_treatment" <> 'STATE_BORNE' OR ("vat_amount" = 0 AND "beneficiary_id_enc" IS NOT NULL))
);

CREATE TABLE "instructor_payouts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    -- First day of the month the pay is for.
    "period" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    -- What the month's dues were when this was paid (minutes taught x hourly rate), kept for the audit trail.
    "dues_amount" DECIMAL(12,2) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "hourly_rate" DECIMAL(12,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'TRANSFER',
    "reference" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instructor_payouts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "instructor_payouts_instructor_id_period_idx" ON "instructor_payouts"("instructor_id", "period");
CREATE INDEX "instructor_payouts_tenant_id_branch_id_paid_on_idx" ON "instructor_payouts"("tenant_id", "branch_id", "paid_on");
ALTER TABLE "instructor_payouts" ADD CONSTRAINT "instructor_payouts_instructor_fkey" FOREIGN KEY ("instructor_id", "branch_id", "tenant_id") REFERENCES "instructors"("id", "branch_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "instructor_payouts" ADD CONSTRAINT "instructor_payouts_rules" CHECK (
  "amount" > 0 AND "dues_amount" >= 0 AND "minutes" >= 0 AND "hourly_rate" >= 0
  AND EXTRACT(DAY FROM "period") = 1
  AND "method" IN ('CASH','TRANSFER','CHEQUE','OTHER')
  AND (("voided_at" IS NULL) = ("void_reason" IS NULL))
);

-- A closed month is locked for payouts too (same guard as expenses, bills and student payments).
CREATE TRIGGER instructor_payouts_closed_guard BEFORE INSERT OR UPDATE OR DELETE ON "instructor_payouts" FOR EACH ROW EXECUTE FUNCTION institute_guard_closed_period('paid_on');

ALTER TABLE "instructor_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instructor_payouts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "instructor_payouts";
CREATE POLICY tenant_isolation ON "instructor_payouts" USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
