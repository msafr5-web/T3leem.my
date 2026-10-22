-- ============================================================================
-- t3leem.my — cluster-level setup (run as a superuser, connected to `postgres`)
--
-- Two roles, least privilege:
--   t3leem_owner  owns the schema and runs migrations (DDL). Not a superuser.
--   t3leem_app    what the API connects as: DML only, no DDL, cannot bypass RLS.
--
-- Idempotent: re-running rotates both passwords and changes nothing else.
-- Variables (passed by setup.ps1): :owner_password :app_password
-- ============================================================================
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE t3leem_owner'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 't3leem_owner') \gexec

SELECT 'CREATE ROLE t3leem_app'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 't3leem_app') \gexec

-- NOBYPASSRLS on both: row level security must hold even for the schema owner.
ALTER ROLE t3leem_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE t3leem_app   WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT
                             CONNECTION LIMIT 100;

SELECT format('ALTER ROLE t3leem_owner PASSWORD %L', :'owner_password') \gexec
SELECT format('ALTER ROLE t3leem_app PASSWORD %L', :'app_password') \gexec

-- Guard rails for the API role: a stuck query or forgotten transaction can't hold
-- locks or a pooled connection indefinitely.
ALTER ROLE t3leem_app SET statement_timeout = '30s';
ALTER ROLE t3leem_app SET lock_timeout = '10s';
ALTER ROLE t3leem_app SET idle_in_transaction_session_timeout = '60s';

-- UTF-8 with PostgreSQL's builtin C.UTF-8 provider: Arabic text stored and compared
-- correctly, and collation doesn't change with OS/ICU upgrades (no silent index corruption).
SELECT 'CREATE DATABASE t3leem WITH OWNER t3leem_owner TEMPLATE template0 ENCODING ''UTF8''
          LOCALE_PROVIDER builtin BUILTIN_LOCALE ''C.UTF-8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 't3leem') \gexec

-- Isolated database for the RLS integration tests (never point tests at t3leem).
SELECT 'CREATE DATABASE t3leem_test WITH OWNER t3leem_owner TEMPLATE template0 ENCODING ''UTF8''
          LOCALE_PROVIDER builtin BUILTIN_LOCALE ''C.UTF-8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 't3leem_test') \gexec

ALTER DATABASE t3leem      SET timezone TO 'UTC';
ALTER DATABASE t3leem_test SET timezone TO 'UTC';

REVOKE ALL ON DATABASE t3leem      FROM PUBLIC;
REVOKE ALL ON DATABASE t3leem_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE t3leem      TO t3leem_owner, t3leem_app;
GRANT CONNECT, TEMPORARY ON DATABASE t3leem_test TO t3leem_owner, t3leem_app;
