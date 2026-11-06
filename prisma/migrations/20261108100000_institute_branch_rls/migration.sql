-- Institute management, hardening: a second row-level-security layer for BRANCHES (defence in depth).
--
-- Tenant isolation stays as it is. On top of it, a RESTRICTIVE policy (AND-ed with the tenant policy) limits every branch-owned table to
-- the branches named in the session setting `app.branch_scope` (a comma-separated list of branch ids). The application sets it for a
-- branch-bound role (branch manager, student affairs) right after it resolves who is asking; an empty / unset value means "every branch"
-- (head office, finance, background jobs). So even a service that forgets its own branch filter cannot read or write another branch.

CREATE OR REPLACE FUNCTION app_branch_in_scope(b uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN nullif(current_setting('app.branch_scope', true), '') IS NULL THEN true
    ELSE b = ANY (string_to_array(current_setting('app.branch_scope', true), ',')::uuid[])
  END
$$;

DO $$
DECLARE t text;
BEGIN
  -- Tables where every row belongs to exactly one branch.
  FOREACH t IN ARRAY ARRAY[
    'rooms','assets','asset_maintenance','staff','programs','levels','subjects','instructors','students',
    'class_sessions','attendance','expenses','utility_bills','budgets','student_invoices','invoice_installments',
    'student_payments','closed_periods','room_meter_readings','instructor_payouts'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS branch_scope ON %I', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I AS RESTRICTIVE FOR ALL USING (app_branch_in_scope(branch_id)) WITH CHECK (app_branch_in_scope(branch_id))', t);
  END LOOP;
  -- Tables where a row may belong to the whole institute (no branch): those stay visible to everyone in the tenant.
  FOREACH t IN ARRAY ARRAY['departments','institute_members'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS branch_scope ON %I', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I AS RESTRICTIVE FOR ALL USING (branch_id IS NULL OR app_branch_in_scope(branch_id)) WITH CHECK (branch_id IS NULL OR app_branch_in_scope(branch_id))', t);
  END LOOP;
END $$;

-- The branch itself.
DROP POLICY IF EXISTS branch_scope ON "branches";
CREATE POLICY branch_scope ON "branches" AS RESTRICTIVE FOR ALL USING (app_branch_in_scope(id)) WITH CHECK (app_branch_in_scope(id));
