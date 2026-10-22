-- ============================================================================
-- Cloud Postgres (Neon / Supabase / RDS) — create the restricted API role.
--
-- Managed providers don't give a real superuser, and their default owner role often has
-- BYPASSRLS (Neon's neon_superuser does). The API must NOT connect with it, or row level
-- security is silently skipped. Run this in the provider's SQL editor as the owner role,
-- AFTER `prisma migrate deploy`, replacing the password placeholder.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 't3leem_app') THEN
    CREATE ROLE t3leem_app LOGIN;
  END IF;
END
$$;

ALTER ROLE t3leem_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
ALTER ROLE t3leem_app SET statement_timeout = '30s';
ALTER ROLE t3leem_app SET lock_timeout = '10s';
ALTER ROLE t3leem_app SET idle_in_transaction_session_timeout = '60s';

GRANT USAGE ON SCHEMA public TO t3leem_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO t3leem_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO t3leem_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO t3leem_app;
REVOKE ALL ON public._prisma_migrations FROM t3leem_app;

-- Future tables created by the owner (later migrations) are granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO t3leem_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO t3leem_app;

-- Verify: both must be false.
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 't3leem_app';
