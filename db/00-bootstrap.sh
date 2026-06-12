#!/bin/sh
# 00-bootstrap.sh — applies the SQL Arena database structure (AgDR-0006).
#
# One script, two entry points:
#   1. Postgres initdb.d — auto-run ONCE on a fresh data volume by the postgres
#      container entrypoint (as the superuser over the local socket). Only this
#      top-level .sh sits in initdb.d; the .sql live in ./sql so the entrypoint
#      does not execute them standalone and double-apply.
#   2. `npm run db:bootstrap` — re-applies the same DDL to an existing DB from
#      the host, connecting via $DATABASE_URL.
#
# Idempotent: safe to run repeatedly.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOOTSTRAP_SQL="$SCRIPT_DIR/sql/bootstrap.sql"

# Dev-only fallback role credentials. Real values come from the environment
# (.env / docker-compose). Never commit real role credentials. The `:=` form
# assigns the default in place when the variable is unset.
: "${ARENA_RUNNER_PASSWORD:=runner}"
: "${ARENA_RW_PASSWORD:=rw}"

# Connection: prefer an explicit DATABASE_URL (host / dev use). Fall back to the
# local-socket connection the postgres entrypoint provides during initdb, where
# only POSTGRES_USER / POSTGRES_DB are set.
if [ -n "${DATABASE_URL:-}" ]; then
  set -- "$DATABASE_URL"
else
  set -- --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}"
fi

echo "==> Bootstrapping SQL Arena schema (seed + app + roles)…"
psql -v ON_ERROR_STOP=1 \
  -v run_pw="$ARENA_RUNNER_PASSWORD" \
  -v rw_pw="$ARENA_RW_PASSWORD" \
  "$@" \
  -f "$BOOTSTRAP_SQL"
echo "==> SQL Arena schema bootstrap complete."
