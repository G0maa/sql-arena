-- bootstrap.sql — orchestrator for the SQL Arena database structure (AgDR-0006).
--
-- Run by 00-bootstrap.sh as the bootstrap superuser. Idempotent + re-runnable:
-- safe on a fresh volume (via the Postgres initdb.d entry) AND on an existing DB
-- (via `npm run db:bootstrap`). The seed half is also re-executed at runtime by
-- the per-submission reset (AgDR-0004).
--
-- Expects two psql variables (passed by 00-bootstrap.sh from the environment
-- vars ARENA_RUNNER_PASSWORD / ARENA_RW_PASSWORD):
--   :run_pw   :rw_pw

\set ON_ERROR_STOP on

-- 1. Roles. Idempotent CREATE guarded on pg_roles. Passwords are set in a
--    SEPARATE statement because psql ':var' interpolation does NOT reach inside
--    $$…$$ dollar-quotes — so we can't set them in the DO block.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arena_runner') THEN
    CREATE ROLE arena_runner LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arena_rw') THEN
    CREATE ROLE arena_rw LOGIN;
  END IF;
END
$$;

ALTER ROLE arena_runner PASSWORD :'run_pw';
ALTER ROLE arena_rw     PASSWORD :'rw_pw';

-- 2. Schemas, each owned by its role (AUTHORIZATION). On re-run the schema
--    already exists, so IF NOT EXISTS makes this a no-op (AUTHORIZATION ignored).
CREATE SCHEMA IF NOT EXISTS seed AUTHORIZATION arena_runner;
CREATE SCHEMA IF NOT EXISTS app  AUTHORIZATION arena_rw;

-- 3. Table DDL run under each owning role, so the tables are OWNED BY that role.
--    Seed ownership by arena_runner is what enables contestant CREATE INDEX
--    (AgDR-0004) — CREATE INDEX requires ownership on PG 16/17/18. `\ir` includes
--    relative to THIS file, so it resolves from the repo root and from
--    /docker-entrypoint-initdb.d/sql/ alike.
SET ROLE arena_runner;
\ir seed.sql
RESET ROLE;

SET ROLE arena_rw;
\ir app.sql
RESET ROLE;

-- 4. Isolation boundary. Named (non-public) schemas grant nothing to PUBLIC by
--    default; these REVOKEs are belt-and-suspenders so the golden answers + the
--    leaderboard (app) are unreachable from contestant submission SQL run as
--    arena_runner, and the dataset (seed) is unreachable from the app role.
REVOKE ALL ON SCHEMA app  FROM arena_runner, PUBLIC;
REVOKE ALL ON SCHEMA seed FROM arena_rw,     PUBLIC;
