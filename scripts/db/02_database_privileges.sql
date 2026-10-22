-- ============================================================================
-- t3leem.my — per-database privileges (run as a superuser, connected to the
-- target database: t3leem and t3leem_test).
-- ============================================================================
\set ON_ERROR_STOP on

-- Only the owner may create objects; nobody else gets anything by default.
ALTER SCHEMA public OWNER TO t3leem_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO t3leem_owner;
GRANT USAGE ON SCHEMA public TO t3leem_app;

-- Every table/sequence the owner creates in future migrations is automatically
-- usable (DML only) by the API role — no per-migration GRANTs to forget.
ALTER DEFAULT PRIVILEGES FOR ROLE t3leem_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO t3leem_app;
ALTER DEFAULT PRIVILEGES FOR ROLE t3leem_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO t3leem_app;
ALTER DEFAULT PRIVILEGES FOR ROLE t3leem_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO t3leem_app;

-- Objects that may already exist (re-run after migrations).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO t3leem_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO t3leem_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO t3leem_app;

-- Prisma's migration history is owner business only.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON public._prisma_migrations FROM t3leem_app;
  END IF;
END
$$;
