-- Row Level Security for every tenant-owned table.
-- Idempotent: safe to re-run after each `prisma migrate deploy`.
--
-- The application sets the tenant per transaction with
--   SELECT set_config('app.current_tenant_id', $1, true)   -- true = transaction-local (SET LOCAL)
-- and the policies below compare every row's tenant_id against it.
--
-- IMPORTANT: connect the app with a role that is neither SUPERUSER nor BYPASSRLS.
-- FORCE ROW LEVEL SECURITY makes the policies apply to the table owner too.

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  -- missing_ok = true returns NULL/'' when unset, so queries without context match zero rows
  -- instead of erroring or (worse) matching everything.
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'courses', 'modules', 'lessons', 'enrollments',
    'certificates', 'invoices', 'invoice_sequences', 'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_current_tenant_id())
         WITH CHECK (tenant_id = app_current_tenant_id())',
      t
    );
  END LOOP;
END
$$;
